// Display formatting helpers, shared across the app.
// One source of truth so amounts read identically everywhere.

const PICO_PER_XMR = 1e12;

/** XMR for display: clean, fixed precision (default 4 dp). */
export function formatXmr(piconero: bigint, decimals = 4): string {
  const xmr = Number(piconero) / PICO_PER_XMR;
  return xmr.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Full-precision XMR string — for prefilling inputs (e.g. MAX) where we must not round away balance. */
export function formatXmrFull(piconero: bigint): string {
  return (Number(piconero) / PICO_PER_XMR).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 12,
    useGrouping: false,
  });
}

/** Generic atomic-units → decimal string. */
export function formatAtomic(amount: bigint, decimals: number, maxFractionDigits = decimals): string {
  return (Number(amount) / Math.pow(10, decimals)).toLocaleString('en-US', {
    maximumFractionDigits: maxFractionDigits,
  });
}

/** Absolute local timestamp from a unix-seconds value. */
export function formatTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString();
}

/** Compact relative time, e.g. "just now", "4m ago", "3h ago", "2d ago". */
export function relativeTime(unixSeconds: number, now = Date.now()): string {
  const diff = Math.max(0, Math.floor(now / 1000 - unixSeconds));
  if (diff < 45) return 'just now';
  if (diff < 90) return '1m ago';
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 7200) return '1h ago';
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  if (diff < 172800) return '1d ago';
  return `${Math.round(diff / 86400)}d ago`;
}

/** Middle-truncate an address: "AbCd…WxYz". */
export function truncateAddress(address: string, chars = 4): string {
  if (!address) return '';
  if (address.length <= chars * 2 + 1) return address;
  return `${address.slice(0, chars)}…${address.slice(-chars)}`;
}

export function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** Compact USD: $1.24M, $48.2K, $842. */
export function formatUsdCompact(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 10_000) return `$${(value / 1_000).toFixed(1)}K`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

/** Coverage ratio as a percentage string, e.g. "100.00%". */
export function formatPct(ratio: number): string {
  return `${(ratio * 100).toFixed(2)}%`;
}
