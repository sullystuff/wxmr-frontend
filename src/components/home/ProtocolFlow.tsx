// The actual protocol, as a flow — not decoration. Native XMR is held 1:1
// in a public reserve wallet, wXMR is minted on Solana, and it's redeemable
// at any time. Color runs Monero-orange → Solana-green to show XMR entering
// Solana, which is the one thing unique to this product.

const STAGES = [
  { k: '01', label: 'Native XMR', sub: 'Deposited to your address', dot: 'var(--color-accent)' },
  { k: '02', label: 'Reserve wallet', sub: 'Held 1:1 · view key public', dot: 'var(--color-accent)' },
  { k: '03', label: 'wXMR minted', sub: 'SPL token on Solana', dot: '#7fb36b' },
  { k: '04', label: 'Usable & redeemable', sub: 'Burn to withdraw anytime', dot: 'var(--color-success)' },
];

function Arrow({ vertical = false }: { vertical?: boolean }) {
  return (
    <svg
      className={vertical ? 'w-4 h-4 my-1 rotate-90 text-ink-3 mx-auto' : 'w-4 h-4 text-ink-3 flex-shrink-0'}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M5 12h14m0 0l-6-6m6 6l-6 6" />
    </svg>
  );
}

export function ProtocolFlow() {
  return (
    <div className="flex flex-col md:flex-row md:items-stretch">
      {STAGES.map((s, i) => (
        <div key={s.k} className="contents md:flex md:items-center md:flex-1">
          <div className="flex-1 py-3 md:py-0 md:px-5 first:md:pl-0">
            <div className="flex items-center gap-2.5 mb-1.5">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.dot }} />
              <span className="mono text-[10.5px] text-ink-3">{s.k}</span>
            </div>
            <p className="text-[15px] font-semibold text-ink leading-tight">{s.label}</p>
            <p className="text-[12px] text-ink-2 mt-1">{s.sub}</p>
          </div>
          {i < STAGES.length - 1 && (
            <>
              <Arrow vertical />
              <span className="hidden md:flex md:items-center"><Arrow /></span>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
