import test from "node:test";
import assert from "node:assert/strict";
import {
  QUOTE_PLACEHOLDER_BTC_ADDRESS,
  placeholderAddressForChain,
  selectableDestinationChains,
  selectableSourceChains,
} from "../src/lib/route-options.ts";

test("BTC remains selectable as an input chain", () => {
  assert.ok(selectableSourceChains().includes("bitcoin"));
});

test("BTC is selectable as an output chain", () => {
  assert.ok(selectableDestinationChains().includes("bitcoin"));
});

test("BTC quote previews use a Bitcoin placeholder destination", () => {
  assert.equal(placeholderAddressForChain("bitcoin"), QUOTE_PLACEHOLDER_BTC_ADDRESS);
  assert.match(QUOTE_PLACEHOLDER_BTC_ADDRESS, /^bc1/i);
});
