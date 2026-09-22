import { getSolanaRpcEndpoint } from '@wxmr/shared/solana-rpc';

// Each visitor calls their selected RPC directly. Components share a browser-local
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
  endpoint?: string;
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
        const response = await request(options.endpoint ?? PUBLIC_SOLANA_RPC, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
          signal: AbortSignal.timeout(12_000),
          cache: 'no-store',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        });
        if (!response.ok) {
          const retryHeader = response.headers.get('retry-after');
          const seconds = retryHeader ? Number(retryHeader) : NaN;
          const retryMs = Number.isFinite(seconds) ? seconds * 1_000
            : retryHeader ? Date.parse(retryHeader) - Date.now() : 0;
          nextStart = Math.max(nextStart, now() + Math.max(5_000, retryMs || 0));
          throw new RpcError('Solana RPC is temporarily unavailable.', response.status === 429 ? 429 : 502);
        }
        const body = await response.json() as RpcReply;
        if (!body || (!Object.hasOwn(body, 'result') && !body.error)) {
          throw new RpcError('Invalid response from Solana RPC.', 502);
        }
        const reply: RpcReply = body.error ? { error: body.error } : { result: body.result };
        if (method === 'sendTransaction' && !reply.error) {
          // Only short-lived account reads are stale after a send; history
          // caches (getTransaction, getSignaturesForAddress) stay intact.
          for (const [key, entry] of cache) {
            if (entry.expires - now() <= 5_000) cache.delete(key);
          }
        }
        // Missing transactions and RPC errors must be retried on the next request.
        if (ttl > 0 && !reply.error && reply.result != null) {
          if (cache.size >= 1_000) cache.delete(cache.keys().next().value!);
          cache.set(key, { reply, expires: now() + ttl });
        }
        return reply;
      } catch (error) {
        nextStart = Math.max(nextStart, now() + (error instanceof RpcError ? 0 : 5_000));
        throw error instanceof RpcError ? error : new RpcError('Solana RPC request failed.', 502);
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
  // Dispatch several cached reads as one JSON-RPC batch request, sharing a
  // single budget slot. Only cached read methods may be batched.
  async function callBatch(requests: Array<{ method: string; params?: unknown[] }>): Promise<RpcResult[]> {
    if (requests.length === 0) return [];
    const results: RpcResult[] = new Array(requests.length);
    const misses: Array<{ index: number; method: string; params: unknown[]; key: string; ttl: number }> = [];
    for (let i = 0; i < requests.length; i++) {
      const { method, params = [] } = requests[i];
      if (!Object.hasOwn(CACHE_TTL, method)) throw new RpcError(`RPC method is not available: ${method}`, 400);
      const ttl = CACHE_TTL[method];
      if (ttl === 0) throw new RpcError('Only cached read methods can be batched', 400);
      const key = JSON.stringify([method, params]);
      const cached = cache.get(key);
      if (cached && cached.expires > now()) { results[i] = { reply: cached.reply, cache: 'hit' }; continue; }
      const existing = pending.get(key);
      if (existing) { results[i] = { reply: await existing, cache: 'coalesced' }; continue; }
      misses.push({ index: i, method, params, key, ttl });
    }
    if (misses.length === 0) return results;
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
      nextStart = now() + RPC_INTERVAL_MS;
      options.writeNextStart?.(nextStart);
      try {
        const response = await request(options.endpoint ?? PUBLIC_SOLANA_RPC, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(misses.map((m) => ({ jsonrpc: '2.0', id: m.index, method: m.method, params: m.params }))),
          signal: AbortSignal.timeout(12_000),
          cache: 'no-store',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        });
        if (!response.ok) {
          const retryHeader = response.headers.get('retry-after');
          const seconds = retryHeader ? Number(retryHeader) : NaN;
          const retryMs = Number.isFinite(seconds) ? seconds * 1_000
            : retryHeader ? Date.parse(retryHeader) - Date.now() : 0;
          nextStart = Math.max(nextStart, now() + Math.max(5_000, retryMs || 0));
          throw new RpcError('Solana RPC is temporarily unavailable.', response.status === 429 ? 429 : 502);
        }
        const body = await response.json() as Array<RpcReply & { id: number }>;
        if (!Array.isArray(body)) throw new RpcError('Invalid response from Solana RPC.', 502);
        const byId = new Map<number, RpcReply & { id: number }>();
        for (const item of body) {
          if (item && typeof item.id === 'number') byId.set(item.id, item);
        }
        for (const m of misses) {
          const reply = byId.get(m.index);
          if (!reply || (!Object.hasOwn(reply, 'result') && !reply.error)) {
            throw new RpcError('Invalid response from Solana RPC.', 502);
          }
          const normalized: RpcReply = reply.error ? { error: reply.error } : { result: reply.result };
          if (m.ttl > 0 && !normalized.error && normalized.result != null) {
            if (cache.size >= 1_000) cache.delete(cache.keys().next().value!);
            cache.set(m.key, { reply: normalized, expires: now() + m.ttl });
          }
          results[m.index] = { reply: normalized, cache: 'miss' };
        }
      } catch (error) {
        nextStart = Math.max(nextStart, now() + (error instanceof RpcError ? 0 : 5_000));
        throw error instanceof RpcError ? error : new RpcError('Solana RPC request failed.', 502);
      } finally {
        options.writeNextStart?.(nextStart);
      }
    }));
    tail = job.catch(() => {});
    const missPromises = misses.map((m) => job.then(() => results[m.index].reply));
    // Coalesced callers await these directly; mark them handled so a failed
    // batch does not leak unhandled rejections when only the batch is awaited.
    for (const promise of missPromises) promise.catch(() => {});
    misses.forEach((m, i) => pending.set(m.key, missPromises[i]));
    try {
      await job;
      return results;
    } finally {
      queued--;
      misses.forEach((m, i) => {
        if (pending.get(m.key) === missPromises[i]) pending.delete(m.key);
      });
    }
  }
  return { call, callBatch };
}

