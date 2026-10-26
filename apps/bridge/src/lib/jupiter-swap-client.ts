import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { SWAP_FEE_ACCOUNT, SWAP_FEE_BPS, SWAP_REFERRAL_ACCOUNT, SWAP_SLIPPAGE_BPS, SWAP_TOKENS,
  type JupiterRouteQuote, type SwapQuote, type SwapToken } from "./jupiter-swap";

export class JupiterApiError extends Error {
  constructor(message: string, public retryAfterMs = 10_000) { super(message); }
}

function errorDetail(value: unknown): string {
  if (typeof value === "string") return value.replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 300);
  if (!value || typeof value !== "object") return "";
  const data = value as Record<string, unknown>;
  for (const key of ["error", "errorMessage", "message"]) {
    const detail = errorDetail(data[key]);
    if (detail) return detail;
  }
  if (Array.isArray(data.InstructionError)) return `Instruction ${data.InstructionError[0]} failed: ${JSON.stringify(data.InstructionError[1]).slice(0, 150)}`;
  return typeof data.errorCode === "string" ? data.errorCode.slice(0, 100) : "";
}

export class JupiterSimulationError extends JupiterApiError {
  constructor(error: unknown) {
    const detail = errorDetail(error);
    super(`Jupiter could not simulate this swap${detail ? `: ${detail}` : "."}`);
  }
}

function validateRoute(route: JupiterRouteQuote, inputMint: string, outputMint: string, amount: string) {
  if (!route || route.inputMint !== inputMint || route.outputMint !== outputMint || route.inAmount !== amount
    || route.swapMode !== "ExactIn" || route.slippageBps !== SWAP_SLIPPAGE_BPS
    || route.platformFee?.feeBps !== SWAP_FEE_BPS || !/^[1-9]\d*$/.test(route.platformFee?.amount ?? "")
    || !/^[1-9]\d*$/.test(route.outAmount) || !/^[1-9]\d*$/.test(route.otherAmountThreshold)
    || BigInt(route.otherAmountThreshold) > BigInt(route.outAmount)
    || BigInt(route.otherAmountThreshold) < BigInt(route.outAmount) * BigInt(10_000 - SWAP_SLIPPAGE_BPS) / BigInt(10_000)
    || !Array.isArray(route.routePlan) || !route.routePlan.length) throw new JupiterApiError("Unable to get a valid price. Trying again shortly.");
}

