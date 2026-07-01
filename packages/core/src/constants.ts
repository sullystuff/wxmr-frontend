import { PublicKey } from "@solana/web3.js";

export const WXMR_MINT_ADDRESS = "WXMRyRZhsa19ety5erZhHg4N3xj3EVN92u94422teJp";
export const USDC_MINT_ADDRESS = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const BRIDGE_PROGRAM_ID = "EzBkC8P5wxab9kwrtV5hRdynHAfB5w3UPcPXNgMseVA8";

export const XMR_MINT = new PublicKey(WXMR_MINT_ADDRESS);
export const WXMR_MINT = XMR_MINT;
export const USDC_MINT = new PublicKey(USDC_MINT_ADDRESS);

export const USDC_DECIMALS = 6;
export const WXMR_DECIMALS = 12;
export const XMR_DECIMALS = WXMR_DECIMALS;

export const BRIDGE_FEE_BPS = 10;

export const PICONERO_PER_XMR = 1_000_000_000_000n;

// Bridge minimums — mirror the on-chain constants in
// wxmr-backend/programs/wxmr-bridge/src/lib.rs (MIN_XMR_DEPOSIT / MIN_XMR_WITHDRAWAL).
export const MIN_XMR_DEPOSIT_PICONERO = 100_000_000_000n; // 0.1 XMR
export const MIN_XMR_WITHDRAWAL_PICONERO = 100_000_000_000n; // 0.1 XMR
export const MIN_WITHDRAW_PICONERO = MIN_XMR_WITHDRAWAL_PICONERO;

// Relayer dust filter (wxmr-backend/src/monero.ts MIN_TRANSFER_AMOUNT): individual
// incoming transfers below this are never tracked, so they can't count toward a mint.
export const XMR_DEPOSIT_DUST_PICONERO = 10_000_000_000n; // 0.01 XMR
