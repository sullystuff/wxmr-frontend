import assert from 'node:assert/strict';
import { test } from 'node:test';
import { USDC_MINT_ADDRESS } from '@wxmr/core';
import { GET } from '../src/app/api/quotes/route';

function assertClose(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) <= Math.max(1, Math.abs(expected)) * 1e-10,
    `Expected ${actual} to be close to ${expected}`);
}

test('quote snapshots include KuCoin taker fees and share cached refreshes', async (t) => {
  const buyInputs: string[] = [];
  const sellInputs: string[] = [];
  let bookRequests = 0;
  let snapshotTime = Date.now();
  let nearTie = false;
  let book = { bids: [['499', '100']], asks: [['501', '100']] };
  t.mock.method(Date, 'now', () => snapshotTime);

  const fetchMock = t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.hostname === 'api.kucoin.com') {
      bookRequests += 1;
      return Response.json({
        code: '200000',
        data: book,
      });
    }

    assert.equal(url.hostname, 'api.jup.ag');
    const amount = url.searchParams.get('amount')!;
    const isBuy = url.searchParams.get('inputMint') === USDC_MINT_ADDRESS;
    (isBuy ? buyInputs : sellInputs).push(amount);
    // At $501.25 to buy and $498.75 to sell, Solana wins only after KuCoin fees.
    const outAmount = nearTie
      ? (isBuy
          ? BigInt(amount) * BigInt(4_000_000) / BigInt(2005)
          : BigInt(amount) * BigInt(1995) / BigInt(4_000_000))
      : (isBuy ? BigInt(amount) * BigInt(2_000) : BigInt(amount) / BigInt(2_000));
    return Response.json({
      inAmount: amount,
      outAmount: outAmount.toString(),
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
    // The displayed buy budget includes the USDT fee; sell inputs stay fixed.
    assertClose(row.buy.kucoin.usdAmount, row.sizeUsd);
    assertClose(row.buy.kucoin.xmrAmount, row.sizeUsd / 501.501);
    assertClose(row.buy.kucoin.effectivePrice, 501.501);
    assert.equal(row.sell.kucoin.xmrAmount, row.sellXmrAmount);
    assertClose(row.sell.kucoin.usdAmount, row.sellXmrAmount * 498.501);
    assertClose(row.sell.kucoin.effectivePrice, 498.501);
    // Jupiter output is already net of its swap fees and must stay untouched.
    assertClose(row.buy.solana.xmrAmount, row.sizeUsd / 500);
    assertClose(row.sell.solana.usdAmount, row.sizeUsd);
    assertClose(row.buy.solanaEdgeBps, 30.02);
    assertClose(row.sell.solanaEdgeBps, (500 / 498.501 - 1) * 10_000);
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

  await t.test('taker fees can change the better venue for both buys and sells', async () => {
    nearTie = true;
    snapshotTime += 20_000;
    const updated = await (await GET()).json();
    for (const row of updated.rows) {
      assert.ok(row.sizeUsd / 501 > row.buy.solana.xmrAmount);
      assert.ok(row.sellXmrAmount * 499 > row.sell.solana.usdAmount);
      assert.ok(row.buy.kucoin.xmrAmount < row.buy.solana.xmrAmount);
      assert.ok(row.sell.kucoin.usdAmount < row.sell.solana.usdAmount);
      assert.equal(row.buy.betterVenue, 'solana');
      assert.equal(row.sell.betterVenue, 'solana');
      assertClose(row.buy.solanaEdgeBps,
        (row.buy.solana.xmrAmount / row.buy.kucoin.xmrAmount - 1) * 10_000);
      assertClose(row.sell.solanaEdgeBps,
        (row.sell.solana.usdAmount / row.sell.kucoin.usdAmount - 1) * 10_000);
    }
  });

  await t.test('fees preserve depth estimates and unavailable quotes', async () => {
    // Ask depth covers the $1,000 budget after reserving its fee, but not before.
    book = { bids: [['499', '1'], ['498', '1']], asks: [['501', '1'], ['502', '0.993']] };
    snapshotTime += 20_000;
    const updated = await (await GET()).json();
    const row = updated.rows[5];
    assert.equal(row.sizeUsd, 1_000);
    assert.equal(row.buy.kucoin.ok, true);
    assertClose(row.buy.kucoin.usdAmount, 1_000);
    assertClose(row.buy.kucoin.xmrAmount, 1 + (1_000 / 1.001 - 501) / 502);
    assertClose(row.buy.kucoin.effectivePrice, 1_000 / row.buy.kucoin.xmrAmount);
    assert.equal(row.sell.kucoin.ok, true);
    assert.equal(row.sell.kucoin.xmrAmount, 2);
    assertClose(row.sell.kucoin.usdAmount, 996.003);
    assertClose(row.sell.kucoin.effectivePrice, 498.0015);

    const unavailable = updated.rows[6];
    assert.equal(unavailable.sizeUsd, 5_000);
    for (const side of ['buy', 'sell']) {
      assert.equal(unavailable[side].kucoin.ok, false);
      assert.equal(unavailable[side].kucoin.xmrAmount, null);
      assert.equal(unavailable[side].kucoin.usdAmount, null);
      assert.equal(unavailable[side].kucoin.effectivePrice, null);
      assert.equal(unavailable[side].betterVenue, null);
      assert.equal(unavailable[side].solanaEdgeBps, null);
    }
  });
});