function waitForRequest(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export function createJupiterSwapClient(options: { fetchImpl?: typeof fetch; apiKey?: () => string | undefined; now?: () => number } = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const builtQuotes = new WeakSet<SwapQuote>();
  let nextRequestAt = 0;

  async function request(path: string, init?: RequestInit, signal?: AbortSignal) {
    const key = options.apiKey?.() ?? process.env.NEXT_PUBLIC_JUPITER_BROWSER_API_KEY;
    await waitForRequest(nextRequestAt - now(), signal);
    signal?.throwIfAborted();
    nextRequestAt = now() + (key ? 1100 : 2200);
    const timeout = AbortSignal.timeout(20_000);
    const response = await fetchImpl(`https://api.jup.ag/${path.startsWith("tokens/") ? path : `swap/v1/${path}`}`, {
      ...init, cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: { ...(key ? { "x-api-key": key } : {}), ...(init?.body ? { "Content-Type": "application/json" } : {}) },
    });
    if (!response.ok) {
      if (response.status === 429) {
        const retry = response.headers.get("retry-after");
        const delay = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : retry ? Date.parse(retry) - now() : 10_000;
        const retryAfterMs = Number.isFinite(delay) ? Math.max(1100, Math.min(delay, 60_000)) : 10_000;
        nextRequestAt = now() + retryAfterMs;
        throw new JupiterApiError("Prices are busy. Trying again shortly.", retryAfterMs);
      }
      const detail = errorDetail(await response.json().catch(() => null));
      throw new JupiterApiError(detail ? `Jupiter: ${detail}` : "No route available right now. Trying again shortly.");
    }
    return response.json();
  }

  return {
    async search(query: string, signal?: AbortSignal): Promise<SwapToken[]> {
      const result = await request(`tokens/v2/search?query=${encodeURIComponent(query.trim().slice(0, 100))}`, undefined, signal);
      if (!Array.isArray(result)) return [];
      return result.flatMap((token): SwapToken[] => {
        try {
          const mint = new PublicKey(token.id).toBase58();
          if (mint === SWAP_TOKENS.wXMR.mint || !Number.isInteger(token.decimals) || token.decimals < 0 || token.decimals > 18
            || typeof token.symbol !== "string" || !token.symbol || typeof token.name !== "string") return [];
          if (mint === SWAP_TOKENS.SOL.mint) return [SWAP_TOKENS.SOL];
          return [{ mint, decimals: token.decimals, symbol: String(token.symbol).slice(0, 16), name: String(token.name).slice(0, 80),
            icon: typeof token.icon === "string" && token.icon.startsWith("https://") ? token.icon : undefined }];
        } catch { return []; }
      }).slice(0, 30);
    },
    async quote(side: "buy" | "sell", token: SwapToken, amount: string, signal?: AbortSignal): Promise<SwapQuote> {
      if ((side !== "buy" && side !== "sell") || token.mint === SWAP_TOKENS.wXMR.mint
        || !/^[1-9]\d{0,19}$/.test(amount) || BigInt(amount) > BigInt("18446744073709551615")) throw new JupiterApiError("Enter a valid amount.");
      const selectedMint = new PublicKey(token.mint).toBase58();
      const inputMint = side === "buy" ? selectedMint : SWAP_TOKENS.wXMR.mint;
      const outputMint = side === "buy" ? SWAP_TOKENS.wXMR.mint : selectedMint;
      const query = new URLSearchParams({ inputMint, outputMint, amount, slippageBps: String(SWAP_SLIPPAGE_BPS),
        swapMode: "ExactIn", platformFeeBps: String(SWAP_FEE_BPS), restrictIntermediateTokens: "true" });
      const route = await request(`quote?${query}`, undefined, signal) as JupiterRouteQuote;
      validateRoute(route, inputMint, outputMint, amount);
      return { inputMint, outputMint, inAmount: amount, outAmount: route.outAmount,
        minimumReceived: route.otherAmountThreshold, slippageBps: SWAP_SLIPPAGE_BPS, priceImpactPct: route.priceImpactPct,
        feeBps: SWAP_FEE_BPS, feeAccount: SWAP_FEE_ACCOUNT, referralAccount: SWAP_REFERRAL_ACCOUNT,
        expiresAt: now() + 30_000, route };
    },
    async build(quote: SwapQuote, walletAddress: string) {
      const wallet = new PublicKey(walletAddress);
      if (!PublicKey.isOnCurve(wallet.toBytes())) throw new JupiterApiError("Connect a valid wallet.");
      if (builtQuotes.has(quote) || quote.expiresAt <= now()) throw new JupiterApiError("Updating your price. Please try again.");
      validateRoute(quote.route, quote.inputMint, quote.outputMint, quote.inAmount);
      if (quote.outAmount !== quote.route.outAmount || quote.minimumReceived !== quote.route.otherAmountThreshold
        || quote.feeAccount !== SWAP_FEE_ACCOUNT || quote.referralAccount !== SWAP_REFERRAL_ACCOUNT
        || (quote.inputMint !== SWAP_TOKENS.wXMR.mint && quote.outputMint !== SWAP_TOKENS.wXMR.mint)) {
        throw new JupiterApiError("The price changed. Please try again.");
      }
      builtQuotes.add(quote);
      const feeAccount = SWAP_FEE_ACCOUNT;
      const result = await request("swap", { method: "POST", body: JSON.stringify({
        quoteResponse: quote.route, userPublicKey: wallet.toBase58(), feeAccount,
        wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 100_000, priorityLevel: "high" } },
      }) });
      if (!result || typeof result !== "object") throw new JupiterApiError("Jupiter returned an invalid swap response.");
      if (typeof result.swapTransaction !== "string" || !result.swapTransaction) {
        if (result.simulationError) throw new JupiterSimulationError(result.simulationError);
        throw new JupiterApiError("Jupiter did not return a swap transaction.");
      }
      let transaction: VersionedTransaction;
      try {
        transaction = VersionedTransaction.deserialize(Uint8Array.from(atob(result.swapTransaction), c => c.charCodeAt(0)));
      } catch {
        if (result.simulationError) throw new JupiterSimulationError(result.simulationError);
        throw new JupiterApiError("Jupiter returned an invalid swap transaction.");
      }
      const feeIndex = transaction.message.staticAccountKeys.findIndex(key => key.toBase58() === feeAccount);
      if (!transaction.message.staticAccountKeys[0].equals(wallet) || transaction.message.header.numRequiredSignatures !== 1
        || feeIndex < 0 || !transaction.message.isAccountWritable(feeIndex)) {
        throw new JupiterApiError("This swap could not be verified. Please try again.");
      }
      if (result.simulationError) {
        // Compute-estimation simulation is not the wallet's final simulation.
        // Preserve the returned transaction; wallet review and RPC preflight
        // (skipPreflight:false) still check it before broadcast.
        console.warn("Jupiter build simulation:", errorDetail(result.simulationError));
      }
      // The transaction is sufficient for signature-based confirmation. Some API
      // responses omit the optional expiry hint or encode it as a numeric string.
      const height = typeof result.lastValidBlockHeight === "string" && /^\d+$/.test(result.lastValidBlockHeight)
        ? Number(result.lastValidBlockHeight) : result.lastValidBlockHeight;
      const lastValidBlockHeight = Number.isSafeInteger(height) && height > 0 ? height as number : undefined;
      return { transaction, lastValidBlockHeight };
    },
  };
}

export const jupiterSwapClient = createJupiterSwapClient();
