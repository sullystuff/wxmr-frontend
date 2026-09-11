import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRpcClient, PUBLIC_SOLANA_RPC, RPC_INTERVAL_MS, rpcFetch } from '../src/lib/rpc-client';

function fixture(responses: Response[] = []) {
  let clock = 0;
  const starts: { time: number; method: string; params: unknown[] }[] = [];
  const client = createRpcClient({
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    fetch: async (url, init) => {
      assert.equal(url, PUBLIC_SOLANA_RPC);
      const body = JSON.parse(String(init?.body));
      starts.push({ time: clock, method: body.method, params: body.params });
      return responses.shift() ?? Response.json({ jsonrpc: '2.0', id: 1, result: { value: body.params } });
    },
  });
  return { client, starts, advance: (ms: number) => { clock += ms; } };
}

test('all methods within one visitor share a 1-RPS budget', async () => {
  const { client, starts } = fixture();
  await Promise.all([
    client.call('getMultipleAccounts', [['wallet-a']]),
    client.call('getTransaction', ['history-a']),
    client.call('getAccountInfo', ['wallet-b']),
    client.call('getLatestBlockhash', []),
  ]);
  assert.equal(starts.length, 4);
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i].time - starts[i - 1].time >= RPC_INTERVAL_MS);
});

test('identical reads coalesce, cached responses expire, and transaction writes invalidate reads', async () => {
  const { client, starts, advance } = fixture();
  const params = ['account', { commitment: 'confirmed' }];
  const results = await Promise.all([client.call('getAccountInfo', params), client.call('getAccountInfo', params)]);
  assert.deepEqual(results.map((r) => r.cache), ['miss', 'coalesced']);
  assert.equal((await client.call('getAccountInfo', params)).cache, 'hit');
  assert.equal(starts.length, 1);
  advance(5_001);
  assert.equal((await client.call('getAccountInfo', params)).cache, 'miss');
  await client.call('sendTransaction', ['signed-fixture']);
  assert.equal((await client.call('getAccountInfo', params)).cache, 'miss');
});

test('missing transactions, JSON-RPC errors, and blockhashes are never cached', async () => {
  const { client, starts } = fixture([
    Response.json({ result: null }),
    Response.json({ error: { code: -32000, message: 'not ready' } }),
  ]);
  await client.call('getTransaction', ['fixture']);
  await client.call('getTransaction', ['fixture']);
  await client.call('getTransaction', ['fixture']);
  await client.call('getLatestBlockhash');
  await client.call('getLatestBlockhash');
  assert.equal(starts.length, 5);
});

test('429 Retry-After delays already queued requests; no hidden retry is sent', async () => {
  const { client, starts } = fixture([new Response('limited', { status: 429, headers: { 'retry-after': '20' } })]);
  const results = await Promise.allSettled([client.call('getAccountInfo', ['a']), client.call('getAccountInfo', ['b'])]);
  assert.equal(results[0].status, 'rejected');
  assert.equal(results[1].status, 'fulfilled');
  assert.equal(starts.length, 2);
  assert.ok(starts[1].time - starts[0].time >= 20_000);
});

test('program scans, arbitrary methods, and excess queue admission send no upstream requests', async () => {
  const { client, starts } = fixture();
  await assert.rejects(client.call('getProgramAccounts', ['program']), /not available/);
  await assert.rejects(client.call('requestAirdrop', ['wallet']), /not available/);
  assert.equal(starts.length, 0);
  const results = await Promise.allSettled(Array.from({ length: 30 }, (_, i) => client.call('getAccountInfo', [String(i)])));
  assert.equal(results.filter((r) => r.status === 'rejected').length, 6);
  assert.equal(starts.length, 24);
});

test('two visitors have independent budgets', async () => {
  const alice = fixture();
  const bob = fixture();
  await Promise.all([
    alice.client.call('getLatestBlockhash'), alice.client.call('getBlockHeight'),
    bob.client.call('getLatestBlockhash'), bob.client.call('getBlockHeight'),
  ]);
  assert.deepEqual(alice.starts.map((call) => call.time), [0, 1_000]);
  assert.deepEqual(bob.starts.map((call) => call.time), [0, 1_000]);
});

test('tabs sharing one visitor budget keep all dispatches one second apart', async () => {
  let time = 0;
  let nextStart = 0;
  let lock: Promise<unknown> = Promise.resolve();
  const starts: number[] = [];
  const options = {
    now: () => time,
    sleep: async (ms: number) => { time += ms; },
    readNextStart: () => nextStart,
    writeNextStart: (value: number) => { nextStart = value; },
    runExclusive: <T>(job: () => Promise<T>) => {
      const result = lock.then(job);
      lock = result.catch(() => {});
      return result;
    },
    fetch: async () => { starts.push(time); return Response.json({ result: 1 }); },
  };
  const tabA = createRpcClient(options);
  const tabB = createRpcClient(options);
  await Promise.all([
    tabA.call('getLatestBlockhash'), tabB.call('getLatestBlockhash'),
    tabA.call('getLatestBlockhash'), tabB.call('getLatestBlockhash'),
  ]);
  assert.deepEqual(starts, [0, 1_000, 2_000, 3_000]);
});

test('web3 fetch preserves IDs and cached reads bypass the network', async () => {
  const { client, starts } = fixture();
  const request = rpcFetch(client);
  for (const id of [7, 'next-component']) {
    const response = await request(PUBLIC_SOLANA_RPC, {
      body: JSON.stringify({ jsonrpc: '2.0', id, method: 'getAccountInfo', params: ['fixture'] }),
    });
    assert.equal((await response.json()).id, id);
  }
  assert.equal(starts.length, 1);
  await assert.rejects(request(PUBLIC_SOLANA_RPC, { body: '[]' }), /batches are not supported/);
});

test('custom clients use their own endpoint and cache without falling back after failure', async () => {
  const urls: string[] = [];
  const request: typeof fetch = async (url) => {
    urls.push(String(url));
    return Response.json({ result: String(url) });
  };
  const alice = createRpcClient({ endpoint: 'https://alice.example/rpc', fetch: request });
  const bob = createRpcClient({ endpoint: 'https://bob.example/rpc', fetch: request });
  assert.equal((await alice.call('getAccountInfo', ['same-account'])).reply.result, 'https://alice.example/rpc');
  assert.equal((await bob.call('getAccountInfo', ['same-account'])).reply.result, 'https://bob.example/rpc');
  assert.equal((await alice.call('getAccountInfo', ['same-account'])).cache, 'hit');
  const failed = createRpcClient({ endpoint: 'https://failed.example/rpc', fetch: async (url) => {
    urls.push(String(url));
    throw new Error('connection failed');
  } });
  await assert.rejects(failed.call('getLatestBlockhash'), /Solana RPC request failed/);
  assert.deepEqual(urls, ['https://alice.example/rpc', 'https://bob.example/rpc', 'https://failed.example/rpc']);
});
