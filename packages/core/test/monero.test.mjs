import test from "node:test";
import assert from "node:assert/strict";
import { keccak_256 } from "@noble/hashes/sha3";

import {
  validateMoneroAddress,
  isValidMoneroAddress,
  assertValidMoneroAddress,
  decodeMoneroAddress,
} from "../dist/monero.js";

// Mirrors the unit tests of the on-chain validator in
// wxmr-backend/programs/wxmr-bridge/src/lib.rs (mod xmr_address_tests).
// The vectors below are the same real mainnet addresses, cross-checked there
// against monero-wallet-rpc `validate_address` (nettype=mainnet, valid=true).

const MAINNET_STANDARD =
  "45ZYpKmPaPmh3bnRP1XpMz8cASJQf1cfUgq32H8trCYA4RodzXhsmt2VYkQX9QQ65CetiGja65tH2JmKC3gEZtZjB7AzMpd";
const MAINNET_SUBADDRESS =
  "88MJCjinq1E636vojsfyD6Ai5SVJ2jDysgmJMXH5sgiGVe7iPTidgwW1P51x9G7tGGYiEbaBrwungjEoozRKkCjsAFwE6Bk";
const MAINNET_INTEGRATED =
  "4FGDq8atBfHh3bnRP1XpMz8cASJQf1cfUgq32H8trCYA4RodzXhsmt2VYkQX9QQ65CetiGja65tH2JmKC3gEZtZjFvDLutPDrdoSFsnM2N";
const DOCS_STANDARD =
  "4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgYeYTRj5UzqtReoS44qo9mtmXCqY45DJ852K5Jv2684Rge";

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

const XMR_MAINNET_STANDARD = 18;
const XMR_MAINNET_INTEGRATED = 19;
const XMR_STAGENET_STANDARD = 24;
const XMR_TESTNET_STANDARD = 53;

// ---- Minimal Monero base58 encoder (test-only), mirrors base58.cpp ----

function encodedBlockSize(decodedLen) {
  return [0, 2, 3, 5, 6, 7, 9, 10, 11][decodedLen];
}

function encodeBlock(block) {
  let num = 0n;
  for (const b of block) num = (num << 8n) | BigInt(b);
  const encSize = encodedBlockSize(block.length);
  const buf = new Array(encSize).fill(BASE58_ALPHABET[0]);
  let i = encSize - 1;
  while (num > 0n) {
    buf[i] = BASE58_ALPHABET[Number(num % 58n)];
    num /= 58n;
    i -= 1;
  }
  return buf.join("");
}

function moneroBase58Encode(data) {
  let out = "";
  const full = Math.floor(data.length / 8);
  for (let i = 0; i < full; i++) out += encodeBlock(data.subarray(i * 8, i * 8 + 8));
  if (data.length % 8 > 0) out += encodeBlock(data.subarray(full * 8));
  return out;
}

/** Build a valid Monero address string (correct Keccak checksum) from parts. */
function buildAddress(tag, spend, view, paymentId = null) {
  const body = [tag, ...spend, ...view, ...(paymentId ?? [])];
  const checksum = keccak_256(Uint8Array.from(body)).subarray(0, 4);
  return moneroBase58Encode(Uint8Array.from([...body, ...checksum]));
}

/** Decode a known-good address into (tag, spend, view) via the library helper. */
function decodeKeys(addr) {
  const decoded = decodeMoneroAddress(addr);
  assert.ok(decoded, `expected ${addr} to decode`);
  return decoded;
}

test("accepts real mainnet addresses", () => {
  for (const a of [MAINNET_STANDARD, MAINNET_SUBADDRESS, MAINNET_INTEGRATED, DOCS_STANDARD]) {
    assert.equal(isValidMoneroAddress(a), true, `should accept mainnet address: ${a}`);
  }
});

test("classifies network and kind", () => {
  assert.deepEqual(validateMoneroAddress(MAINNET_STANDARD), {
    valid: true, network: "mainnet", kind: "standard",
  });
  assert.deepEqual(validateMoneroAddress(MAINNET_SUBADDRESS), {
    valid: true, network: "mainnet", kind: "subaddress",
  });
  assert.deepEqual(validateMoneroAddress(MAINNET_INTEGRATED), {
    valid: true, network: "mainnet", kind: "integrated",
  });
});

test("accepts surrounding whitespace (validation trims)", () => {
  assert.equal(isValidMoneroAddress(`  ${MAINNET_STANDARD}\n`), true);
});

test("rejects checksum typo", () => {
  const last = MAINNET_STANDARD.length - 1;
  const typo =
    MAINNET_STANDARD.slice(0, last) + (MAINNET_STANDARD[last] === "e" ? "f" : "e");
  const result = validateMoneroAddress(typo);
  assert.equal(result.valid, false, "checksum typo must be rejected");
  assert.match(result.reason, /checksum/);
});

test("rejects bad length and charset", () => {
  assert.equal(isValidMoneroAddress(""), false);
  assert.equal(isValidMoneroAddress("4"), false);
  assert.equal(isValidMoneroAddress(MAINNET_STANDARD.slice(0, 94)), false); // too short
  assert.equal(isValidMoneroAddress(MAINNET_STANDARD + "1"), false); // too long
  // '0', 'O', 'I', 'l' are not in the Monero base58 alphabet.
  for (const bad of ["0", "O", "I", "l"]) {
    const mutated = MAINNET_STANDARD.slice(0, 10) + bad + MAINNET_STANDARD.slice(11);
    assert.equal(isValidMoneroAddress(mutated), false, `char '${bad}' must be rejected`);
  }
});

