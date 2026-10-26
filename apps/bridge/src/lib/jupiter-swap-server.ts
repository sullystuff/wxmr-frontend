import { randomUUID } from "node:crypto";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { getSwapFeeAccount, SWAP_FEE_BPS, SWAP_REFERRAL_ACCOUNT, SWAP_TOKENS, type SwapQuote } from "./jupiter-swap";

interface RouteQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  platformFee: { feeBps: number; amount: string };
  routePlan: unknown[];
}

export class SwapRequestError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function createSwapService(options: { fetchImpl?: typeof fetch; apiKey?: () => string | undefined; now?: () => number } = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const quotes = new Map<string, { quote: RouteQuote; expiresAt: number }>();
  let busy = false;
  let nextRequestAt = 0;

  async function request(path: string, init?: RequestInit) {
    const key = options.apiKey?.() ?? process.env.JUPITER_API_KEY ?? process.env.NEXT_PUBLIC_JUPITER_API_KEY;
    if (!key) throw new SwapRequestError("Swapping is temporarily unavailable.", 503);
    // Keep the shared key within its free-tier budget, without an unbounded queue.
    if (busy) throw new SwapRequestError("Another quote is loading. Please try again shortly.", 429);
    busy = true;
    try {
      const delay = nextRequestAt - now();
      if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
      nextRequestAt = now() + 1100;
      const response = await fetchImpl(`https://api.jup.ag/swap/v1/${path}`, {
        ...init, cache: "no-store", signal: AbortSignal.timeout(20_000),
        headers: { "Content-Type": "application/json", "x-api-key": key },
      });
      if (!response.ok) throw new SwapRequestError(
        response.status === 429 ? "Jupiter is busy. Please try again shortly." : "Jupiter could not find or build this swap. Refresh your quote.",
        response.status === 429 ? 429 : 502,
      );
      return response.json();
    } finally { busy = false; }
  }

  return {
    async quote(params: URLSearchParams): Promise<SwapQuote> {
      const side = params.get("side");
      const symbol = params.get("token");
      const amount = params.get("amount") ?? "";
      const slippageBps = Number(params.get("slippageBps") ?? "50");
      if ((side !== "buy" && side !== "sell") || (symbol !== "SOL" && symbol !== "USDC")
        || !/^[1-9]\d{0,19}$/.test(amount) || BigInt(amount) > BigInt("18446744073709551615")
        || ![10, 50, 100].includes(slippageBps)) throw new SwapRequestError("Invalid swap amount, pair, or slippage.");
      const inputMint = side === "buy" ? SWAP_TOKENS[symbol].mint : SWAP_TOKENS.wXMR.mint;
      const outputMint = side === "buy" ? SWAP_TOKENS.wXMR.mint : SWAP_TOKENS[symbol].mint;
      const query = new URLSearchParams({ inputMint, outputMint, amount, slippageBps: String(slippageBps),
        swapMode: "ExactIn", platformFeeBps: String(SWAP_FEE_BPS), restrictIntermediateTokens: "true" });
      const quote = await request(`quote?${query}`) as RouteQuote;
      if (quote.inputMint !== inputMint || quote.outputMint !== outputMint || quote.inAmount !== amount
        || quote.swapMode !== "ExactIn" || quote.slippageBps !== slippageBps
        || quote.platformFee?.feeBps !== SWAP_FEE_BPS || !/^[1-9]\d*$/.test(quote.platformFee?.amount ?? "")
        || !/^[1-9]\d*$/.test(quote.outAmount) || !/^[1-9]\d*$/.test(quote.otherAmountThreshold)
        || BigInt(quote.otherAmountThreshold) > BigInt(quote.outAmount)
        || BigInt(quote.otherAmountThreshold) < BigInt(quote.outAmount) * BigInt(10_000 - slippageBps) / BigInt(10_000)
        || !Array.isArray(quote.routePlan) || !quote.routePlan.length) {
        throw new SwapRequestError("Jupiter returned an invalid quote or omitted the referral fee.", 502);
      }
      for (const [id, saved] of quotes) if (saved.expiresAt <= now()) quotes.delete(id);
      if (quotes.size >= 100) quotes.delete(quotes.keys().next().value!);
      const id = randomUUID();
      const expiresAt = now() + 30_000;
      quotes.set(id, { quote, expiresAt });
      return { id, inputMint, outputMint, inAmount: amount, outAmount: quote.outAmount,
        minimumReceived: quote.otherAmountThreshold, slippageBps, priceImpactPct: quote.priceImpactPct,
        feeBps: SWAP_FEE_BPS, feeAccount: getSwapFeeAccount(outputMint), referralAccount: SWAP_REFERRAL_ACCOUNT, expiresAt };
    },
    async build(id: string, walletAddress: string) {
      let wallet: PublicKey;
      try { wallet = new PublicKey(walletAddress); } catch { throw new SwapRequestError("Invalid wallet."); }
      if (!PublicKey.isOnCurve(wallet.toBytes())) throw new SwapRequestError("Invalid wallet.");
      const saved = quotes.get(id);
      if (!saved || saved.expiresAt <= now()) throw new SwapRequestError("Your quote expired. Get a fresh quote.");
      // Each quote can build once. The client never supplies or alters route/fee data.
      quotes.delete(id);
      const feeAccount = getSwapFeeAccount(saved.quote.outputMint);
      const result = await request("swap", { method: "POST", body: JSON.stringify({
        quoteResponse: saved.quote, userPublicKey: wallet.toBase58(), feeAccount,
        wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 100_000, priorityLevel: "high" } },
      }) });
      if (result.simulationError || typeof result.swapTransaction !== "string"
        || !Number.isSafeInteger(result.lastValidBlockHeight) || result.lastValidBlockHeight <= 0) {
        throw new SwapRequestError("The swap could not be simulated. Refresh your quote.", 502);
      }
      const tx = VersionedTransaction.deserialize(Buffer.from(result.swapTransaction, "base64"));
      const feeIndex = tx.message.staticAccountKeys.findIndex(key => key.toBase58() === feeAccount);
      if (!tx.message.staticAccountKeys[0].equals(wallet) || tx.message.header.numRequiredSignatures !== 1
        || feeIndex < 0 || !tx.message.isAccountWritable(feeIndex)) {
        throw new SwapRequestError("The swap transaction did not include the expected wallet and referral fee account.", 502);
      }
      return { swapTransaction: result.swapTransaction, lastValidBlockHeight: result.lastValidBlockHeight,
        feeAccount, referralAccount: SWAP_REFERRAL_ACCOUNT };
    },
  };
}

export const jupiterSwapService = createSwapService();
