'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Connection, PublicKey } from '@solana/web3.js';
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor';
import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes';
import type { WxmrBridge } from '@/idl/wxmr_bridge';
import IDL from '@/idl/wxmr_bridge.json';

// Monero Logo SVG component (official logo from cryptologos.cc)
function MoneroLogo({ className = "w-8 h-8" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 3756.09 3756.49" xmlns="http://www.w3.org/2000/svg">
      <path d="M4128,2249.81C4128,3287,3287.26,4127.86,2250,4127.86S372,3287,372,2249.81,1212.76,371.75,2250,371.75,4128,1212.54,4128,2249.81Z" transform="translate(-371.96 -371.75)" fill="#fff"/>
      <path d="M2250,371.75c-1036.89,0-1879.12,842.06-1877.8,1878,0.26,207.26,33.31,406.63,95.34,593.12h561.88V1263L2250,2483.57,3470.52,1263v1579.9h562c62.12-186.48,95-385.85,95.37-593.12C4129.66,1212.76,3287,372,2250,372Z" transform="translate(-371.96 -371.75)" fill="#f26822"/>
      <path d="M1969.3,2764.17l-532.67-532.7v994.14H1029.38l-384.29.07c329.63,540.8,925.35,902.56,1604.91,902.56S3525.31,3766.4,3855,3225.6H3063.25V2231.47l-532.7,532.7-280.61,280.61-280.62-280.61h0Z" transform="translate(-371.96 -371.75)" fill="#4d4d4d"/>
    </svg>
  );
}

// Hardcoded values - in production these would come from an API
const BRIDGE_DATA = {
  xmrAddress: '45ZYpKmPaPmh3bnRP1XpMz8cASJQf1cfUgq32H8trCYA4RodzXhsmt2VYkQX9QQ65CetiGja65tH2JmKC3gEZtZjB7AzMpd',
  viewKey: 'e4e02de197582ff2e93f9eaefc96e122a13ffa838736ef38f4a8ea27a0dc4909',
  wxmrMint: 'WXMRyRZhsa19ety5erZhHg4N3xj3EVN92u94422teJp',
  bridgeProgram: 'EzBkC8P5wxab9kwrtV5hRdynHAfB5w3UPcPXNgMseVA8',
};

const SOLANA_RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

// Audit record interface
interface AuditRecord {
  epoch: number;
  timestamp: number;
  circulatingSupply: bigint;
  spendableBalance: bigint;
  unconfirmedBalance: bigint;
  data: string;
}

// Parsed audit data type
interface AuditData {
  timestamp: number;        // Unix timestamp (used as unique ID)
  triggeredBy: 'scheduled' | 'withdrawal_failure';
  address: string;
  totalAmount: number;
  totalFee: number;
  txs: Array<{ txid: string; key: string; amount: number; fee: number }>;
  unconfirmed: Array<{ tx: string; amt: number; conf: number }>;
  // Legacy support
  epoch?: number;
}

// InfoCard component
function InfoCard({ 
  title, 
  icon, 
  children 
}: { 
  title: string; 
  icon: React.ReactNode; 
  children: React.ReactNode;
}) {
  return (
    <div className="xmr-card p-6 mb-6">
      <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
        {icon}
        {title}
      </h2>
      {children}
    </div>
  );
}

// Expandable section
function ExpandableSection({ 
  title, 
  children,
  defaultOpen = false 
}: { 
  title: string; 
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  
  return (
    <div className="border border-[var(--border)] rounded-lg overflow-hidden mb-4">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-3 bg-[var(--background)] hover:bg-[var(--card-hover)] flex justify-between items-center text-left transition-colors"
      >
        <span className="font-medium">{title}</span>
        <svg 
          className={`w-5 h-5 transition-transform ${isOpen ? 'rotate-180' : ''}`} 
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isOpen && (
        <div className="px-4 py-4 border-t border-[var(--border)] bg-[var(--card)]">
          {children}
        </div>
      )}
    </div>
  );
}

// Format XMR amount from atomic units
function formatXmr(atomic: bigint | number): string {
  const num = typeof atomic === 'bigint' ? Number(atomic) : atomic;
  return (num / 1e12).toFixed(6);
}

// Format timestamp
function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString();
}

// AuditRecord discriminator (first 8 bytes of sha256("account:AuditRecord"))
const AUDIT_RECORD_DISCRIMINATOR = [23, 133, 250, 12, 85, 60, 64, 139];

