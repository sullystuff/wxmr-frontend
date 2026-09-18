'use client';

import { useState } from 'react';
import { formatReserveXmr, parseReserveReport } from '@/lib/reserve-proof';

function download(name: string, value: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ReserveAuditCard({ data, account }: { data: string; account: string }) {
  const [expanded, setExpanded] = useState(false);
  const report = parseReserveReport(data);
  if (!report) return <div className="p-4 border border-[var(--border)] rounded-lg text-[var(--muted)]">Reserve report unavailable: incomplete or unsupported data.</div>;
  const r = report;
  const check = `check_reserve_proof ${r.address} reserve-${r.id}.txt ${r.message}`;
  const button = 'px-3 py-2 rounded border border-[var(--border)] hover:bg-[var(--card-hover)] text-sm';
  return <div className="border border-[var(--border)] rounded-lg overflow-hidden">
    <button className="w-full p-4 text-left flex justify-between gap-4 hover:bg-[var(--card-hover)]" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
      <span><span className="font-semibold">Reserve proof</span><span className="block text-xs text-[var(--muted)]">Checked by publisher {new Date(r.verified.at * 1000).toLocaleString()}</span></span>
      <span className="text-right"><span className="text-[#ff6600]">{formatReserveXmr(r.verified.unspentAtomic)} XMR</span><span className="block text-xs text-[var(--muted)]">{expanded ? 'Hide details' : 'View proof'}</span></span>
    </button>
    {expanded && <div className="p-4 border-t border-[var(--border)] space-y-4 text-sm">
      <p>The complete proof and signed message are stored on Solana. Verify them with your own Monero node; this page displays the publisher’s recorded check.</p>
      <dl className="space-y-2">
        <div className="flex justify-between gap-4"><dt>Proven unspent at check</dt><dd className="font-mono">{formatReserveXmr(r.verified.unspentAtomic)} XMR</dd></div>
        <div className="flex justify-between gap-4"><dt>Token supply reference</dt><dd className="font-mono">{formatReserveXmr(r.solana.supplyAtomic)} wXMR</dd></div>
        <div className="flex justify-between gap-4"><dt>Unlocked balance reported by wallet</dt><dd className="font-mono">{formatReserveXmr(r.walletReported.unlockedAtomic)} XMR</dd></div>
      </dl>
      <p className="text-[var(--muted)]">The supply reference does not include every possible pending bridge obligation. This report proves reserves; it is not a complete liabilities audit. Later withdrawals and consolidations can spend outputs covered by this proof.</p>
      <div className="text-xs text-[var(--muted)] space-y-2 break-all">
        <p>Monero challenge block {r.monero.height}: <code>{r.monero.hash}</code></p>
        <p>Solana reference slot {r.solana.slot}: <code>{r.solana.blockhash}</code></p>
        <p>Proof SHA-256: <code>{r.proofSha256}</code></p>
        <p>Wallet: <code>{r.address}</code></p>
        <p><a className="underline" href={`https://solscan.io/account/${account}`} target="_blank" rel="noopener noreferrer">View the proof account on Solana</a></p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className={button} onClick={() => download(`reserve-${r.id}.txt`, r.proof)}>Download proof</button>
        <button className={button} onClick={() => download(`reserve-${r.id}.json`, data, 'application/json')}>Download full report</button>
        <button className={button} onClick={() => download(`reserve-${r.id}-message.txt`, r.message)}>Download signed message</button>
      </div>
      <p>In a Monero CLI wallet connected to your own synchronized node, use the exact signed message below. Check both the signature result and the amount reported as spent.</p>
      <pre className="overflow-x-auto p-3 bg-[var(--background)] rounded text-xs whitespace-pre-wrap break-all">{check}</pre>
      <p className="text-xs text-[var(--muted)]">The block hashes bind the challenge. The completed Solana upload anchors the report’s existence; the standard Monero checker reports spent status now, not at the challenge block.</p>
    </div>}
  </div>;
}
