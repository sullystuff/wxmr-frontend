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
export const MIN_WITHDRAW_PICONERO = 10_000_000_000n;