// Fetch audit records from on-chain
async function fetchAuditRecords(): Promise<AuditRecord[]> {
  try {
    const connection = new Connection(SOLANA_RPC, 'confirmed');
    const programId = new PublicKey(BRIDGE_DATA.bridgeProgram);
    
    // Fetch all accounts with the AuditRecord discriminator (dynamic size)
    const accounts = await connection.getProgramAccounts(programId, {
      filters: [
        {
          memcmp: {
            offset: 0,
            bytes: bs58.encode(Buffer.from(AUDIT_RECORD_DISCRIMINATOR)),
          },
        },
      ],
    });

    const records: AuditRecord[] = [];
    
    for (const account of accounts) {
      try {
        const data = account.account.data;
        // Skip discriminator (8 bytes)
        let offset = 8;
        
        const epoch = new BN(data.subarray(offset, offset + 8), 'le').toNumber();
        offset += 8;
        
        const timestamp = new BN(data.subarray(offset, offset + 8), 'le').toNumber();
        offset += 8;
        
        const circulatingSupply = BigInt(new BN(data.subarray(offset, offset + 8), 'le').toString());
        offset += 8;
        
        const spendableBalance = BigInt(new BN(data.subarray(offset, offset + 8), 'le').toString());
        offset += 8;
        
        const unconfirmedBalance = BigInt(new BN(data.subarray(offset, offset + 8), 'le').toString());
        offset += 8;
        
        // String length (4 bytes) + string data
        const strLen = new BN(data.subarray(offset, offset + 4), 'le').toNumber();
        offset += 4;
        
        const dataStr = new TextDecoder().decode(data.subarray(offset, offset + strLen));
        
        records.push({
          epoch,
          timestamp,
          circulatingSupply,
          spendableBalance,
          unconfirmedBalance,
          data: dataStr,
        });
      } catch {
        // Skip malformed records
      }
    }
    
    // Sort by epoch desc
    return records.sort((a, b) => b.epoch - a.epoch);
  } catch (error) {
    console.error('Error fetching audit records:', error);
    return [];
  }
}

