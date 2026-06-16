import Fastify from "fastify";
import cors from "@fastify/cors";
import { getSwapFromEvmTxPayload } from "@mayanfinance/swap-sdk";
import type { Quote as MayanSdkQuote } from "@mayanfinance/swap-sdk";
import {
  BRIDGE_FEE_BPS,
  CHAINS,
  JupiterClient,
  assertValidMoneroAddress,
  buildMayanSwiftFunding,
  type MayanEvmTxPayload,
  MayanClient,
  type FundingInstructions,
  type MayanSwiftFunding,
  type Order,
  type Quote,
  type QuoteRequest,
  type SourceChainId,
} from "@wxmr/core";
import { loadEnv } from "./env.js";
import { Store } from "./db.js";

const env = loadEnv();
const store = new Store(env.dbPath);
const jupiter = new JupiterClient({ apiKey: env.jupiterApiKey });
const mayan = new MayanClient({ apiKey: env.mayanApiKey });

const app = Fastify({ logger: true });
await app.register(cors, {
  origin: true,
  methods: ["GET", "POST", "OPTIONS"],
});

registerRoutes("");
registerRoutes("/api");

await app.listen({ host: env.host, port: env.port });

function registerRoutes(prefix: "" | "/api"): void {
  const route = (path: string) => `${prefix}${path}`;

  app.get(route("/health"), async () => ({ ok: true }));

  app.get(route("/tokens/:sourceChain"), async (request, reply) => {
    const { sourceChain } = request.params as { sourceChain: SourceChainId };
    const chain = CHAINS[sourceChain];
    if (!chain?.mayanChain) {
      return reply.code(404).send({ error: "unsupported sourceChain" });
    }
    const tokens = await mayan.fetchTokens(sourceChain);
    return tokens.filter((token) => token.verified !== false);
  });

  app.post(route("/quote"), async (request, reply) => {
    const body = request.body as Partial<QuoteRequest>;
    const sourceChain = body.sourceChain as SourceChainId;
    if (!sourceChain || !CHAINS[sourceChain]) {
      return reply.code(400).send({ error: "unsupported sourceChain" });
    }
    if (!body.amount || BigInt(body.amount) <= 0n) {
      return reply.code(400).send({ error: "amount must be a positive integer in USDC base units" });
    }
    assertValidMoneroAddress(body.xmrAddress ?? "");

    const chain = CHAINS[sourceChain];
    if (chain.kind !== "evm") {
      return reply.code(400).send({ error: "this build supports Mayan Swift v2 EVM sources; Sui and Hyperliquid need separate wallet signing" });
    }
    if (!body.sourceToken) {
      return reply.code(400).send({ error: "sourceToken is required" });
    }

    const quote = await quoteUsdcToXmr({
      sourceChain,
      sourceToken: body.sourceToken,
      amount: body.amount,
      xmrAddress: body.xmrAddress!,
      refundAddress: body.refundAddress,
      slippageBps: body.slippageBps,
    });
    store.insertQuote(quote);
    return quote;
  });

  app.post(route("/orders"), async (request, reply) => {
    const body = request.body as { quoteId?: string; refundAddress?: string };
    if (!body.quoteId) {
      return reply.code(400).send({ error: "quoteId is required" });
    }
    const quote = store.getQuote(body.quoteId);
    if (!quote) {
      return reply.code(404).send({ error: "quote not found" });
    }
    if (Date.parse(quote.expiresAt) <= Date.now()) {
      return reply.code(400).send({ error: "quote expired" });
    }

    const now = new Date().toISOString();
    const orderId = crypto.randomUUID();
    const refundAddress = body.refundAddress ?? quote.refundAddress;
    const funding = buildFundingInstructions(orderId, quote);
    const order: Order = {
      id: orderId,
      quoteId: quote.id,
      status: "awaiting_deposit",
      sourceChain: quote.sourceChain,
      sourceToken: quote.sourceToken,
      amount: quote.inputAmount,
      xmrAddress: quote.xmrAddress,
      refundAddress,
      funding,
      createdAt: now,
      updatedAt: now,
      expiresAt: quote.expiresAt,
    };

    store.createOrder(order);
    return { order, funding };
  });

  app.post(route("/orders/:id/deposit"), async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { txHash?: string };
    if (!body.txHash) {
      return reply.code(400).send({ error: "txHash is required" });
    }
    const order = store.getOrder(id);
    if (!order) {
      return reply.code(404).send({ error: "order not found" });
    }
    if (order.status !== "awaiting_deposit") {
      return reply.code(409).send({ error: `order is ${order.status}` });
    }
    const nextStatus = "bridging";
    return store.updateOrder(id, { sourceTxHash: body.txHash, status: nextStatus }, "deposit reported");
  });

  app.post(route("/orders/:id/mayan/evm-payload"), async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { swapperAddress?: string };
    if (!body.swapperAddress) {
      return reply.code(400).send({ error: "swapperAddress is required" });
    }
    const order = store.getOrder(id);
    if (!order) {
      return reply.code(404).send({ error: "order not found" });
    }
    if (order.status !== "awaiting_deposit") {
      return reply.code(409).send({ error: `order is ${order.status}` });
    }
    if (order.funding.type !== "mayan-swift") {
      return reply.code(400).send({ error: "order is not a Mayan Swift order" });
    }

    return buildMayanPayload(order.funding, body.swapperAddress);
  });

  app.get(route("/orders/:id"), async (request, reply) => {
    const { id } = request.params as { id: string };
    const order = store.getOrder(id);
    if (!order) {
      return reply.code(404).send({ error: "order not found" });
    }
    return order;
  });
}

