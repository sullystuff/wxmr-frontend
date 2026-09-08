// One relay is shared by every bridge API route in this Node process.
// Never use the worker/orchestrator RPC settings here.
export const PUBLIC_SOLANA_RPC = 'https://api.mainnet.solana.com';
export const RPC_INTERVAL_MS = 1_250;

const CACHE_TTL: Record<string, number> = {
  getAccountInfo: 5_000,
  getMultipleAccounts: 5_000,
  getBalance: 5_000,
  getLatestBlockhash: 0,
  getBlockHeight: 3_000,
  getSignatureStatuses: 2_000,
  getSignaturesForAddress: 60_000,
  getTransaction: 3_600_000,
  sendTransaction: 0,
  simulateTransaction: 0,
};

export class RpcRelayError extends Error {
  constructor(message: string, readonly status = 503) {
    super(message);
  }
}

type RpcReply = { result?: unknown; error?: { code: number; message: string; data?: unknown } };
type RelayResult = { reply: RpcReply; cache: 'hit' | 'miss' | 'coalesced' };

export function createRpcRelay(options: {
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
} = {}) {
  const request = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => performance.now());
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const cache = new Map<string, { reply: RpcReply; expires: number }>();
  const pending = new Map<string, Promise<RpcReply>>();
  let tail: Promise<unknown> = Promise.resolve();
  let nextStart = 0;
  let queued = 0;
  let count = 0;

  async function call(method: string, params: unknown[] = []): Promise<RelayResult> {
    if (!Object.hasOwn(CACHE_TTL, method)) {
      throw new RpcRelayError('RPC method is not available', 400);
    }
    const ttl = CACHE_TTL[method];
    const key = JSON.stringify([method, params]);
    const cached = cache.get(key);
    if (cached && cached.expires > now()) return { reply: cached.reply, cache: 'hit' };
    const existing = ttl > 0 ? pending.get(key) : undefined;
    if (existing) return { reply: await existing, cache: 'coalesced' };
    if (queued >= 24 || nextStart - now() > 30_000) {
      throw new RpcRelayError('RPC is busy. Please try again shortly.', 429);
    }

    queued++;
    const enqueuedAt = now();
    const job = tail.then(async () => {
      const delay = Math.max(0, nextStart - now());
      if (now() + delay - enqueuedAt > 30_000) {
        throw new RpcRelayError('RPC is busy. Please try again shortly.', 429);
      }
      while (nextStart > now()) await sleep(Math.ceil(nextStart - now()));
      // Reserve at dispatch time, including failed calls. No automatic retries.
      nextStart = now() + RPC_INTERVAL_MS;
      count++;
      console.info(`[bridge-rpc] upstream=${count} method=${method}`);
      try {
        const response = await request(PUBLIC_SOLANA_RPC, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
          signal: AbortSignal.timeout(12_000),
          cache: 'no-store',
        });
        if (!response.ok) {
          const retryHeader = response.headers.get('retry-after');
          const seconds = retryHeader ? Number(retryHeader) : NaN;
          const retryMs = Number.isFinite(seconds) ? seconds * 1_000
            : retryHeader ? Date.parse(retryHeader) - Date.now() : 0;
          nextStart = Math.max(nextStart, now() + Math.max(5_000, retryMs || 0));
          throw new RpcRelayError('Public Solana RPC is temporarily unavailable.', response.status === 429 ? 429 : 502);
        }
        const body = await response.json() as RpcReply;
        if (!body || (!Object.hasOwn(body, 'result') && !body.error)) {
          throw new RpcRelayError('Invalid response from public Solana RPC.', 502);
        }
        const reply: RpcReply = body.error ? { error: body.error } : { result: body.result };
        if (method === 'sendTransaction' && !reply.error) cache.clear();
        // Missing transactions and RPC errors must be retried on the next request.
        if (ttl > 0 && !reply.error && reply.result != null) {
          if (cache.size >= 1_000) cache.delete(cache.keys().next().value!);
          cache.set(key, { reply, expires: now() + ttl });
        }
        return reply;
      } catch (error) {
        nextStart = Math.max(nextStart, now() + (error instanceof RpcRelayError ? 0 : 5_000));
        throw error instanceof RpcRelayError ? error : new RpcRelayError('Public Solana RPC request failed.', 502);
      }
    });
    tail = job.catch(() => {});
    if (ttl > 0) pending.set(key, job);
    try {
      return { reply: await job, cache: 'miss' };
    } finally {
      queued--;
      if (pending.get(key) === job) pending.delete(key);
    }
  }
  return { call };
}

const shared = globalThis as typeof globalThis & { wxmrBridgeRpc?: ReturnType<typeof createRpcRelay> };
export const bridgeRpc = shared.wxmrBridgeRpc ??= createRpcRelay();

export async function rpcResult<T>(method: string, params: unknown[]): Promise<T> {
  const { reply } = await bridgeRpc.call(method, params);
  if (reply.error) throw new RpcRelayError(reply.error.message, 502);
  return reply.result as T;
}
