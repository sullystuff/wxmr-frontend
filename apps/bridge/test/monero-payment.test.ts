import assert from "node:assert/strict";
import test from "node:test";
import { parseMoneroPaymentRequest } from "../src/lib/monero-payment";

const address =
  "45ZYpKmPaPmh3bnRP1XpMz8cASJQf1cfUgq32H8trCYA4RodzXhsmt2VYkQX9QQ65CetiGja65tH2JmKC3gEZtZjB7AzMpd";

test("plain addresses and address-only URIs do not supply or overwrite an amount", () => {
  assert.deepEqual(parseMoneroPaymentRequest(` ${address}\n`), {
    address,
    amount: null,
  });
  assert.deepEqual(
    parseMoneroPaymentRequest(`monero:${address}?recipient_name=Example`),
    { address, amount: null },
  );
});

test("Monero QR amounts preserve XMR units and all twelve decimal places", () => {
  assert.deepEqual(
    parseMoneroPaymentRequest(
      `monero:${address}?tx_amount=1.234567890123&recipient_name=Example`,
    ),
    { address, amount: "1.234567890123" },
  );
  assert.equal(
    parseMoneroPaymentRequest(`MONERO:${address}?tx_amount=0.000000000001`)
      .amount,
    "0.000000000001",
  );
  assert.equal(
    parseMoneroPaymentRequest(`monero:${address}?amount=0002.500000000000`)
      .amount,
    "2.5",
  );
});

test("invalid or ambiguous QR amounts are rejected rather than rounded or silently ignored", () => {
  for (const query of [
    "tx_amount=",
    "tx_amount=0",
    "tx_amount=-1",
    "tx_amount=1e2",
    "tx_amount=1,2",
    "tx_amount=0.1234567890123",
    "tx_amount=99999999999",
    "tx_amount=1&tx_amount=2",
    "tx_amount=1&amount=1",
  ]) {
    assert.throws(() =>
      parseMoneroPaymentRequest(`monero:${address}?${query}`),
    );
  }
});

test("unsupported addresses and required payment instructions are not silently discarded", () => {
  for (const value of [
    "https://example.com",
    `monero:${address.slice(0, -1)}1`,
    `monero:${address}?tx_payment_id=1234`,
    `monero:${address}?req-feature=yes`,
    `monero:${address}?tx_amount=1#other`,
  ]) {
    assert.throws(() => parseMoneroPaymentRequest(value));
  }
});
