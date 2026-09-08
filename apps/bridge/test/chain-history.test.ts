import assert from 'node:assert/strict';
import { test } from 'node:test';
import { utils } from '@coral-xyz/anchor';
import IDL from '@wxmr/core/idl/wxmr_bridge.json';
import { BRIDGE_PROGRAM, extractRecordAddresses, type HistoryTransaction } from '../src/lib/chain-history';

function instruction(name: string, record: string) {
  const definition = IDL.instructions.find((item) => item.name === name)!;
  return {
    programId: BRIDGE_PROGRAM.toBase58(),
    accounts: definition.accounts.map((item) => item.name === 'audit' || item.name === 'withdrawal' ? record : item.name),
    data: utils.bytes.bs58.encode(Buffer.from(definition.discriminator)),
  };
}

test('discovers audit creation/extension and CPI withdrawal accounts without scanning', () => {
  const tx: HistoryTransaction = {
    transaction: { message: { instructions: [instruction('create_audit_record', 'audit-a'), instruction('extend_audit_data', 'audit-a')] } },
    meta: { err: null, innerInstructions: [{ instructions: [instruction('request_withdrawal', 'withdrawal-a')] }] },
  };
  assert.deepEqual(extractRecordAddresses(tx, 'audit'), ['audit-a']);
  assert.deepEqual(extractRecordAddresses(tx, 'withdrawal'), ['withdrawal-a']);
  tx.meta!.err = { InstructionError: [0, 'InvalidArgument'] };
  assert.deepEqual(extractRecordAddresses(tx, 'withdrawal'), []);
});

test('ignores parsed instructions and matching bytes from another program', () => {
  const tx: HistoryTransaction = {
    transaction: { message: { instructions: [
      { programId: BRIDGE_PROGRAM.toBase58() },
      { ...instruction('request_withdrawal', 'wrong'), programId: 'another-program' },
    ] } }, meta: { err: null },
  };
  assert.deepEqual(extractRecordAddresses(tx, 'withdrawal'), []);
});
