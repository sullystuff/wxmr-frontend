import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReserveReport, formatReserveXmr } from '../src/lib/reserve-proof';

const context = { format: 'wxmr-reserve-v1', id: 1800000000000, address: '4'.repeat(95),
  monero: { network: 'mainnet', height: 100, hash: 'a'.repeat(64) },
  solana: { genesisHash: 'a'.repeat(44), program: 'b'.repeat(44), mint: 'c'.repeat(44), slot: 100, blockhash: 'd'.repeat(44), supplyAtomic: '100000000000000001' },
  scope: 'reserves-with-supply-reference' };
const report = { ...context, message: JSON.stringify(context), proof: 'ReserveProofV2abc', proofSha256: 'a'.repeat(64),
  verified: { at: 1800000000, moneroHeight: 101, totalAtomic: '100000000000000001', spentAtomic: '0', unspentAtomic: '100000000000000001' },
  walletReported: { balanceAtomic: '100000000000000001', unlockedAtomic: '90000000000000001', outputs: 19 } };

test('reserve display preserves every piconero and accepts complete v1 reports', () => {
  assert.equal(parseReserveReport(JSON.stringify(report))?.verified.totalAtomic, '100000000000000001');
  assert.equal(formatReserveXmr('100000000000000001'), '100000.000000000001');
});

test('partial, altered-context, inconsistent, unsafe-number, and unsupported reports are not displayed as proof', () => {
  assert.equal(parseReserveReport(JSON.stringify(report).slice(0, 700)), null);
  for (const changed of [
    { ...report, format: 'wxmr-reserve-v2' },
    { ...report, address: '5'.repeat(95) },
    { ...report, message: report.message + ' ' },
    { ...report, verified: { ...report.verified, unspentAtomic: '1' } },
    { ...report, walletReported: { ...report.walletReported, balanceAtomic: 100000000000000001 } },
    { ...report, verified: { ...report.verified, moneroHeight: 99 } },
  ]) assert.equal(parseReserveReport(JSON.stringify(changed)), null);
});
