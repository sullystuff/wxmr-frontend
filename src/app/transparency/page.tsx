'use client';

import { useState, useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import { TopBar } from '@/components/layout/TopBar';
import { Footer } from '@/components/layout/Footer';
import { Spinner } from '@/components/ui/Spinner';
import { fetchAuditRecords, summarizeReserves, type AuditRecord, type AuditData } from '@/lib/audits';
import { XMR_MINT, BRIDGE_PROGRAM_ID } from '@/constants';

// Transparency-specific public data (the bridge's own wallet credentials).
const BRIDGE_DATA = {
  xmrAddress: '45ZYpKmPaPmh3bnRP1XpMz8cASJQf1cfUgq32H8trCYA4RodzXhsmt2VYkQX9QQ65CetiGja65tH2JmKC3gEZtZjB7AzMpd',
  viewKey: 'e4e02de197582ff2e93f9eaefc96e122a13ffa838736ef38f4a8ea27a0dc4909',
};
const XMR_MINT_STR = XMR_MINT.toBase58();
const PROGRAM_STR = BRIDGE_PROGRAM_ID.toBase58();

function formatXmr(atomic: bigint | number): string {
  const num = typeof atomic === 'bigint' ? Number(atomic) : atomic;
  return (num / 1e12).toFixed(12);
}
function formatDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString();
}

function CopyButton({ text, active, onCopy }: { text: string; active: boolean; onCopy: () => void }) {
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); onCopy(); }}
      className="grid place-items-center w-8 h-8 rounded-[8px] text-ink-3 hover:bg-sunken hover:text-ink transition-colors flex-shrink-0"
      title="Copy"
    >
      {active ? (
        <svg className="w-4 h-4" style={{ color: 'var(--color-success)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
      ) : (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
      )}
    </button>
  );
}

