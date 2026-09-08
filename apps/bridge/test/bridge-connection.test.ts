import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BridgeConnection } from '../src/lib/bridge-connection';

test('confirmation reports a confirmed on-chain error and never opens a WebSocket', async () => {
  const connection = new BridgeConnection();
  connection.onSignature = () => { throw new Error('WebSockets must not be used'); };
  const err = { InstructionError: [0, 'Custom'] };
  connection.getSignatureStatuses = async () => ({ context: { slot: 123 }, value: [{ slot: 123, confirmations: 1, confirmationStatus: 'confirmed', err }] });
  assert.deepEqual(await connection.confirmTransaction('fixture', 'confirmed'), { context: { slot: 123 }, value: { err } });
});

test('unknown signature after blockhash expiry is not treated as confirmed', async () => {
  const connection = new BridgeConnection();
  connection.getSignatureStatuses = async () => ({ context: { slot: 123 }, value: [null] });
  connection.getBlockHeight = async () => 101;
  await assert.rejects(connection.confirmTransaction({ signature: 'fixture', blockhash: 'fixture', lastValidBlockHeight: 100 }), /block height exceeded/i);
});

test('an aborted confirmation performs no RPC request', async () => {
  const connection = new BridgeConnection();
  connection.getSignatureStatuses = async () => { throw new Error('unexpected RPC'); };
  const controller = new AbortController();
  controller.abort(new Error('cancelled'));
  await assert.rejects(connection.confirmTransaction({ signature: 'fixture', blockhash: 'fixture', lastValidBlockHeight: 100, abortSignal: controller.signal }), /cancelled/);
});
