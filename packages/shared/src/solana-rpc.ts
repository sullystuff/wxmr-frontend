export const SOLANA_RPC_STORAGE_KEY = 'wxmr:solana-rpc-url';
export const SOLANA_MAINNET_GENESIS_HASH = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';

export function normalizeSolanaRpcUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('Enter a complete RPC URL starting with https:// or http://.');
  }
  if (!['https:', 'http:'].includes(url.protocol)) {
    throw new Error('Use an HTTP or HTTPS RPC URL, not a WebSocket URL.');
  }
  if (url.username || url.password || url.hash) {
    throw new Error('Use an RPC URL without a username, password, or # fragment. API keys in the path or query are supported.');
  }
  return url.href;
}

// Pin the selection for this page's lifetime. Saving requires an explicit reload;
// another tab must never change the endpoint beneath an in-flight transaction.
let pageRpcUrl: string | null | undefined;

export function getCustomSolanaRpcUrl(): string | null {
  if (typeof window === 'undefined') return null;
  if (pageRpcUrl !== undefined) return pageRpcUrl;
  try {
    const saved = window.localStorage.getItem(SOLANA_RPC_STORAGE_KEY);
    pageRpcUrl = saved ? normalizeSolanaRpcUrl(saved) : null;
  } catch {
    pageRpcUrl = null;
  }
  return pageRpcUrl;
}

export function getSolanaRpcEndpoint(defaultEndpoint: string): string {
  return getCustomSolanaRpcUrl() ?? defaultEndpoint;
}

export function saveSolanaRpcUrl(value: string | null): void {
  const endpoint = value === null ? null : normalizeSolanaRpcUrl(value);
  try {
    if (endpoint === null) window.localStorage.removeItem(SOLANA_RPC_STORAGE_KEY);
    else window.localStorage.setItem(SOLANA_RPC_STORAGE_KEY, endpoint);
  } catch {
    throw new Error('Your browser could not save this setting. Allow site storage and try again.');
  }
}

export async function checkSolanaRpcUrl(value: string, request: typeof fetch = globalThis.fetch): Promise<string> {
  const endpoint = normalizeSolanaRpcUrl(value);
  const url = new URL(endpoint);
  const loopback = url.hostname === 'localhost' || url.hostname.endsWith('.localhost')
    || url.hostname === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(url.hostname);
  if (typeof window !== 'undefined' && window.location.protocol === 'https:'
    && url.protocol === 'http:' && !loopback) {
    throw new Error('Use HTTPS for this RPC. Browsers block remote HTTP RPCs on a secure page.');
  }
  let reply: { result?: unknown; error?: unknown };
  try {
    const response = await request(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getGenesisHash', params: [] }),
      signal: AbortSignal.timeout(12_000),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('HTTP error');
    reply = await response.json();
    if (!reply || reply.error || typeof reply.result !== 'string') throw new Error('Invalid RPC response');
  } catch {
    // Provider errors can contain the entire URL, including its API key.
    throw new Error('Could not connect to this RPC. Check the URL, API key, and browser access (CORS), then try again.');
  }
  if (reply.result !== SOLANA_MAINNET_GENESIS_HASH) {
    throw new Error('This RPC is not on Solana mainnet. Choose a mainnet RPC URL.');
  }
  return endpoint;
}
