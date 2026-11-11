import { Buffer } from 'buffer';
import { BorshCoder, EventParser, type Idl } from '@coral-xyz/anchor';
import { sha256 } from '@noble/hashes/sha256';
import IDL from '@wxmr/core/idl/wxmr_bridge.json';
import { BRIDGE_PROGRAM, decodeHistoryTransaction, type EncodedHistoryTransaction, type HistoryTransaction } from './chain-history';
import { rpcResult } from './rpc-client';
import { MAX_XMR_TRANSACTION_BYTES, xmrTransactionHash } from './xmr-transaction';

const coder = new BorshCoder(IDL as unknown as Idl);
const parser = new EventParser(BRIDGE_PROGRAM, coder);
type RecoveryPiece = { xmr_tx_hash: string; recovery_hash: number[]; total: number; offset: number; data: Buffer };
export type WithdrawalCompletion = {
  withdrawalPda: string; user: string; nonce: bigint; amount: bigint; xmrAddress: string;
  status: 'completed'; createdAt: number; completedAt: number | null;
  xmrTxHash: string; xmrTxKey: string; completionSignature: string;
  recovery?: { hash: number[]; total: number; inline?: number[] };
};
type SignatureEntry = { signature: string; err: unknown; blockTime: number | null };

export function recoveryPieces(tx: HistoryTransaction, withdrawal: string): RecoveryPiece[] {
  if (!tx.meta || tx.meta.err) return [];
  const pieces: RecoveryPiece[] = [];
  for (const ix of [...tx.transaction.message.instructions, ...tx.meta.innerInstructions?.flatMap(group => group.instructions) ?? []]) {
    if (ix.programId !== BRIDGE_PROGRAM.toBase58() || !ix.data || !ix.accounts) continue;
    let decoded;
    try { decoded = coder.instruction.decode(ix.data, 'base58'); }
    catch { continue; } // Historical completions have only the original two strings.
    if (!decoded || decoded.name !== 'complete_withdrawal') continue;
    const definition = IDL.instructions.find(item => item.name === decoded.name)!;
    const index = definition.accounts.findIndex(account => account.name === 'withdrawal');
    if (ix.accounts[index] !== withdrawal) continue;
    pieces.push(decoded.data as RecoveryPiece);
  }
  return pieces;
}

export function extractWithdrawalCompletion(tx: HistoryTransaction, withdrawal: string, owner: string,
  signature: string, time: number | null): WithdrawalCompletion | null {
  if (!tx.meta || tx.meta.err) return null;
  const events = [...parser.parseLogs(tx.meta.logMessages ?? [])];
  const request = events.find(event => event.name === 'WithdrawRecoveryPublishedEvent' && event.data.withdrawal_pda.toBase58() === withdrawal)?.data;
  for (const event of events) {
    if (event.name !== 'WithdrawCompletedEvent') continue;
    const data = event.data;
    if (data.withdrawal_pda.toBase58() !== withdrawal || data.user.toBase58() !== owner ||
        !/^[a-f0-9]{64}$/i.test(data.xmr_tx_hash)) continue;
    const recovery = recoveryPieces(tx, withdrawal).find(piece => piece.xmr_tx_hash === data.xmr_tx_hash);
    return { withdrawalPda: withdrawal, user: owner, nonce: request ? BigInt(request.nonce.toString()) : BigInt(0), amount: BigInt(data.amount.toString()),
      xmrAddress: data.xmr_address, status: 'completed', createdAt: request ? Number(request.created_at.toString()) : time ?? 0, completedAt: time,
      xmrTxHash: data.xmr_tx_hash, xmrTxKey: data.xmr_tx_key, completionSignature: signature,
      ...(recovery ? { recovery: { hash: [...recovery.recovery_hash], total: recovery.total, ...(recovery.offset === 0 && recovery.data.length === recovery.total ? { inline: [...recovery.data] } : {}) } } : {}) };
  }
  return null;
}

type RpcRead = typeof rpcResult;

async function readTransaction(signature: string, rpc: RpcRead = rpcResult) {
  const raw = await rpc<EncodedHistoryTransaction | null>('getTransaction', [signature,
    { encoding: 'base64', commitment: 'finalized', maxSupportedTransactionVersion: 1 }]);
  if (!raw) throw new Error('Withdrawal transaction history is temporarily unavailable. Retry to load it.');
  return decodeHistoryTransaction(raw);
}

const completed = new Map<string, WithdrawalCompletion>();
const reverted = new Set<string>();

export function isWithdrawalReverted(withdrawal: string, owner: string): boolean {
  return reverted.has(`${BRIDGE_PROGRAM}:${owner}:${withdrawal}`);
}

