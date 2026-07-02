'use client';

import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { CHAINS, type FundingInstructions, type FundingMode, type Order } from '@wxmr/core';

type DepositAddressFunding = Extract<FundingInstructions, { type: 'deposit-address' }>;

/**
 * Chain-agnostic funding panel for orchestrator-hosted deposit addresses
 * (EVM + Solana sources). No wallet connection: the user or agent sends the
 * asset to the per-order address and the backend detects, confirms, and
 * executes the swap by itself.
 *
 * Self-contained on purpose — page.tsx only mounts it — so it stays out of
 * the way of ongoing design work in that file. Small helpers are local
 * copies of page.tsx equivalents.
 */
export function AddressDepositFunding({
  order,
  funding,
}: {
  order: Order;
  funding: DepositAddressFunding;
}) {
  const [showQr, setShowQr] = useState(false);
  const chainName = CHAINS[funding.chainId]?.name ?? funding.chainId;
  const symbol = funding.assetSymbol ?? 'tokens';
  const decimals = funding.assetDecimals ?? 6;
  const amount = formatBaseUnits(funding.expectedAmount ?? order.amount, decimals, Math.min(decimals, 8));
  const detected = BigInt(funding.detectedAmount ?? '0');
  const expiresIn = useCountdown(funding.expiresAt);
  const windowClosed = expiresIn === 0;

  return (
    <div className="rounded-2xl border border-[#f26822]/40 bg-[#1a120c] p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-white">Send {symbol} on {chainName}</div>
          <div className="text-xs text-[#c59a7c]">Order {shortId(order.id)} · no wallet connection needed</div>
        </div>
        <span className="shrink-0 rounded-full border border-[#f26822]/40 bg-[#23170e] px-2.5 py-1 text-[11px] font-semibold text-[#f5b98f]">
          {detected > BigInt(0) ? 'Deposit detected' : windowClosed ? 'Window closed' : 'Awaiting deposit'}
        </span>
      </div>
      <div className="space-y-3">
        <div className="min-w-0 rounded-xl border border-[#493424] bg-[#120d09] px-3 py-3">
          <div className="truncate text-[11px] uppercase tracking-[0.08em] text-[#a8846d]">Amount</div>
          <div className="mt-1 break-words text-sm font-semibold leading-snug text-white">{amount} {symbol}</div>
          <div className="mt-1 text-xs text-[#a8846d]">Send the exact amount in a single transfer, on {chainName} only.</div>
        </div>
        <div className="rounded-xl border border-[#493424] bg-[#120d09] p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-xs uppercase tracking-[0.08em] text-[#a8846d]">Deposit address</div>
            <button
              type="button"
              onClick={() => setShowQr((current) => !current)}
              className="rounded-lg border border-[#493424] px-2 py-1 text-[11px] font-semibold text-[#e6c7ad] transition-colors hover:border-[#f26822]"
            >
              {showQr ? 'Hide QR' : 'Show QR'}
            </button>
          </div>
          <div className="break-all font-mono text-sm text-white">{funding.address}</div>
          {showQr && (
            <div className="mt-3 flex justify-center rounded-lg bg-white p-3">
              <QRCodeSVG value={funding.address} size={168} marginSize={0} />
            </div>
          )}
        </div>
        <CopyValueButton label={`Copy ${chainName} address`} value={funding.address} />
        <div className="flex items-center justify-between gap-3 text-xs text-[#c59a7c]">
          <span>
            {detected > BigInt(0)
              ? 'Deposit seen on-chain — confirming, then the swap runs automatically.'
              : windowClosed
                ? 'The deposit window closed. A deposit that still arrives is processed or refunded automatically.'
                : 'The swap starts by itself once your deposit confirms. Keep this page open to follow it, or come back later.'}
          </span>
          {!windowClosed && <span className="shrink-0 font-mono text-[#f5b98f]">{formatCountdown(expiresIn)}</span>}
        </div>
      </div>
    </div>
  );
}

/** Pre-order choice between the address deposit default and the legacy wallet-signing flow. */
export function DepositMethodToggle({
  value,
  onChange,
}: {
  value: FundingMode;
  onChange: (value: FundingMode) => void;
}) {
  const options: Array<{ value: FundingMode; title: string; caption: string }> = [
    { value: 'address', title: 'Deposit address', caption: 'Send from any wallet, exchange, or agent' },
    { value: 'wallet', title: 'Connect wallet', caption: 'Sign the transactions yourself' },
  ];
  return (
    <div className="rounded-2xl border border-[#292b31] bg-[#0f1015] p-3">
      <div className="mb-2 px-1 text-xs text-[#a9afba]">Pay by</div>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                selected
                  ? 'border-[#f26822] bg-[#22170f] text-white'
                  : 'border-[#30333b] bg-[#090a0e] text-[#c8cbd1] hover:border-[#f26822]/45'
              }`}
            >
              <span className="block text-sm font-semibold">{option.title}</span>
              <span className="mt-0.5 block text-xs leading-snug text-[#8b919d]">{option.caption}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CopyValueButton({ label, value }: { label: string; value?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      onClick={() => {
        if (!value) return;
        void navigator.clipboard?.writeText(value);
        setCopied(true);
      }}
      disabled={!value}
      className={`w-full rounded-xl border px-4 py-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
        copied
          ? 'border-[#35d071]/50 bg-[#122316] text-[#9ee6a8]'
          : 'border-[#493424] bg-[#23170e] text-white enabled:hover:border-[#f26822]'
      }`}
    >
      {copied ? 'Copied' : label}
    </button>
  );
}

function useCountdown(expiresAt?: string): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [expiresAt]);
  if (!expiresAt) return null;
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));
}

function formatCountdown(value: number | null): string {
  if (value === null) return '--:--';
  const minutes = Math.floor(value / 60).toString().padStart(2, '0');
  const seconds = (value % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function formatBaseUnits(value: string, decimals: number, maxFractionDigits = 6): string {
  const amount = BigInt(value);
  const unit = BigInt(10) ** BigInt(decimals);
  const whole = amount / unit;
  const fraction = (amount % unit).toString().padStart(decimals, '0').slice(0, maxFractionDigits).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function shortId(value: string): string {
  return value.length > 18 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}
