import assert from 'node:assert/strict';
import { test } from 'node:test';
import anchor from '@coral-xyz/anchor';
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { createBridgeProgram, createReadonlyWallet, buildCancelWithdrawalTransaction, getNextWithdrawalNonce, getWithdrawalPda } from '../dist/bridge.js';

async function fixture({ age = 300, status = 'pending', lastNonce = 16300901271364754805n } = {}) {
  const owner = Keypair.generate().publicKey, other = Keypair.generate().publicKey, mint = Keypair.generate().publicKey;
  const connection = {};
  const program = createBridgeProgram(connection, createReadonlyWallet(owner));
  const info = data => ({ data, owner: program.programId, executable: false, lamports: 1000000, rentEpoch: 0 });
  const nonce = 100n, withdrawal = getWithdrawalPda(owner, nonce);
  const record = info(await program.coder.accounts.encode('withdrawalRecord', { user: owner, nonce: new anchor.BN(nonce.toString()), amount: new anchor.BN('9990000000000'), fee: new anchor.BN('10000000000'), xmrAddress: 'test', exactOut: false, status: { [status]: {} }, bump: 0, createdAt: new anchor.BN(1800000000 - age) }));
  const clock = { data: Buffer.alloc(40), owner: SystemProgram.programId }; clock.data.writeBigInt64LE(1800000000n, 32);
  const state = info(await program.coder.accounts.encode('userWithdrawalState', { user: owner, lastNonce: new anchor.BN(lastNonce.toString()), bump: 0 }));
  const config = info(await program.coder.accounts.encode('bridgeConfig', { authority: other, wxmrMint: mint, totalDeposits: new anchor.BN(0), totalWithdrawals: new anchor.BN(0), bump: 0, feeBps: 10 }));
  connection.getMultipleAccountsInfo = async () => [record, clock];
  connection.getAccountInfo = async () => state;
  connection.getAccountInfoAndContext = async () => ({ context: { slot: 1 }, value: config });
  return { connection, owner, other, program, state, record, clock, withdrawal };
}

test('next nonce exceeds a legacy random u64 and fails closed if the read fails', async () => {
  const f = await fixture(); assert.equal(await getNextWithdrawalNonce(f.connection, f.owner), 16300901271364754806n);
  f.connection.getAccountInfo = async () => null; assert.ok(await getNextWithdrawalNonce(f.connection, f.owner) >= BigInt(Date.now() - 1000));
  f.connection.getAccountInfo = async () => { throw Error('RPC unavailable'); }; await assert.rejects(getNextWithdrawalNonce(f.connection, f.owner), /RPC unavailable/);
  const exhausted = await fixture({ lastNonce: 0xffffffffffffffffn }); await assert.rejects(getNextWithdrawalNonce(exhausted.connection, exhausted.owner), /exhausted/);
});
test('cancellation builder uses chain time, the owner signer, and the recorded refund', async () => {
  const f = await fixture();
  const result = await buildCancelWithdrawalTransaction({ connection: f.connection, user: f.owner, withdrawalPda: f.withdrawal });
  assert.equal(result.refundAmount, 9990000000000n);
  const ix = result.transaction.instructions.at(-1);
  assert.deepEqual(ix.keys.filter(k => k.isSigner).map(k => k.pubkey.toBase58()), [f.owner.toBase58()]);
  assert.equal(ix.programId.toBase58(), f.program.programId.toBase58());
});
test('cancellation builder rejects young, Sending, closed, and another owner requests', async () => {
  for (const [options, error] of [[{ age: 299 }, /five minutes/], [{ age: -1 }, /five minutes/], [{ status: 'sending' }, /already being sent/]]) {
    const f = await fixture(options); await assert.rejects(buildCancelWithdrawalTransaction({ connection: f.connection, user: f.owner, withdrawalPda: f.withdrawal }), error);
  }
  const f = await fixture(); await assert.rejects(buildCancelWithdrawalTransaction({ connection: f.connection, user: f.other, withdrawalPda: f.withdrawal }), /Only the withdrawal owner/);
  f.connection.getMultipleAccountsInfo = async () => [null, f.clock]; await assert.rejects(buildCancelWithdrawalTransaction({ connection: f.connection, user: f.owner, withdrawalPda: f.withdrawal }), /already been closed/);
});
