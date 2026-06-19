import Fastify from "fastify";
import cors from "@fastify/cors";
import { getSwapFromEvmTxPayload } from "@mayanfinance/swap-sdk";
import type { Quote as MayanSdkQuote } from "@mayanfinance/swap-sdk";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  BRIDGE_FEE_BPS,
  CHAINFLIP,
  CHAINS,
  ChainflipClient,
  JupiterClient,
  THORCHAIN,
  ThorchainClient,
  USDC_MINT_ADDRESS,
  WXMR_MINT_ADDRESS,
  assertValidMoneroAddress,
  buildMayanSwiftFunding,
  chainflipDepositExpiresAt,
  chainflipMinSolanaUsdcOut,
  filterMayanTokensForChain,
  quoteHasPositiveOutput,
  thorchainAmountToBaseUnits,
  thorchainSeconds,
  type ChainflipQuote,
  type DepositAddressFunding,
  type ExecutionPolicy,
  type MayanEvmTxPayload,
  type MayanToken,
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
import { SolanaExecutor } from "./chain/solana.js";
import { deriveReverseDepositOwner } from "./reverse.js";

const env = loadEnv();
const store = new Store(env.dbPath);
const connection = new Connection(env.solanaRpcUrl, "confirmed");
const jupiter = new JupiterClient({ apiKey: env.jupiterApiKey });
const mayan = new MayanClient({ apiKey: env.mayanApiKey });
const chainflip = new ChainflipClient({ backendUrl: env.chainflipBackendUrl });
const thorchain = new ThorchainClient({ thornodeUrl: env.thornodeUrl, clientId: env.thornodeClientId });
const solana = new SolanaExecutor(connection, env.solanaHotWallet, env.bridgeProgramId, env.jupiterApiKey, env.mayanApiKey);
const DEFAULT_EXECUTION_POLICY: ExecutionPolicy = "execute-anyway";
const DEFAULT_SLIPPAGE_BPS = 200;
const MAX_SLIPPAGE_BPS = 2_000;
const USDC_DECIMALS = 6;

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
    if (sourceChain === "bitcoin") {
      return [{
        name: "Bitcoin",
        symbol: "BTC",
        contract: THORCHAIN.btcAsset,
        decimals: 8,
        logoURI: "https://assets.coingecko.com/coins/images/1/large/bitcoin.png",
        verified: true,
      }];
    }
    const chain = CHAINS[sourceChain];
    if (!chain?.mayanChain) {
      return reply.code(404).send({ error: "unsupported sourceChain" });
    }
    const tokens = await mayan.fetchTokens(sourceChain);
    return filterMayanTokensForChain(tokens, sourceChain).filter((token) => token.verified !== false);
  });

  app.post(route("/quote"), async (request, reply) => {
    const body = request.body as Partial<QuoteRequest>;
    const direction = body.direction ?? "mayan-to-xmr";
    const executionPolicy = normalizeExecutionPolicy(body.executionPolicy);
    const sourceChain = body.sourceChain as SourceChainId;
    if (!sourceChain || !CHAINS[sourceChain]) {
      return reply.code(400).send({ error: "unsupported sourceChain" });
    }
    if (!body.amount || BigInt(body.amount) <= 0n) {
      return reply.code(400).send({ error: "amount must be a positive integer in base units" });
    }
    if (!body.sourceToken) {
      return reply.code(400).send({ error: "sourceToken is required" });
    }

    if (direction === "mayan-to-xmr") {
      if (body.xmrAddress) {
        assertValidMoneroAddress(body.xmrAddress);
      }

      const chain = CHAINS[sourceChain];
      if (sourceChain !== "solana" && sourceChain !== "bitcoin" && chain.kind !== "evm") {
        return reply.code(400).send({ error: "this build supports Mayan Swift v2 EVM sources; Sui and Hyperliquid need separate wallet signing" });
      }
      const quote = sourceChain === "bitcoin" ? await quoteBtcToXmr({
        direction,
        sourceChain,
        sourceToken: body.sourceToken,
        amount: body.amount,
        sourceAddress: body.sourceAddress,
        xmrAddress: body.xmrAddress,
        refundAddress: body.refundAddress,
        slippageBps: body.slippageBps,
        executionPolicy,
      }) : sourceChain === "solana" ? await quoteSolanaToXmr({
        direction,
        sourceChain,
        sourceToken: body.sourceToken,
        amount: body.amount,
        xmrAddress: body.xmrAddress,
        refundAddress: body.refundAddress,
        slippageBps: body.slippageBps,
        executionPolicy,
      }) : await quoteUsdcToXmr({
        direction,
        sourceChain,
        sourceToken: body.sourceToken,
        amount: body.amount,
        xmrAddress: body.xmrAddress,
        refundAddress: body.refundAddress,
        slippageBps: body.slippageBps,
        executionPolicy,
      });
      store.insertQuote(quote);
      return quote;
    }

    if (direction !== "xmr-to-mayan") {
      return reply.code(400).send({ error: "unsupported direction" });
    }
    assertValidMoneroAddress(body.xmrAddress ?? "");
    if (!body.destinationAddress) {
      return reply.code(400).send({ error: "destinationAddress is required" });
    }
    if (sourceChain === "solana") {
      try {
        new PublicKey(body.destinationAddress);
      } catch {
        return reply.code(400).send({ error: "destinationAddress must be a Solana wallet address" });
      }
    }
    if (!CHAINS[sourceChain].mayanChain) {
      return reply.code(400).send({ error: "destination chain is not supported by Mayan" });
    }

    const quote = sourceChain === "solana" ? await quoteXmrToSolana({
      direction,
      sourceChain,
      sourceToken: body.sourceToken,
      amount: body.amount,
      xmrAddress: body.xmrAddress!,
      destinationAddress: body.destinationAddress,
      refundAddress: body.refundAddress,
      slippageBps: body.slippageBps,
      executionPolicy,
    }) : await quoteXmrToMayan({
      direction,
      sourceChain,
      sourceToken: body.sourceToken,
      amount: body.amount,
      xmrAddress: body.xmrAddress!,
      destinationAddress: body.destinationAddress,
      refundAddress: body.refundAddress,
      slippageBps: body.slippageBps,
      executionPolicy,
    });
    store.insertQuote(quote);
    return quote;
  });

  app.post(route("/orders"), async (request, reply) => {
    const body = request.body as { quoteId?: string; sourceAddress?: string; refundAddress?: string; xmrAddress?: string; executionPolicy?: ExecutionPolicy };
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
    if (!quoteHasPositiveOutput(quote)) {
      return reply.code(400).send({ error: "quote output is zero" });
    }

    const now = new Date().toISOString();
    const orderId = crypto.randomUUID();
    const refundAddress = body.refundAddress ?? quote.refundAddress;
    const sourceAddress = body.sourceAddress ?? quote.sourceAddress;
    const xmrAddress = body.xmrAddress ?? quote.xmrAddress;
    const executionPolicy = normalizeExecutionPolicy(body.executionPolicy ?? quote.executionPolicy);
    if (quote.direction === "mayan-to-xmr") {
      assertValidMoneroAddress(xmrAddress ?? "");
    }
    if (quote.route === "chainflip" && !sourceAddress) {
      return reply.code(400).send({ error: "BTC refund address is required for Chainflip" });
    }
    const funding = await buildFundingInstructions(orderId, { ...quote, sourceAddress, refundAddress, xmrAddress: xmrAddress ?? quote.xmrAddress });
    const orderExpiresAt = funding.type === "deposit-address" ? funding.expiresAt : quote.expiresAt;
    const order: Order = {
      id: orderId,
      quoteId: quote.id,
      direction: quote.direction,
      status: "awaiting_deposit",
      sourceChain: quote.sourceChain,
      sourceToken: quote.sourceToken,
      amount: quote.inputAmount,
      xmrAddress: xmrAddress ?? quote.xmrAddress,
      destinationAddress: quote.destinationAddress,
      destinationTokenSymbol: quote.destinationTokenSymbol,
      destinationTokenDecimals: quote.destinationTokenDecimals,
      refundAddress,
      executionPolicy,
      funding,
      createdAt: now,
      updatedAt: now,
      expiresAt: orderExpiresAt,
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
    if (order.funding.type === "solana-transfer") {
      const verified = await solana.verifySolanaTransfer(order.funding, body.txHash);
      return store.updateOrder(
        id,
        {
          sourceTxHash: body.txHash,
          status: "minted",
          destinationAmount: verified.amount.toString(),
        },
        `verified Solana funding transfer for ${verified.amount}`,
      );
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
  const slippageBps = normalizeSlippageBps(input.slippageBps);
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
    direction: "mayan-to-xmr",
    sourceChain: input.sourceChain,
    sourceToken: mayanQuote.fromToken.contract ?? input.sourceToken,
    sourceTokenSymbol: mayanQuote.fromToken.symbol,
    sourceTokenDecimals: mayanQuote.fromToken.decimals,
    inputAmount: input.amount,
    xmrAddress: input.xmrAddress ?? "",
    refundAddress: input.refundAddress,
    estimatedWxmrOut: afterService.toString(),
    estimatedXmrOut: estimatedXmrOut.toString(),
    minWxmrOut: minWxmrOut.toString(),
    minXmrOut: minXmrOut.toString(),
    bridgeFeeBps: BRIDGE_FEE_BPS,
    serviceFeeBps: env.serviceFeeBps,
    executionPolicy: input.executionPolicy ?? DEFAULT_EXECUTION_POLICY,
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

async function quoteSolanaToXmr(input: QuoteRequest): Promise<Quote> {
  const token = await findToken(input.sourceChain, input.sourceToken);
  const slippageBps = normalizeSlippageBps(input.slippageBps);
  const expectedJupiterQuote = await jupiter.quote({
    inputMint: input.sourceToken,
    outputMint: WXMR_MINT_ADDRESS,
    amount: input.amount,
    taker: env.solanaHotWallet.publicKey.toBase58(),
  });
  const grossWxmr = BigInt(expectedJupiterQuote.outAmount);
  const minGrossWxmr = applyBps(grossWxmr, 10_000 - slippageBps);
  const afterService = applyBps(grossWxmr, 10_000 - env.serviceFeeBps);
  const minWxmrOut = applyBps(minGrossWxmr, 10_000 - env.serviceFeeBps);
  const estimatedXmrOut = applyBps(afterService, 10_000 - BRIDGE_FEE_BPS);
  const minXmrOut = applyBps(minWxmrOut, 10_000 - BRIDGE_FEE_BPS);
  const tokenSymbol = token.symbol ?? "Token";

  return {
    id: crypto.randomUUID(),
    direction: "mayan-to-xmr",
    sourceChain: "solana",
    sourceToken: token.contract ?? input.sourceToken,
    sourceTokenSymbol: token.symbol,
    sourceTokenDecimals: token.decimals,
    inputAmount: input.amount,
    xmrAddress: input.xmrAddress ?? "",
    refundAddress: input.refundAddress,
    estimatedWxmrOut: afterService.toString(),
    estimatedXmrOut: estimatedXmrOut.toString(),
    minWxmrOut: minWxmrOut.toString(),
    minXmrOut: minXmrOut.toString(),
    bridgeFeeBps: BRIDGE_FEE_BPS,
    serviceFeeBps: env.serviceFeeBps,
    executionPolicy: input.executionPolicy ?? DEFAULT_EXECUTION_POLICY,
    jupiterPriceImpactPct: expectedJupiterQuote.priceImpactPct ?? "0",
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    route: "solana",
    routeSummary: `${tokenSymbol} on Solana -> XMR-SOL via jup.ag -> native XMR via Monero Bridge`,
  };
}

async function quoteBtcToXmr(input: QuoteRequest): Promise<Quote> {
  const slippageBps = normalizeSlippageBps(input.slippageBps);

  const chainflipQuote = await chainflip.fetchBtcToSolanaUsdcQuote({
    amount: input.amount,
  }).catch(() => null);

  if (chainflipQuote) {
    const expectedSolanaUsdcOut = chainflipQuote.egressAmount;
    const minSolanaUsdcOut = chainflipMinSolanaUsdcOut(chainflipQuote, slippageBps);
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
      direction: "mayan-to-xmr",
      sourceChain: "bitcoin",
      sourceToken: input.sourceToken,
      sourceTokenSymbol: "BTC",
      sourceTokenDecimals: CHAINFLIP.btcDecimals,
      inputAmount: input.amount,
      sourceAddress: input.sourceAddress,
      xmrAddress: input.xmrAddress ?? "",
      refundAddress: input.refundAddress,
      estimatedWxmrOut: afterService.toString(),
      estimatedXmrOut: estimatedXmrOut.toString(),
      minWxmrOut: minWxmrOut.toString(),
      minXmrOut: minXmrOut.toString(),
      bridgeFeeBps: BRIDGE_FEE_BPS,
      serviceFeeBps: env.serviceFeeBps,
      executionPolicy: input.executionPolicy ?? DEFAULT_EXECUTION_POLICY,
      jupiterPriceImpactPct: expectedJupiterQuote.priceImpactPct ?? "0",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      route: "chainflip",
      routeSummary: "BTC -> USDC-SOL via Chainflip -> XMR-SOL via jup.ag -> native XMR via Monero Bridge",
      chainflip: {
        fromAsset: "BTC",
        toAsset: "USDC-SOL",
        quote: chainflipQuote,
        expectedSolanaUsdcOut,
        minSolanaUsdcOut,
        slippageBps,
        estimatedTimeSeconds: chainflipQuote.estimatedDurationSeconds,
        fees: chainflipQuote.includedFees,
      },
    };
  }

  let directError: unknown;
  const directQuote = await thorchain.fetchSwapQuote({
    fromAsset: THORCHAIN.btcAsset,
    toAsset: THORCHAIN.solanaUsdcAsset,
    amount: input.amount,
    destination: env.solanaHotWallet.publicKey.toBase58(),
    toleranceBps: slippageBps,
  }).catch((error) => {
    directError = error;
    return null;
  });

  const thorQuote = directQuote ? {
    mode: "direct-solana" as const,
    toAsset: THORCHAIN.solanaUsdcAsset,
    quote: directQuote,
    expectedSolanaUsdcOut: thorchainAmountToBaseUnits(directQuote.expected_amount_out, USDC_DECIMALS),
    minSolanaUsdcOut: applyBps(
      BigInt(thorchainAmountToBaseUnits(directQuote.expected_amount_out, USDC_DECIMALS)),
      10_000 - slippageBps,
    ).toString(),
    estimatedTimeSeconds: thorchainSeconds(directQuote),
    mayan: undefined,
    routeSummary: "BTC -> USDC-SOL via THORChain -> XMR-SOL via jup.ag -> native XMR via Monero Bridge",
  } : await quoteBtcToEthUsdc(input, slippageBps, directError);
  const expectedSolanaUsdcOut = thorQuote.expectedSolanaUsdcOut;
  const minSolanaUsdcOut = thorQuote.minSolanaUsdcOut;
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
    direction: "mayan-to-xmr",
    sourceChain: "bitcoin",
    sourceToken: THORCHAIN.btcAsset,
    sourceTokenSymbol: "BTC",
    sourceTokenDecimals: 8,
    inputAmount: input.amount,
    sourceAddress: input.sourceAddress,
    xmrAddress: input.xmrAddress ?? "",
    refundAddress: input.refundAddress,
    estimatedWxmrOut: afterService.toString(),
    estimatedXmrOut: estimatedXmrOut.toString(),
    minWxmrOut: minWxmrOut.toString(),
    minXmrOut: minXmrOut.toString(),
    bridgeFeeBps: BRIDGE_FEE_BPS,
    serviceFeeBps: env.serviceFeeBps,
    executionPolicy: input.executionPolicy ?? DEFAULT_EXECUTION_POLICY,
    jupiterPriceImpactPct: expectedJupiterQuote.priceImpactPct ?? "0",
    expiresAt: new Date(thorQuote.quote.expiry * 1000).toISOString(),
    route: "thorchain",
    routeSummary: thorQuote.routeSummary,
    thorchain: {
      mode: thorQuote.mode,
      fromAsset: THORCHAIN.btcAsset,
      toAsset: thorQuote.toAsset,
      expectedOut: thorQuote.quote.expected_amount_out,
      expectedSolanaUsdcOut,
      minSolanaUsdcOut,
      inboundAddress: thorQuote.quote.inbound_address!,
      memo: thorQuote.quote.memo!,
      expiry: thorQuote.quote.expiry,
      estimatedTimeSeconds: thorQuote.estimatedTimeSeconds,
      fees: thorQuote.quote.fees,
      mayan: thorQuote.mayan,
    },
  };
}

async function quoteBtcToEthUsdc(
  input: QuoteRequest,
  slippageBps: number,
  directError: unknown,
): Promise<{
  mode: "eth-usdc-fallback";
  toAsset: string;
  quote: Awaited<ReturnType<ThorchainClient["fetchSwapQuote"]>>;
  mayan: NonNullable<Quote["mayan"]>;
  expectedSolanaUsdcOut: string;
  minSolanaUsdcOut: string;
  estimatedTimeSeconds?: number;
  routeSummary: string;
}> {
  if (!env.evmHotWalletAddress) {
    const reason = directError instanceof Error ? directError.message : "direct route unavailable";
    throw new Error(`Direct THORChain BTC -> USDC-SOL is unavailable (${reason}); EVM_HOTWALLET_PRIVATE_KEY is required for BTC -> ETH USDC fallback`);
  }

  const quote = await thorchain.fetchSwapQuote({
    fromAsset: THORCHAIN.btcAsset,
    toAsset: THORCHAIN.ethUsdcAsset,
    amount: input.amount,
    destination: env.evmHotWalletAddress,
    toleranceBps: slippageBps,
  });
  const expectedEthUsdcOut = thorchainAmountToBaseUnits(quote.expected_amount_out, USDC_DECIMALS);
  const mayanQuote = await mayan.fetchSwiftQuoteForRoute({
    fromChain: "ethereum",
    fromToken: CHAINS.ethereum.usdc!,
    toChain: "solana",
    toToken: USDC_MINT_ADDRESS,
    amount: expectedEthUsdcOut,
    destinationAddress: env.solanaHotWallet.publicKey.toBase58(),
    slippageBps,
  });
  const mayanMetadata = {
    quote: mayanQuote,
    expectedSolanaUsdcOut: mayanQuote.expectedAmountOutBaseUnits,
    minSolanaUsdcOut: mayanQuote.minReceivedBaseUnits,
    etaSeconds: mayanQuote.etaSeconds,
    clientEta: mayanQuote.clientEta,
    protocolBps: mayanQuote.protocolBps,
    quoteId: mayanQuote.quoteId,
  };
  return {
    mode: "eth-usdc-fallback",
    toAsset: THORCHAIN.ethUsdcAsset,
    quote,
    mayan: mayanMetadata,
    expectedSolanaUsdcOut: mayanMetadata.expectedSolanaUsdcOut,
    minSolanaUsdcOut: mayanMetadata.minSolanaUsdcOut,
    estimatedTimeSeconds: (thorchainSeconds(quote) ?? 0) + (mayanQuote.etaSeconds ?? 0),
    routeSummary: "BTC -> USDC-ETH via THORChain -> USDC-SOL via Mayan Swift v2 -> XMR-SOL via jup.ag -> native XMR via Monero Bridge",
  };
}

async function quoteXmrToMayan(input: QuoteRequest): Promise<Quote> {
  if (!input.destinationAddress) throw new Error("destinationAddress is required");
  const slippageBps = normalizeSlippageBps(input.slippageBps);
  const inputAmount = BigInt(input.amount);
  const afterService = applyBps(inputAmount, 10_000 - env.serviceFeeBps);
  const expectedJupiterQuote = await jupiter.quoteWxmrToUsdc(afterService);
  const expectedSolanaUsdcOut = expectedJupiterQuote.outAmount;
  const minSolanaUsdcOut = applyBps(BigInt(expectedSolanaUsdcOut), 10_000 - slippageBps).toString();
  const mayanQuote = await mayan.fetchSwiftQuoteForRoute({
    fromChain: "solana",
    fromToken: USDC_MINT_ADDRESS,
    toChain: input.sourceChain,
    toToken: input.sourceToken,
    amount: expectedSolanaUsdcOut,
    destinationAddress: input.destinationAddress,
    slippageBps,
  });

  return {
    id: crypto.randomUUID(),
    direction: "xmr-to-mayan",
    sourceChain: input.sourceChain,
    sourceToken: mayanQuote.toToken.contract ?? input.sourceToken,
    sourceTokenSymbol: mayanQuote.toToken.symbol,
    sourceTokenDecimals: mayanQuote.toToken.decimals,
    inputAmount: input.amount,
    xmrAddress: input.xmrAddress ?? "",
    destinationAddress: input.destinationAddress,
    destinationTokenSymbol: mayanQuote.toToken.symbol,
    destinationTokenDecimals: mayanQuote.toToken.decimals,
    refundAddress: input.refundAddress,
    estimatedWxmrOut: afterService.toString(),
    estimatedXmrOut: input.amount,
    minWxmrOut: afterService.toString(),
    minXmrOut: input.amount,
    estimatedDestinationOut: mayanQuote.expectedAmountOutBaseUnits,
    minDestinationOut: mayanQuote.minReceivedBaseUnits,
    bridgeFeeBps: 0,
    serviceFeeBps: env.serviceFeeBps,
    executionPolicy: input.executionPolicy ?? DEFAULT_EXECUTION_POLICY,
    jupiterPriceImpactPct: expectedJupiterQuote.priceImpactPct ?? "0",
    expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    route: "mayan",
    routeSummary: `native XMR -> XMR-SOL via Monero Bridge -> USDC-SOL via jup.ag -> ${mayanQuote.toToken.symbol ?? "Token"} on ${CHAINS[input.sourceChain].name} via Mayan Swift v2`,
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

async function quoteXmrToSolana(input: QuoteRequest): Promise<Quote> {
  if (!input.destinationAddress) throw new Error("destinationAddress is required");
  const token = await findToken(input.sourceChain, input.sourceToken);
  const slippageBps = normalizeSlippageBps(input.slippageBps);
  const inputAmount = BigInt(input.amount);
  const afterService = applyBps(inputAmount, 10_000 - env.serviceFeeBps);
  const expectedJupiterQuote = await jupiter.quote({
    inputMint: WXMR_MINT_ADDRESS,
    outputMint: input.sourceToken,
    amount: afterService,
  });
  const minDestinationOut = applyBps(BigInt(expectedJupiterQuote.outAmount), 10_000 - slippageBps);
  const tokenSymbol = token.symbol ?? "Token";

  return {
    id: crypto.randomUUID(),
    direction: "xmr-to-mayan",
    sourceChain: "solana",
    sourceToken: token.contract ?? input.sourceToken,
    sourceTokenSymbol: token.symbol,
    sourceTokenDecimals: token.decimals,
    inputAmount: input.amount,
    xmrAddress: input.xmrAddress ?? "",
    destinationAddress: input.destinationAddress,
    destinationTokenSymbol: token.symbol,
    destinationTokenDecimals: token.decimals,
    refundAddress: input.refundAddress,
    estimatedWxmrOut: afterService.toString(),
    estimatedXmrOut: input.amount,
    minWxmrOut: afterService.toString(),
    minXmrOut: input.amount,
    estimatedDestinationOut: expectedJupiterQuote.outAmount,
    minDestinationOut: minDestinationOut.toString(),
    bridgeFeeBps: 0,
    serviceFeeBps: env.serviceFeeBps,
    executionPolicy: input.executionPolicy ?? DEFAULT_EXECUTION_POLICY,
    jupiterPriceImpactPct: expectedJupiterQuote.priceImpactPct ?? "0",
    expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    route: "solana",
    routeSummary: `native XMR -> XMR-SOL via Monero Bridge -> ${tokenSymbol} on Solana via jup.ag`,
  };
}

async function buildFundingInstructions(orderId: string, quote: Quote): Promise<FundingInstructions> {
  if (quote.direction === "xmr-to-mayan") {
    const owner = deriveReverseDepositOwner(env.solanaHotWallet, orderId);
    const created = await solana.createMoneroDepositAccount(owner);
    const depositFunding: DepositAddressFunding = {
      type: "deposit-address",
      orderId,
      chainId: "monero",
      asset: "XMR",
      address: created.deposit?.xmrDepositAddress ?? "",
      expiresAt: quote.expiresAt,
      expectedAmount: quote.inputAmount,
      depositOwner: owner.publicKey.toBase58(),
      depositPda: created.depositPda,
      createSignature: created.signature || undefined,
    };
    return depositFunding;
  }

  if (quote.route === "solana") {
    const mint = new PublicKey(quote.sourceToken);
    const destinationTokenAccount = getAssociatedTokenAddressSync(mint, env.solanaHotWallet.publicKey);
    return {
      type: "solana-transfer",
      orderId,
      chainId: "solana",
      mint: mint.toBase58(),
      tokenSymbol: quote.sourceTokenSymbol,
      tokenDecimals: quote.sourceTokenDecimals,
      amount: quote.inputAmount,
      destinationTokenAccount: destinationTokenAccount.toBase58(),
      destinationOwner: env.solanaHotWallet.publicKey.toBase58(),
      memo: orderId,
    };
  }

  if (quote.route === "thorchain") {
    if (!quote.thorchain) throw new Error("THORChain quote metadata is missing");
    return {
      type: "deposit-address",
      orderId,
      chainId: "bitcoin",
      asset: "BTC",
      address: quote.thorchain.inboundAddress,
      memo: quote.thorchain.memo,
      expiresAt: quote.expiresAt,
      expectedAmount: quote.inputAmount,
      sourceAddress: quote.sourceAddress,
      provider: "THORChain",
      targetAsset: quote.thorchain.toAsset,
    };
  }

  if (quote.route === "chainflip") {
    if (!quote.chainflip) throw new Error("Chainflip quote metadata is missing");
    if (!quote.sourceAddress) throw new Error("BTC refund address is required for Chainflip");
    const deposit = await chainflip.openDepositAddress({
      quote: quote.chainflip.quote as ChainflipQuote,
      destinationAddress: env.solanaHotWallet.publicKey.toBase58(),
      refundAddress: quote.sourceAddress,
      slippageBps: quote.chainflip.slippageBps,
    });
    return {
      type: "deposit-address",
      orderId,
      chainId: "bitcoin",
      asset: "BTC",
      address: deposit.depositAddress,
      expiresAt: chainflipDepositExpiresAt(deposit),
      expectedAmount: quote.inputAmount,
      sourceAddress: quote.sourceAddress,
      provider: "Chainflip",
      targetAsset: "USDC-SOL",
      depositChannelId: deposit.id,
      channelOpeningFee: deposit.channelOpeningFee,
      maxBoostFeeBps: deposit.maxBoostFeeBps,
    };
  }

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

async function findToken(sourceChain: SourceChainId, contract: string): Promise<MayanToken> {
  const tokens = filterMayanTokensForChain(await mayan.fetchTokens(sourceChain), sourceChain);
  const token = tokens.find((candidate) => {
    const candidateContract = candidate.contract ?? candidate.mint;
    return candidateContract?.toLowerCase() === contract.toLowerCase();
  });
  if (!token) {
    throw new Error(`token ${contract} is not supported on ${CHAINS[sourceChain].name}`);
  }
  return {
    ...token,
    contract: token.contract ?? token.mint ?? contract,
  };
}

function applyBps(amount: bigint, bps: number): bigint {
  return (amount * BigInt(bps)) / 10_000n;
}

function normalizeSlippageBps(slippageBps: number | undefined): number {
  return Math.max(0, Math.min(slippageBps ?? DEFAULT_SLIPPAGE_BPS, MAX_SLIPPAGE_BPS));
}

function normalizeExecutionPolicy(value: unknown): ExecutionPolicy {
  return value === "execute-anyway" ? "execute-anyway" : DEFAULT_EXECUTION_POLICY;
}
