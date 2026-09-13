'use client';

import { useEffect, useState } from 'react';
import { WITHDRAWAL_CANCEL_DELAY_SECONDS } from '@wxmr/core/bridge';

export function CancelWithdrawalButton({ createdAt, disabled, canceling, onCancel }: {
  createdAt: number;
  disabled: boolean;
  canceling: boolean;
  onCancel: () => void;
}) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const secondsLeft = Math.max(0, createdAt + WITHDRAWAL_CANCEL_DELAY_SECONDS - now);
  const waiting = secondsLeft > 0;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, [waiting]);

  return (
    <div className="mt-4 border-t border-[var(--border)] pt-3">
      <button type="button" onClick={onCancel} disabled={disabled || secondsLeft > 0}
        className="rounded-lg border border-[#ff6600] px-4 py-2 text-sm font-medium text-[#ff6600] transition-colors hover:bg-[#ff6600]/10 disabled:cursor-not-allowed disabled:opacity-50">
        {canceling ? 'Canceling…' : secondsLeft > 0
          ? `Cancel available in ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`
          : 'Cancel withdrawal'}
      </button>
      <p className="mt-2 text-xs text-[var(--muted)]">
        Returns your wXMR while this request is pending. The original bridge fee is retained.
      </p>
    </div>
  );
}
