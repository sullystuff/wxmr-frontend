/** Client for the swap backend (swap-api.wxmr.io). Types mirror its public JSON. */

export const SWAP_API_URL = (process.env.NEXT_PUBLIC_SWAP_API_URL || "https://swap-api.wxmr.io").replace(/\/$/, "");

export const XMR_ASSET_ID = "XMR.Monero";
export const USDC_SOL_ASSET_ID = "USDC.Solana";

export interface SwapAsset {
  id: string;
  chain: string;
  chainName: string;
  symbol: string;
  name: string;
  decimals: number;
  minDeposit: string;
  depositEnabled: boolean;
  receiveEnabled: boolean;
}

export interface RouteStep {
  provider: "chainflip" | "jupiter" | "bridge" | "monero" | "solana";
  label: string;
  fromAsset: string;
  toAsset: string;
  amountIn?: string;
  amountOut?: string;
  etaSeconds?: number;
}

export interface QuoteFee {
  label: string;
  amount: string;
  asset: string;
  provider: string;
}

export interface ReserveDecision {
  available: string;
  required: string;
  path: "fast" | "slow";
  confirmations: number;
  etaSeconds: number;
  fastConfirmations: number;
  slowConfirmations: number;
  bridgeExempt: boolean;
}

export interface SwapQuote {
  id: string;
  createdAt: number;
  expiresAt: number;
  from: string;
  to: string;
  amountIn: string;
  estimatedOut: string;
  minOut: string;
  slippageBps: number;
  boost: boolean;
  boostAvailable: boolean;
  kind: "chainflip" | "to_xmr" | "from_xmr";
  steps: RouteStep[];
  fees: QuoteFee[];
  etaSeconds: number;
  reserve?: ReserveDecision;
  minDeposit: string;
  priceImpactBps?: number;
  usdIn?: string;
  usdOut?: string;
  warnings: string[];
}

export interface SwapReserves {
  wxmrOnSolana: string;
  availableForSwaps: string;
  claimedByOpenSwaps: string;
  xmrWallet: { balance: string; unlocked: string };
  incomingFromTopups: string;
  minTopup: string;
  fastPathConfirmations: number;
  slowPathConfirmations: number;
  bridgeExempt: boolean;
  walletUnlockConfirmations: number;
  bridgeDepositConfirmations: number;
  moneroBlockSeconds: number;
  solanaAddress: string | null;
  recentTopups: { txHash: string; amount: string; status: string; confirmations: number; at: number }[];
  bridgeOnline: boolean | null;
  updatedAt: number | null;
  stale: boolean;
}

export type SwapStatus =
  | "allocating"
  | "awaiting_deposit"
  | "confirming"
  | "swapping"
  | "sending"
  | "completed"
  | "refunding"
  | "refunded"
  | "expired"
  | "failed";

export interface TimelineStep {
  key: string;
  label: string;
  state: "done" | "active" | "pending" | "failed";
  detail?: string;
}

export interface OrderAsset {
  id: string;
  symbol: string;
  decimals: number;
  chain: string;
  chainName: string;
}

export interface SwapOrder {
  id: string;
  status: SwapStatus;
  kind: SwapQuote["kind"];
  from: string;
  to: string;
  fromAsset: OrderAsset;
  toAsset: OrderAsset;
  amountIn: string;
  estimatedOut: string;
  minOut: string;
  destinationAddress: string;
  refundAddress: string;
  deposit: {
    address: string | null;
    expiresAt: number | null;
    received: string | null;
    confirmations: number | null;
    requiredConfirmations: number | null;
    tx: string | null;
    network: string;
    acceptsMore: boolean;
  };
  reservePath: "fast" | "slow" | null;
  reserveHeldUntil: number | null;
  payout: { amount: string | null; tx: string | null; txKey: string | null };
  refund: { amount: string | null; asset: OrderAsset | null; tx: string | null; txKey: string | null; reason: string | null };
  timeline: TimelineStep[];
  events: { at: number; status: string; message: string }[];
  createdAt: number;
  updatedAt: number;
  error: string | null;
  needsAttention: boolean;
}