function Card({ title, eyebrow, children }: { title: string; eyebrow?: string; children: ReactNode }) {
  return (
    <section className="surface-card p-6 md:p-7">
      {eyebrow && <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-accent-ink mb-2">{eyebrow}</p>}
      <h2 className="text-[18px] font-semibold text-ink mb-4">{title}</h2>
      {children}
    </section>
  );
}

function Disclosure({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group border border-line rounded-field overflow-hidden">
      <summary className="flex items-center justify-between cursor-pointer list-none px-4 py-3 bg-inset hover:bg-sunken transition-colors">
        <span className="text-[13.5px] font-medium text-ink">{title}</span>
        <svg className="w-4 h-4 text-ink-3 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M19 9l-7 7-7-7" /></svg>
      </summary>
      <div className="px-4 py-4 border-t border-line text-[13px] leading-relaxed text-ink-2">{children}</div>
    </details>
  );
}

function FieldBlock({ label, value, mono = true, copyId, copied, onCopy }: { label: string; value: string; mono?: boolean; copyId: string; copied: string | null; onCopy: (id: string) => void }) {
  return (
    <div>
      <p className="text-[11px] text-ink-3 mb-1.5 uppercase tracking-[0.06em] font-semibold">{label}</p>
      <div className="flex items-center gap-2">
        <code className={`flex-1 text-[12px] bg-inset border border-line p-3 rounded-field break-all ${mono ? 'font-mono' : ''} text-ink-2`}>{value}</code>
        <CopyButton text={value} active={copied === copyId} onCopy={() => onCopy(copyId)} />
      </div>
    </div>
  );
}

export default function TransparencyPage() {
  const [copied, setCopied] = useState<string | null>(null);
  const [audits, setAudits] = useState<AuditRecord[]>([]);
  const [loadingAudits, setLoadingAudits] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    fetchAuditRecords().then((records) => {
      setAudits(records);
      setLoadingAudits(false);
    });
  }, []);

  const reserves = summarizeReserves(audits);

  const copy = (id: string) => {
    setCopied(id);
    setTimeout(() => setCopied(null), 1800);
  };

  return (
    <>
      <TopBar />
      <main className="max-w-[900px] mx-auto px-5 md:px-8">
        <section className="pt-12 md:pt-16 mb-9">
          <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-accent-ink mb-2">Proof of reserves</p>
          <h1 className="text-[30px] md:text-[34px] font-semibold leading-[1.08] text-ink">Don&apos;t trust. Verify.</h1>
          <p className="text-[15px] leading-relaxed text-ink-2 mt-3 max-w-[58ch]">
            Every wXMR is backed 1:1 by native Monero. Below are the cryptographic tools to audit both directions of the bridge yourself — no trust in us required.
          </p>
        </section>

        {/* Reserve overview — live on-chain figures, "Pending" before the first audit */}
        <div className="flex items-center gap-2.5 mb-4">
          <h2 className="text-[14px] font-semibold text-ink">Reserve overview</h2>
          <span className="w-1.5 h-1.5 rounded-full live-dot" style={{ background: 'var(--color-success)' }} />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-line rounded-card overflow-hidden border border-line mb-3">
          {[
            { label: 'Reserve publication', value: reserves ? 'Published' : 'Pending', ok: reserves != null },
            { label: 'Coverage verification', value: reserves?.coverage != null ? `${(reserves.coverage * 100).toFixed(2)}%` : 'Pending', ok: reserves?.coverage != null },
            { label: 'Audit history', value: audits.length > 0 ? `${audits.length} ${audits.length === 1 ? 'record' : 'records'}` : 'Pending', ok: audits.length > 0 },
            { label: 'Reserve wallet', value: 'Active', ok: true },
          ].map((s) => (
            <div key={s.label} className="bg-surface p-5">
              <p className="mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3 mb-3">{s.label}</p>
              <p className="flex items-center gap-2 text-[17px] font-semibold tnum leading-none">
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: s.ok ? 'var(--color-success)' : 'var(--color-warn)' }} />
                <span className={s.ok ? 'text-[var(--color-success-ink)]' : 'text-ink-2'}>{s.value}</span>
              </p>
            </div>
          ))}
        </div>
        <p className="text-[12.5px] text-ink-3 mb-9">
          {audits.length > 0
            ? 'Status from the latest on-chain audit record. Full proofs below.'
            : 'The reserve wallet and verification tools are live now. Coverage figures publish with the first reserve audit.'}
        </p>

        <h2 className="text-[14px] font-semibold text-ink mb-4">Verification tools</h2>
        <div className="space-y-5">
          {/* View key */}
          <Card eyebrow="Monero → Solana" title="View key">
            <p className="text-[13.5px] leading-relaxed text-ink-2 mb-5">
              The <span className="font-semibold text-ink">view key</span> lets you see every incoming transaction to our wallet — so you can confirm the native XMR we hold. It cannot move funds.
            </p>
            <div className="space-y-3 mb-5">
              <Disclosure title="What is a Monero view key?" defaultOpen>
                <div className="space-y-3">
                  <p>Monero wallets have a <span className="text-ink font-medium">spend key</span> (needed to send) and a <span className="text-ink font-medium">view key</span> (only sees incoming transactions).</p>
                  <p>The view key reveals <em>incoming</em> transfers only — not outgoing transactions or the live balance. Combined with the per-transfer tx keys below, the two directions are fully auditable.</p>
                </div>
              </Disclosure>
              <Disclosure title="How to verify Monero → Solana">
                <div className="space-y-3">
                  <p className="font-medium text-ink">Option 1 — View-only wallet</p>
                  <ol className="list-decimal list-inside space-y-1.5">
                    <li>Open the Monero GUI/CLI wallet and choose “Restore from keys”.</li>
                    <li>Enter the address and view key below; leave the spend key blank.</li>
                    <li>Sync to see all incoming XMR transfers.</li>
                  </ol>
                  <p className="font-medium text-ink mt-3">Option 2 — Block explorer</p>
                  <p>Some explorers like <a href="https://xmrchain.net" target="_blank" rel="noopener noreferrer" className="text-accent-ink hover:underline">xmrchain.net</a> let you search an address with a view key to see incoming transactions.</p>
                </div>
              </Disclosure>
            </div>
            <div className="surface-inset p-4 space-y-4">
              <FieldBlock label="XMR address" value={BRIDGE_DATA.xmrAddress} copyId="address" copied={copied} onCopy={copy} />
              <FieldBlock label="View key" value={BRIDGE_DATA.viewKey} copyId="viewkey" copied={copied} onCopy={copy} />
            </div>
          </Card>

          {/* Tx keys */}
          <Card eyebrow="Solana → Monero" title="Transaction keys">
            <p className="text-[13.5px] leading-relaxed text-ink-2 mb-5">
              Every redemption we process emits a <span className="font-semibold text-ink">transaction key</span> in its Solana event — cryptographic proof the native XMR was sent to your address, even though Monero transfers are private.
            </p>
            <div className="space-y-3">
              <Disclosure title="How to verify Solana → Monero" defaultOpen>
                <div className="space-y-3">
                  <p className="font-medium text-ink">You need: the txid, your XMR address, and the tx key (from the Solana event).</p>
                  <ol className="list-decimal list-inside space-y-1.5">
                    <li>Go to <a href="https://xmrchain.net" target="_blank" rel="noopener noreferrer" className="text-accent-ink hover:underline">xmrchain.net</a> and paste the txid.</li>
                    <li>Click “Prove sending”.</li>
                    <li>Enter your address and the tx key, then “Prove Send” — it shows the exact amount sent to you.</li>
                  </ol>
                  <p className="mt-3">Or via CLI:</p>
                  <code className="block bg-inset border border-line p-3 rounded-field font-mono text-[12px] mt-1 text-ink-2">monero-wallet-cli check_tx_key &lt;txid&gt; &lt;address&gt; &lt;tx_key&gt;</code>
                </div>
              </Disclosure>
              <Disclosure title="Where to find the tx key">
                <p>The tx key is emitted in the <code className="bg-inset px-1 py-0.5 rounded text-ink-2">WithdrawCompletedEvent</code> on Solana when your redemption finalizes. Find your completion transaction on Solscan and read the event logs — they contain the txid, recipient, and tx key.</p>
              </Disclosure>
            </div>
          </Card>

          {/* On-chain */}
          <Card title="On-chain anchors">
            <div className="divide-y divide-line">
              <div className="flex items-center justify-between gap-4 py-3">
                <div>
                  <p className="text-[13.5px] font-medium text-ink">wXMR mint</p>
                  <p className="text-[12px] text-ink-3">Total supply = wXMR in circulation</p>
                </div>
                <a href={`https://solscan.io/token/${XMR_MINT_STR}`} target="_blank" rel="noopener noreferrer" className="font-mono text-[12px] text-accent-ink hover:underline truncate max-w-[45%] text-right">{XMR_MINT_STR}</a>
              </div>
              <div className="flex items-center justify-between gap-4 py-3">
                <div>
                  <p className="text-[13.5px] font-medium text-ink">Bridge program</p>
                  <p className="text-[12px] text-ink-3">Holds config + on-chain audit records</p>
                </div>
                <a href={`https://solscan.io/account/${PROGRAM_STR}`} target="_blank" rel="noopener noreferrer" className="font-mono text-[12px] text-accent-ink hover:underline truncate max-w-[45%] text-right">{PROGRAM_STR}</a>
              </div>
            </div>
          </Card>

          {/* Audit history */}
          <Card title="Reserve audit history">
            <p className="text-[13.5px] leading-relaxed text-ink-2 mb-5">
              Weekly (and on every redemption) we consolidate spendable XMR and record proof on-chain. Each audit includes tx keys proving we control the native XMR backing wXMR.
            </p>

            {loadingAudits ? (
              <div className="flex items-center justify-center gap-2.5 py-10 text-ink-3 text-[13.5px]">
                <Spinner className="w-5 h-5" /> Loading audit history…
              </div>
            ) : audits.length === 0 ? (
              <div className="text-center py-10 text-[13.5px] text-ink-3">No audits recorded yet — the first publishes within 24 hours.</div>
            ) : (
              <div className="space-y-2.5">
                {audits.map((audit) => {
                  const isOpen = expanded === audit.epoch;
                  let data: AuditData | null = null;
                  try { data = JSON.parse(audit.data); } catch { data = null; }
                  const totalXmr = audit.spendableBalance + audit.unconfirmedBalance;

                  return (
                    <div key={audit.epoch} className="border border-line rounded-field overflow-hidden">
                      <button onClick={() => setExpanded(isOpen ? null : audit.epoch)} className="w-full px-4 py-3.5 bg-inset hover:bg-sunken flex items-center justify-between text-left transition-colors">
                        <div className="flex items-center gap-2.5">
                          <span className="text-[13.5px] font-semibold text-ink">{formatDate(audit.epoch)}</span>
                          {data?.triggeredBy === 'withdrawal_failure' && <span className="text-[11px] px-2 py-0.5 rounded-pill font-medium" style={{ background: 'var(--color-warn-wash)', color: 'var(--color-warn)' }}>redemption</span>}
                          {data?.triggeredBy === 'scheduled' && <span className="text-[11px] px-2 py-0.5 rounded-pill font-medium" style={{ background: 'var(--color-success-wash)', color: 'var(--color-success)' }}>scheduled</span>}
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-[13px] text-accent-ink font-semibold tnum">{formatXmr(audit.spendableBalance)} XMR</span>
                          <svg className={`w-4 h-4 text-ink-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M19 9l-7 7-7-7" /></svg>
                        </div>
                      </button>

                      {isOpen && (
                        <div className="px-4 py-4 border-t border-line space-y-4">
                          {/* Balance summary */}
                          <div className="surface-inset p-4">
                            <p className="text-[11px] text-ink-3 uppercase mb-3 font-semibold tracking-[0.06em]">Balance summary</p>
                            <div className="space-y-2 text-[13px] font-mono">
                              <div className="flex justify-between"><span className="text-ink-3">Circulating wXMR</span><span className="text-ink tnum">{formatXmr(audit.circulatingSupply)}</span></div>
                              <div className="flex justify-between"><span className="text-ink-3">XMR spendable</span><span className="text-accent-ink tnum">{formatXmr(audit.spendableBalance)}</span></div>
                              <div className="flex justify-between"><span className="text-ink-3">XMR unconfirmed</span><span className="tnum" style={{ color: 'var(--color-warn)' }}>{formatXmr(audit.unconfirmedBalance)}</span></div>
                              <div className="flex justify-between border-t border-line pt-2 mt-2 font-semibold"><span className="text-ink-3">Total backing</span><span className="tnum" style={{ color: 'var(--color-success)' }}>{formatXmr(totalXmr)}</span></div>
                            </div>

                            {data?.burn && (() => {
                              const burned = BigInt(data!.burn!.amount);
                              const post = audit.circulatingSupply - burned;
                              const match = post === totalXmr;
                              return (
                                <div className="mt-3 rounded-field p-3 text-[12px]" style={{ background: 'var(--color-success-wash)' }}>
                                  <p className="text-center font-bold mb-2" style={{ color: 'var(--color-success)' }}>{match ? 'Exact 1:1 match' : 'Final state'}</p>
                                  <div className="space-y-1 font-mono">
                                    <div className="flex justify-between"><span className="text-ink-3">wXMR after burn</span><span className="text-ink tnum">{formatXmr(post)}</span></div>
                                    <div className="flex justify-between"><span className="text-ink-3">XMR backing</span><span className="text-ink tnum">{formatXmr(totalXmr)}</span></div>
                                  </div>
                                  <div className="flex items-center gap-2 mt-2 pt-2 border-t" style={{ borderColor: 'var(--color-recv-line)' }}>
                                    <span className="text-ink-3">Burn tx</span>
                                    <a href={`https://solscan.io/tx/${data!.burn!.txid}`} target="_blank" rel="noopener noreferrer" className="font-mono hover:underline truncate flex-1" style={{ color: 'var(--color-success)' }}>{data!.burn!.txid.slice(0, 24)}…</a>
                                  </div>
                                </div>
                              );
                            })()}
                          </div>

                          {/* Consolidation txs with keys */}
                          {data?.txs && data.txs.length > 0 && (
                            <div>
                              <p className="text-[11px] text-ink-3 uppercase mb-1 font-semibold tracking-[0.06em]">Consolidation transactions ({data.txs.length})</p>
                              <p className="text-[12px] text-ink-3 mb-3">Each proves we control the XMR — verify the tx key on xmrchain.net.</p>
                              <div className="space-y-2.5">
                                {data.txs.map((tx, i) => (
                                  <div key={i} className="surface-inset p-3">
                                    <div className="flex justify-between items-center mb-2">
                                      <span className="text-[12px] text-ink-3">Tx #{i + 1}</span>
                                      <span className="text-[13px] text-accent-ink font-mono tnum">{formatXmr(tx.amount)} XMR</span>
                                    </div>
                                    <div className="space-y-2 text-[12px]">
                                      <div>
                                        <p className="text-ink-3 mb-0.5">TXID</p>
                                        <div className="flex gap-2 items-center"><code className="font-mono text-ink break-all flex-1">{tx.txid}</code><CopyButton text={tx.txid} active={copied === `txid-${audit.epoch}-${i}`} onCopy={() => copy(`txid-${audit.epoch}-${i}`)} /></div>
                                      </div>
                                      <div>
                                        <p className="text-ink-3 mb-0.5">Tx key</p>
                                        <div className="flex gap-2 items-center"><code className="font-mono break-all flex-1" style={{ color: 'var(--color-success)' }}>{tx.key}</code><CopyButton text={tx.key} active={copied === `key-${audit.epoch}-${i}`} onCopy={() => copy(`key-${audit.epoch}-${i}`)} /></div>
                                      </div>
                                    </div>
                                    <a href={`https://xmrchain.net/tx/${tx.txid}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12px] text-accent-ink hover:underline mt-2">Verify on xmrchain.net →</a>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        <div className="mt-8 text-center">
          <Link href="/" className="btn-secondary inline-flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold">
            ← Back to bridge
          </Link>
        </div>
      </main>
      <Footer />
    </>
  );
}