async function quoteUsdcToXmr(input: QuoteRequest): Promise<Quote> {
  const slippageBps = Math.max(0, Math.min(input.slippageBps ?? 100, 2_000));
  const mayanQuote = await mayan.fetchSwiftQuote({
    sourceChain: input.sourceChain,
    sourceToken: input.sourceToken,
    amount: input.amount,
    destinationAddress: env.solanaHotWallet.publicKey.toBase58(),
    slippageBps,
  });
  const expectedSolanaUsdcOut = mayanQuote.expectedAmountOutBaseUnits;
  const minSolanaUsdcOut = mayanQuote.minReceivedBaseUnits;
  const expectedJupiterQuote = await jupiter.quoteUsdcToWxmr(expectedSolanaUsdcOut);
  const minJupiterQuote = await jupiter.quoteUsdcToWxmr(minSolanaUsdcOut);
  const grossWxmr = BigInt(expectedJupiterQuote.outAmount);
  const minGrossWxmr = BigInt(minJupiterQuote.outAmount);
  const afterService = applyBps(grossWxmr, 10_000 - env.serviceFeeBps);
  const minAfterService = applyBps(minGrossWxmr, 10_000 - env.serviceFeeBps);
  const minWxmrOut = applyBps(minAfterService, 10_000 - slippageBps);
  const estimatedXmrOut = applyBps(afterService, 10_000 - BRIDGE_FEE_BPS);
  const minXmrOut = applyBps(minWxmrOut, 10_000 - BRIDGE_FEE_BPS);

  return {
    id: crypto.randomUUID(),
    sourceChain: input.sourceChain,
    sourceToken: mayanQuote.fromToken.contract ?? input.sourceToken,
    sourceTokenSymbol: mayanQuote.fromToken.symbol,
    sourceTokenDecimals: mayanQuote.fromToken.decimals,
    inputAmount: input.amount,
    xmrAddress: input.xmrAddress,
    refundAddress: input.refundAddress,
    estimatedWxmrOut: afterService.toString(),
    estimatedXmrOut: estimatedXmrOut.toString(),
    minWxmrOut: minWxmrOut.toString(),
    minXmrOut: minXmrOut.toString(),
    bridgeFeeBps: BRIDGE_FEE_BPS,
    serviceFeeBps: env.serviceFeeBps,
    jupiterPriceImpactPct: expectedJupiterQuote.priceImpactPct ?? "0",
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    route: "mayan",
    routeSummary: `${mayanQuote.fromToken.symbol ?? "Token"} on ${CHAINS[input.sourceChain].name} -> USDC-SOL via Mayan Swift v2 -> XMR-SOL via jup.ag -> native XMR via Monero Bridge`,
    mayan: {
      quote: mayanQuote,
      expectedSolanaUsdcOut,
      minSolanaUsdcOut,
      etaSeconds: mayanQuote.etaSeconds,
      clientEta: mayanQuote.clientEta,
      protocolBps: mayanQuote.protocolBps,
      quoteId: mayanQuote.quoteId,
    },
  };
}

function buildFundingInstructions(orderId: string, quote: Quote): FundingInstructions {
  if (!quote.mayan) throw new Error("Mayan quote metadata is missing");

  return buildMayanSwiftFunding({
    orderId,
    sourceChain: quote.sourceChain,
    amount: quote.inputAmount,
    destinationAddress: env.solanaHotWallet.publicKey.toBase58(),
    quote: quote.mayan.quote,
  });
}

async function buildMayanPayload(funding: MayanSwiftFunding, swapperAddress: string): Promise<MayanEvmTxPayload> {
  const payload = await getSwapFromEvmTxPayload(
    funding.mayanQuote as unknown as MayanSdkQuote,
    swapperAddress,
    funding.destinationAddress,
    null,
    swapperAddress,
    funding.chainNumericId,
    null,
    null,
    { apiKey: env.mayanApiKey },
  );
  return {
    to: payload.to as MayanEvmTxPayload["to"],
    data: payload.data as MayanEvmTxPayload["data"],
    value: (payload.value ?? "0x0") as MayanEvmTxPayload["value"],
    chainId: Number(payload.chainId),
  };
}

function applyBps(amount: bigint, bps: number): bigint {
  return (amount * BigInt(bps)) / 10_000n;
}
