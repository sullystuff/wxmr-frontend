'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Wordmark } from '@/components/brand/BrandMark';
import { ConnectButton } from '@/components/layout/ConnectButton';

const NAV = [
  { href: '/', label: 'Bridge' },
  { href: '/transparency', label: 'Proof of Reserves' },
  { href: '/docs', label: 'Docs' },
];

export function TopBar() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas">
      <div className="max-w-[1040px] mx-auto px-5 md:px-8 h-[60px] flex items-center justify-between gap-6">
        <div className="flex items-center gap-8">
          <Link href="/" className="rounded-[8px]">
            <Wordmark />
          </Link>
          <nav className="hidden md:flex items-center gap-1">
            {NAV.map((item) => {
              const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-3 py-1.5 text-[13.5px] rounded-[8px] transition-colors ${
                    active ? 'text-ink font-semibold' : 'text-ink-2 hover:text-ink font-medium'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <ConnectButton />
      </div>
    </header>
  );
}
