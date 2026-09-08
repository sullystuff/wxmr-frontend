import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRpcRelay, PUBLIC_SOLANA_RPC, RPC_INTERVAL_MS } from '../src/lib/rpc-relay';

function fixture(responses: Response[] = []) {
  let clock = 0;
  const starts: { time: number; method: string; params: unknown[] }[] = [];
  const relay = createRpcRelay({
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    fetch: async (url, init) => {
      assert.equal(url, PUBLIC_SOLANA_RPC);
      const body = JSON.parse(String(init?.body));
      starts.push({ time: clock, method: body.method, params: body.params });
      return responses.shift() ?? Response.json({ jsonrpc: '2.0', id: 1, result: { value: body.params } });
    },
  });
  return { relay, starts, advance: (ms: number) => { clock += ms; } };
}

test('all distinct methods and concurrent visitors share a strict sub-1-RPS budget', async () => {
  const { relay, starts } = fixture();
  await Promise.all([
    relay.call('getMultipleAccounts', [['wallet-a']]),
    relay.call('getTransaction', ['history-a']),
    relay.call('getAccountInfo', ['wallet-b']),
    relay.call('getLatestBlockhash', []),
  ]);
  assert.equal(starts.length, 4);
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i].time - starts[i - 1].time >= RPC_INTERVAL_MS);
});

test('identical reads coalesce, cached responses expire, and transaction writes invalidate reads', async () => {
  const { relay, starts, advance } = fixture();
  const params = ['account', { commitment: 'confirmed' }];
  const results = await Promise.all([relay.call('getAccountInfo', params), relay.call('getAccountInfo', params)]);
  assert.deepEqual(results.map((r) => r.cache), ['miss', 'coalesced']);
  assert.equal((await relay.call('getAccountInfo', params)).cache, 'hit');
  assert.equal(starts.length, 1);
  advance(5_001);
  assert.equal((await relay.call('getAccountInfo', params)).cache, 'miss');
  await relay.call('sendTransaction', ['signed-fixture']);
  assert.equal((await relay.call('getAccountInfo', params)).cache, 'miss');
});

test('missing transactions, JSON-RPC errors, and blockhashes are never cached', async () => {
  const { relay, starts } = fixture([
    Response.json({ result: null }),
    Response.json({ error: { code: -32000, message: 'not ready' } }),
  ]);
  await relay.call('getTransaction', ['fixture']);
  await relay.call('getTransaction', ['fixture']);
  await relay.call('getTransaction', ['fixture']);
  await relay.call('getLatestBlockhash');
  await relay.call('getLatestBlockhash');
  assert.equal(starts.length, 5);
});

test('429 Retry-After delays already queued requests; no hidden retry is sent', async () => {
  const { relay, starts } = fixture([new Response('limited', { status: 429, headers: { 'retry-after': '20' } })]);
  const results = await Promise.allSettled([relay.call('getAccountInfo', ['a']), relay.call('getAccountInfo', ['b'])]);
  assert.equal(results[0].status, 'rejected');
  assert.equal(results[1].status, 'fulfilled');
  assert.equal(starts.length, 2);
  assert.ok(starts[1].time - starts[0].time >= 20_000);
});

test('program scans, arbitrary methods, and excess queue admission send no upstream requests', async () => {
  const { relay, starts } = fixture();
  await assert.rejects(relay.call('getProgramAccounts', ['program']), /not available/);
  await assert.rejects(relay.call('requestAirdrop', ['wallet']), /not available/);
  assert.equal(starts.length, 0);
  const results = await Promise.allSettled(Array.from({ length: 30 }, (_, i) => relay.call('getAccountInfo', [String(i)])));
  assert.equal(results.filter((r) => r.status === 'rejected').length, 6);
  assert.equal(starts.length, 24);
});
