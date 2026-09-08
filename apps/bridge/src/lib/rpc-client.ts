// Each visitor calls the public RPC directly. Components share a browser-local
// cache and queue; supported browsers coordinate the budget across their tabs.
export const PUBLIC_SOLANA_RPC = 'https://solana-rpc.publicnode.com';
export const RPC_INTERVAL_MS = 1_000;

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

export class RpcError extends Error {
  constructor(message: string, readonly status = 503) {
    super(message);
  }
}

type RpcReply = { result?: unknown; error?: { code: number; message: string; data?: unknown } };
type RpcResult = { reply: RpcReply; cache: 'hit' | 'miss' | 'coalesced' };

export function createRpcClient(options: {
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  runExclusive?: <T>(job: () => Promise<T>) => Promise<T>;
  readNextStart?: () => number;
  writeNextStart?: (nextStart: number) => void;
} = {}) {
  const request = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const cache = new Map<string, { reply: RpcReply; expires: number }>();
  const pending = new Map<string, Promise<RpcReply>>();
  let tail: Promise<unknown> = Promise.resolve();
  let nextStart = 0;
  let queued = 0;
  const runExclusive = options.runExclusive ?? (async <T>(job: () => Promise<T>) => job());

  async function call(method: string, params: unknown[] = []): Promise<RpcResult> {
    if (!Object.hasOwn(CACHE_TTL, method)) {
      throw new RpcError('RPC method is not available', 400);
    }
    const ttl = CACHE_TTL[method];
    const key = JSON.stringify([method, params]);
    const cached = cache.get(key);
    if (cached && cached.expires > now()) return { reply: cached.reply, cache: 'hit' };
    const existing = ttl > 0 ? pending.get(key) : undefined;
    if (existing) return { reply: await existing, cache: 'coalesced' };
    if (queued >= 24 || nextStart - now() > 30_000) {
      throw new RpcError('RPC is busy. Please try again shortly.', 429);
    }

    queued++;
    const enqueuedAt = now();
    const job = tail.then(() => runExclusive(async () => {
      nextStart = Math.max(nextStart, options.readNextStart?.() ?? 0);
      const delay = Math.max(0, nextStart - now());
      if (now() + delay - enqueuedAt > 30_000) {
        throw new RpcError('RPC is busy. Please try again shortly.', 429);
      }
      while (nextStart > now()) await sleep(Math.ceil(nextStart - now()));
      // Reserve at dispatch time, including failed calls. No automatic retries.
      nextStart = now() + RPC_INTERVAL_MS;
      options.writeNextStart?.(nextStart);
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
          throw new RpcError('Public Solana RPC is temporarily unavailable.', response.status === 429 ? 429 : 502);
        }
        const body = await response.json() as RpcReply;
        if (!body || (!Object.hasOwn(body, 'result') && !body.error)) {
          throw new RpcError('Invalid response from public Solana RPC.', 502);
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
        nextStart = Math.max(nextStart, now() + (error instanceof RpcError ? 0 : 5_000));
        throw error instanceof RpcError ? error : new RpcError('Public Solana RPC request failed.', 502);
      } finally {
        options.writeNextStart?.(nextStart);
      }
    }));
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

const BROWSER_BUDGET_KEY = 'wxmr:public-rpc:next-start';

export const browserRpc = createRpcClient({
  fetch: (...args) => {
    if (typeof window === 'undefined') throw new RpcError('Bridge RPC reads run in the browser');
    return globalThis.fetch(...args);
  },
  runExclusive: async (job) => {
    if (typeof navigator !== 'undefined' && navigator.locks) {
      return navigator.locks.request('wxmr:public-rpc', { signal: AbortSignal.timeout(30_000) }, job);
    }
    return job();
  },
  readNextStart: () => {
    try {
      const value = Number(localStorage.getItem(BROWSER_BUDGET_KEY));
      return Number.isFinite(value) ? Math.max(0, value) : 0;
    } catch { return 0; }
  },
  writeNextStart: (nextStart) => {
    try { localStorage.setItem(BROWSER_BUDGET_KEY, String(nextStart)); } catch { /* Per-tab pacing still applies. */ }
  },
});

// Adapt the cached response to web3.js while preserving its request ID.
export function rpcFetch(client = browserRpc): typeof fetch {
  return async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    if (Array.isArray(body)) throw new RpcError('RPC batches are not supported', 400);
    const { reply } = await client.call(body.method, body.params ?? []);
    return Response.json({ jsonrpc: '2.0', id: body.id, ...reply });
  };
}

export async function rpcResult<T>(method: string, params: unknown[]): Promise<T> {
  const { reply } = await browserRpc.call(method, params);
  if (reply.error) throw new RpcError(reply.error.message, 502);
  return reply.result as T;
}
