import { PublicKey } from "@solana/web3.js";

export const SWAP_REFERRAL_ACCOUNT = "36rUjmrYc16eBpCCGG2t6oeiEmi1GHjeLTDQ7i8JUxAW";
export const SWAP_FEE_BPS = 50;
export const SWAP_SLIPPAGE_BPS = 50;
export const SWAP_TOKENS = {
  SOL: { mint: "So11111111111111111111111111111111111111112", decimals: 9, symbol: "SOL", name: "Solana" },
  USDC: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6, symbol: "USDC", name: "USD Coin" },
  wXMR: { mint: "WXMRyRZhsa19ety5erZhHg4N3xj3EVN92u94422teJp", decimals: 12, symbol: "wXMR", name: "Wrapped Monero" },
} as const;

export interface SwapToken { mint: string; decimals: number; symbol: string; name: string; icon?: string }

// Existing token accounts under the requested Jupiter Swap referral account.
export function getSwapFeeAccount(mint: string): string {
  return PublicKey.findProgramAddressSync([
  new TextEncoder().encode("referral_ata"),
  new PublicKey(SWAP_REFERRAL_ACCOUNT).toBytes(),
  new PublicKey(mint).toBytes(),
  ], new PublicKey("REFER4ZgmyYx9c6He5XfaTMiGfdLwRnkV4RPp9t9iF3"))[0].toBase58();
}
export const SWAP_FEE_ACCOUNT = getSwapFeeAccount(SWAP_TOKENS.wXMR.mint);

export function parseSwapAmount(text: string, decimals: number): string | null {
  if (text.length > 40) return null;
  const match = text.trim().match(/^(\d*)(?:\.(\d*))?$/);
  if (!match || (!match[1] && !match[2]) || (match[2]?.length ?? 0) > decimals) return null;
  const amount = BigInt((match[1] || "0") + (match[2] ?? "").padEnd(decimals, "0"));
  return amount > BigInt(0) && amount <= BigInt("18446744073709551615") ? amount.toString() : null;
}

export function formatSwapAmount(amount: string, decimals: number): string {
  if (decimals === 0) return amount;
  const text = amount.padStart(decimals + 1, "0");
  const fraction = text.slice(-decimals).replace(/0+$/, "");
  return `${text.slice(0, -decimals)}${fraction ? `.${fraction}` : ""}`;
}

export interface SwapQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  minimumReceived: string;
  slippageBps: number;
  priceImpactPct: string;
  feeBps: number;
  feeAccount: string;
  referralAccount: string;
  expiresAt: number;
  route: JupiterRouteQuote;
}

export interface JupiterRouteQuote {
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

export interface PendingSwap {
  wallet: string;
  signature: string;
  signedTransaction: string;
  blockhash: string;
  lastValidBlockHeight?: number;
}
