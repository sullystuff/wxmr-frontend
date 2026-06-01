// On-chain audit records — proof-of-reserves data.
// Decoded straight from program account data so anyone can verify
// the bridge holds 1:1 native XMR. Shared by the transparency page
// and the homepage reserve strip.

import { Connection } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes';
import { BRIDGE_PROGRAM_ID, SOLANA_RPC } from '@/constants';

export interface AuditRecord {
  epoch: number; // unix timestamp of the audit
  timestamp: number;
  circulatingSupply: bigint; // wXMR minted on Solana
  spendableBalance: bigint; // native XMR confirmed + spendable
  unconfirmedBalance: bigint; // native XMR pending confirmation
  data: string; // JSON blob (txs, keys, burn, etc.)
}

export interface AuditTx {
  txid: string;
  key: string;
  amount: number;
  fee: number;
}

export interface AuditData {
  timestamp: number;
  triggeredBy: 'scheduled' | 'withdrawal_failure';
  address: string;
  totalAmount: number;
  totalFee: number;
  txs: AuditTx[];
  unconfirmed: Array<{ tx: string; amt: number; conf: number }>;
  burn?: { txid: string; amount: number };
  epoch?: number;
}

// First 8 bytes of sha256("account:AuditRecord")
const AUDIT_RECORD_DISCRIMINATOR = [23, 133, 250, 12, 85, 60, 64, 139];

/** Fetch and decode all on-chain audit records, newest first. */
export async function fetchAuditRecords(): Promise<AuditRecord[]> {
  try {
    const connection = new Connection(SOLANA_RPC, 'confirmed');

    const accounts = await connection.getProgramAccounts(BRIDGE_PROGRAM_ID, {
      filters: [
        {
          memcmp: {
            offset: 0,
            bytes: bs58.encode(Buffer.from(AUDIT_RECORD_DISCRIMINATOR)),
          },
        },
      ],
    });

    const records: AuditRecord[] = [];

    for (const account of accounts) {
      try {
        const data = account.account.data;
        let offset = 8; // skip discriminator

        const epoch = new BN(data.subarray(offset, offset + 8), 'le').toNumber();
        offset += 8;
        const timestamp = new BN(data.subarray(offset, offset + 8), 'le').toNumber();
        offset += 8;
        const circulatingSupply = BigInt(new BN(data.subarray(offset, offset + 8), 'le').toString());
        offset += 8;
        const spendableBalance = BigInt(new BN(data.subarray(offset, offset + 8), 'le').toString());
        offset += 8;
        const unconfirmedBalance = BigInt(new BN(data.subarray(offset, offset + 8), 'le').toString());
        offset += 8;

        const strLen = new BN(data.subarray(offset, offset + 4), 'le').toNumber();
        offset += 4;
        const dataStr = new TextDecoder().decode(data.subarray(offset, offset + strLen));

        records.push({ epoch, timestamp, circulatingSupply, spendableBalance, unconfirmedBalance, data: dataStr });
      } catch {
        // skip malformed records
      }
    }

    return records.sort((a, b) => b.epoch - a.epoch);
  } catch (error) {
    console.error('Error fetching audit records:', error);
    return [];
  }
}

export interface ReserveSummary {
  /** Native XMR backing (spendable + unconfirmed) from the latest audit. */
  backing: bigint;
  /** wXMR circulating supply recorded by the latest audit. */
  circulating: bigint;
  /** backing / circulating as a ratio (1 = fully backed); null if unknown. */
  coverage: number | null;
  /** Unix seconds of the latest audit. */
  updatedAt: number | null;
}

/** Reduce the newest audit record to the numbers the reserve strip needs. */
export function summarizeReserves(records: AuditRecord[]): ReserveSummary | null {
  if (records.length === 0) return null;
  const latest = records[0];
  const backing = latest.spendableBalance + latest.unconfirmedBalance;
  const circulating = latest.circulatingSupply;
  const coverage = circulating > BigInt(0) ? Number(backing) / Number(circulating) : null;
  return { backing, circulating, coverage, updatedAt: latest.epoch };
}
