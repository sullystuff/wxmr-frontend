import { Buffer } from 'buffer';
import { PublicKey } from '@solana/web3.js';
import { utils } from '@coral-xyz/anchor';
import IDL from '@wxmr/core/idl/wxmr_bridge.json';
import { rpcResult, rpcBatchResult, batchWithFallback, RpcError } from './rpc-client';

export const BRIDGE_PROGRAM = new PublicKey(
  process.env.NEXT_PUBLIC_BRIDGE_PROGRAM_ID || 'EzBkC8P5wxab9kwrtV5hRdynHAfB5w3UPcPXNgMseVA8',
);
export const HISTORY_PAGE_SIZE = 10;

type Instruction = { programId: string; accounts?: string[]; data?: string };
export type HistoryTransaction = {
  transaction: { message: { instructions: Instruction[] } };
  meta: { err: unknown; innerInstructions?: { instructions: Instruction[] }[] } | null;
};

// Use named instruction accounts from the IDL, including CPI instructions.
// No program-account enumeration or guesses about timestamp-based PDA seeds.
export function extractRecordAddresses(transaction: HistoryTransaction, kind: 'audit' | 'withdrawal', owner?: string): string[] {
  if (!transaction.meta || transaction.meta.err) return [];
  const addresses = new Set<string>();
  const instructions = [
    ...transaction.transaction.message.instructions,
    ...transaction.meta.innerInstructions?.flatMap((group) => group.instructions) ?? [],
  ];
  for (const instruction of instructions) {
    if (instruction.programId !== BRIDGE_PROGRAM.toBase58() || !instruction.data || !instruction.accounts) continue;
    const discriminator = Buffer.from(utils.bytes.bs58.decode(instruction.data)).subarray(0, 8);
    const definition = IDL.instructions.find((item) => Buffer.from(item.discriminator).equals(discriminator));
    if (owner) {
      const userIndex = definition?.accounts.findIndex((account) => account.name === 'user') ?? -1;
      if (userIndex < 0 || instruction.accounts[userIndex] !== owner) continue;
    }
    const index = definition?.accounts.findIndex((account) => account.name === kind) ?? -1;
    if (index >= 0 && instruction.accounts[index]) addresses.add(instruction.accounts[index]);
  }
  return [...addresses];
}

export async function readHistoryPage(address: PublicKey, kind: 'audit' | 'withdrawal', before?: string) {
  if (before) {
    try {
      if (utils.bytes.bs58.decode(before).length !== 64) throw new Error('length');
    } catch {
      throw new RpcError('Invalid history cursor', 400);
    }
  }
  const signatures = await rpcResult<{ signature: string; err: unknown; blockTime: number | null }[]>(
    'getSignaturesForAddress',
    [address.toBase58(), { limit: HISTORY_PAGE_SIZE, commitment: 'finalized', ...(before ? { before } : {}) }],
  );
  const addresses = new Set<string>();
  // One batched request for the whole page: a single budget slot and HTTP call.
  // Endpoints that reject getTransaction batches fall back to individual reads.
  const entries = signatures.filter((entry) => !entry.err);
  const requests = entries.map((entry) => ({
    method: 'getTransaction',
    params: [entry.signature, { encoding: 'jsonParsed', commitment: 'finalized', maxSupportedTransactionVersion: 0 }],
  }));
  const transactions = await batchWithFallback<HistoryTransaction | null>(
    requests,
    (batchRequests) => rpcBatchResult<HistoryTransaction | null>(batchRequests),
    (method, params) => rpcResult<HistoryTransaction | null>(method, params),
  );
  for (let i = 0; i < transactions.length; i++) {
    const transaction = transactions[i];
    // Do not advance past transactions that the public endpoint cannot retrieve.
    if (!transaction) throw new RpcError('Transaction history is temporarily unavailable. Please retry.', 502);
    for (const key of extractRecordAddresses(transaction, kind, kind === 'withdrawal' ? address.toBase58() : undefined)) addresses.add(key);
  }
  return {
    addresses: [...addresses],
    nextCursor: signatures.length === HISTORY_PAGE_SIZE ? signatures.at(-1)!.signature : null,
    searchedThrough: signatures.at(-1)?.blockTime ?? null,
  };
}
