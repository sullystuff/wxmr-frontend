import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { BorshCoder, BN, utils, type Idl } from '@coral-xyz/anchor';
import { Keypair } from '@solana/web3.js';
import { address, appendTransactionMessageInstructions, blockhash, compileTransaction, createTransactionMessage,
  getTransactionEncoder, setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash } from '@solana/kit';
import IDL from '@wxmr/core/idl/wxmr_bridge.json';
import fixture from './fixtures/xmr-transaction.json';
import { BRIDGE_PROGRAM, decodeHistoryTransaction, type EncodedHistoryTransaction, type HistoryTransaction } from '../src/lib/chain-history';
import { decompressRecovery, extractWithdrawalCompletion, readSignedXmrTransaction, readWithdrawalCompletion } from '../src/lib/withdrawal-history';
import { xmrTransactionHash } from '../src/lib/xmr-transaction';
import type { rpcResult } from '../src/lib/rpc-client';

const coder = new BorshCoder(IDL as unknown as Idl);
const owner = Keypair.generate().publicKey, withdrawal = Keypair.generate().publicKey;
const compressed = gzipSync(Buffer.from(fixture.hex, 'hex'));
const digest = [...createHash('sha256').update(compressed).digest()];

function event(name: string, data: object) {
  return 'Program data: ' + Buffer.concat([Buffer.from(IDL.events.find(item => item.name === name)!.discriminator), coder.types.encode(name, data)]).toString('base64');
}
function transaction(data = compressed, offset = 0, total = compressed.length, hash = digest, txid = fixture.txid, final = true): HistoryTransaction {
  const name = final ? 'complete_withdrawal_with_recovery' : 'publish_withdrawal_recovery';
  const definition = IDL.instructions.find(item => item.name === name)!;
  const header = coder.instruction.encode(name, { xmr_tx_hash: txid, xmr_tx_key: 'b'.repeat(64), recovery_hash: hash, offset, total, data: Buffer.alloc(0) });
  const length = Buffer.alloc(4); length.writeUInt32LE(data.length);
  return { transaction: { message: { instructions: [{ programId: BRIDGE_PROGRAM.toBase58(),
    accounts: definition.accounts.map(item => item.name === 'withdrawal' ? withdrawal.toBase58() : item.name === 'user' ? owner.toBase58() : Keypair.generate().publicKey.toBase58()),
    data: utils.bytes.bs58.encode(Buffer.concat([header.subarray(0, -4), length, data])),
  }] } }, meta: { err: null, logMessages: final ? [
    `Program ${BRIDGE_PROGRAM} invoke [1]`,
    event('WithdrawRecoveryPublishedEvent', { withdrawal_pda: withdrawal, nonce: new BN(123), created_at: new BN(1000) }),
    event('WithdrawCompletedEvent', { withdrawal_pda: withdrawal, user: owner, amount: new BN('1000000000000'), xmr_address: 'destination', xmr_tx_hash: txid, xmr_tx_key: 'b'.repeat(64) }),
    `Program ${BRIDGE_PROGRAM} success`,
  ] : [] } };
}

function encoded(tx: HistoryTransaction, version: 'legacy' | 0 | 1 = 1): EncodedHistoryTransaction {
  const base = setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash('11111111111111111111111111111111'), lastValidBlockHeight: BigInt(200) },
    setTransactionMessageFeePayer(address(owner.toBase58()), createTransactionMessage({ version })));
  const message = appendTransactionMessageInstructions(tx.transaction.message.instructions.map(ix => ({ programAddress: address(ix.programId),
    accounts: ix.accounts!.map(key => ({ address: address(key), role: 0 })), data: utils.bytes.bs58.decode(ix.data!) })), base);
  return { transaction: [Buffer.from(getTransactionEncoder().encode(compileTransaction(message))).toString('base64'), 'base64'], meta: tx.meta as EncodedHistoryTransaction['meta'] };
}

test('decodes legacy, v0 and v1 history, preserving completion identity and recovery bytes', () => {
  for (const version of ['legacy', 0, 1] as const) {
    const tx = decodeHistoryTransaction(encoded(transaction(), version));
    const result = extractWithdrawalCompletion(tx, withdrawal.toBase58(), owner.toBase58(), 'signature', 2000)!;
    assert.equal(result.xmrTxHash, fixture.txid);
    assert.equal(result.amount, BigInt('1000000000000'));
    assert.equal(result.nonce, BigInt(123));
    assert.equal(result.createdAt, 1000);
    assert.deepEqual(result.recovery?.inline, [...compressed]);
  }
});

