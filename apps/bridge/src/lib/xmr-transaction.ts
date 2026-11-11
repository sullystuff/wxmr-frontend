import { keccak_256 } from '@noble/hashes/sha3';

export const MAX_XMR_TRANSACTION_BYTES = 256_000;

// Monero v2 hashes H(prefix) || H(RingCT base) || H(prunable), not the
// entire blob. Support the CLSAG/Bulletproof+ formats used by the wallet.
export function xmrTransactionHash(bytes: Uint8Array): string {
  if (bytes.length === 0 || bytes.length > MAX_XMR_TRANSACTION_BYTES) throw new Error('Invalid XMR transaction size');
  let cursor = 0;
  const skip = (length: number) => {
    cursor += length;
    if (!Number.isSafeInteger(cursor) || cursor > bytes.length) throw new Error('Truncated XMR transaction');
  };
  const integer = () => {
    let value = BigInt(0);
    for (let i = 0; i < 10; i++) {
      if (cursor >= bytes.length) throw new Error('Truncated XMR varint');
      const byte = bytes[cursor++];
      value |= BigInt(byte & 127) << BigInt(i * 7);
      if (!(byte & 128)) return value;
    }
    throw new Error('Invalid XMR varint');
  };
  const count = () => {
    const value = integer();
    if (value > BigInt(bytes.length)) throw new Error('Invalid XMR vector size');
    return Number(value);
  };
  if (integer() !== BigInt(2)) throw new Error('Unsupported XMR transaction version');
  integer(); // unlock_time
  const inputs = count();
  if (!inputs) throw new Error('XMR transaction has no inputs');
  for (let i = 0; i < inputs; i++) {
    if (bytes[cursor++] !== 2) throw new Error('Unsupported XMR input');
    integer();
    const ring = count();
    if (!ring) throw new Error('Empty XMR ring');
    for (let j = 0; j < ring; j++) integer();
    skip(32);
  }
  const outputs = count();
  if (!outputs) throw new Error('XMR transaction has no outputs');
  for (let i = 0; i < outputs; i++) {
    integer();
    const type = bytes[cursor++];
    if (type !== 2 && type !== 3) throw new Error('Unsupported XMR output');
    skip(type === 3 ? 33 : 32);
  }
  const extra = count();
  skip(extra);
  const prefixEnd = cursor;
  const type = bytes[cursor++];
  if (type !== 5 && type !== 6) throw new Error('Unsupported XMR RingCT type');
  integer(); // fee
  skip(outputs * 40); // compact encrypted amounts (8) and commitments (32)
  if (cursor === bytes.length) throw new Error('Missing XMR signatures');
  const hashes = new Uint8Array(96);
  hashes.set(keccak_256(bytes.subarray(0, prefixEnd)), 0);
  hashes.set(keccak_256(bytes.subarray(prefixEnd, cursor)), 32);
  hashes.set(keccak_256(bytes.subarray(cursor)), 64);
  return Array.from(keccak_256(hashes), byte => byte.toString(16).padStart(2, '0')).join('');
}
