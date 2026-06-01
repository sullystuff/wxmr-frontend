// Protocol-wide, read-only on-chain reads for the homepage:
// headline metrics and the live activity feed. Everything here is real
// chain data — callers render honest empty states when a value is absent.

import { Connection, PublicKey } from '@solana/web3.js';
import { Program, AnchorProvider } from '@coral-xyz/anchor';
import type { Wallet as AnchorProviderWallet } from '@coral-xyz/anchor/dist/cjs/provider';
import type { WxmrBridge } from '@/idl/wxmr_bridge';
import IDL from '@/idl/wxmr_bridge.json';
import { BRIDGE_PROGRAM_ID, SOLANA_RPC, XMR_MINT } from '@/constants';
import { fetchAuditRecords, summarizeReserves } from './audits';

function readonlyProgram(connection: Connection): Program<WxmrBridge> {
  const wallet: AnchorProviderWallet = {
    publicKey: PublicKey.default,
    signTransaction: async (tx) => tx,
    signAllTransactions: async (txs) => txs,
  };
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  return new Program<WxmrBridge>(IDL as WxmrBridge, provider);
}

function pda(seed: string): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from(seed)], BRIDGE_PROGRAM_ID)[0];
}

export interface ProtocolStats {
  /** native XMR backing (spendable + unconfirmed) from latest audit */
  backing: bigint | null;
  /** wXMR circulating supply (live mint supply) */
  circulating: bigint;
  /** backing / circulating, 1 = fully backed */
  coverage: number | null;
  /** lifetime XMR bridged in (from BridgeConfig) */
  totalDeposits: bigint;
  /** lifetime wXMR redeemed out (from BridgeConfig) */
  totalWithdrawals: bigint;
  /** USDC price per 1 XMR from the AMM pool (sell side), if a pool exists */
  priceUsd: number | null;
  /** circulating supply valued in USD, if a price is available */
  tvlUsd: number | null;
  /** unix seconds of the latest audit */
  lastAudit: number | null;
}

export async function fetchProtocolStats(): Promise<ProtocolStats> {
  const connection = new Connection(SOLANA_RPC, 'confirmed');
  const program = readonlyProgram(connection);

  const [supply, records, configRes, poolRes] = await Promise.all([
    connection.getTokenSupply(XMR_MINT).then((s) => BigInt(s.value.amount)).catch(() => BigInt(0)),
    fetchAuditRecords(),
    program.account.bridgeConfig.fetchNullable(pda('config')).catch(() => null),
    program.account.ammPool.fetchNullable(pda('amm_pool')).catch(() => null),
  ]);

  const reserves = summarizeReserves(records);
  const backing = reserves?.backing ?? null;
  const circulating = supply;

  // Prefer measuring coverage against live supply; fall back to audit figure.
  let coverage: number | null = null;
  if (backing != null && circulating > BigInt(0)) coverage = Number(backing) / Number(circulating);
  else if (reserves?.coverage != null) coverage = reserves.coverage;

  // AMM sell price is USDC atomic units (1e6) per 1 XMR (1e12 piconero).
  let priceUsd: number | null = null;
  if (poolRes && poolRes.enabled) {
    const sell = BigInt(poolRes.sellPrice.toString());
    if (sell > BigInt(0)) priceUsd = Number(sell) / 1e6;
  }

  const tvlUsd = priceUsd != null ? (Number(circulating) / 1e12) * priceUsd : null;

  return {
    backing,
    circulating,
    coverage,
    totalDeposits: configRes ? BigInt(configRes.totalDeposits.toString()) : BigInt(0),
    totalWithdrawals: configRes ? BigInt(configRes.totalWithdrawals.toString()) : BigInt(0),
    priceUsd,
    tvlUsd,
    lastAudit: reserves?.updatedAt ?? null,
  };
}

export interface ActivityEvent {
  id: string;
  direction: 'in' | 'out'; // in = XMR → Solana, out = Solana → XMR
  amount: bigint; // piconero
  ts: number; // unix seconds
  status: string;
}

export interface ActivityResult {
  events: ActivityEvent[];
  total: number;
}

/** Recent bridge activity, newest first, plus the total transfer count.
 *  Combines redemption records (Solana → XMR) with funded deposit accounts
 *  (XMR → Solana). Real chain data only — empty when the program has none. */
export async function fetchRecentActivity(limit = 8): Promise<ActivityResult> {
  try {
    const connection = new Connection(SOLANA_RPC, 'confirmed');
    const program = readonlyProgram(connection);

    const [withdrawals, deposits] = await Promise.all([
      program.account.withdrawalRecord.all().catch(() => []),
      program.account.depositRecord.all().catch(() => []),
    ]);

    const events: ActivityEvent[] = [];

    for (const w of withdrawals) {
      const a = w.account;
      let status = 'pending';
      if ('sending' in a.status) status = 'sending';
      else if ('completed' in a.status) status = 'completed';
      else if ('reverted' in a.status) status = 'reverted';
      events.push({
        id: w.publicKey.toBase58(),
        direction: 'out',
        amount: BigInt(a.amount.toString()),
        ts: a.createdAt.toNumber(),
        status,
      });
    }

    for (const d of deposits) {
      const a = d.account;
      const total = BigInt((a.totalDeposited ?? 0).toString());
      if (total <= BigInt(0)) continue; // only accounts that actually received XMR
      events.push({
        id: d.publicKey.toBase58(),
        direction: 'in',
        amount: total,
        ts: a.createdAt.toNumber(),
        status: 'completed',
      });
    }

    const sorted = events.sort((a, b) => b.ts - a.ts);
    return { events: sorted.slice(0, limit), total: sorted.length };
  } catch (e) {
    console.error('Error fetching activity:', e);
    return { events: [], total: 0 };
  }
}