test("encoder matches ground truth", () => {
  // Anchor the test encoder against a real address: rebuilding from its decoded
  // keys must reproduce the exact original string.
  const { tag, spendKey, viewKey } = decodeKeys(MAINNET_STANDARD);
  assert.equal(buildAddress(tag, spendKey, viewKey), MAINNET_STANDARD);
  const integrated = decodeKeys(MAINNET_INTEGRATED);
  assert.equal(
    buildAddress(integrated.tag, integrated.spendKey, integrated.viewKey, integrated.paymentId),
    MAINNET_INTEGRATED
  );
});

test("network gate blocks non-mainnet unless enabled", () => {
  // Reuse real (curve-valid) keys, just change the network tag.
  const { spendKey, viewKey } = decodeKeys(MAINNET_STANDARD);
  const stagenet = buildAddress(XMR_STAGENET_STANDARD, spendKey, viewKey);
  const testnet = buildAddress(XMR_TESTNET_STANDARD, spendKey, viewKey);

  // Default (mainnet-only, like the deployed program) rejects both...
  assert.equal(isValidMoneroAddress(stagenet), false);
  assert.equal(isValidMoneroAddress(testnet), false);
  // ...but a stagenet/testnet configuration accepts them.
  assert.deepEqual(validateMoneroAddress(stagenet, { allowTestnet: true }), {
    valid: true, network: "stagenet", kind: "standard",
  });
  assert.deepEqual(validateMoneroAddress(testnet, { allowTestnet: true }), {
    valid: true, network: "testnet", kind: "standard",
  });

  // And mainnet is accepted regardless of the flag.
  assert.equal(isValidMoneroAddress(MAINNET_STANDARD), true);
  assert.equal(isValidMoneroAddress(MAINNET_STANDARD, { allowTestnet: true }), true);
});

test("rejects tag/length mismatch", () => {
  const { spendKey, viewKey, paymentId } = decodeKeys(MAINNET_INTEGRATED);
  // Standard tag with a payment id (106 chars) and integrated tag without one
  // (95 chars) are both malformed even with valid checksums.
  const standardTagWithPid = buildAddress(XMR_MAINNET_STANDARD, spendKey, viewKey, paymentId);
  const integratedTagNoPid = buildAddress(XMR_MAINNET_INTEGRATED, spendKey, viewKey);
  assert.equal(isValidMoneroAddress(standardTagWithPid), false);
  assert.equal(isValidMoneroAddress(integratedTagNoPid), false);
});

test("rejects non-curve public key", () => {
  // [2; 32] is not a valid ed25519 point (same style of probe as the Rust test,
  // which searches [b; 32] for the first non-decompressible value).
  const bad = new Uint8Array(32).fill(2);
  const { viewKey } = decodeKeys(MAINNET_STANDARD);
  // Valid checksum + valid tag, but the spend key is off-curve.
  const addr = buildAddress(XMR_MAINNET_STANDARD, bad, viewKey);
  const result = validateMoneroAddress(addr, { allowTestnet: true });
  assert.equal(result.valid, false, "off-curve key must be rejected");
  assert.match(result.reason, /ed25519/);
});

test("rejects key encodings Monero itself rejects (strict decompression)", () => {
  // monero-wallet-rpc validate_address rejects non-canonical y (>= p) and
  // x=0-with-sign-bit encodings; the relayer wallet could never pay these, so
  // the validator must reject them even though the on-chain program's more
  // permissive dalek decompress would let them through.
  const { viewKey } = decodeKeys(MAINNET_STANDARD);

  // y = p (2^255 - 19): non-canonical encoding of y = 0, which is on-curve.
  const yEqualsP = new Uint8Array(32).fill(0xff);
  yEqualsP[0] = 0xed;
  yEqualsP[31] = 0x7f;
  // y = 1 with the sign bit set: decompresses to x = 0 with "negative" sign.
  const xZeroSignBit = new Uint8Array(32);
  xZeroSignBit[0] = 0x01;
  xZeroSignBit[31] = 0x80;

  for (const badKey of [yEqualsP, xZeroSignBit]) {
    const addr = buildAddress(XMR_MAINNET_STANDARD, badKey, viewKey);
    const result = validateMoneroAddress(addr);
    assert.equal(result.valid, false, "non-canonical key encoding must be rejected");
    assert.match(result.reason, /ed25519/);
  }
});

test("every single-character substitution is rejected", () => {
  // A 4-byte Keccak checksum plus the base58 range checks must catch any
  // one-character corruption of a real address.
  for (const addr of [MAINNET_STANDARD, MAINNET_SUBADDRESS, MAINNET_INTEGRATED]) {
    for (let i = 0; i < addr.length; i++) {
      for (const c of BASE58_ALPHABET) {
        if (c === addr[i]) continue;
        const mutated = addr.slice(0, i) + c + addr.slice(i + 1);
        assert.equal(
          isValidMoneroAddress(mutated),
          false,
          `mutation at index ${i} ('${addr[i]}' -> '${c}') of ${addr.slice(0, 12)}… must be rejected`
        );
      }
    }
  }
});

test("assertValidMoneroAddress throws with a reason", () => {
  assert.doesNotThrow(() => assertValidMoneroAddress(MAINNET_STANDARD));
  assert.throws(
    () => assertValidMoneroAddress("not-an-address"),
    /Invalid Monero address: address must be 95 characters/
  );
});
