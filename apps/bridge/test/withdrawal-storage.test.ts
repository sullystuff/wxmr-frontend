import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  knownWithdrawals,
  rememberWithdrawals,
  markWithdrawalPending,
  markWithdrawalsResolved,
} from '../src/lib/withdrawal-storage';

const store = new Map<string, string>();
(globalThis as { localStorage: Storage }).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, value); },
  removeItem: (key: string) => { store.delete(key); },
  clear: () => { store.clear(); },
  key: (index: number) => [...store.keys()][index] ?? null,
  get length() { return store.size; },
};

test('remembered withdrawals are capped to the most recent, evicting the oldest', () => {
  store.clear();
  const program = 'prog', owner = 'owner';
  rememberWithdrawals(program, owner, Array.from({ length: 150 }, (_, i) => `w-${i}`));
  const known = knownWithdrawals(program, owner);
  assert.equal(known.length, 100);
  assert.ok(known.includes('w-0'), 'most recently discovered withdrawal is kept');
  assert.ok(!known.includes('w-149'), 'oldest withdrawal is evicted');
});

test('pending withdrawals survive cap eviction and stay tracked', () => {
  store.clear();
  const program = 'prog', owner = 'owner';
  rememberWithdrawals(program, owner, Array.from({ length: 100 }, (_, i) => `w-${i}`));
  // Created after the cap is full: appended at the tail, where eviction happens.
  markWithdrawalPending(program, owner, 'w-100');
  let known = knownWithdrawals(program, owner);
  assert.ok(known.includes('w-100'), 'new pending withdrawal is tracked');
  assert.equal(known.length, 100);
  // Old history flooding in must not evict the pending withdrawal.
  rememberWithdrawals(program, owner, Array.from({ length: 100 }, (_, i) => `old-${i}`));
  known = knownWithdrawals(program, owner);
  assert.ok(known.includes('w-100'), 'pending withdrawal survives history flooding');
  assert.equal(known.length, 100);
  // Resolving it lets the cap keep the list bounded as new history arrives.
  markWithdrawalsResolved(program, owner, ['w-100']);
  rememberWithdrawals(program, owner, Array.from({ length: 100 }, (_, i) => `new-${i}`));
  known = knownWithdrawals(program, owner);
  assert.equal(known.length, 100);
});