export class SwapApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly details: Record<string, string> = {},
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${SWAP_API_URL}${path}`, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new SwapApiError("The swap service cannot be reached right now.", "unreachable", 0);
  }
  // Reading can still abort. That has to surface as an abort, not look like an empty success.
  const text = await response.text();
  let body: (Record<string, string> & T) | null = null;
  try {
    body = JSON.parse(text) as Record<string, string> & T;
  } catch {
    body = null;
  }
  if (!response.ok) {
    throw new SwapApiError(body?.message || "The swap service returned an error.", body?.error || "error", response.status, body ?? {});
  }
  if (!body) throw new SwapApiError("The swap service sent an unreadable response.", "bad_response", response.status);
  return body;
}

export const swapApi = {
  assets: (signal?: AbortSignal) => request<{ assets: SwapAsset[] }>("/v1/assets", { signal }).then((body) => body.assets),
  reserves: (signal?: AbortSignal) => request<SwapReserves>("/v1/reserves", { signal }),
  quote: (params: { from: string; to: string; amount: string; slippageBps?: number; boost: boolean }, signal?: AbortSignal) => {
    const search = new URLSearchParams({ from: params.from, to: params.to, amount: params.amount, boost: String(params.boost) });
    if (params.slippageBps) search.set("slippageBps", String(params.slippageBps));
    return request<{ quote: SwapQuote }>(`/v1/quote?${search}`, { signal }).then((body) => body.quote);
  },
  validateAddress: (chain: string, address: string, signal?: AbortSignal) =>
    request<{ valid: boolean; reason?: string }>("/v1/validate-address", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chain, address }),
      signal,
    }),
  create: (params: { quoteId: string; destinationAddress: string; refundAddress: string }) =>
    request<{ swap: SwapOrder }>("/v1/swaps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
    }).then((body) => body.swap),
  order: (id: string, signal?: AbortSignal) => request<{ swap: SwapOrder }>(`/v1/swaps/${id}`, { signal }).then((body) => body.swap),
};

// ---- amounts ----------------------------------------------------------------

/** Base units from what a person typed. Null when it is not a usable amount yet. */
export function parseUnits(text: string, decimals: number): bigint | null {
  const match = text.trim().match(/^(\d*)(?:\.(\d*))?$/);
  if (!match || (!match[1] && !match[2])) return null;
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) return null;
  return BigInt((match[1] || "0") + fraction.padEnd(decimals, "0"));
}

/** Exact decimal string with no grouping, for feeding back into an input. */
export function unitsToInput(value: bigint | string, decimals: number): string {
  const amount = BigInt(value);
  const scale = BigInt(10) ** BigInt(decimals);
  const fraction = (amount % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${amount / scale}${fraction ? `.${fraction}` : ""}`;
}

/** For display: grouped, trimmed, keeping `significant` digits of anything under 1. */
export function formatUnits(value: bigint | string, decimals: number, maxFraction = 8): string {
  const amount = BigInt(value);
  const scale = BigInt(10) ** BigInt(decimals);
  const whole = amount / scale;
  const raw = (amount % scale).toString().padStart(decimals, "0");
  let digits = maxFraction;
  if (whole === BigInt(0) && amount > BigInt(0)) {
    const leadingZeros = raw.length - raw.replace(/^0+/, "").length;
    digits = Math.max(maxFraction, Math.min(decimals, leadingZeros + 2));
  }
  const fraction = raw.slice(0, digits).replace(/0+$/, "");
  return `${whole.toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}`;
}

export function formatUsd(usdcBaseUnits: string | undefined): string | null {
  if (!usdcBaseUnits) return null;
  const cents = BigInt(usdcBaseUnits) / BigInt(10_000);
  const dollars = cents / BigInt(100);
  return `$${dollars.toLocaleString("en-US")}.${(cents % BigInt(100)).toString().padStart(2, "0")}`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 90) return "about a minute";
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `about ${minutes} minutes`;
  const hours = Math.round(minutes / 30) / 2;
  return `about ${hours} hours`;
}

// ---- explorers --------------------------------------------------------------

const EXPLORERS: Record<string, string> = {
  Bitcoin: "https://mempool.space/tx/",
  Ethereum: "https://etherscan.io/tx/",
  Arbitrum: "https://arbiscan.io/tx/",
  Solana: "https://solscan.io/tx/",
  Tron: "https://tronscan.org/#/transaction/",
  Assethub: "https://assethub-polkadot.subscan.io/extrinsic/",
  Bsc: "https://bscscan.com/tx/",
  Monero: "https://xmrchain.net/tx/",
};

export function explorerTxUrl(assetId: string, tx: string): string | null {
  const chain = assetId.split(".")[1] ?? "";
  const base = EXPLORERS[chain];
  return base ? `${base}${tx}` : null;
}

// ---- progress the browser should remember ------------------------------------

const RECENT_KEY = "wxmr:xswap-recent:v1";
const MAX_RECENT = 8;

export interface RecentSwap {
  id: string;
  from: string;
  to: string;
  amountIn: string;
  createdAt: number;
}

export function readRecentSwaps(): RecentSwap[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as RecentSwap[];
    return Array.isArray(parsed) ? parsed.filter((entry) => /^[0-9a-f]{32}$/.test(entry.id)) : [];
  } catch {
    return [];
  }
}

export function rememberSwap(swap: RecentSwap): void {
  try {
    const rest = readRecentSwaps().filter((entry) => entry.id !== swap.id);
    localStorage.setItem(RECENT_KEY, JSON.stringify([swap, ...rest].slice(0, MAX_RECENT)));
  } catch {
    // Without storage the swap link still works.
  }
}

/** USDC on Solana is where every other route meets, so against XMR there is nothing for Chainflip to do. */
export function routeUsesChainflip(from: string, to: string): boolean {
  const pair = [from, to];
  return !(pair.includes(XMR_ASSET_ID) && pair.includes(USDC_SOL_ASSET_ID));
}

/** What happens if the swap is rejected, in the terms that are true for this route. */
export function refundNotice(from: string, to: string): string {
  if (!routeUsesChainflip(from, to)) {
    return "This route runs on Jupiter and the wXMR bridge, without Chainflip. If it cannot finish, your funds go back to your refund address, less network and bridge fees.";
  }
  if (from === XMR_ASSET_ID) {
    return "Powered by Chainflip. If Chainflip's AML check rejects this swap, your funds come back to your refund address as XMR. The amount depends on the market price at that time, less network and bridge fees.";
  }
  return "Powered by Chainflip. A deposit that fails Chainflip's AML check is not swapped: it is refunded to your refund address.";
}
