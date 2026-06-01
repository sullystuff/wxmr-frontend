import type { Metadata } from 'next';
import { TopBar } from '@/components/layout/TopBar';
import { Footer } from '@/components/layout/Footer';
import { XMR_MINT, USDC_MINT, BRIDGE_PROGRAM_ID } from '@/constants';

export const metadata: Metadata = {
  title: 'Docs — wXMR Bridge',
  description: 'Technical documentation for the wXMR bridge protocol on Solana.',
};

const SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'architecture', label: 'Architecture' },
  { id: 'bridging-in', label: 'Bridging in' },
  { id: 'bridging-out', label: 'Bridging out' },
  { id: 'swapping', label: 'Swapping' },
  { id: 'reserves', label: 'Reserves' },
  { id: 'contracts', label: 'Contracts' },
];

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-24 text-[22px] font-semibold text-ink tracking-[-0.02em] mt-14 first:mt-0 mb-4">
      {children}
    </h2>
  );
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="text-[14.5px] leading-[1.7] text-ink-2 mb-4">{children}</p>;
}
function Code({ children }: { children: React.ReactNode }) {
  return <code className="mono text-[12.5px] text-accent-ink bg-inset border border-line rounded-[6px] px-1.5 py-0.5">{children}</code>;
}
function Block({ children }: { children: React.ReactNode }) {
  return (
    <pre className="surface-inset p-4 rounded-field overflow-x-auto mb-5">
      <code className="mono text-[12.5px] text-ink-2 leading-relaxed whitespace-pre">{children}</code>
    </pre>
  );
}
function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 mb-3">
      <span className="mono grid place-items-center w-6 h-6 rounded-full bg-accent-wash text-accent-ink text-[12px] font-semibold flex-shrink-0">{n}</span>
      <span className="text-[14.5px] leading-[1.6] text-ink-2 pt-0.5">{children}</span>
    </li>
  );
}