export default function TransparencyPage() {
  const [copied, setCopied] = useState<string | null>(null);
  const [audits, setAudits] = useState<AuditRecord[]>([]);
  const [loadingAudits, setLoadingAudits] = useState(true);
  const [expandedEpoch, setExpandedEpoch] = useState<number | null>(null);

  useEffect(() => {
    fetchAuditRecords().then(records => {
      setAudits(records);
      setLoadingAudits(false);
    });
  }, []);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <main className="min-h-screen p-4 md:p-8 xmr-pattern">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <header className="flex flex-col md:flex-row justify-between items-center mb-10 gap-4">
          <div className="flex items-center gap-4">
            <MoneroLogo className="w-12 h-12" />
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-[#ff6600] to-[#ff8533] bg-clip-text text-transparent">
                Transparency
              </h1>
              <p className="text-[var(--muted)] mt-0.5">Verify our reserves and proofs</p>
            </div>
          </div>
          <Link 
            href="/"
            className="px-6 py-2.5 bg-[var(--card)] hover:bg-[var(--card-hover)] border border-[var(--border)] rounded-lg font-semibold transition-all"
          >
            Back to Bridge
          </Link>
        </header>

        {/* Introduction */}
        <div className="xmr-card p-6 mb-8 xmr-glow">
          <h2 className="text-xl font-bold mb-3">Proof of Reserves</h2>
          <p className="text-[var(--muted)] leading-relaxed">
            The wXMR bridge is designed for transparency. Every wXMR token is backed 1:1 by real XMR. 
            We provide cryptographic tools so you can independently verify deposits and withdrawals.
          </p>
        </div>

        {/* View Key Section */}
        <InfoCard
          title="Monero View Key"
          icon={
            <svg className="w-5 h-5 text-[#ff6600]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          }
        >
          <p className="text-[var(--muted)] mb-4">
            The <strong className="text-white">view key</strong> allows you to see all incoming transactions 
            to our wallet. Combined with the tx keys we provide for withdrawals, you can fully audit the bridge.
          </p>

          <ExpandableSection title="What is a Monero View Key?" defaultOpen>
            <div className="text-sm text-[var(--muted)] space-y-3">
              <p>
                Monero uses two key pairs: a <strong className="text-white">spend key</strong> (needed to send XMR) 
                and a <strong className="text-white">view key</strong> (only needed to see incoming transactions).
              </p>
              <p>
                <strong className="text-white">Important:</strong> The view key only reveals <em>incoming</em> transactions 
                (deposits to our wallet). It does NOT show outgoing transactions or the current balance. 
                To verify withdrawals, you need the tx keys we provide for each withdrawal (see below).
              </p>
              <p>
                Together, the view key (for deposits) + tx keys (for withdrawals) allow full transparency. 
                The view key cannot be used to steal funds.
              </p>
            </div>
          </ExpandableSection>

          <ExpandableSection title="How to Verify Deposits">
            <div className="text-sm text-[var(--muted)] space-y-4">
              <p><strong className="text-white">Option 1: View-Only Wallet</strong></p>
              <ol className="list-decimal list-inside space-y-2 ml-4">
                <li>Open Monero GUI or CLI wallet</li>
                <li>Select &quot;Restore wallet from keys&quot;</li>
                <li>Enter the address and view key below</li>
                <li>Leave spend key blank (or enter zeros)</li>
                <li>Sync with a Monero node to see all incoming deposits</li>
              </ol>
              <p className="mt-2 text-xs">
                Note: This shows total deposits received, not current balance (outputs are hidden without spend key).
              </p>
              
              <p className="mt-4"><strong className="text-white">Option 2: Block Explorer</strong></p>
              <p>
                Some Monero block explorers like{' '}
                <a href="https://xmrchain.net" target="_blank" rel="noopener noreferrer" className="text-[#ff6600] hover:underline">
                  xmrchain.net
                </a>{' '}
                allow you to search by address and provide your view key to see incoming transactions.
              </p>
            </div>
          </ExpandableSection>

          <div className="bg-[var(--background)] rounded-xl p-4 border border-[var(--border)] space-y-4 mt-4">
            <div>
              <p className="text-xs text-[var(--muted)] mb-2 uppercase tracking-wide">XMR Address</p>
              <div className="flex gap-2">
                <code className="text-xs bg-[var(--card)] p-3 rounded-lg flex-1 break-all font-mono border border-[var(--border)] text-[#ff6600]">
                  {BRIDGE_DATA.xmrAddress}
                </code>
                <button
                  onClick={() => copyToClipboard(BRIDGE_DATA.xmrAddress, 'address')}
                  className="p-3 bg-[var(--card)] hover:bg-[var(--card-hover)] border border-[var(--border)] hover:border-[#ff6600] rounded-lg transition-all flex-shrink-0"
                  title="Copy"
                >
                  {copied === 'address' ? (
                    <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
            <div>
              <p className="text-xs text-[var(--muted)] mb-2 uppercase tracking-wide">View Key</p>
              <div className="flex gap-2">
                <code className="text-xs bg-[var(--card)] p-3 rounded-lg flex-1 break-all font-mono border border-[var(--border)]">
                  {BRIDGE_DATA.viewKey}
                </code>
                <button
                  onClick={() => copyToClipboard(BRIDGE_DATA.viewKey, 'viewkey')}
                  className="p-3 bg-[var(--card)] hover:bg-[var(--card-hover)] border border-[var(--border)] hover:border-[#ff6600] rounded-lg transition-all flex-shrink-0"
                  title="Copy"
                >
                  {copied === 'viewkey' ? (
                    <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>
        </InfoCard>

        {/* Transaction Key Section */}
        <InfoCard
          title="Transaction Keys (Withdrawal Proofs)"
          icon={
            <svg className="w-5 h-5 text-[#ff6600]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          }
        >
          <p className="text-[var(--muted)] mb-4">
            Every withdrawal we process includes a <strong className="text-white">transaction key</strong> (tx key) 
            that cryptographically proves the payment was made to your address.
          </p>

          <ExpandableSection title="What is a Transaction Key?" defaultOpen>
            <div className="text-sm text-[var(--muted)] space-y-3">
              <p>
                When a Monero transaction is created, a unique <strong className="text-white">transaction private key</strong> is 
                generated. This key can be shared to prove that a specific payment was made to a specific address.
              </p>
              <p>
                Unlike Bitcoin where transactions are publicly visible on the blockchain, Monero transactions are 
                private by default. The tx key is the cryptographic proof that a payment was made.
              </p>
              <p>
                When we complete your withdrawal, we emit the tx key in the Solana transaction event. You can use 
                this to verify that your XMR was actually sent, even though Monero transactions are private.
              </p>
            </div>
          </ExpandableSection>

          <ExpandableSection title="How to Verify a Withdrawal">
            <div className="text-sm text-[var(--muted)] space-y-4">
              <p><strong className="text-white">What you need:</strong></p>
              <ul className="list-disc list-inside space-y-1 ml-4">
                <li>Transaction ID (txid) - the Monero transaction hash</li>
                <li>Your XMR address - where you requested the withdrawal</li>
                <li>Transaction Key (tx key) - from the Solana withdrawal event</li>
              </ul>
              
              <p className="mt-4"><strong className="text-white">Verification steps:</strong></p>
              <ol className="list-decimal list-inside space-y-2 ml-4">
                <li>
                  Go to{' '}
                  <a href="https://xmrchain.net" target="_blank" rel="noopener noreferrer" className="text-[#ff6600] hover:underline">
                    xmrchain.net
                  </a>
                </li>
                <li>Paste the transaction ID and press Enter</li>
                <li>Click &quot;Prove sending&quot;</li>
                <li>Enter your XMR address (output address) and the tx key</li>
                <li>Click &quot;Prove Send&quot; - it will show the exact amount sent to you</li>
              </ol>

              <p className="mt-4"><strong className="text-white">Alternative: Monero CLI</strong></p>
              <code className="block bg-[var(--background)] p-3 rounded-lg font-mono text-xs mt-2">
                monero-wallet-cli check_tx_key &lt;txid&gt; &lt;address&gt; &lt;tx_key&gt;
              </code>
            </div>
          </ExpandableSection>

          <ExpandableSection title="Where to Find the TX Key">
            <div className="text-sm text-[var(--muted)] space-y-3">
              <p>
                The tx key is emitted in the <code className="bg-[var(--background)] px-1 rounded">WithdrawCompletedEvent</code> on Solana 
                when your withdrawal is finalized. You can find it by:
              </p>
              <ol className="list-decimal list-inside space-y-2 ml-4">
                <li>Finding your withdrawal completion transaction on Solscan</li>
                <li>Looking at the &quot;Instruction Logs&quot; or &quot;Events&quot; section</li>
                <li>The event contains: txid, recipient address, and tx key</li>
              </ol>
              <p className="mt-3 text-xs">
                We also log tx keys in our backend - if you need help finding a tx key for a completed withdrawal, 
                contact support with your withdrawal details.
              </p>
            </div>
          </ExpandableSection>
        </InfoCard>

        {/* On-Chain Data Section */}
        <InfoCard
          title="On-Chain Verification"
          icon={
            <svg className="w-5 h-5 text-[#ff6600]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
            </svg>
          }
        >
          <p className="text-[var(--muted)] mb-4">
            All bridge operations are recorded on-chain. The Solana program tracks total deposits and withdrawals, 
            and all events are permanently stored.
          </p>

          <div className="space-y-4">
            <div className="bg-[var(--background)] rounded-lg p-4 border border-[var(--border)]">
              <p className="text-xs text-[var(--muted)] mb-2 uppercase tracking-wide">wXMR Token Mint</p>
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono text-[#ff6600] flex-1 break-all">
                  {BRIDGE_DATA.wxmrMint}
                </code>
                <a
                  href={`https://solscan.io/token/${BRIDGE_DATA.wxmrMint}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 bg-[var(--card)] hover:bg-[var(--card-hover)] border border-[var(--border)] hover:border-[#ff6600] rounded-lg transition-all"
                  title="View on Solscan"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              </div>
              <p className="text-xs text-[var(--muted)] mt-2">
                Total supply = total wXMR in circulation
              </p>
            </div>

            <div className="bg-[var(--background)] rounded-lg p-4 border border-[var(--border)]">
              <p className="text-xs text-[var(--muted)] mb-2 uppercase tracking-wide">Bridge Program</p>
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono flex-1 break-all">
                  {BRIDGE_DATA.bridgeProgram}
                </code>
                <a
                  href={`https://solscan.io/account/${BRIDGE_DATA.bridgeProgram}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 bg-[var(--card)] hover:bg-[var(--card-hover)] border border-[var(--border)] hover:border-[#ff6600] rounded-lg transition-all"
                  title="View on Solscan"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              </div>
              <p className="text-xs text-[var(--muted)] mt-2">
                Contains BridgeConfig with total deposit/withdrawal stats
              </p>
            </div>
          </div>
        </InfoCard>

        {/* Full Auditability */}
        <InfoCard
          title="Full Auditability"
          icon={
            <svg className="w-5 h-5 text-[#ff6600]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          }
        >
          <div className="space-y-4 text-[var(--muted)]">
            <p>
              <strong className="text-white">Everything is verifiable:</strong>
            </p>
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li>Verify all XMR deposits using our public view key</li>
              <li>Verify any withdrawal with the tx key we provide</li>
              <li>Check total wXMR supply on Solana matches reserves</li>
              <li>All bridge events permanently recorded on-chain</li>
            </ul>

            <div className="mt-4 p-4 bg-[#ff6600]/10 border border-[#ff6600]/30 rounded-lg">
              <p className="text-sm">
                <strong className="text-[#ff6600]">Don&apos;t trust, verify.</strong> We provide all the cryptographic 
                tools you need to independently audit every deposit and withdrawal.
              </p>
            </div>
          </div>
        </InfoCard>

        {/* Epoch Audit History */}
        <InfoCard
          title="Epoch Audit History"
          icon={
            <svg className="w-5 h-5 text-[#ff6600]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
            </svg>
          }
        >
          <p className="text-[var(--muted)] mb-4">
            Every week (or when needed for withdrawals), we consolidate all spendable XMR and record proof on-chain. 
            Each audit includes transaction keys so you can verify we control the XMR backing wXMR.
          </p>

          <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg mb-4">
            <p className="text-xs text-yellow-200">
              <strong>Why XMR balance may differ from wXMR supply:</strong> Monero requires transaction fees to 
              consolidate UTXOs. The bridge operator pays these fees out of pocket—users never pay consolidation fees. 
              This means the actual XMR backing may be slightly less than the wXMR supply (typically &lt;0.01 XMR difference).
            </p>
          </div>

          {loadingAudits ? (
            <div className="text-center py-8 text-[var(--muted)]">
              <div className="animate-spin w-6 h-6 border-2 border-[#ff6600] border-t-transparent rounded-full mx-auto mb-2"></div>
              Loading audit history...
            </div>
          ) : audits.length === 0 ? (
            <div className="text-center py-8 text-[var(--muted)]">
              No audits recorded yet. First audit will run within 24 hours.
            </div>
          ) : (
            <div className="space-y-3">
              {audits.map((audit) => {
                const isExpanded = expandedEpoch === audit.epoch;
                
                let auditData: AuditData | null = null;
                try {
                  auditData = JSON.parse(audit.data);
                } catch {
                  auditData = null;
                }

                // The epoch field is now a Unix timestamp
                const auditDate = formatDate(audit.epoch);
                const triggeredBy = auditData?.triggeredBy;
                
                return (
                  <div key={audit.epoch} className="border border-[var(--border)] rounded-lg overflow-hidden">
                    <button
                      onClick={() => setExpandedEpoch(isExpanded ? null : audit.epoch)}
                      className="w-full p-4 bg-[var(--background)] hover:bg-[var(--card-hover)] flex justify-between items-center text-left transition-colors"
                    >
                      <div>
                        <span className="font-semibold text-white">{auditDate}</span>
                        {triggeredBy === 'withdrawal_failure' && (
                          <span className="text-xs text-yellow-400 ml-2 px-2 py-0.5 bg-yellow-400/10 rounded">
                            triggered by withdrawal
                          </span>
                        )}
                        {triggeredBy === 'scheduled' && (
                          <span className="text-xs text-green-400 ml-2 px-2 py-0.5 bg-green-400/10 rounded">
                            scheduled
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right text-sm">
                          <div className="text-[#ff6600]">{formatXmr(audit.spendableBalance)} XMR</div>
                          <div className="text-xs text-[var(--muted)]">consolidated</div>
                        </div>
                        <svg 
                          className={`w-5 h-5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} 
                          fill="none" 
                          stroke="currentColor" 
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </button>
                    
                    {isExpanded && (
                      <div className="p-4 border-t border-[var(--border)] bg-[var(--card)] space-y-4">
                        {/* Balance Summary Box */}
                        <div className="bg-[var(--background)] rounded-lg p-4 border border-[var(--border)]">
                          <p className="text-xs text-[var(--muted)] uppercase mb-3 font-semibold">Balance Summary</p>
                          
                          {/* Main comparison */}
                          <div className="space-y-2 text-sm font-mono">
                            <div className="flex justify-between">
                              <span className="text-[var(--muted)]">wXMR Circulating Supply:</span>
                              <span className="text-white">{formatXmr(audit.circulatingSupply)} wXMR</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-[var(--muted)]">XMR Spendable (after fees):</span>
                              <span className="text-[#ff6600]">{formatXmr(audit.spendableBalance)} XMR</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-[var(--muted)]">XMR Unconfirmed (pending):</span>
                              <span className="text-yellow-400">{formatXmr(audit.unconfirmedBalance)} XMR</span>
                            </div>
                            
                            <div className="border-t border-[var(--border)] pt-2 mt-2">
                              <div className="flex justify-between font-semibold">
                                <span className="text-[var(--muted)]">Total XMR Backing:</span>
                                <span className="text-green-400">
                                  {formatXmr(BigInt(audit.spendableBalance.toString()) + BigInt(audit.unconfirmedBalance.toString()))} XMR
                                </span>
                              </div>
                            </div>
                            
                            {/* Fee difference explanation */}
                            {(() => {
                              const totalXmr = BigInt(audit.spendableBalance.toString()) + BigInt(audit.unconfirmedBalance.toString());
                              const wxmrSupply = BigInt(audit.circulatingSupply.toString());
                              const difference = wxmrSupply - totalXmr;
                              
                              if (difference > BigInt(0)) {
                                return (
                                  <div className="mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs">
                                    <div className="flex justify-between mb-1">
                                      <span className="text-[var(--muted)]">Shortfall (fees we paid):</span>
                                      <span className="text-red-400 font-semibold">-{formatXmr(difference)} XMR</span>
                                    </div>
                                    <p className="text-[var(--muted)]">
                                      This {formatXmr(difference)} XMR difference is the cumulative cost of consolidation fees 
                                      the bridge operator has paid. Users never pay these fees—we absorb the cost of managing Monero UTXOs.
                                    </p>
                                  </div>
                                );
                              }
                              return null;
                            })()}
                          </div>
                          
                          {/* Total fees this epoch */}
                          {auditData?.totalFee && auditData.totalFee > 0 && (
                            <div className="mt-3 pt-3 border-t border-[var(--border)]">
                              <div className="flex justify-between text-sm">
                                <span className="text-[var(--muted)]">Fees we paid this epoch:</span>
                                <span className="text-red-400 font-mono">-{formatXmr(auditData.totalFee)} XMR</span>
                              </div>
                              <p className="text-xs text-[var(--muted)] mt-1">
                                Paid by bridge operator, not deducted from user balances
                              </p>
                            </div>
                          )}
                        </div>

                        {/* Unconfirmed Transfers (viewable with view key) */}
                        {auditData?.unconfirmed && auditData.unconfirmed.length > 0 && (
                          <div className="mt-4">
                            <p className="text-xs text-[var(--muted)] uppercase mb-2">
                              Unconfirmed Deposits (verify with view key)
                            </p>
                            <div className="space-y-1">
                              {auditData.unconfirmed.map((tx, i) => (
                                <div key={i} className="text-xs font-mono bg-[var(--background)] p-2 rounded flex justify-between">
                                  <span className="text-[var(--muted)]">{tx.tx.slice(0, 16)}...</span>
                                  <span className="text-yellow-400">{formatXmr(tx.amt)} XMR</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Primary Address */}
                        {auditData?.address && (
                          <div className="mt-4">
                            <p className="text-xs text-[var(--muted)] uppercase mb-2">Consolidation Destination</p>
                            <div className="bg-[var(--background)] p-3 rounded-lg border border-[var(--border)]">
                              <div className="flex gap-2">
                                <code className="font-mono text-xs text-[#ff6600] break-all flex-1">{auditData.address}</code>
                                <button
                                  onClick={() => copyToClipboard(auditData!.address, `addr-${audit.epoch}`)}
                                  className="p-1 hover:bg-[var(--card-hover)] rounded flex-shrink-0"
                                >
                                  {copied === `addr-${audit.epoch}` ? '✓' : '📋'}
                                </button>
                              </div>
                              <p className="text-xs text-[var(--muted)] mt-1">
                                All XMR was swept to this address (our primary wallet)
                              </p>
                            </div>
                          </div>
                        )}

                        {/* Consolidation Transactions with TX Keys */}
                        {auditData?.txs && auditData.txs.length > 0 && (
                          <div className="mt-4">
                            <p className="text-xs text-[var(--muted)] uppercase mb-2">
                              Consolidation Transactions ({auditData.txs.length})
                            </p>
                            <p className="text-xs text-[var(--muted)] mb-3">
                              Each transaction proves we control the XMR. Use the TX key to verify on xmrchain.net.
                            </p>
                            <div className="space-y-3">
                              {auditData.txs.map((tx, i) => (
                                <div key={i} className="bg-[var(--background)] p-3 rounded-lg border border-[var(--border)]">
                                  <div className="flex justify-between items-start mb-2">
                                    <span className="text-xs text-[var(--muted)]">TX #{i + 1}</span>
                                    <div className="text-right">
                                      <span className="text-sm text-[#ff6600] font-mono">{formatXmr(tx.amount)} XMR</span>
                                      <span className="text-xs text-red-400 ml-2">(-{formatXmr(tx.fee)} fee)</span>
                                    </div>
                                  </div>
                                  
                                  <div className="space-y-2 text-xs">
                                    <div>
                                      <p className="text-[var(--muted)]">TXID:</p>
                                      <div className="flex gap-2">
                                        <code className="font-mono text-white break-all flex-1">{tx.txid}</code>
                                        <button
                                          onClick={() => copyToClipboard(tx.txid, `txid-${audit.epoch}-${i}`)}
                                          className="p-1 hover:bg-[var(--card-hover)] rounded"
                                        >
                                          {copied === `txid-${audit.epoch}-${i}` ? '✓' : '📋'}
                                        </button>
                                      </div>
                                    </div>
                                    
                                    <div>
                                      <p className="text-[var(--muted)]">TX Key (proof of ownership):</p>
                                      <div className="flex gap-2">
                                        <code className="font-mono text-green-400 break-all flex-1">{tx.key}</code>
                                        <button
                                          onClick={() => copyToClipboard(tx.key, `key-${audit.epoch}-${i}`)}
                                          className="p-1 hover:bg-[var(--card-hover)] rounded"
                                        >
                                          {copied === `key-${audit.epoch}-${i}` ? '✓' : '📋'}
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                  
                                  <a
                                    href={`https://xmrchain.net/tx/${tx.txid}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-xs text-[#ff6600] hover:underline mt-2"
                                  >
                                    Verify on xmrchain.net →
                                  </a>
                                </div>
                              ))}
                            </div>
                            
                            {auditData.totalFee > 0 && (
                              <p className="text-xs text-[var(--muted)] mt-2">
                                Total fees paid: {formatXmr(auditData.totalFee)} XMR
                              </p>
                            )}
                          </div>
                        )}

                        {/* Verification Instructions */}
                        <div className="mt-4 p-3 bg-[var(--background)] rounded-lg text-xs text-[var(--muted)]">
                          <p className="font-semibold text-white mb-1">How to verify:</p>
                          <ol className="list-decimal list-inside space-y-1">
                            <li>Go to xmrchain.net and paste the TXID</li>
                            <li>Click &quot;Prove sending&quot;</li>
                            <li>Enter our XMR address and the TX key</li>
                            <li>Confirms we spent the exact amount shown</li>
                          </ol>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </InfoCard>

        {/* Footer */}
        <footer className="mt-16 pt-8 border-t border-[var(--border)]">
          <div className="flex flex-wrap justify-center gap-6 mb-8">
            <Link
              href="/"
              className="flex items-center gap-2 text-sm text-[var(--muted)] hover:text-[#ff6600] transition-colors"
            >
              <MoneroLogo className="w-4 h-4" />
              Back to Bridge
            </Link>
            <a
              href="https://getmonero.org"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-[var(--muted)] hover:text-[#ff6600] transition-colors"
            >
              Learn about Monero
            </a>
          </div>
          <div className="flex justify-center">
            <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
              <MoneroLogo className="w-4 h-4 opacity-50" />
              <span>Powered by Monero & Solana</span>
            </div>
          </div>
        </footer>
      </div>
    </main>
  );
}
