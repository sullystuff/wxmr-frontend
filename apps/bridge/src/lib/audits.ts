import { Buffer } from 'buffer';
import { BorshAccountsCoder, type Idl } from '@coral-xyz/anchor';
import IDL from '@wxmr/core/idl/wxmr_bridge.json';
import { BRIDGE_PROGRAM, readHistoryPage } from './chain-history';
import { rpcResult } from './rpc-client';

export async function fetchAuditPage(before?: string) {
  const { addresses, ...page } = await readHistoryPage(BRIDGE_PROGRAM, 'audit', before);
  const records = [];
  if (addresses.length) {
    const result = await rpcResult<{ value: ({ owner: string; data: [string, string] } | null)[] }>(
      'getMultipleAccounts', [addresses, { encoding: 'base64', commitment: 'confirmed' }],
    );
    const coder = new BorshAccountsCoder(IDL as Idl);
    for (const info of result.value) {
      if (!info || info.owner !== BRIDGE_PROGRAM.toBase58()) continue;
      const record = coder.decode('AuditRecord', Buffer.from(info.data[0], 'base64'));
      records.push({
        epoch: record.epoch.toNumber(), timestamp: record.timestamp.toNumber(),
        circulatingSupply: record.circulating_supply.toString(),
        spendableBalance: record.spendable_balance.toString(),
        unconfirmedBalance: record.unconfirmed_balance.toString(), data: record.data,
      });
    }
  }
  return { records: records.sort((a, b) => b.epoch - a.epoch), ...page };
}
