import assert from 'node:assert/strict';
import { test } from 'node:test';
import { USDC_MINT_ADDRESS } from '@wxmr/core';
import { GET } from '../src/app/api/quotes/route';

test('concurrent quote refreshes share one batch for every trade size and cache the result', async (t) => {
  const buyInputs: string[] = [];
  const sellInputs: string[] = [];
  let bookRequests = 0;

  const fetchMock = t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.hostname === 'api.kucoin.com') {
      bookRequests += 1;
      return Response.json({
        code: '200000',
        data: { bids: [['499', '100']], asks: [['501', '100']] },
      });
    }

    assert.equal(url.hostname, 'api.jup.ag');
    const amount = url.searchParams.get('amount')!;
    const isBuy = url.searchParams.get('inputMint') === USDC_MINT_ADDRESS;
    (isBuy ? buyInputs : sellInputs).push(amount);
    return Response.json({
      inAmount: amount,
      outAmount: (isBuy ? BigInt(amount) * BigInt(2_000) : BigInt(amount) / BigInt(2_000)).toString(),
      routePlan: [{}],
      priceImpactPct: '0',
    });
  });

  const [first, second] = await Promise.all([GET(), GET()]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  const snapshot = await first.json();
  assert.deepEqual(await second.json(), snapshot);
  assert.deepEqual(snapshot.tradeSizesUsd, [1, 5, 10, 100, 500, 1_000, 5_000]);
  assert.deepEqual(snapshot.rows.map((row: { sizeUsd: number }) => row.sizeUsd), snapshot.tradeSizesUsd);
  assert.equal(snapshot.referencePrice, 500);
  for (const row of snapshot.rows) {
    assert.equal(row.buy.solana.ok, true);
    assert.equal(row.buy.kucoin.ok, true);
    assert.equal(row.sell.solana.ok, true);
    assert.equal(row.sell.kucoin.ok, true);
    assert.equal(row.buy.solana.usdAmount, row.sizeUsd);
    assert.equal(row.sell.solana.xmrAmount, row.sellXmrAmount);
  }
  assert.equal(bookRequests, 1);
  assert.deepEqual(buyInputs, [
    '1000000', '5000000', '10000000', '100000000', '500000000', '1000000000', '5000000000',
  ]);
  assert.deepEqual(sellInputs, [
    '2000000000', '10000000000', '20000000000', '200000000000', '1000000000000', '2000000000000', '10000000000000',
  ]);
  const cached = await GET();
  assert.deepEqual(await cached.json(), snapshot);
  assert.equal(fetchMock.mock.callCount(), 15);
});