export default function DocsPage() {
  const MINT = XMR_MINT.toBase58();
  const USDC = USDC_MINT.toBase58();
  const PROGRAM = BRIDGE_PROGRAM_ID.toBase58();

  return (
    <>
      <TopBar />
      <main className="max-w-[1100px] mx-auto px-5 md:px-8 py-12 lg:py-16">
        <div className="grid lg:grid-cols-[180px_1fr] gap-10 lg:gap-16">
          {/* Sidebar */}
          <aside className="hidden lg:block">
            <div className="sticky top-[84px]">
              <p className="mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3 mb-3">Documentation</p>
              <nav className="flex flex-col gap-0.5 border-l border-line">
                {SECTIONS.map((s) => (
                  <a key={s.id} href={`#${s.id}`} className="text-[13px] text-ink-2 hover:text-ink hover:border-accent transition-colors -ml-px border-l border-transparent pl-3.5 py-1.5">
                    {s.label}
                  </a>
                ))}
              </nav>
            </div>
          </aside>

          {/* Content */}
          <article className="max-w-[680px]">
            <p className="mono text-[11px] uppercase tracking-[0.14em] text-accent-ink mb-3">Protocol documentation</p>
            <h1 className="text-[34px] font-semibold text-ink tracking-[-0.03em] leading-tight mb-4">wXMR Bridge</h1>
            <P>
              wXMR is native Monero bridged onto Solana as an SPL token. Every wXMR in circulation is backed one-to-one
              by native XMR held by the bridge, and is redeemable back to a Monero address at any time. This document
              describes how the protocol works and how to verify it.
            </P>

            <H2 id="overview">Overview</H2>
            <P>
              The bridge operates in two directions. Bridging <em>in</em> mints wXMR against native XMR you send to a
              personal deposit address. Bridging <em>out</em> burns wXMR and releases native XMR to an address you
              choose. A spot AMM and Jupiter routing provide wXMR↔USDC liquidity on Solana.
            </P>

            <H2 id="architecture">Architecture</H2>
            <P>
              State lives in program-derived accounts. A singleton <Code>config</Code> account tracks bridge authority and
              lifetime volume. Each user has one permanent <Code>deposit</Code> record (seeds{' '}
              <Code>[&quot;deposit&quot;, owner]</Code>) holding their assigned XMR address. Each redemption creates a{' '}
              <Code>withdrawal</Code> record keyed by a nonce. An <Code>amm_pool</Code> account holds spot liquidity and
              quoted prices.
            </P>

            <H2 id="bridging-in">Bridging in · XMR → Solana</H2>
            <ol className="mb-5">
              <Step n={1}>Connect a Solana wallet and generate a deposit address. This creates your <Code>deposit</Code> account and an associated wXMR token account.</Step>
              <Step n={2}>Send native XMR to the assigned address — minimum <Code>0.01</Code> XMR per transfer.</Step>
              <Step n={3}>After roughly 20 minutes (10 Monero confirmations), wXMR is minted to your wallet 1:1.</Step>
              <Step n={4}>If wXMR was minted before your token account existed, it is held as a pending balance you can claim from the bridge UI.</Step>
            </ol>
            <P>You can reuse a deposit address indefinitely, or close it to rotate to a fresh address for privacy.</P>

            <H2 id="bridging-out">Bridging out · Solana → XMR</H2>
            <ol className="mb-5">
              <Step n={1}>Switch to the <Code>Solana → XMR</Code> tab, enter an amount and your Monero destination address.</Step>
              <Step n={2}>Submitting calls <Code>requestWithdrawal</Code>, which burns the wXMR and records the request on-chain.</Step>
              <Step n={3}>The bridge sends native XMR to your address. With exact-output enabled you receive exactly the amount entered — the bridge covers Monero network fees.</Step>
            </ol>

            <H2 id="swapping">Swapping</H2>
            <P>
              The Swap module quotes both the protocol&apos;s own AMM pool (<Code>buyWxmr</Code> / <Code>sellWxmr</Code>) and
              the Jupiter aggregator, simulates each, and auto-selects the better rate for wXMR↔USDC.
            </P>

            <H2 id="reserves">Reserves &amp; verification</H2>
            <P>Both directions are independently auditable:</P>
            <ul className="mb-5 space-y-2">
              <li className="text-[14.5px] leading-[1.6] text-ink-2">— A public Monero <strong className="text-ink">view key</strong> reveals every incoming transfer (bridge-in backing).</li>
              <li className="text-[14.5px] leading-[1.6] text-ink-2">— A per-transfer <strong className="text-ink">transaction key</strong> proves each redemption was paid (bridge-out).</li>
              <li className="text-[14.5px] leading-[1.6] text-ink-2">— On-chain <strong className="text-ink">audit records</strong> publish spendable backing vs. circulating supply.</li>
            </ul>
            <P>Verify a redemption with the Monero CLI:</P>
            <Block>{`monero-wallet-cli check_tx_key <txid> <address> <tx_key>`}</Block>

            <H2 id="contracts">Contracts</H2>
            <P>All addresses are on Solana mainnet.</P>
            <div className="surface-card overflow-hidden divide-y divide-line">
              {[
                { label: 'wXMR mint', value: MINT, href: `https://solscan.io/token/${MINT}` },
                { label: 'Bridge program', value: PROGRAM, href: `https://solscan.io/account/${PROGRAM}` },
                { label: 'USDC mint', value: USDC, href: `https://solscan.io/token/${USDC}` },
              ].map((c) => (
                <div key={c.label} className="flex items-center justify-between gap-4 px-4 py-3">
                  <span className="text-[13px] text-ink-2">{c.label}</span>
                  <a href={c.href} target="_blank" rel="noopener noreferrer" className="mono text-[12px] text-accent-ink hover:underline break-all text-right">{c.value}</a>
                </div>
              ))}
            </div>
          </article>
        </div>
      </main>
      <Footer />
    </>
  );
}
