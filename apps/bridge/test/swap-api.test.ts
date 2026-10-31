import assert from "node:assert/strict";
import test from "node:test";
import { explorerTxUrl, formatDuration, formatUnits, formatUsd, parseUnits, unitsToInput } from "../src/lib/swap-api";

test("parseUnits accepts what people type and refuses what cannot be exact", () => {
  assert.equal(parseUnits("0.05", 8), BigInt(5_000_000));
  assert.equal(parseUnits(".5", 6), BigInt(500_000));
  assert.equal(parseUnits("5.", 6), BigInt(5_000_000));
  assert.equal(parseUnits(" 1 ", 6), BigInt(1_000_000));
  assert.equal(parseUnits("", 6), null);
  assert.equal(parseUnits(".", 6), null);
  assert.equal(parseUnits("1.2.3", 6), null);
  assert.equal(parseUnits("abc", 6), null);
  assert.equal(parseUnits("-1", 6), null);
  assert.equal(parseUnits("1e5", 6), null);
  assert.equal(parseUnits("0.1234567", 6), null, "more decimals than the asset has");
});

test("unitsToInput round-trips exactly, at any size", () => {
  for (const [value, decimals] of [["100000000000", 12], ["1", 18], ["123456789012345678901234", 18], ["5000000", 6]] as const) {
    assert.equal(parseUnits(unitsToInput(value, decimals), decimals)?.toString(), value);
  }
  assert.equal(unitsToInput("100000000000", 12), "0.1");
  assert.equal(unitsToInput("5000000", 6), "5");
});

test("formatUnits groups, trims, and keeps small amounts readable", () => {
  assert.equal(formatUnits("1234567890", 6), "1,234.56789");
  assert.equal(formatUnits("5000000", 6), "5");
  assert.equal(formatUnits("0", 6), "0");
  assert.equal(formatUnits("1234", 18), "0.0000000000000012", "two significant digits survive");
  assert.equal(formatUnits("100000000000", 12), "0.1");
  assert.equal(formatUnits("777000", 8), "0.00777");
});

test("formatUsd reads USDC base units", () => {
  assert.equal(formatUsd("3850000000"), "$3,850.00");
  assert.equal(formatUsd("59820000"), "$59.82");
  assert.equal(formatUsd("5000"), "$0.00");
  assert.equal(formatUsd(undefined), null);
});

test("formatDuration speaks plainly", () => {
  assert.equal(formatDuration(30), "about a minute");
  assert.equal(formatDuration(120), "about 2 minutes");
  assert.equal(formatDuration(11 * 120), "about 22 minutes");
  assert.equal(formatDuration(20 * 120), "about 40 minutes");
  assert.equal(formatDuration(3 * 3600), "about 3 hours");
});

test("explorerTxUrl knows every chain, and nothing else", () => {
  assert.equal(explorerTxUrl("BTC.Bitcoin", "abc"), "https://mempool.space/tx/abc");
  assert.equal(explorerTxUrl("USDC.Ethereum", "0xabc"), "https://etherscan.io/tx/0xabc");
  assert.equal(explorerTxUrl("USDC.Arbitrum", "0xabc"), "https://arbiscan.io/tx/0xabc");
  assert.equal(explorerTxUrl("SOL.Solana", "abc"), "https://solscan.io/tx/abc");
  assert.equal(explorerTxUrl("XMR.Monero", "abc"), "https://xmrchain.net/tx/abc");
  assert.equal(explorerTxUrl("TRX.Tron", "abc"), "https://tronscan.org/#/transaction/abc");
  assert.equal(explorerTxUrl("NOPE.Nowhere", "abc"), null);
});
