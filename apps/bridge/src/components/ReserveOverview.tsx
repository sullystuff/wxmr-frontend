"use client";

import Link from "next/link";
import { useLatestReserve } from "@/hooks/useLatestReserve";
import { useHeartbeat } from "@/hooks/useHeartbeat";
import { useXmrPrice, usdValue } from "@/hooks/useXmrPrice";
import { Icon } from "./BridgeIcons";

export function compactXmr(value: bigint | string, digits = 4) {
  const n = BigInt(value);
  const whole = (n / BigInt(1e12)).toLocaleString("en-US");
  return `${whole}.${(n % BigInt(1e12)).toString().padStart(12, "0").slice(0, digits)}`;
}

export function ReserveOverview({
  supply,
  ready,
}: {
  supply: bigint;
  ready: boolean;
}) {
  const { reserve, loading, error } = useLatestReserve();
  const { heartbeat } = useHeartbeat();
  const price = useXmrPrice();
  const report = reserve?.report;

  return (
    <aside className="reserve-panel">
      <div className="eyebrow">
        <Icon name="shield" />
        OPEN BY DESIGN
      </div>
      <h2>Verify. Then bridge.</h2>
      <p className="muted">
        Daily reserve proofs. On-chain records.
        <br />
        The evidence is yours to inspect.
      </p>
      <div className="reserve-number tvl-number">
        <span className="field-label">TVL · native XMR in bridge</span>
        <div>{heartbeat ? compactXmr(heartbeat.balanceAtomic) : "—"}<span>XMR</span></div>
        <p className="tvl-usd">{heartbeat && price ? `≈ ${usdValue(heartbeat.balanceAtomic, price.usd)} USD` : "USD estimate unavailable"}</p>
        {price && <p className="muted small" title={`${price.source} · ${new Date(price.at*1000).toLocaleString()}`}>XMR reference price · {new Date(price.at*1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>}
      </div>
      <div className="reserve-number">
        <span className="field-label">Circulating on Solana</span>
        <div>
          {ready ? (
            compactXmr(supply)
          ) : (
            <span className="skeleton number-skeleton" />
          )}
          <span>wXMR</span>
        </div>
        {ready && price && <p className="muted small">≈ {usdValue(supply, price.usd)} USD</p>}
      </div>
      <div className="reserve-proof-summary">
        <div className="proof-heading">
          <span className={`status-dot ${report ? "neutral" : "muted-dot"}`} />
          <span>Reserve proof</span>
          <span className="tiny-tag">ON-CHAIN</span>
        </div>
        {loading ? (
          <p className="muted small">Reading the latest proof…</p>
        ) : report ? (
          <>
            <p className="proof-amount">
              {compactXmr(report.verified.unspentAtomic)}{" "}
              <span>XMR at recorded check</span>
            </p>
            <p className="muted small">
              Publisher checked{" "}
              {new Date(report.verified.at * 1000).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
                timeZoneName: "short",
              })}
              .
            </p>
          </>
        ) : (
          <p className="muted small">
            {error
              ? "Report lookup unavailable. Open reserves to retry."
              : "Waiting for the latest published reserve proof."}
          </p>
        )}
      </div>
      <Link href="/transparency" className="text-link">
        Explore reserves
        <Icon name="arrow" />
      </Link>
      <p className="reserve-scope">
        Every report includes its recorded check time and the data you need to
        verify the proof independently.
      </p>
    </aside>
  );
}
