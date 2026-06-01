'use client';

import { useState, useRef, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { truncateAddress } from '@/lib/format';

/** Polished connect/connected control replacing the default wallet-adapter button.
 *  Disconnected → opens the wallet modal. Connected → green dot + address with a
 *  small disconnect menu. */
export function ConnectButton() {
  const { publicKey, disconnect, connecting } = useWallet();
  const { setVisible } = useWalletModal();
  const [menuOpen, setMenuOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  if (!publicKey) {
    return (
      <button
        onClick={() => setVisible(true)}
        className="btn-primary px-4 py-2 text-[13px] font-semibold"
      >
        {connecting ? 'Connecting…' : 'Connect wallet'}
      </button>
    );
  }

  const address = publicKey.toBase58();

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setMenuOpen((o) => !o)}
        className="btn-secondary inline-flex items-center gap-2 pl-2.5 pr-3 py-2 text-[13px] font-semibold"
      >
        <span className="w-2 h-2 rounded-full bg-[var(--color-success)]" />
        <span className="font-mono tracking-tight text-ink">{truncateAddress(address, 4)}</span>
        <svg className={`w-3.5 h-3.5 text-ink-3 transition-transform ${menuOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {menuOpen && (
        <div className="absolute right-0 mt-2 w-44 surface-card overflow-hidden rise z-50" style={{ boxShadow: 'var(--shadow-pop)' }}>
          <button
            onClick={() => { navigator.clipboard.writeText(address); setMenuOpen(false); }}
            className="w-full text-left px-3.5 py-2.5 text-[13px] text-ink-2 hover:bg-inset transition-colors"
          >
            Copy address
          </button>
          <button
            onClick={() => { setVisible(true); setMenuOpen(false); }}
            className="w-full text-left px-3.5 py-2.5 text-[13px] text-ink-2 hover:bg-inset transition-colors border-t border-line"
          >
            Change wallet
          </button>
          <button
            onClick={() => { disconnect(); setMenuOpen(false); }}
            className="w-full text-left px-3.5 py-2.5 text-[13px] font-medium hover:bg-inset transition-colors border-t border-line"
            style={{ color: 'var(--color-danger)' }}
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
