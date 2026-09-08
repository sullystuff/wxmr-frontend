// Keep addresses only; account data/status always comes from Solana.
// In-memory storage also works when the browser denies localStorage access.
const remembered = new Map<string, string[]>();

export function knownWithdrawals(program: string, owner: string): string[] {
  const key = `wxmr:withdrawals:${program}:${owner}`;
  let stored: unknown;
  try { stored = JSON.parse(localStorage.getItem(key) || '[]'); } catch { stored = []; }
  const fromDisk = Array.isArray(stored) ? stored.filter((item): item is string => typeof item === 'string') : [];
  return [...new Set([...(remembered.get(key) ?? []), ...fromDisk])];
}

export function rememberWithdrawals(program: string, owner: string, addresses: string[]) {
  const key = `wxmr:withdrawals:${program}:${owner}`;
  const next = [...new Set([...knownWithdrawals(program, owner), ...addresses])];
  remembered.set(key, next);
  try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* Memory fallback remains available. */ }
}