const BROWSER_BUDGET_KEY = 'wxmr:public-rpc:next-start';

const FALLBACK_SOLANA_RPCS = [
  PUBLIC_SOLANA_RPC,
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL,
  'https://api.mainnet-beta.solana.com',
].filter((endpoint): endpoint is string => Boolean(endpoint));

export const browserRpc = createRpcClient({
  fetch: async (...args) => {
    if (typeof window === 'undefined') throw new RpcError('Bridge RPC reads run in the browser');
    const primary = getSolanaRpcEndpoint(PUBLIC_SOLANA_RPC);
    const endpoints = [primary, ...FALLBACK_SOLANA_RPCS.filter((endpoint) => endpoint !== primary)];
    let lastResponse: Response | undefined;
    let lastError: unknown;
    for (const endpoint of endpoints) {
      try {
        const response = await globalThis.fetch(endpoint, { ...(args[1] ?? {}), signal: AbortSignal.timeout(12_000) });
        if (response.ok) return response;
        lastResponse = response;
      } catch (error) {
        lastError = error;
      }
    }
    if (lastResponse) return lastResponse;
    throw lastError instanceof Error ? lastError : new RpcError('Solana RPC request failed.', 502);
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
    if (Array.isArray(body)) {
      const results = await client.callBatch(body.map((request) => ({ method: request.method, params: request.params ?? [] })));
      return Response.json(body.map((request, i) => ({ jsonrpc: '2.0', id: request.id, ...results[i].reply })));
    }
    const { reply } = await client.call(body.method, body.params ?? []);
    return Response.json({ jsonrpc: '2.0', id: body.id, ...reply });
  };
}

export async function rpcResult<T>(method: string, params: unknown[]): Promise<T> {
  const { reply } = await browserRpc.call(method, params);
  if (reply.error) throw new RpcError(reply.error.message, 502);
  return reply.result as T;
}

export async function rpcBatchResult<T>(requests: Array<{ method: string; params: unknown[] }>): Promise<T[]> {
  const results = await browserRpc.callBatch(requests);
  return results.map(({ reply }) => {
    if (reply.error) throw new RpcError(reply.error.message, 502);
    return reply.result as T;
  });
}

// Some endpoints (e.g. PublicNode) reject batches of certain methods. Try the
// batch first, then fall back to individual reads on the same selected endpoint.
export async function batchWithFallback<T>(
  requests: Array<{ method: string; params: unknown[] }>,
  batch: (requests: Array<{ method: string; params: unknown[] }>) => Promise<T[]>,
  single: (method: string, params: unknown[]) => Promise<T>,
): Promise<T[]> {
  try {
    return await batch(requests);
  } catch {
    const results: T[] = [];
    for (const { method, params } of requests) results.push(await single(method, params));
    return results;
  }
}
