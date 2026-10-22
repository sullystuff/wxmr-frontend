"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CopyAddress, SolanaRpcSettings } from "@wxmr/shared";
import { BridgeShell } from "@/components/BridgeShell";
import { Icon } from "@/components/BridgeIcons";
import { ReserveAuditCard } from "@/components/ReserveAuditCard";
import { compactXmr } from "@/components/ReserveOverview";
import { useLatestReserve } from "@/hooks/useLatestReserve";
import { useHeartbeat } from "@/hooks/useHeartbeat";
import { useXmrPrice, usdValue } from "@/hooks/useXmrPrice";
import { fetchAuditPage } from "@/lib/audits";
import { parseReserveReport, RESERVE_FORMAT } from "@/lib/reserve-proof";

type AuditRecord = Awaited<
  ReturnType<typeof fetchAuditPage>
>["records"][number];
type LegacyData = {
  address?: string;
  txs?: { txid: string; key: string; amount: number; fee: number }[];
  burn?: { txid: string; amount: number };
  totalFee?: number;
};
const RESERVE_ADDRESS =
  "45ZYpKmPaPmh3bnRP1XpMz8cASJQf1cfUgq32H8trCYA4RodzXhsmt2VYkQX9QQ65CetiGja65tH2JmKC3gEZtZjB7AzMpd";
const VIEW_KEY =
  "e4e02de197582ff2e93f9eaefc96e122a13ffa838736ef38f4a8ea27a0dc4909";