// Query the saved withdrawal address, not the wallet's unrelated transactions.
// Stop at the latest completion. Gzip chunks are read only when requested.
export async function readWithdrawalCompletion(withdrawal: string, owner: string, rpc: RpcRead = rpcResult): Promise<WithdrawalCompletion | null> {
  const key = `${BRIDGE_PROGRAM}:${owner}:${withdrawal}`;
  const cached = completed.get(key);
  if (cached) return cached;
  if (reverted.has(key)) return null;
  const entries = await rpc<SignatureEntry[]>('getSignaturesForAddress', [withdrawal,
    { commitment: 'finalized', limit: 10 }]);
  for (const entry of entries) {
    if (entry.err) continue;
    const tx = await readTransaction(entry.signature, rpc);
    const result = extractWithdrawalCompletion(tx, withdrawal, owner, entry.signature, entry.blockTime);
    if (result) {
      if (completed.size >= 1000) completed.delete(completed.keys().next().value!);
      completed.set(key, result);
      return result;
    }
    if (tx.meta && !tx.meta.err) {
      for (const event of parser.parseLogs(tx.meta.logMessages ?? [])) {
        if (event.name === 'WithdrawRevertedEvent' && event.data.withdrawal_pda.toBase58() === withdrawal &&
            event.data.user.toBase58() === owner) {
          if (reverted.size >= 1000) reverted.clear();
          reverted.add(key);
          return null;
        }
      }
    }
  }
  return null;
}

export async function decompressRecovery(compressed: Uint8Array, expectedHash: string): Promise<string> {
  const stream = new DecompressionStream('gzip');
  const writer = stream.writable.getWriter();
  const writing = (async () => { await writer.write(new Uint8Array(compressed)); await writer.close(); })();
  void writing.catch(() => {});
  const reader = stream.readable.getReader();
  const pieces: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_XMR_TRANSACTION_BYTES) throw new Error('Signed XMR transaction exceeds recovery size limit');
      pieces.push(value);
    }
    await writing;
  } catch (error) { await reader.cancel(); throw error; }
  finally { reader.releaseLock(); }
  const raw = new Uint8Array(size);
  let offset = 0;
  for (const piece of pieces) { raw.set(piece, offset); offset += piece.length; }
  if (xmrTransactionHash(raw) !== expectedHash.toLowerCase()) throw new Error('Recovered transaction does not match the XMR txid');
  return Buffer.from(raw).toString('hex');
}

export async function readSignedXmrTransaction(completion: WithdrawalCompletion, rpc: RpcRead = rpcResult): Promise<string> {
  const recovery = completion.recovery;
  if (!recovery || !Number.isSafeInteger(recovery.total) || recovery.total < 1 || recovery.total > 300_000 || recovery.hash.length !== 32) {
    throw new Error('This withdrawal has no signed transaction recovery data');
  }
  if (recovery.inline) {
    const bytes = new Uint8Array(recovery.inline);
    if (bytes.length !== recovery.total || !Buffer.from(sha256(bytes)).equals(Buffer.from(recovery.hash))) throw new Error('XMR recovery checksum mismatch');
    return decompressRecovery(bytes, completion.xmrTxHash);
  }
  const compressed = new Uint8Array(recovery.total);
  const received = new Uint8Array(recovery.total);
  let count = 0;
  let before: string | undefined;
  for (let page = 0; page < 20; page++) {
    const entries = await rpc<SignatureEntry[]>('getSignaturesForAddress', [completion.withdrawalPda,
      { commitment: 'finalized', limit: 100, ...(before ? { before } : {}) }]);
    for (const entry of entries) {
      if (entry.err) continue;
      for (const piece of recoveryPieces(await readTransaction(entry.signature, rpc), completion.withdrawalPda)) {
        if (piece.xmr_tx_hash !== completion.xmrTxHash || piece.total !== recovery.total ||
            !Buffer.from(piece.recovery_hash).equals(Buffer.from(recovery.hash))) continue;
        if (!Number.isSafeInteger(piece.offset) || piece.offset < 0 || piece.data.length > 3000 ||
            piece.offset + piece.data.length > recovery.total) throw new Error('Invalid XMR recovery chunk');
        for (let i = 0; i < piece.data.length; i++) {
          const at = piece.offset + i;
          if (received[at] && compressed[at] !== piece.data[i]) throw new Error('Conflicting XMR recovery chunks');
          if (!received[at]) { received[at] = 1; compressed[at] = piece.data[i]; count++; }
        }
      }
      if (count === recovery.total) {
        if (!Buffer.from(sha256(compressed)).equals(Buffer.from(recovery.hash))) throw new Error('XMR recovery checksum mismatch');
        return decompressRecovery(compressed, completion.xmrTxHash);
      }
    }
    if (entries.length < 100) break;
    before = entries.at(-1)!.signature;
  }
  throw new Error('Some recovery chunks are unavailable from this RPC. Try another RPC or retry later.');
}
