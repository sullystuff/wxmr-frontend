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
      'getMultipleAccounts', [addresses, { encoding: 'base64', commitment: 'finalized' }],
    );
    const coder = new BorshAccountsCoder(IDL as Idl);
    for (const [index, info] of result.value.entries()) {
      if (!info || info.owner !== BRIDGE_PROGRAM.toBase58()) continue;
      const record = coder.decode('AuditRecord', Buffer.from(info.data[0], 'base64'));
      if (record.data.startsWith('{"format":"wxmr-reserve-v1"')) {
        // Account uploads are incremental. Do not display a partial report as
        // either a reserve proof or a legacy consolidation audit.
        try { JSON.parse(record.data); } catch { continue; }
      }
      records.push({
        account: addresses[index],
        epoch: record.epoch.toNumber(), timestamp: record.timestamp.toNumber(),
        circulatingSupply: record.circulating_supply.toString(),
        spendableBalance: record.spendable_balance.toString(),
        unconfirmedBalance: record.unconfirmed_balance.toString(), data: record.data,
      });
    }
  }
  return { records: records.sort((a, b) => b.timestamp - a.timestamp || b.epoch - a.epoch), ...page };
}
