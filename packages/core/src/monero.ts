import { keccak_256 } from "@noble/hashes/sha3";
import { ed25519 } from "@noble/curves/ed25519";
import { PICONERO_PER_XMR } from "./constants.js";

/** Exact piconero -> XMR decimal string (no rounding, no locale separators), e.g. 100_000_000_000n -> "0.1". */
export function formatXmrAmount(piconero: bigint): string {
  const whole = piconero / PICONERO_PER_XMR;
  const fraction = (piconero % PICONERO_PER_XMR).toString().padStart(12, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

// TypeScript port of the on-chain withdrawal address validation in
// wxmr-backend/programs/wxmr-bridge/src/lib.rs (`validate_xmr_address_impl`).
// Running the identical checks client-side lets the UI reject a bad address
// before a transaction is ever submitted to the Solana network. Any change
// here must stay in lockstep with the Rust implementation.

// Base58 alphabet used by Monero (excludes 0, O, I, l)
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

const BASE58_DIGITS = new Map<string, bigint>(
  [...BASE58_ALPHABET].map((c, i) => [c, BigInt(i)])
);

// Monero network+type address tags (the leading varint byte of the decoded
// address). All are < 128, so they encode as a single varint byte.
const XMR_MAINNET_STANDARD = 18;
const XMR_MAINNET_INTEGRATED = 19;
const XMR_MAINNET_SUBADDRESS = 42;
const XMR_STAGENET_STANDARD = 24;
const XMR_STAGENET_INTEGRATED = 25;
const XMR_STAGENET_SUBADDRESS = 36;
const XMR_TESTNET_STANDARD = 53;
const XMR_TESTNET_INTEGRATED = 54;
const XMR_TESTNET_SUBADDRESS = 63;

// Decoded address layout: [tag(1)] [spend(32)] [view(32)] [payment_id(8, integrated only)] [checksum(4)]
const XMR_STANDARD_DECODED_LEN = 1 + 32 + 32 + 4; // 69 bytes  -> 95 base58 chars
const XMR_INTEGRATED_DECODED_LEN = 1 + 32 + 32 + 8 + 4; // 77 bytes -> 106 base58 chars
const XMR_CHECKSUM_LEN = 4;

const U64_MAX = (1n << 64n) - 1n;

export type MoneroNetwork = "mainnet" | "stagenet" | "testnet";
export type MoneroAddressKind = "standard" | "subaddress" | "integrated";

export interface MoneroAddressValidationOptions {
  /**
   * Accept stagenet/testnet address prefixes in addition to mainnet.
   * Mirrors the compile-time `ALLOW_TESTNET_ADDRESSES` gate in the on-chain
   * program, which is `false` for the deployed mainnet build — only enable
   * this against a stagenet/testnet deployment of the bridge program.
   */
  allowTestnet?: boolean;
}

export type MoneroAddressValidationResult =
  | { valid: true; network: MoneroNetwork; kind: MoneroAddressKind }
  | { valid: false; reason: string };

/**
 * Monero base58 block-size table: encoded char count -> decoded byte count.
 * Only the sizes that a valid encoding can produce are accepted.
 */
function decodedBlockSize(encodedLen: number): number | null {
  switch (encodedLen) {
    case 0: return 0;
    case 2: return 1;
    case 3: return 2;
    case 5: return 3;
    case 6: return 4;
    case 7: return 5;
    case 9: return 6;
    case 10: return 7;
    case 11: return 8;
    default: return null;
  }
}

/**
 * Decode a single Monero base58 block into `out` (whose length must equal the
 * block's decoded size). Mirrors `tools::base58::decode_block`, including the
 * u64 overflow and per-size range checks.
 */
function decodeBlock(enc: string, out: Uint8Array): boolean {
  const resSize = decodedBlockSize(enc.length);
  if (resSize === null || resSize !== out.length) return false;

  let resNum = 0n;
  let order = 1n;
  for (let i = enc.length - 1; i >= 0; i--) {
    const digit = BASE58_DIGITS.get(enc[i]);
    if (digit === undefined) return false; // symbol outside the alphabet

    const product = order * digit;
    if (product > U64_MAX) return false; // mul128 hi != 0 in the reference
    resNum += product;
    if (resNum > U64_MAX) return false; // addition wrapped
    // order *= 58 for the next (more significant) digit. Skipped on the final
    // iteration where 58^11 would overflow u64 and is never used anyway.
    if (i !== 0) {
      order *= 58n;
      if (order > U64_MAX) return false;
    }
  }

  // A partial block's value must fit in its decoded byte count.
  if (resSize < 8 && 1n << BigInt(8 * resSize) <= resNum) return false;

  // Big-endian write of the low `resSize` bytes.
  for (let j = resSize - 1; j >= 0; j--) {
    out[j] = Number(resNum & 0xffn);
    resNum >>= 8n;
  }
  return true;
}

/** Monero block base58-decode, or `null` if the encoding is malformed. */
function moneroBase58Decode(enc: string): Uint8Array | null {
  const FULL_ENCODED_BLOCK = 11;
  const FULL_BLOCK = 8;

  const fullBlockCount = Math.floor(enc.length / FULL_ENCODED_BLOCK);
  const lastBlockSize = enc.length % FULL_ENCODED_BLOCK;
  const lastDecoded = decodedBlockSize(lastBlockSize);
  if (lastDecoded === null) return null;

  const out = new Uint8Array(fullBlockCount * FULL_BLOCK + lastDecoded);
  for (let i = 0; i < fullBlockCount; i++) {
    const encStart = i * FULL_ENCODED_BLOCK;
    const outStart = i * FULL_BLOCK;
    if (
      !decodeBlock(
        enc.slice(encStart, encStart + FULL_ENCODED_BLOCK),
        out.subarray(outStart, outStart + FULL_BLOCK)
      )
    ) {
      return null;
    }
  }
  if (lastBlockSize > 0) {
    const encStart = fullBlockCount * FULL_ENCODED_BLOCK;
    const outStart = fullBlockCount * FULL_BLOCK;
    if (!decodeBlock(enc.slice(encStart), out.subarray(outStart, outStart + lastDecoded))) {
      return null;
    }
  }
  return out;
}

/**
 * A 32-byte value is a valid ed25519 public key iff it decompresses to a curve
 * point. Strict mode (`zip215: false`) matches Monero's own key check
 * (`ge_frombytes_vartime`, i.e. monero-wallet-rpc `validate_address`): it
 * rejects non-canonical y encodings (>= p) and x=0-with-sign-bit encodings.
 * The on-chain program's source applies the same strict check
 * (`is_strict_ed25519_point` in wxmr-backend); an older deployed build whose
 * `validate_edwards` was permissive would accept those crafted encodings, but
 * strict acceptance is a subset of it either way, so everything the UI
 * approves passes the program — and nothing the Monero wallet can't pay out
 * gets through.
 */
function isValidEd25519Point(bytes: Uint8Array): boolean {
  try {
    ed25519.ExtendedPoint.fromHex(bytes, false);
    return true;
  } catch {
    return false;
  }
}

/** Structured decode of a Monero address; `null` if it is not well-formed base58 of a plausible length. */
export function decodeMoneroAddress(address: string): {
  tag: number;
  spendKey: Uint8Array;
  viewKey: Uint8Array;
  paymentId: Uint8Array | null;
  checksumOk: boolean;
} | null {
  if (address.length !== 95 && address.length !== 106) return null;
  const decoded = moneroBase58Decode(address);
  if (decoded === null) return null;
  if (
    decoded.length !== XMR_STANDARD_DECODED_LEN &&
    decoded.length !== XMR_INTEGRATED_DECODED_LEN
  ) {
    return null;
  }

  const checksumStart = decoded.length - XMR_CHECKSUM_LEN;
  const computed = keccak_256(decoded.subarray(0, checksumStart));
  let checksumOk = true;
  for (let i = 0; i < XMR_CHECKSUM_LEN; i++) {
    if (computed[i] !== decoded[checksumStart + i]) checksumOk = false;
  }

  const isIntegrated = decoded.length === XMR_INTEGRATED_DECODED_LEN;
  return {
    tag: decoded[0],
    spendKey: decoded.slice(1, 33),
    viewKey: decoded.slice(33, 65),
    paymentId: isIntegrated ? decoded.slice(65, 73) : null,
    checksumOk,
  };
}

/**
 * Fully validates a Monero address with the exact same procedure as the
 * on-chain program (and monero-wallet-rpc's `validate_address`):
 *   1. Monero block base58 decode (rejects malformed encodings / bad symbols).
 *   2. 4-byte Keccak-256 checksum over the tag+keys (catches typos).
 *   3. Exact network+type tag match. Mainnet is always accepted; stagenet and
 *      testnet only with `allowTestnet`.
 *   4. Both public keys must be valid ed25519 curve points.
 * Accepts standard, subaddress, and integrated addresses.
 *
 * The address is trimmed before validation — callers must submit the trimmed
 * string on-chain, otherwise the program will reject what the UI accepted.
 */
export function validateMoneroAddress(
  address: string,
  options: MoneroAddressValidationOptions = {}
): MoneroAddressValidationResult {
  const allowTestnet = options.allowTestnet ?? false;
  const value = address.trim();

  // Fast length pre-check before doing any real work.
  if (value.length !== 95 && value.length !== 106) {
    return {
      valid: false,
      reason: "address must be 95 characters (standard or subaddress) or 106 characters (integrated)",
    };
  }

  // 1. Monero block base58 decode.
  const decoded = moneroBase58Decode(value);
  if (decoded === null) {
    return { valid: false, reason: "address is not valid Monero base58" };
  }
  if (
    decoded.length !== XMR_STANDARD_DECODED_LEN &&
    decoded.length !== XMR_INTEGRATED_DECODED_LEN
  ) {
    return { valid: false, reason: "address is not valid Monero base58" };
  }

  // 2. Keccak-256 checksum: first 4 bytes of keccak(tag||keys[||payment_id]).
  const checksumStart = decoded.length - XMR_CHECKSUM_LEN;
  const computed = keccak_256(decoded.subarray(0, checksumStart));
  for (let i = 0; i < XMR_CHECKSUM_LEN; i++) {
    if (computed[i] !== decoded[checksumStart + i]) {
      return { valid: false, reason: "checksum mismatch — the address contains a typo" };
    }
  }

  // 3. Network+type tag. Tags are single-byte varints (all < 128).
  const tag = decoded[0];
  if (tag >= 0x80) {
    return { valid: false, reason: "unrecognized address prefix" };
  }
  const isIntegrated = decoded.length === XMR_INTEGRATED_DECODED_LEN;

  let network: MoneroNetwork;
  let kind: MoneroAddressKind;
  switch (tag) {
    case XMR_MAINNET_STANDARD: network = "mainnet"; kind = "standard"; break;
    case XMR_MAINNET_INTEGRATED: network = "mainnet"; kind = "integrated"; break;
    case XMR_MAINNET_SUBADDRESS: network = "mainnet"; kind = "subaddress"; break;
    case XMR_STAGENET_STANDARD: network = "stagenet"; kind = "standard"; break;
    case XMR_STAGENET_INTEGRATED: network = "stagenet"; kind = "integrated"; break;
    case XMR_STAGENET_SUBADDRESS: network = "stagenet"; kind = "subaddress"; break;
    case XMR_TESTNET_STANDARD: network = "testnet"; kind = "standard"; break;
    case XMR_TESTNET_INTEGRATED: network = "testnet"; kind = "integrated"; break;
    case XMR_TESTNET_SUBADDRESS: network = "testnet"; kind = "subaddress"; break;
    default:
      return { valid: false, reason: "unrecognized address prefix" };
  }
  if ((kind === "integrated") !== isIntegrated) {
    return { valid: false, reason: "address prefix does not match its length" };
  }
  if (network !== "mainnet" && !allowTestnet) {
    return {
      valid: false,
      reason: `this is a ${network} address — the bridge only pays out to Monero mainnet addresses`,
    };
  }

  // 4. Both public keys must be valid ed25519 points (mirrors crypto::check_key).
  if (
    !isValidEd25519Point(decoded.subarray(1, 33)) ||
    !isValidEd25519Point(decoded.subarray(33, 65))
  ) {
    return { valid: false, reason: "embedded public keys are not valid ed25519 points" };
  }

  return { valid: true, network, kind };
}

export function isValidMoneroAddress(
  address: string,
  options: MoneroAddressValidationOptions = {}
): boolean {
  return validateMoneroAddress(address, options).valid;
}

export function assertValidMoneroAddress(
  address: string,
  options: MoneroAddressValidationOptions = {}
): void {
  const result = validateMoneroAddress(address, options);
  if (!result.valid) {
    throw new Error(`Invalid Monero address: ${result.reason}`);
  }
}
