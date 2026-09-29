'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

async function copyAddress(address: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(address);
    return;
  } catch {
    // Older browsers and HTTP onion sites may not expose the Clipboard API.
  }

  const activeElement = document.activeElement;
  const selection = window.getSelection();
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange())
    : [];
  const textarea = document.createElement('textarea');
  textarea.value = address;
  textarea.readOnly = true;
  textarea.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;font-size:16px';
  document.body.appendChild(textarea);

  try {
    textarea.select();
    if (!document.execCommand('copy')) throw new Error('Copy failed');
  } finally {
    textarea.remove();
    if (activeElement instanceof HTMLElement) activeElement.focus({ preventScroll: true });
    if (selection) {
      selection.removeAllRanges();
      ranges.forEach((range) => selection.addRange(range));
    }
  }
}

export function CopyAddress({
  address,
  label = 'address',
  className = '',
  children,
}: {
  address?: string;
  label?: string;
  className?: string;
  children?: ReactNode;
}) {
  const [feedback, setFeedback] = useState<{ address: string; ok: boolean } | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timeout.current) clearTimeout(timeout.current);
  }, []);

  const copy = async () => {
    if (!address) return;
    if (timeout.current) clearTimeout(timeout.current);
    setFeedback(null);
    let ok = false;
    try {
      await copyAddress(address);
      ok = true;
    } catch {
      // Keep the address visible so it can still be selected and copied manually.
    }
    setFeedback({ address, ok });
    timeout.current = setTimeout(() => setFeedback(null), ok ? 2000 : 5000);
  };

  const currentFeedback = feedback?.address === address ? feedback : null;

  return (
    <button
      type="button"
      onClick={() => void copy()}
      disabled={!address}
      aria-label={`Copy ${label}`}
      title={address ? `Click to copy ${label}: ${address}` : undefined}
      className={`min-w-0 cursor-pointer text-left transition-colors hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6600] disabled:cursor-not-allowed ${className}`}
    >
      {children ?? address}
      <span role="status" aria-live="polite" className={`block whitespace-normal font-sans text-xs ${currentFeedback?.ok ? 'text-green-400' : 'text-red-400'}`}>
        {currentFeedback ? currentFeedback.ok ? 'Copied!' : 'Could not copy. Select and copy manually.' : ''}
      </span>
    </button>
  );
}
