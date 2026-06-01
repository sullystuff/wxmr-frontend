// Small status pill for deposit/withdrawal records.
// Light palette — soft wash + readable ink, a single quiet dot.

const STYLES: Record<string, { wash: string; ink: string; dot: string; label: string }> = {
  pending: { wash: 'var(--color-warn-wash)', ink: 'var(--color-warn)', dot: 'var(--color-warn)', label: 'Pending' },
  active: { wash: 'var(--color-success-wash)', ink: 'var(--color-success)', dot: 'var(--color-success)', label: 'Active' },
  sending: { wash: '#eef2fb', ink: '#3552a0', dot: '#3552a0', label: 'Sending' },
  completed: { wash: 'var(--color-success-wash)', ink: 'var(--color-success)', dot: 'var(--color-success)', label: 'Completed' },
  reverted: { wash: 'var(--color-danger-wash)', ink: 'var(--color-danger)', dot: 'var(--color-danger)', label: 'Reverted' },
  closed: { wash: 'var(--color-sunken)', ink: 'var(--color-ink-3)', dot: 'var(--color-ink-3)', label: 'Closed' },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STYLES[status] ?? STYLES.closed;
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-pill text-[11px] font-semibold tracking-[0.02em]"
      style={{ background: s.wash, color: s.ink }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.dot }} />
      {s.label}
    </span>
  );
}
