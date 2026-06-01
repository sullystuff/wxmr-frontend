import Link from 'next/link';
import { BrandMark } from '@/components/brand/BrandMark';

const COLUMNS: { heading: string; links: { label: string; href: string; external?: boolean }[] }[] = [
  {
    heading: 'Protocol',
    links: [
      { label: 'Bridge', href: '/' },
      { label: 'Proof of Reserves', href: '/transparency' },
      { label: 'Documentation', href: '/docs' },
    ],
  },
  {
    heading: 'Resources',
    links: [
      { label: 'Monero', href: 'https://getmonero.org', external: true },
      { label: 'Solana', href: 'https://solana.com', external: true },
      { label: 'xmrchain.net', href: 'https://xmrchain.net', external: true },
    ],
  },
  {
    heading: 'Security',
    links: [
      { label: 'Audit process', href: '/transparency' },
      { label: 'Reserve verification', href: '/transparency' },
      { label: 'View key', href: '/transparency' },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-line mt-16">
      <div className="max-w-[1040px] mx-auto px-5 md:px-8 py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2 mb-3">
              <BrandMark size={22} />
              <span className="text-[14px] font-semibold text-ink">wXMR Bridge</span>
            </div>
            <p className="text-[12.5px] leading-relaxed text-ink-3 max-w-[24ch]">
              Native Monero on Solana. 1:1 backed and independently verifiable.
            </p>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.heading}>
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-3 mb-3.5">{col.heading}</h3>
              <ul className="space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.label}>
                    {l.external ? (
                      <a href={l.href} target="_blank" rel="noopener noreferrer" className="text-[13px] text-ink-2 hover:text-ink transition-colors">
                        {l.label}
                      </a>
                    ) : (
                      <Link href={l.href} className="text-[13px] text-ink-2 hover:text-ink transition-colors">
                        {l.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 pt-6 border-t border-line flex items-center justify-between text-[12px] text-ink-3">
          <span>© {new Date().getFullYear()} wXMR Bridge</span>
          <span>Powered by Monero &amp; Solana</span>
        </div>
      </div>
    </footer>
  );
}
