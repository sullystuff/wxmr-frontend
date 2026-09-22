// Keep addresses only; account data/status always comes from Solana.
// In-memory storage also works when the browser denies localStorage access.
const remembered = new Map<string, string[]>();
const pending = new Map<string, Set<string>>();

// Newest withdrawals are discovered first and appended first; older history is
// appended later. The cap evicts from the tail (oldest) and never evicts
// withdrawals that are still pending, so their status/cancel controls survive.
const MAX_REMEMBERED_WITHDRAWALS = 100;

function pendingKey(program: string, owner: string): string {
  return `wxmr:withdrawals-pending:${program}:${owner}`;
}

function storedList(key: string): string[] {
  let stored: unknown;
  try { stored = JSON.parse(localStorage.getItem(key) || '[]'); } catch { stored = []; }
  return Array.isArray(stored) ? stored.filter((item): item is string => typeof item === 'string') : [];
}

export function knownWithdrawals(program: string, owner: string): string[] {
  const key = `wxmr:withdrawals:${program}:${owner}`;
  return [...new Set([...(remembered.get(key) ?? []), ...storedList(key)])];
}

export function pendingWithdrawals(program: string, owner: string): string[] {
  const key = pendingKey(program, owner);
  return [...new Set([...(pending.get(key) ?? []), ...storedList(key)])];
}

function writePending(program: string, owner: string, next: Set<string>) {
  const key = pendingKey(program, owner);
  pending.set(key, next);
  try { localStorage.setItem(key, JSON.stringify([...next])); } catch { /* Memory fallback remains available. */ }
}

export function rememberWithdrawals(program: string, owner: string, addresses: string[]) {
  const key = `wxmr:withdrawals:${program}:${owner}`;
  const protectedSet = new Set(pendingWithdrawals(program, owner));
  const next = [...new Set([...knownWithdrawals(program, owner), ...addresses])];
  while (next.length > MAX_REMEMBERED_WITHDRAWALS) {
    let evict = -1;
    for (let i = next.length - 1; i >= 0; i--) {
      if (!protectedSet.has(next[i])) { evict = i; break; }
    }
    if (evict === -1) break;
    next.splice(evict, 1);
  }
  remembered.set(key, next);
  try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* Memory fallback remains available. */ }
}

export function markWithdrawalPending(program: string, owner: string, address: string) {
  writePending(program, owner, new Set([...pendingWithdrawals(program, owner), address]));
  rememberWithdrawals(program, owner, [address]);
}

export function markWithdrawalsResolved(program: string, owner: string, addresses: string[]) {
  if (addresses.length === 0) return;
  const next = new Set(pendingWithdrawals(program, owner));
  for (const address of addresses) next.delete(address);
  writePending(program, owner, next);
}
