import { NextResponse } from 'next/server';
import { bridgeRpc, RpcRelayError } from '@/lib/rpc-relay';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  let id: string | number | null = null;
  try {
    // Only the fixed public destination and supported bridge methods are exposed.
    const origin = request.headers.get('origin');
    // Next can use its internal listen hostname in request.url behind a proxy.
    const host = request.headers.get('host') ?? new URL(request.url).host;
    if (origin && new URL(origin).host !== host) {
      return NextResponse.json({ error: 'Origin is not allowed' }, { status: 403 });
    }
    const text = await request.text();
    if (text.length > 32_768) throw new RpcRelayError('Request is too large', 413);
    const body = JSON.parse(text);
    if (!body || Array.isArray(body) || body.jsonrpc !== '2.0'
      || typeof body.method !== 'string' || !Array.isArray(body.params ?? [])
      || !['string', 'number'].includes(typeof body.id)) {
      throw new RpcRelayError('Invalid RPC request; batches are not supported', 400);
    }
    id = body.id;
    const { reply, cache } = await bridgeRpc.call(body.method, body.params ?? []);
    return NextResponse.json({ jsonrpc: '2.0', id, ...reply }, {
      headers: { 'Cache-Control': 'no-store', 'X-Wxmr-Rpc-Cache': cache },
    });
  } catch (error) {
    const status = error instanceof RpcRelayError ? error.status : error instanceof SyntaxError ? 400 : 502;
    return NextResponse.json({
      jsonrpc: '2.0', id,
      error: { code: -32000, message: error instanceof RpcRelayError ? error.message : 'RPC request failed' },
    }, { status, headers: { 'Cache-Control': 'no-store', ...(status === 429 ? { 'Retry-After': '5' } : {}) } });
  }
}
