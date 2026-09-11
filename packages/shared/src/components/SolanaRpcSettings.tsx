'use client';

import { useId, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { checkSolanaRpcUrl, getCustomSolanaRpcUrl, saveSolanaRpcUrl } from '../solana-rpc';

const subscribe = () => () => {};
const serverSnapshot = () => null;

export function SolanaRpcSettings({ disabled = false }: { disabled?: boolean }) {
  const customUrl = useSyncExternalStore(subscribe, getCustomSolanaRpcUrl, serverSnapshot);
  const dialog = useRef<HTMLDialogElement>(null);
  const attempt = useRef(0);
  const id = useId();
  const [url, setUrl] = useState('');
  const [showUrl, setShowUrl] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    attempt.current++;
    setChecking(false);
    dialog.current?.close();
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const currentAttempt = ++attempt.current;
    setChecking(true);
    setError(null);
    try {
      const endpoint = await checkSolanaRpcUrl(url);
      if (attempt.current !== currentAttempt || !dialog.current?.open) return;
      saveSolanaRpcUrl(endpoint);
      window.location.reload();
    } catch (err) {
      if (attempt.current === currentAttempt) setError((err as Error).message);
    } finally {
      if (attempt.current === currentAttempt) setChecking(false);
    }
  };

  const reset = () => {
    try {
      saveSolanaRpcUrl(null);
      window.location.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const buttonClass = 'min-h-10 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--card-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <>
      <button
        type="button"
        className={`${buttonClass} shrink-0`}
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => {
          setUrl(customUrl ?? '');
          setError(null);
          setShowUrl(false);
          dialog.current?.showModal();
        }}
      >
        Solana RPC{customUrl ? ' · Custom' : ''}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        onCancel={close}
        className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 text-[var(--foreground)] shadow-2xl backdrop:bg-black/75"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id={`${id}-title`} className="text-lg font-semibold">Solana RPC</h2>
          <button type="button" onClick={close} className={buttonClass} aria-label="Close RPC settings">Close</button>
        </div>
        <p id={`${id}-description`} className="mb-4 text-sm text-[var(--muted)]">
          Use your own Solana mainnet RPC for this site&apos;s wallet reads and transactions.
          Saved only in this browser, separately for each site. Changes reload this page;
          other open tabs keep their current RPC until reloaded.
        </p>
        <form onSubmit={save}>
          <label htmlFor={`${id}-url`} className="mb-2 block text-sm font-medium">Custom RPC URL</label>
          <input
            id={`${id}-url`}
            type={showUrl ? 'text' : 'password'}
            value={url}
            onChange={(event) => { setUrl(event.target.value); setError(null); }}
            placeholder="https://your-solana-rpc.example"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            required
            disabled={checking}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${id}-error` : undefined}
            className="xmr-input w-full min-w-0 px-3 py-3 text-base"
          />
          <label className="mt-3 flex w-fit items-center gap-2 text-sm">
            <input type="checkbox" checked={showUrl} onChange={(event) => setShowUrl(event.target.checked)} className="accent-[var(--primary)]" />
            Show URL
          </label>
          <p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">
            Your browser connects directly to this provider. The URL may include an API key.
            Quotes and cross-chain processing continue to use their services.
          </p>
          {error && <p id={`${id}-error`} role="alert" className="mt-3 text-sm text-red-400">{error}</p>}
          <div className="mt-5 flex flex-wrap gap-2">
            <button type="submit" disabled={checking || !url.trim()} className={`${buttonClass} border-[var(--primary)] text-[var(--primary)]`}>
              {checking ? 'Checking mainnet…' : 'Save & reload'}
            </button>
            <button type="button" onClick={reset} disabled={checking || !customUrl} className={buttonClass}>
              Use default & reload
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
