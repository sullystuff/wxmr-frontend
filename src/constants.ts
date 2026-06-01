import { PublicKey } from '@solana/web3.js';

export const XMR_MINT = new PublicKey('WXMRyRZhsa19ety5erZhHg4N3xj3EVN92u94422teJp');
export const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

export const BRIDGE_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_BRIDGE_PROGRAM_ID || 'EzBkC8P5wxab9kwrtV5hRdynHAfB5w3UPcPXNgMseVA8'
);

export const SOLANA_RPC =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

// Public reserve credentials — the wallet that holds native XMR backing wXMR,
// and the view key that lets anyone audit incoming reserves.
export const RESERVE_XMR_ADDRESS =
  '45ZYpKmPaPmh3bnRP1XpMz8cASJQf1cfUgq32H8trCYA4RodzXhsmt2VYkQX9QQ65CetiGja65tH2JmKC3gEZtZjB7AzMpd';
export const RESERVE_VIEW_KEY = 'e4e02de197582ff2e93f9eaefc96e122a13ffa838736ef38f4a8ea27a0dc4909';
