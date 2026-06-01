import { formatXmr, relativeTime } from '@/lib/format';
import type { ActivityEvent } from '@/lib/protocol';

function Row({ e }: { e: ActivityEvent }) {
  const inbound = e.direction === 'in';
  const color = inbound ? 'var(--color-success-ink)' : 'var(--color-accent-ink)';
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3.5 hover:bg-surface-2 transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        <span
          className="grid place-items-center w-7 h-7 rounded-[8px] flex-shrink-0"
          style={{ background: inbound ? 'var(--color-success-wash)' : 'var(--color-accent-wash)', color }}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d={inbound ? 'M12 5v14m0 0l6-6m-6 6l-6-6' : 'M12 19V5m0 0l-6 6m6-6l6 6'} />
          </svg>
        </span>
        <span className="text-[13.5px] text-ink-2 truncate">
          {inbound ? (
            <><span className="font-semibold tnum text-ink">{formatXmr(e.amount, 2)} XMR</span> bridged in</>
          ) : (
            <>Redeemed <span className="font-semibold tnum text-ink">{formatXmr(e.amount, 2)} wXMR</span></>
          )}
        </span>
      </div>
      <span className="text-[12.5px] text-ink-3 whitespace-nowrap">{relativeTime(e.ts)}</span>
    </div>
  );
}

export function LiveActivity({ events, loading }: { events: ActivityEvent[]; loading: boolean }) {
  return (
    <section className="flex flex-col">
      <div className="flex items-center gap-2.5 mb-5">
        <h2 className="text-[14px] font-semibold text-ink">Recent activity</h2>
        <span className="w-1.5 h-1.5 rounded-full live-dot" style={{ background: 'var(--color-success)' }} />
      </div>

      <div className="surface-card overflow-hidden">
        {loading ? (
          <div className="divide-y divide-line">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 px-5 py-4">
                <div className="w-7 h-7 rounded-[8px] bg-sunken animate-pulse flex-shrink-0" />
                <div className="h-4 rounded bg-sunken animate-pulse" style={{ width: `${60 - i * 6}%` }} />
              </div>
            ))}
          </div>
        ) : events.length > 0 ? (
          <div className="divide-y divide-line">
            {events.map((e) => (
              <Row key={e.id} e={e} />
            ))}
          </div>
        ) : (
          <div className="px-5 py-5">
            <p className="text-[13.5px] font-medium text-ink mb-3">Awaiting first bridge transaction.</p>
            <div className="space-y-1.5">
              <p className="flex items-center gap-2 text-[12.5px] text-ink-2">
                <span className="w-1.5 h-1.5 rounded-full live-dot" style={{ background: 'var(--color-success)' }} />
                Monitoring deposits
              </p>
              <p className="flex items-center gap-2 text-[12.5px] text-ink-2">
                <span className="w-1.5 h-1.5 rounded-full live-dot" style={{ background: 'var(--color-success)' }} />
                Monitoring redemptions
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