test('ignores failed transactions, another owner/PDA and events emitted by another program', () => {
  const tx = transaction();
  assert.equal(extractWithdrawalCompletion(tx, withdrawal.toBase58(), 'other', 'sig', 0), null);
  assert.equal(extractWithdrawalCompletion(tx, 'other', owner.toBase58(), 'sig', 0), null);
  tx.meta!.err = 'failed';
  assert.equal(extractWithdrawalCompletion(tx, withdrawal.toBase58(), owner.toBase58(), 'sig', 0), null);
  tx.meta!.err = null;
  tx.meta!.logMessages = tx.meta!.logMessages!.map(line => line.replaceAll(BRIDGE_PROGRAM.toBase58(), Keypair.generate().publicKey.toBase58()));
  assert.equal(extractWithdrawalCompletion(tx, withdrawal.toBase58(), owner.toBase58(), 'sig', 0), null);
});

test('legacy completion still shows its txid without claiming recovery data exists', () => {
  const tx = transaction();
  tx.transaction.message.instructions = [];
  tx.meta!.logMessages!.splice(1, 1);
  const result = extractWithdrawalCompletion(tx, withdrawal.toBase58(), owner.toBase58(), 'legacy', 2000)!;
  assert.equal(result.xmrTxHash, fixture.txid);
  assert.equal(result.recovery, undefined);
  assert.equal(result.createdAt, 2000);
});

test('looks up the saved withdrawal PDA and loads inline recovery without further RPC', async () => {
  const calls: string[] = [];
  const rpc = (async (method: string, params: unknown[]) => {
    calls.push(method);
    if (method === 'getSignaturesForAddress') { assert.equal(params[0], withdrawal.toBase58()); return [{ signature: 'sig', err: null, blockTime: 2000 }]; }
    assert.deepEqual(params[1], { encoding: 'base64', commitment: 'finalized', maxSupportedTransactionVersion: 1 });
    return encoded(transaction());
  }) as typeof rpcResult;
  const completion = (await readWithdrawalCompletion(withdrawal.toBase58(), owner.toBase58(), rpc))!;
  assert.deepEqual(calls, ['getSignaturesForAddress', 'getTransaction']);
  assert.equal(await readSignedXmrTransaction(completion, (async () => assert.fail('inline recovery needs no RPC')) as typeof rpcResult), fixture.hex);
  const corrupted = { ...completion, recovery: { ...completion.recovery!, inline: [0, ...completion.recovery!.inline!.slice(1)] } };
  await assert.rejects(readSignedXmrTransaction(corrupted), /checksum mismatch/);
});

test('assembles large chunks out of order, tolerates duplicate publication, and rejects missing data', async () => {
  const raw = Buffer.concat([Buffer.from(fixture.hex, 'hex'), randomBytes(7000)]);
  const zipped = gzipSync(raw), hash = [...createHash('sha256').update(zipped).digest()], txid = xmrTransactionHash(raw);
  const pieces: HistoryTransaction[] = [];
  for (let offset = 0; offset < zipped.length; offset += 3000) pieces.push(transaction(zipped.subarray(offset, offset + 3000), offset, zipped.length, hash, txid, offset + 3000 >= zipped.length));
  const completion = extractWithdrawalCompletion(pieces.at(-1)!, withdrawal.toBase58(), owner.toBase58(), 'sig', 2000)!;
  const rpc = (async (method: string, params: unknown[]) => method === 'getSignaturesForAddress'
    ? [pieces.length - 1, pieces.length - 1, ...pieces.map((_, i) => i)].map(i => ({ signature: String(i), err: null, blockTime: 2000 }))
    : encoded(pieces[Number(params[0])])) as typeof rpcResult;
  assert.equal(await readSignedXmrTransaction(completion, rpc), raw.toString('hex'));
  await assert.rejects(readSignedXmrTransaction(completion, (async () => []) as typeof rpcResult), /unavailable/);
});

test('rejects corrupted gzip, wrong transaction IDs and oversized decompression', async () => {
  await assert.rejects(decompressRecovery(compressed, 'a'.repeat(64)), /txid/);
  await assert.rejects(decompressRecovery(new Uint8Array([1, 2, 3]), fixture.txid));
  await assert.rejects(decompressRecovery(gzipSync(Buffer.alloc(256001)), fixture.txid), /size limit/);
});
