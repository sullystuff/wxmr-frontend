'use client';

import { useState, useEffect, useCallback } from 'react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useWxmrBridge, DepositAccountInfo, WithdrawalInfo } from '@/hooks/useWxmrBridge';
import { SwapModal } from '@/components/SwapModal';
import { QRCodeModal } from '@/components/modals/QRCodeModal';
import { QRScannerModal } from '@/components/modals/QRScannerModal';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Spinner } from '@/components/ui/Spinner';
import { BrandMark } from '@/components/brand/BrandMark';
import { formatXmr, formatXmrFull, formatTime, truncateAddress, getErrorMessage } from '@/lib/format';

type Tab = 'deposit' | 'withdraw';

function TokenChip({ symbol }: { symbol: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 bg-sunken rounded-pill pl-1.5 pr-3 py-1.5 flex-shrink-0">
      <BrandMark size={20} />
      <span className="text-[13px] font-semibold text-ink">{symbol}</span>
    </span>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-[12px] font-semibold text-ink-2">{children}</span>;
}

export function BridgeCard() {
  const {
    isConnected,
    createDepositAccount,
    closeDepositAccount,
    fetchMyDepositAccount,
    requestWithdrawal,
    fetchMyWithdrawals,
    getWxmrBalance,
    getPendingBalance,
    claimPendingMint,
  } = useWxmrBridge();

  const [tab, setTab] = useState<Tab>('deposit');
  const [depositAccount, setDepositAccount] = useState<DepositAccountInfo | null>(null);
  const [withdrawals, setWithdrawals] = useState<WithdrawalInfo[]>([]);
  const [wxmrBalance, setWxmrBalance] = useState<bigint>(BigInt(0));
  const [pendingBalance, setPendingBalance] = useState<bigint>(BigInt(0));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [xmrAddress, setXmrAddress] = useState('');

  const [qrAddress, setQrAddress] = useState<string | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [showSwap, setShowSwap] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadData = useCallback(async () => {
    if (!isConnected) return;
    try {
      const [balance, pending, dep, wd] = await Promise.all([
        getWxmrBalance(),
        getPendingBalance(),
        fetchMyDepositAccount(),
        fetchMyWithdrawals(),
      ]);
      setWxmrBalance(balance);
      setPendingBalance(pending);
      setDepositAccount(dep);
      setWithdrawals(wd.sort((a, b) => b.createdAt - a.createdAt));
    } catch (err) {
      console.error('Error loading bridge data:', err);
    }
  }, [isConnected, getWxmrBalance, getPendingBalance, fetchMyDepositAccount, fetchMyWithdrawals]);

  useEffect(() => {
    if (!isConnected) {
      setWxmrBalance(BigInt(0));
      setPendingBalance(BigInt(0));
      setDepositAccount(null);
      setWithdrawals([]);
    }
  }, [isConnected]);

  useEffect(() => {
    loadData();
    const id = setInterval(loadData, 10000);
    return () => clearInterval(id);
  }, [loadData]);

  const run = async (fn: () => Promise<string | { signature: string } | null>, ok: (sig: string) => string, fail: string) => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fn();
      const sig = typeof res === 'string' ? res : res?.signature;
      if (sig) {
        setSuccess(ok(sig));
        await loadData();
      }
    } catch (err) {
      setError(getErrorMessage(err, fail));
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = () =>
    run(createDepositAccount, (s) => `Deposit address created · ${truncateAddress(s, 6)}`, 'Failed to create deposit address');

  const handleClose = () => {
    setShowCloseConfirm(false);
    run(closeDepositAccount, (s) => `Address closed · ${truncateAddress(s, 6)}. Generate a new one for a fresh address.`, 'Failed to close address');
  };

  const handleClaim = () =>
    run(claimPendingMint, (s) => `Pending wXMR claimed · ${truncateAddress(s, 6)}`, 'Failed to claim pending tokens');

  const handleWithdraw = () => {
    if (!withdrawAmount || !xmrAddress) {
      setError('Enter an amount and a Monero destination address.');
      return;
    }
    if (!xmrAddress.startsWith('4') && !xmrAddress.startsWith('8')) {
      setError('Invalid XMR address — it should start with 4 or 8.');
      return;
    }
    if (xmrAddress.length < 95) {
      setError('That XMR address looks too short.');
      return;
    }
    const amountFloat = parseFloat(withdrawAmount);
    if (isNaN(amountFloat) || amountFloat <= 0) {
      setError('Enter a valid amount.');
      return;
    }
    const amountPiconero = BigInt(Math.floor(amountFloat * 1e12));
    if (amountPiconero > wxmrBalance) {
      setError('Amount exceeds your wXMR balance.');
      return;
    }
    run(
      async () => {
        const res = await requestWithdrawal(amountPiconero, xmrAddress, true);
        if (res) {
          setWithdrawAmount('');
          setXmrAddress('');
        }
        return res;
      },
      (s) => `Redemption submitted · ${truncateAddress(s, 6)}`,
      'Failed to submit redemption'
    );
  };

  const copyAddress = (addr: string) => {
    navigator.clipboard.writeText(addr);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <>
      <div className="surface-card overflow-hidden">
        {/* Direction control + swap */}
        <div className="flex items-center justify-between gap-3 px-5 md:px-6 pt-5">
          <div role="tablist" className="inline-flex bg-sunken rounded-field p-1">
            {(['deposit', 'withdraw'] as Tab[]).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => { setTab(t); setError(null); setSuccess(null); }}
                className={`px-3.5 py-2 rounded-[10px] text-[13px] font-semibold transition-all ${
                  tab === t ? 'text-accent-ink' : 'text-ink-3 hover:text-ink-2'
                }`}
                style={tab === t ? { background: 'rgba(255,106,26,0.13)', boxShadow: 'inset 0 0 0 1px rgba(255,106,26,0.35)' } : undefined}
              >
                {t === 'deposit' ? 'XMR → Solana' : 'Solana → XMR'}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowSwap(true)}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-2 hover:text-ink transition-colors pr-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
            </svg>
            Swap
          </button>
        </div>

        <div className="px-5 md:px-6 pb-6 pt-5">
          {/* Alerts */}
          {error && (
            <div className="rise mb-4 rounded-field px-3.5 py-3 text-[13px] flex items-start gap-2.5" style={{ background: 'var(--color-danger-wash)', color: 'var(--color-danger)' }}>
              <svg className="w-[18px] h-[18px] flex-shrink-0 mt-px" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.7 7.3a1 1 0 00-1.4 1.4L8.6 10l-1.3 1.3a1 1 0 101.4 1.4L10 11.4l1.3 1.3a1 1 0 001.4-1.4L11.4 10l1.3-1.3a1 1 0 00-1.4-1.4L10 8.6 8.7 7.3z" clipRule="evenodd" /></svg>
              <span>{error}</span>
            </div>
          )}
          {success && (
            <div className="rise mb-4 rounded-field px-3.5 py-3 text-[13px] flex items-start gap-2.5" style={{ background: 'var(--color-success-wash)', color: 'var(--color-success)' }}>
              <svg className="w-[18px] h-[18px] flex-shrink-0 mt-px" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.7-9.3a1 1 0 00-1.4-1.4L9 10.6 7.7 9.3a1 1 0 00-1.4 1.4l2 2a1 1 0 001.4 0l4-4z" clipRule="evenodd" /></svg>
              <span>{success}</span>
            </div>
          )}

          {/* Pending claim */}
          {isConnected && pendingBalance > BigInt(0) && (
            <div className="mb-4 rounded-field px-3.5 py-3 flex items-center justify-between gap-3" style={{ background: 'var(--color-warn-wash)' }}>
              <p className="text-[12.5px] leading-snug" style={{ color: 'var(--color-warn)' }}>
                <span className="font-semibold tnum">{formatXmr(pendingBalance)} wXMR</span> minted before your token account existed.
              </p>
              <button onClick={handleClaim} disabled={loading} className="btn-secondary text-[12.5px] font-semibold px-3 py-1.5 flex-shrink-0">
                {loading ? 'Claiming…' : 'Claim'}
              </button>
            </div>
          )}

          {tab === 'deposit' ? renderDeposit() : renderWithdraw()}
        </div>

        {/* Protocol meta */}
        <div className="px-5 md:px-6 py-3 border-t border-line flex items-center justify-between text-[11.5px] text-ink-3">
          <span>Min <span className="text-ink-2 tnum">0.01</span> XMR</span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--color-success)' }} />
            Settles in ~20 min
          </span>
        </div>
      </div>

      {/* Withdrawal history — its own block below the card, only when relevant */}
      {tab === 'withdraw' && isConnected && withdrawals.length > 0 && (
        <div className="mt-5">
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.07em] text-ink-3 mb-3">Recent redemptions</h3>
          <div className="divide-y divide-line border-t border-b border-line">
            {withdrawals.map((w) => (
              <div key={w.withdrawalPda} className="flex items-center justify-between py-3">
                <div>
                  <div className="flex items-center gap-2.5">
                    <span className="text-[14px] font-semibold text-ink tnum">{formatXmr(w.amount)} <span className="text-ink-3 font-normal">XMR</span></span>
                    <StatusBadge status={w.status} />
                  </div>
                  <p className="text-[12px] text-ink-3 font-mono mt-1">to {truncateAddress(w.xmrAddress, 10)}</p>
                </div>
                <span className="text-[12px] text-ink-3">{formatTime(w.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {qrAddress && <QRCodeModal address={qrAddress} onClose={() => setQrAddress(null)} />}
      {showScanner && <QRScannerModal onScan={setXmrAddress} onClose={() => setShowScanner(false)} />}
      {showCloseConfirm && (
        <ConfirmModal
          title="Close this deposit address?"
          message="Any XMR sent to this address that hasn't been minted yet will be lost. Only close if no Monero → Solana transfers are pending. You can generate a fresh address afterward."
          confirmText="Close address"
          onConfirm={handleClose}
          onCancel={() => setShowCloseConfirm(false)}
        />
      )}
      <SwapModal isOpen={showSwap} onClose={() => setShowSwap(false)} />
    </>
  );

  // ---------- deposit ----------
  function renderDeposit() {
    if (!isConnected) {
      return (
        <div className="py-2">
          <p className="text-[14px] leading-relaxed text-ink-2 mb-5">
            Connect a Solana wallet to generate your personal native-XMR deposit address.
          </p>
          <WalletMultiButton />
        </div>
      );
    }

    if (!depositAccount) {
      return (
        <div>
          <p className="text-[14px] leading-relaxed text-ink-2">
            Generate a personal Monero address. Anything you send to it is minted as wXMR on Solana, 1:1.
          </p>
          <p className="text-[12.5px] text-ink-3 mt-1.5 mb-5">Minimum 0.01 XMR per transfer · arrives in ~20 minutes</p>
          <button onClick={handleCreate} disabled={loading} className="btn-primary w-full py-3.5 text-[14px] font-semibold inline-flex items-center justify-center gap-2">
            {loading ? <><Spinner /> Generating…</> : 'Generate deposit address'}
          </button>
        </div>
      );
    }

    if (depositAccount.status === 'pending') {
      return (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <StatusBadge status="pending" />
            <span className="text-[12.5px] text-ink-3">Created {formatTime(depositAccount.createdAt)}</span>
          </div>
          <div className="flex items-center gap-2.5 text-[13.5px] text-ink-2">
            <Spinner className="w-4 h-4 text-ink-3" />
            Assigning your XMR address — usually just a few seconds.
          </div>
        </div>
      );
    }

    if (depositAccount.status === 'active') {
      return (
        <div>
          <div className="rounded-field border border-line bg-inset p-3.5">
            <div className="flex items-center justify-between mb-2.5">
              <FieldLabel>Your native XMR deposit address</FieldLabel>
              <StatusBadge status="active" />
            </div>
            <code className="block font-mono text-[12.5px] leading-relaxed text-ink break-all select-all">
              {depositAccount.xmrDepositAddress}
            </code>
            <div className="flex gap-2 mt-3">
              <button onClick={() => copyAddress(depositAccount.xmrDepositAddress)} className="btn-secondary text-[12.5px] font-semibold px-3 py-2 inline-flex items-center gap-1.5">
                {copied ? (
                  <><svg className="w-3.5 h-3.5" style={{ color: 'var(--color-success)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg> Copied</>
                ) : (
                  <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg> Copy</>
                )}
              </button>
              <button onClick={() => setQrAddress(depositAccount.xmrDepositAddress)} className="btn-secondary text-[12.5px] font-semibold px-3 py-2 inline-flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" /></svg> QR
              </button>
            </div>
          </div>

          <p className="text-[12.5px] leading-relaxed text-ink-2 mt-4">
            Send at least <span className="font-semibold text-ink">0.01 XMR</span>. wXMR is minted automatically after ~20 minutes. Deposit as many times as you like.
          </p>

          <div className="flex items-center justify-between mt-4 pt-4 border-t border-line">
            <span className="text-[12.5px] text-ink-3">
              Total bridged <span className="text-ink font-semibold tnum">{formatXmr(depositAccount.totalDeposited)} XMR</span>
            </span>
            <button onClick={() => setShowCloseConfirm(true)} disabled={loading} className="text-[12.5px] font-medium text-ink-3 hover:text-[var(--color-danger)] transition-colors">
              Close &amp; rotate
            </button>
          </div>
        </div>
      );
    }

    return <p className="text-[14px] text-ink-2 py-2">Deposit address closed. Generate a new one to continue.</p>;
  }

  // ---------- withdraw ----------
  function renderWithdraw() {
    if (!isConnected) {
      return (
        <div className="py-2">
          <p className="text-[14px] leading-relaxed text-ink-2 mb-5">Connect a Solana wallet to redeem wXMR back to native Monero.</p>
          <WalletMultiButton />
        </div>
      );
    }

    if (wxmrBalance === BigInt(0) && pendingBalance === BigInt(0)) {
      return (
        <div className="py-3 text-center">
          <p className="text-[14px] font-semibold text-ink">No wXMR to redeem yet</p>
          <p className="text-[13px] leading-relaxed text-ink-2 mt-1.5 mb-5 max-w-[32ch] mx-auto">Bridge some Monero into Solana first — your wXMR will appear here.</p>
          <button onClick={() => { setTab('deposit'); setError(null); setSuccess(null); }} className="btn-secondary px-4 py-2.5 text-[13px] font-semibold">
            Bridge XMR in
          </button>
        </div>
      );
    }

    const canSubmit = !loading && !!withdrawAmount && !!xmrAddress;

    return (
      <div>
        {/* You send */}
        <div className="field-input px-4 py-3">
          <div className="flex items-center justify-between mb-1.5">
            <FieldLabel>You send</FieldLabel>
            <span className="text-[12px] text-ink-3">
              Balance <span className="tnum text-ink-2">{formatXmr(wxmrBalance)}</span>
              <button onClick={() => setWithdrawAmount(formatXmrFull(wxmrBalance))} className="ml-1.5 font-semibold text-accent-ink hover:underline">MAX</button>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="number"
              step="0.000000000001"
              min="0.01"
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              placeholder="0.00"
              className="flex-1 bg-transparent text-[24px] font-semibold tnum text-ink outline-none placeholder-ink-3 min-w-0"
            />
            <TokenChip symbol="wXMR" />
          </div>
        </div>

        {/* arrow */}
        <div className="flex justify-center -my-2 relative z-10">
          <div className="w-8 h-8 rounded-[9px] bg-surface border border-line grid place-items-center text-ink-3">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>
          </div>
        </div>

        {/* Destination */}
        <div className="field-input">
          <div className="px-4 pt-3 pb-1.5"><FieldLabel>Monero destination</FieldLabel></div>
          <div className="flex items-stretch">
            <input
              type="text"
              value={xmrAddress}
              onChange={(e) => setXmrAddress(e.target.value)}
              placeholder="4… or 8…"
              className="flex-1 bg-transparent px-4 pb-3 font-mono text-[13px] text-ink outline-none placeholder-ink-3 min-w-0"
            />
            <button type="button" onClick={() => setShowScanner(true)} title="Scan QR" className="px-4 border-l border-line text-ink-3 hover:text-ink transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" /></svg>
            </button>
          </div>
        </div>

        <div className="flex items-start gap-2 text-[12px] text-ink-3 mt-3 leading-relaxed">
          <svg className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          You receive exactly the amount you enter — the bridge covers Monero network fees.
        </div>

        <button onClick={handleWithdraw} disabled={!canSubmit} className="btn-primary w-full py-3.5 mt-4 text-[14px] font-semibold inline-flex items-center justify-center gap-2">
          {loading ? <><Spinner /> Submitting…</> : 'Bridge to Monero'}
        </button>
      </div>
    );
  }
}
