'use client';

import Link from 'next/link';
import { useProtocolData } from '@/hooks/useProtocolData';
import { BridgeCard } from '@/components/home/BridgeCard';
import { ProtocolHealth } from '@/components/home/ProtocolHealth';
import { LiveActivity } from '@/components/home/LiveActivity';
import { ProtocolFlow } from '@/components/home/ProtocolFlow';
import { formatXmr, formatPct } from '@/lib/format';

const TRUST = [
  '1:1 backed by native XMR',
  'Redeemable at any time',
  'Public reserve verification',
  'On-chain audit records',
];

const VERIFICATION = ['Reserve verification', 'Coverage verification', 'Public view key'];

function Check({ className = 'w-[14px] h-[14px]' }: { className?: string }) {
  return (
    <svg className={`${className} flex-shrink-0`} viewBox="0 0 24 24" fill="none" style={{ color: 'var(--color-success)' }}>
      <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Arrow() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 5l7 7-7 7" />
    </svg>
  );
}

export function HomeView() {
  const { stats, activity, loading } = useProtocolData();

  const held = stats?.backing != null ? formatXmr(stats.backing, 2) : '0.00';
  const supply = formatXmr(stats?.circulating ?? BigInt(0), 2);
  const coverage =
    stats == null ? '—' : stats.circulating === BigInt(0) ? '100%' : stats.coverage != null ? formatPct(stats.coverage) : 'Pending';

  return (
    <main>
      {/* Hero — asymmetric message column + the bridge as the protocol's center */}
      <section className="max-w-[1100px] mx-auto px-5 md:px-8 pt-14 md:pt-20 pb-14">
        <div className="grid lg:grid-cols-[1fr_minmax(0,420px)] gap-12 lg:gap-20 items-start">
          <div>
            <div className="flex items-center gap-2 mb-6">
              <span className="w-1.5 h-1.5 rounded-full live-dot" style={{ background: 'var(--color-success)' }} />
              <span className="mono text-[11px] uppercase tracking-[0.16em] text-ink-3">Mainnet · Solana</span>
            </div>
            <h1 className="display-xl text-[54px] md:text-[76px] font-bold leading-[0.92] text-ink">
              <span className="text-accent">Monero</span><br />on Solana
            </h1>
            <p className="text-[16px] md:text-[17px] leading-relaxed text-ink-2 mt-6 max-w-[44ch]">
              Private liquidity for the Solana ecosystem. Bridge native XMR into Solana and redeem it at any time.
              Every token is backed 1:1 and independently verifiable.
            </p>
            <ul className="mt-7 grid grid-cols-1 sm:grid-cols-2 gap-x-7 gap-y-2.5 max-w-[440px]">
              {TRUST.map((t) => (
                <li key={t} className="flex items-center gap-2 text-[13.5px] font-medium text-ink">
                  <Check /> {t}
                </li>
              ))}
            </ul>
          </div>

          {/* Bridge widget + a verification affordance (no raw addresses up front) */}
          <div className="lg:mt-1">
            <div id="bridge" className="scroll-mt-24 rounded-[16px] glow-card">
              <BridgeCard />
            </div>
            <Link
              href="/transparency"
              className="mt-3 surface-inset px-4 py-3 flex items-center justify-between hover:border-line-2 transition-colors group"
              style={{ borderRadius: 'var(--radius-field)' }}
            >
              <span className="flex items-center gap-2 text-[12.5px] text-ink-2">
                <Check className="w-[13px] h-[13px]" /> Independently verifiable
              </span>
              <span className="flex items-center gap-1 text-[12.5px] font-semibold text-accent-ink">
                Verify reserves
                <svg className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 5l7 7-7 7" /></svg>
              </span>
            </Link>
          </div>
        </div>
      </section>

      {/* The actual protocol, as a real flow */}
      <section className="border-y border-line bg-[var(--color-surface)]/40">
        <div className="max-w-[1100px] mx-auto px-5 md:px-8 py-7">
          <p className="mono text-[10.5px] uppercase tracking-[0.14em] text-ink-3 mb-5">How wXMR works</p>
          <ProtocolFlow />
        </div>
      </section>

      {/* Live reserve verification — trust data + that verification exists. Tools live one click away. */}
      <section className="bg-[var(--color-surface)]/30 border-b border-line">
        <div className="max-w-[1100px] mx-auto px-5 md:px-8 py-16">
          <div className="flex items-center gap-2.5 mb-6">
            <h2 className="text-[14px] font-semibold text-ink">Live reserve verification</h2>
            <span className="w-1.5 h-1.5 rounded-full live-dot" style={{ background: 'var(--color-success)' }} />
          </div>

          <div className="surface-card overflow-hidden">
            <div className="grid grid-cols-3 divide-x divide-line">
              {[
                { label: 'Native XMR held', value: held, unit: 'XMR', green: false },
                { label: 'wXMR supply', value: supply, unit: 'wXMR', green: false },
                { label: 'Coverage', value: coverage, unit: '', green: true },
              ].map((m) => (
                <div key={m.label} className="p-5">
                  <p className="mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3 mb-2.5">{m.label}</p>
                  <p className={`text-[22px] md:text-[26px] font-semibold tnum leading-none ${m.green ? 'text-[var(--color-success-ink)]' : 'text-ink'}`}>
                    {m.value}
                    {m.unit && <span className="text-[12px] font-medium text-ink-3 ml-1.5">{m.unit}</span>}
                  </p>
                </div>
              ))}
            </div>

            <div className="border-t border-line p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex flex-wrap gap-x-6 gap-y-2.5">
                {VERIFICATION.map((v) => (
                  <span key={v} className="flex items-center gap-2 text-[13px]">
                    <Check className="w-[13px] h-[13px]" />
                    <span className="text-ink">{v}</span>
                    <span className="mono text-[10.5px] uppercase tracking-[0.08em]" style={{ color: 'var(--color-success-ink)' }}>Available</span>
                  </span>
                ))}
              </div>
              <Link href="/transparency" className="btn-secondary px-4 py-2.5 text-[13px] font-semibold inline-flex items-center gap-2 whitespace-nowrap self-start sm:self-auto">
                View verification tools
                <Arrow />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Bridge status */}
      <section className="max-w-[1100px] mx-auto px-5 md:px-8 py-14">
        <ProtocolHealth stats={stats} loading={loading && !stats} />
      </section>

      {/* Recent activity */}
      <section className="max-w-[1100px] mx-auto px-5 md:px-8 pb-16">
        <LiveActivity events={activity} loading={loading && activity.length === 0} />
      </section>
    </main>
  );
}
