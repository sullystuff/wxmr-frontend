'use client';

import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { SwapPanel } from '@wxmr/shared';

// Monero Logo SVG (official logo)
function MoneroLogo({ className = "w-8 h-8" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 3756.09 3756.49" xmlns="http://www.w3.org/2000/svg">
      <path d="M4128,2249.81C4128,3287,3287.26,4127.86,2250,4127.86S372,3287,372,2249.81,1212.76,371.75,2250,371.75,4128,1212.54,4128,2249.81Z" transform="translate(-371.96 -371.75)" fill="#fff"/>
      <path d="M2250,371.75c-1036.89,0-1879.12,842.06-1877.8,1878,0.26,207.26,33.31,406.63,95.34,593.12h561.88V1263L2250,2483.57,3470.52,1263v1579.9h562c62.12-186.48,95-385.85,95.37-593.12C4129.66,1212.76,3287,372,2250,372Z" transform="translate(-371.96 -371.75)" fill="#f26822"/>
      <path d="M1969.3,2764.17l-532.67-532.7v994.14H1029.38l-384.29.07c329.63,540.8,925.35,902.56,1604.91,902.56S3525.31,3766.4,3855,3225.6H3063.25V2231.47l-532.7,532.7-280.61,280.61-280.62-280.61h0Z" transform="translate(-371.96 -371.75)" fill="#4d4d4d"/>
    </svg>
  );
}

export default function SwapPage() {
  return (
    <main className="min-h-screen flex flex-col xmr-pattern">
      {/* Header */}
      <header className="flex justify-between items-center gap-4 max-w-5xl w-full mx-auto px-4 md:px-8 py-5">
        <div className="flex items-center gap-3">
          <MoneroLogo className="w-9 h-9" />
          <div>
            <h1 className="text-xl font-bold bg-gradient-to-r from-[#ff6600] to-[#ff8533] bg-clip-text text-transparent">
              wXMR Swap
            </h1>
            <p className="text-xs text-[var(--muted)]">XMR &harr; USDC on Solana</p>
          </div>
        </div>
        <WalletMultiButton />
      </header>

      {/* Swap card */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-10">
        <SwapPanel />
        <p className="text-xs text-[var(--muted)] mt-6">
          Best-price routing powered by <span className="text-[#ff6600]">Jupiter</span>
        </p>
      </div>

      {/* Footer */}
      <footer className="border-t border-[var(--border)] py-6">
        <div className="max-w-5xl mx-auto px-4 md:px-8 flex flex-col sm:flex-row justify-between items-center gap-3 text-sm text-[var(--muted)]">
          <span>wXMR Bridge</span>
          <a
            href="https://wxmr.io"
            className="hover:text-[#ff6600] transition-colors"
          >
            Bridge XMR &harr; Solana at wxmr.io &rarr;
          </a>
        </div>
      </footer>
    </main>
  );
}