function date(value: number) {
  return new Date(value * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function LegacyAudit({ record }: { record: AuditRecord }) {
  let data: LegacyData | null = null;
  try {
    data = JSON.parse(record.data);
  } catch {
    /* Retain the raw record below. */
  }
  return (
    <details className="legacy-audit">
      <summary>
        <div>
          <span className="history-type">
            <Icon name="activity" />
            Consolidation record
          </span>
          <p>{date(record.timestamp)}</p>
        </div>
        <div className="history-value">
          {compactXmr(record.spendableBalance)}{" "}
          <span>XMR reported spendable</span>
        </div>
        <Icon name="chevron" />
      </summary>
      <div className="audit-details">
        <p className="muted">
          A historical wallet consolidation record with transaction keys and
          balance figures from the recorded audit.
        </p>
        <dl className="audit-facts">
          <div>
            <dt>Supply reference</dt>
            <dd>{compactXmr(record.circulatingSupply, 12)} wXMR</dd>
          </div>
          <div>
            <dt>Reported spendable</dt>
            <dd>{compactXmr(record.spendableBalance, 12)} XMR</dd>
          </div>
          <div>
            <dt>Reported unconfirmed</dt>
            <dd>{compactXmr(record.unconfirmedBalance, 12)} XMR</dd>
          </div>
        </dl>
        {data?.burn && (
          <p className="audit-burn">
            Recorded fee-covering burn:{" "}
            <a
              href={`https://solscan.io/tx/${data.burn.txid}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {compactXmr(BigInt(data.burn.amount), 12)} wXMR
              <Icon name="external" />
            </a>
          </p>
        )}
        {data?.txs?.map((tx, i) => (
          <div className="audit-transaction" key={tx.txid}>
            <div className="section-label">
              CONSOLIDATION TRANSACTION {i + 1}
            </div>
            <p className="field-label">Transaction hash</p>
            <CopyAddress
              address={tx.txid}
              label="Monero transaction hash"
              className="contract-address"
            />
            <p className="field-label">Public payment proof key</p>
            <CopyAddress
              address={tx.key}
              label="Monero transaction proof key"
              className="contract-address"
            />
            <div className="audit-transaction-actions">
              <a
                className="text-link"
                href={`https://xmrchain.net/tx/${tx.txid}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                View transaction
                <Icon name="external" />
              </a>
              <form
                action="https://xmrchain.net/prove"
                method="POST"
                target="_blank"
                rel="noopener noreferrer"
              >
                <input type="hidden" name="txhash" value={tx.txid} />
                <input type="hidden" name="txprvkey" value={tx.key} />
                <input type="hidden" name="raw_tx_data" value="" />
                <input
                  type="hidden"
                  name="xmraddress"
                  value={data?.address || RESERVE_ADDRESS}
                />
                <button type="submit" className="text-link">
                  Check payment proof
                  <Icon name="external" />
                </button>
              </form>
            </div>
          </div>
        ))}
        <a
          className="text-link"
          href={`https://solscan.io/account/${record.account}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Inspect on-chain record
          <Icon name="external" />
        </a>
        <details className="raw-record">
          <summary>Raw published data</summary>
          <pre>{record.data}</pre>
        </details>
      </div>
    </details>
  );
}

export default function TransparencyPage() {
  const { reserve: currentReserve, loading: latestLoading, error: latestError } = useLatestReserve();
  const { heartbeat } = useHeartbeat();
  const price = useXmrPrice();
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [searchedThrough, setSearchedThrough] = useState<number | null>(null);
  const load = useCallback(async (before?: string) => {
    setLoading(true);
    setError(null);
    try {
      const page = await fetchAuditPage(before);
      setRecords((prior) =>
        [
          ...new Map(
            [...prior, ...page.records].map((r) => [r.account, r]),
          ).values(),
        ].sort((a, b) => b.timestamp - a.timestamp),
      );
      setCursor(page.nextCursor);
      setSearchedThrough(page.searchedThrough);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to load reserve records.",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const latest = currentReserve?.report;
  return (
    <BridgeShell>
      <main id="main" className="bridge-main reserves-main">
        <div className="page-intro">
          <div>
            <p className="eyebrow">
              <span className="orange-dash" />
              THE EVIDENCE, IN THE OPEN
            </p>
            <h1>
              Reserves you can <span>inspect.</span>
            </h1>
            <p>
              Published Monero proofs and Solana records. Verify them on your
              terms.
            </p>
          </div>
          <Link href="/docs#verification" className="intro-help">
            How to verify
            <Icon name="arrow" />
          </Link>
        </div>
        <section
          className="reserve-stat-grid"
          aria-label="Latest reserve proof"
        >
          <div>
            <span className="field-label">Reported unspent at check</span>
            <p>
              {latest ? compactXmr(latest.verified.unspentAtomic) : "—"}
              <small>XMR</small>
            </p>
          </div>
          <div>
            <span className="field-label">Token supply reference</span>
            <p>
              {latest ? compactXmr(latest.solana.supplyAtomic) : "—"}
              <small>wXMR</small>
            </p>
          </div>
          <div>
            <span className="field-label">Recorded publisher check</span>
            <p className="stat-date">
              {latest
                ? date(latest.verified.at)
                : latestLoading
                  ? "Loading latest proof…"
                  : latestError ? "Proof lookup unavailable" : "Waiting for proof pointer"}
            </p>
          </div>
        </section>
        <p className="reserve-stat-caption">
          Native reserve proofs publish daily, including confirmed locked outputs. The daily wallet sweep runs separately.
          {heartbeat && <> Current TVL: {compactXmr(heartbeat.balanceAtomic)} XMR{price ? ` (≈ ${usdValue(heartbeat.balanceAtomic, price.usd)} USD)` : ""}.</>}
        </p>
        {currentReserve && <section className="latest-reserve-proof" aria-label="Latest daily reserve proof">
          <p className="eyebrow">LATEST DAILY PROOF</p>
          <ReserveAuditCard data={currentReserve.data} account={currentReserve.account} />
        </section>}
        <div className="reserves-content">
          <section className="proof-history" aria-labelledby="proof-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">ON-CHAIN PUBLICATIONS</p>
                <h2 id="proof-title">Reserve proofs & audit history</h2>
              </div>
              <span className="tiny-tag">{records.length} LOADED</span>
            </div>
            <p className="section-description">
              Native reserve proofs demonstrate control of the included XMR
              outputs. Older consolidation records retain their transaction keys
              for inspection.
            </p>
            {error && (
              <div className="notice error-notice" role="alert">
                <Icon name="info" />
                <p>{error}</p>
              </div>
            )}
            {loading && records.length === 0 ? (
              <div className="history-loading">
                <span className="spinner" />
                <p>Reading published records from Solana…</p>
              </div>
            ) : records.length === 0 && !error ? (
              <div className="activity-empty compact">
                <Icon name="shield" />
                <h3>No reports in the activity loaded yet.</h3>
                <p>Load earlier activity to look for reserve publications.</p>
              </div>
            ) : (
              <div className="proof-records">
                {records.map((record) =>
                  record.data.startsWith(`{"format":"${RESERVE_FORMAT}"`) ? (
                    <ReserveAuditCard
                      key={record.account}
                      data={record.data}
                      account={record.account}
                    />
                  ) : (
                    <LegacyAudit key={record.account} record={record} />
                  ),
                )}
              </div>
            )}
            <div className="history-pagination">
              {(cursor !== null || error) && (
                <button
                  className="secondary-button"
                  disabled={loading}
                  onClick={() => void load(cursor || undefined)}
                >
                  {loading
                    ? "Loading…"
                    : error
                      ? "Retry lookup"
                      : "Load earlier activity"}
                  <Icon name="arrow" />
                </button>
              )}
              {searchedThrough && (
                <p>Activity searched back to {date(searchedThrough)}.</p>
              )}
            </div>
          </section>
          <aside className="verification-sidebar">
            <div className="verification-note">
              <Icon name="shield" />
              <h2>What a proof tells you.</h2>
              <p>
                A native Monero reserve proof lets you check control of the
                included outputs and their spent status using a synchronized
                Monero node.
              </p>
              <p>
                The browser displays the publisher’s recorded check. Download
                the report and verify it yourself for an independent result.
              </p>
              <Link className="text-link" href="/docs#verification">
                Verification guide
                <Icon name="arrow" />
              </Link>
            </div>
            <div className="verification-note">
              <Icon name="info" />
              <h2>Privacy across two networks.</h2>
              <p>
                Monero and Solana have different privacy properties. wXMR
                balances and transfers are public on Solana.
              </p>
              <p>
                Bridge records can link a Solana wallet with deposit addresses,
                withdrawal destinations, and amounts.
              </p>
              <Link className="text-link" href="/docs#privacy">
                Understand bridge privacy
                <Icon name="arrow" />
              </Link>
            </div>
            <div className="verification-note rpc-note">
              <h2>Your connection.</h2>
              <p>
                Choose the Solana RPC provider your browser uses to inspect
                on-chain records.
              </p>
              <SolanaRpcSettings />
            </div>
          </aside>
        </div>
        <section className="public-verification">
          <div className="section-heading">
            <div>
              <p className="eyebrow">VERIFY INDEPENDENTLY</p>
              <h2>Public addresses & view key</h2>
            </div>
          </div>
          <div className="public-keys-grid">
            <div>
              <h3>Monero wallet inspection</h3>
              <p>
                A view-only wallet can reveal incoming transfers. The view key
                alone does not establish the current unspent balance.
              </p>
              <details className="contract-details">
                <summary>
                  Show address & public view key
                  <Icon name="chevron" />
                </summary>
                <div>
                  <p className="field-label">Reserve wallet address</p>
                  <CopyAddress
                    address={RESERVE_ADDRESS}
                    label="Monero reserve wallet address"
                    className="contract-address"
                  />
                  <p className="field-label">Public view key</p>
                  <CopyAddress
                    address={VIEW_KEY}
                    label="public Monero view key"
                    className="contract-address"
                  />
                </div>
              </details>
            </div>
            <div>
              <h3>Solana program & token</h3>
              <p>
                Inspect token supply and bridge records directly on Solana.
                Click an address to copy its full value.
              </p>
              <p className="field-label">wXMR token mint</p>
              <CopyAddress
                address="WXMRyRZhsa19ety5erZhHg4N3xj3EVN92u94422teJp"
                label="wXMR token mint"
                className="contract-address"
              />
              <p className="field-label">Bridge program</p>
              <CopyAddress
                address="EzBkC8P5wxab9kwrtV5hRdynHAfB5w3UPcPXNgMseVA8"
                label="bridge program"
                className="contract-address"
              />
            </div>
          </div>
        </section>
      </main>
    </BridgeShell>
  );
}
