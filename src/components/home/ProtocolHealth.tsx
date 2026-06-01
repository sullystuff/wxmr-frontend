import { formatXmr } from '@/lib/format';
import type { ProtocolStats } from '@/lib/protocol';

type Tone = 'live' | 'pending' | 'neutral';

function Dot({ tone }: { tone: Tone }) {
  const color = tone === 'live' ? 'var(--color-success)' : tone === 'pending' ? 'var(--color-warn)' : 'var(--color-ink-3)';
  return <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${tone === 'live' ? 'live-dot' : ''}`} style={{ background: color }} />;
}

function StatusItem({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  const color = tone === 'live' ? 'text-[var(--color-success-ink)]' : tone === 'pending' ? 'text-[var(--color-warn)]' : 'text-ink';
  return (
    <div className="p-5">
      <p className="mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3 mb-2.5">{label}</p>
      <p className={`flex items-center gap-2 text-[16px] font-semibold tnum leading-none ${color}`}>
        <Dot tone={tone} />
        {value}
      </p>
    </div>
  );
}

export function ProtocolHealth({ stats }: { stats: ProtocolStats | null; loading?: boolean }) {
  const hasAudit = stats?.lastAudit != null;
  const supply = `${formatXmr(stats?.circulating ?? BigInt(0), 2)} wXMR`;

  return (
    <section>
      <h2 className="text-[14px] font-semibold text-ink mb-5">Bridge status</h2>
      <div className="surface-card overflow-hidden grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-line [&>*]:border-line">
        <StatusItem label="Reserve wallet" value="Live" tone="live" />
        <StatusItem label="Redemptions" value="Live" tone="live" />
        <StatusItem label="Coverage audit" value={hasAudit ? 'Published' : 'Pending'} tone={hasAudit ? 'live' : 'pending'} />
        <StatusItem label="Supply" value={supply} tone="neutral" />
      </div>
    </section>
  );
}
