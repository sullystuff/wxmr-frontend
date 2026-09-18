export const RESERVE_FORMAT = 'wxmr-reserve-v1';
export interface ReserveReport {
  format: typeof RESERVE_FORMAT;
  id: number;
  address: string;
  monero: { network: string; height: number; hash: string };
  solana: { genesisHash: string; program: string; mint: string; slot: number; blockhash: string; supplyAtomic: string };
  scope: 'reserves-with-supply-reference';
  message: string;
  proof: string;
  proofSha256: string;
  verified: { at: number; moneroHeight: number; totalAtomic: string; spentAtomic: string; unspentAtomic: string };
  walletReported: { balanceAtomic: string; unlockedAtomic: string; outputs: number };
}

const amount = (x: unknown): x is string => typeof x === 'string' && /^(0|[1-9]\d*)$/.test(x) && BigInt(x) <= BigInt('18446744073709551615');
const integer = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
const hash = (x: unknown) => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x);
const base58 = (x: unknown) => typeof x === 'string' && /^[1-9A-HJ-NP-Za-km-z]+$/.test(x);

// Structural validation only. The page never represents this as cryptographic
// Monero verification; the downloadable proof must be checked against a node.
export function parseReserveReport(raw: string): ReserveReport | null {
  try {
    if (raw.length > 40000) return null;
    const r = JSON.parse(raw);
    if (r.format !== RESERVE_FORMAT || r.scope !== 'reserves-with-supply-reference' || !integer(r.id) ||
        !base58(r.address) || r.address.length !== 95 || !integer(r.monero?.height) || !hash(r.monero?.hash) ||
        !['mainnet', 'stagenet', 'testnet'].includes(r.monero.network) || !integer(r.solana?.slot) ||
        !base58(r.solana?.program) || !base58(r.solana?.mint) || !base58(r.solana?.blockhash) || !base58(r.solana?.genesisHash) ||
        !amount(r.solana?.supplyAtomic) || !hash(r.proofSha256) || typeof r.proof !== 'string' || !/^ReserveProofV2[1-9A-HJ-NP-Za-km-z]+$/.test(r.proof) ||
        !integer(r.verified?.at) || !integer(r.verified?.moneroHeight) || r.verified.moneroHeight <= r.monero.height ||
        !amount(r.verified?.totalAtomic) || !amount(r.verified?.spentAtomic) || !amount(r.verified?.unspentAtomic) ||
        !amount(r.walletReported?.balanceAtomic) || !amount(r.walletReported?.unlockedAtomic) || !integer(r.walletReported?.outputs)) return null;
    if (BigInt(r.verified.totalAtomic) - BigInt(r.verified.spentAtomic) !== BigInt(r.verified.unspentAtomic) ||
        r.verified.spentAtomic !== '0' || r.verified.totalAtomic !== r.walletReported.balanceAtomic ||
        BigInt(r.walletReported.unlockedAtomic) > BigInt(r.walletReported.balanceAtomic)) return null;
    const { format, id, address, monero, solana, scope } = r;
    if (r.message !== JSON.stringify({ format, id, address, monero, solana, scope })) return null;
    return r;
  } catch { return null; }
}

export function formatReserveXmr(value: string): string {
  const n = BigInt(value);
  return `${n / BigInt(1000000000000)}.${(n % BigInt(1000000000000)).toString().padStart(12, '0')}`;
}
