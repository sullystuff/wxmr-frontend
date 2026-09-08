import { NextResponse } from 'next/server';
import { PublicKey } from '@solana/web3.js';
import { readHistoryPage } from '@/lib/chain-history';
import { RpcRelayError } from '@/lib/rpc-relay';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    let owner: PublicKey;
    try { owner = new PublicKey(params.get('owner') || ''); }
    catch { throw new RpcRelayError('Invalid wallet address', 400); }
    const page = await readHistoryPage(owner, 'withdrawal', params.get('before') || undefined);
    return NextResponse.json(page, { headers: { 'Cache-Control': 'private, max-age=30' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof RpcRelayError ? error.message : 'Failed to load withdrawal history' }, {
      status: error instanceof RpcRelayError ? error.status : 502,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
