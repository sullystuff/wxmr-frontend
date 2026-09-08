import assert from 'node:assert/strict';
import { test } from 'node:test';
import { POST } from '../src/app/api/solana/route';
import { bridgeRpc } from '../src/lib/rpc-relay';

function request(body: unknown, origin = 'https://wxmr.io') {
  return new Request('http://localhost:3000/api/solana', {
    method: 'POST', headers: { host: 'wxmr.io', origin, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

test('same-origin requests work behind the reverse proxy and preserve each client request ID', async () => {
  const original = bridgeRpc.call;
  bridgeRpc.call = async () => ({ cache: 'hit', reply: { result: 123 } });
  try {
    for (const id of [7, 'second-tab']) {
      const response = await POST(request({ jsonrpc: '2.0', id, method: 'getBlockHeight', params: [] }));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('X-Wxmr-Rpc-Cache'), 'hit');
      assert.deepEqual(await response.json(), { jsonrpc: '2.0', id, result: 123 });
    }
  } finally { bridgeRpc.call = original; }
});

test('cross-origin calls, JSON-RPC batches, and program scans are rejected before any upstream request', async () => {
  const body = { jsonrpc: '2.0', id: 1, method: 'getProgramAccounts', params: [] };
  assert.equal((await POST(request(body, 'https://unrelated.example'))).status, 403);
  assert.equal((await POST(request([body]))).status, 400);
  assert.equal((await POST(request(body))).status, 400);
});
