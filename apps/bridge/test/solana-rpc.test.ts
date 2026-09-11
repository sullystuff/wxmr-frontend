import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  checkSolanaRpcUrl,
  getCustomSolanaRpcUrl,
  getSolanaRpcEndpoint,
  normalizeSolanaRpcUrl,
  saveSolanaRpcUrl,
  SOLANA_MAINNET_GENESIS_HASH,
  SOLANA_RPC_STORAGE_KEY,
} from '@wxmr/shared/solana-rpc';
import { BridgeConnection } from '../src/lib/bridge-connection';
import { rpcResult } from '../src/lib/rpc-client';

test('custom URLs preserve API keys in paths and queries and reject unsupported formats', () => {
  assert.equal(normalizeSolanaRpcUrl('  https://rpc.example/v2/test-key?api-key=a%2Bb  '), 'https://rpc.example/v2/test-key?api-key=a%2Bb');
  assert.equal(normalizeSolanaRpcUrl('http://localhost:8899'), 'http://localhost:8899/');
  for (const url of ['', 'rpc.example', '/api/rpc', 'wss://rpc.example', 'file:///tmp/rpc', 'https://user:password@rpc.example', 'https://rpc.example/#secret']) {
    assert.throws(() => normalizeSolanaRpcUrl(url));
  }
});

test('endpoint check makes only a read-only mainnet query directly to the supplied URL', async () => {
  const endpoint = 'https://rpc.example/v2/test-key?api-key=test';
  const calls: string[] = [];
  assert.equal(await checkSolanaRpcUrl(endpoint, async (url, options) => {
    assert.equal(url, endpoint);
    assert.equal(options?.credentials, 'omit');
    assert.equal(options?.referrerPolicy, 'no-referrer');
    calls.push(JSON.parse(String(options?.body)).method);
    return Response.json({ result: SOLANA_MAINNET_GENESIS_HASH });
  }), endpoint);
  assert.deepEqual(calls, ['getGenesisHash']);
});

test('wrong networks, RPC errors, invalid replies, and unavailable endpoints cannot be saved by the check', async () => {
  const endpoint = 'https://rpc.example/?api-key=must-not-leak';
  await assert.rejects(checkSolanaRpcUrl(endpoint, async () => Response.json({ result: 'devnet' })), /not on Solana mainnet/);
  for (const reply of [
    Response.json({ error: { message: endpoint } }),
    Response.json(null),
    Response.json({ result: null }),
    new Response('<html>not an RPC</html>'),
    new Response(endpoint, { status: 401 }),
  ]) {
    await assert.rejects(checkSolanaRpcUrl(endpoint, async () => reply), (error: Error) => {
      assert.match(error.message, /Could not connect/);
      assert.ok(!error.message.includes('must-not-leak'));
      return true;
    });
  }
  await assert.rejects(checkSolanaRpcUrl(endpoint, async () => { throw new Error(endpoint); }), /Could not connect/);
});

test('saved selection drives web3 and direct history reads, stays pinned until reload, and reset removes storage', async () => {
  const endpoint = 'https://custom.example/rpc?api-key=test-only';
  const saved = new Map([[SOLANA_RPC_STORAGE_KEY, endpoint]]);
  const originalFetch = globalThis.fetch;
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const requests: { url: string; method: string }[] = [];
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    location: { protocol: 'https:' },
    localStorage: {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => { saved.set(key, value); },
      removeItem: (key: string) => { saved.delete(key); },
    },
  } });
  globalThis.fetch = async (url, options) => {
    const method = JSON.parse(String(options?.body)).method;
    requests.push({ url: String(url), method });
    return Response.json({ result: method === 'getSignatureStatuses'
      ? { context: { slot: 123 }, value: [] } : [] });
  };
  try {
    assert.equal(getCustomSolanaRpcUrl(), endpoint);
    assert.equal(getSolanaRpcEndpoint('https://default.example'), endpoint);
    const connection = new BridgeConnection();
    assert.equal(connection.rpcEndpoint, endpoint);
    await connection.getSignatureStatuses([]);
    await rpcResult('getSignaturesForAddress', ['read-only-fixture']);
    assert.deepEqual(requests, [
      { url: endpoint, method: 'getSignatureStatuses' },
      { url: endpoint, method: 'getSignaturesForAddress' },
    ]);

    saveSolanaRpcUrl('https://another.example');
    assert.equal(saved.get(SOLANA_RPC_STORAGE_KEY), 'https://another.example/');
    assert.equal(getSolanaRpcEndpoint('https://default.example'), endpoint, 'saving cannot change an in-flight connection');
    saveSolanaRpcUrl(null);
    assert.equal(saved.has(SOLANA_RPC_STORAGE_KEY), false);
    assert.equal(getCustomSolanaRpcUrl(), endpoint, 'reset also requires a reload');

    await assert.rejects(checkSolanaRpcUrl('http://remote.example'), /Use HTTPS/);
    await assert.rejects(checkSolanaRpcUrl('http://127.attacker.example'), /Use HTTPS/);
    assert.equal(await checkSolanaRpcUrl('http://localhost:8899', async () => Response.json({ result: SOLANA_MAINNET_GENESIS_HASH })), 'http://localhost:8899/');

    Object.defineProperty(window, 'localStorage', { get: () => { throw new Error('storage denied'); } });
    assert.throws(() => saveSolanaRpcUrl(endpoint), /could not save/);
    assert.throws(() => saveSolanaRpcUrl(null), /could not save/);
  } finally {
    globalThis.fetch = originalFetch;
    if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
