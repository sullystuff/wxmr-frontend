import Fastify from "fastify";
import cors from "@fastify/cors";
import {
  BRIDGE_FEE_BPS,
  CHAINS,
  JupiterClient,
  USDC_MINT_ADDRESS,
  assertValidMoneroAddress,
  buildEvmCctpBurnFunding,
  type FundingInstructions,
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

const app = Fastify({ logger: true });
await app.register(cors, {
  origin: true,
  methods: ["GET", "POST", "OPTIONS"],
});

app.get("/health", async () => ({ ok: true }));

app.post("/quote", async (request, reply) => {
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
  if (chain.kind !== "evm" && chain.kind !== "solana") {
    return reply.code(400).send({ error: "v1 supports native USDC on EVM chains and Solana only" });
  }

  const quote = await quoteUsdcToXmr({
    sourceChain,
    sourceToken: "USDC",
    amount: body.amount,
    xmrAddress: body.xmrAddress!,
    refundAddress: body.refundAddress,
    slippageBps: body.slippageBps,
  });
  store.insertQuote(quote);
  return quote;
});

app.post("/orders", async (request, reply) => {
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

app.post("/orders/:id/deposit", async (request, reply) => {
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
  const nextStatus = order.sourceChain === "solana" ? "minted" : "attesting";
  return store.updateOrder(id, { sourceTxHash: body.txHash, status: nextStatus }, "deposit reported");
});

app.get("/orders/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const order = store.getOrder(id);
  if (!order) {
    return reply.code(404).send({ error: "order not found" });
  }
  return order;
});

await app.listen({ host: env.host, port: env.port });

async function quoteUsdcToXmr(input: QuoteRequest): Promise<Quote> {
  const slippageBps = Math.max(0, Math.min(input.slippageBps ?? 100, 2_000));
  const jupiterQuote = await jupiter.quoteUsdcToWxmr(input.amount);
  const grossWxmr = BigInt(jupiterQuote.outAmount);
  const afterService = applyBps(grossWxmr, 10_000 - env.serviceFeeBps);
  const minWxmrOut = applyBps(afterService, 10_000 - slippageBps);
  const estimatedXmrOut = applyBps(afterService, 10_000 - BRIDGE_FEE_BPS);
  const minXmrOut = applyBps(minWxmrOut, 10_000 - BRIDGE_FEE_BPS);

  return {
    id: crypto.randomUUID(),
    sourceChain: input.sourceChain,
    sourceToken: "USDC",
    inputAmount: input.amount,
    xmrAddress: input.xmrAddress,
    refundAddress: input.refundAddress,
    estimatedWxmrOut: afterService.toString(),
    estimatedXmrOut: estimatedXmrOut.toString(),
    minWxmrOut: minWxmrOut.toString(),
    minXmrOut: minXmrOut.toString(),
    bridgeFeeBps: BRIDGE_FEE_BPS,
    serviceFeeBps: env.serviceFeeBps,
    jupiterPriceImpactPct: jupiterQuote.priceImpactPct ?? "0",
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    route: "cctp",
  };
}

function buildFundingInstructions(orderId: string, quote: Quote): FundingInstructions {
  if (quote.sourceChain === "solana") {
    return {
      type: "solana-transfer",
      orderId,
      chainId: "solana",
      mint: USDC_MINT_ADDRESS,
      amount: quote.inputAmount,
      destinationTokenAccount: env.hotWalletUsdcAta.toBase58(),
      destinationOwner: env.solanaHotWallet.publicKey.toBase58(),
      memo: orderId,
    };
  }

  return buildEvmCctpBurnFunding({
    orderId,
    sourceChain: quote.sourceChain,
    amount: quote.inputAmount,
    mintRecipient: env.hotWalletUsdcAta,
    destinationCaller: env.solanaHotWallet.publicKey,
  });
}

function applyBps(amount: bigint, bps: number): bigint {
  return (amount * BigInt(bps)) / 10_000n;
}
