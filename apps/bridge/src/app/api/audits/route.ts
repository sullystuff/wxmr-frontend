import { NextResponse } from 'next/server';
import { Connection, PublicKey } from '@solana/web3.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BRIDGE_PROGRAM_ID =
  process.env.NEXT_PUBLIC_BRIDGE_PROGRAM_ID || 'EzBkC8P5wxab9kwrtV5hRdynHAfB5w3UPcPXNgMseVA8';
const SOLANA_RPC =
  process.env.SOLANA_RPC_URL ||
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
  'https://api.mainnet-beta.solana.com';

// First 8 bytes of sha256("account:AuditRecord"), base58 encoded for memcmp.
const AUDIT_RECORD_DISCRIMINATOR_B58 = '4wCwkHnKz1g';

type AuditRecordResponse = {
  epoch: number;
  timestamp: number;
  circulatingSupply: string;
  spendableBalance: string;
  unconfirmedBalance: string;
  data: string;
};

export async function GET() {
  try {
    const records = await fetchAuditRecords();

    return NextResponse.json(records, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Error fetching audit records:', error);

    return NextResponse.json(
      { error: 'Failed to load audit records' },
      { status: 502 },
    );
  }
}

async function fetchAuditRecords(): Promise<AuditRecordResponse[]> {
  const connection = new Connection(SOLANA_RPC, 'confirmed');
  const programId = new PublicKey(BRIDGE_PROGRAM_ID);

  const accounts = await connection.getProgramAccounts(programId, {
    filters: [
      {
        memcmp: {
          offset: 0,
          bytes: AUDIT_RECORD_DISCRIMINATOR_B58,
        },
      },
    ],
  });

  const records: AuditRecordResponse[] = [];

  for (const account of accounts) {
    try {
      records.push(decodeAuditRecord(Buffer.from(account.account.data)));
    } catch (error) {
      console.warn(`Skipping malformed audit record ${account.pubkey.toBase58()}:`, error);
    }
  }

  return records.sort((a, b) => b.epoch - a.epoch);
}

function decodeAuditRecord(data: Buffer): AuditRecordResponse {
  let offset = 8; // discriminator

  const epoch = Number(data.readBigUInt64LE(offset));
  offset += 8;

  const timestamp = Number(data.readBigInt64LE(offset));
  offset += 8;

  const circulatingSupply = data.readBigUInt64LE(offset).toString();
  offset += 8;

  const spendableBalance = data.readBigUInt64LE(offset).toString();
  offset += 8;

  const unconfirmedBalance = data.readBigUInt64LE(offset).toString();
  offset += 8;

  const dataLen = data.readUInt32LE(offset);
  offset += 4;

  if (offset + dataLen > data.length) {
    throw new Error(`Audit data length ${dataLen} exceeds account size ${data.length}`);
  }

  return {
    epoch,
    timestamp,
    circulatingSupply,
    spendableBalance,
    unconfirmedBalance,
    data: data.subarray(offset, offset + dataLen).toString('utf8'),
  };
}
