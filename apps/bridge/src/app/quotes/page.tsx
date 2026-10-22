"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BridgeShell } from "@/components/BridgeShell";
import { TRADE_SIZES_USD } from "@/lib/quote-sizes";

const REFRESH_MS = 10_000;

type VenueQuote = {
  ok: boolean;
  venue: "solana" | "kucoin";
  source: string;
  xmrAmount: number | null;
  usdAmount: number | null;
  effectivePrice: number | null;
  priceImpactPct?: number | null;
  routeCount?: number | null;
  error?: string;
};

type QuoteRow = {
  sizeUsd: number;
  sellXmrAmount: number | null;
  buy: {
    solana: VenueQuote;
    kucoin: VenueQuote;
    solanaEdgeBps: number | null;
    betterVenue: "solana" | "kucoin" | null;
  };
  sell: {
    solana: VenueQuote;
    kucoin: VenueQuote;
    solanaEdgeBps: number | null;
    betterVenue: "solana" | "kucoin" | null;
  };
};

type QuoteSnapshot = {
  timestamp: string;
  referencePrice: number | null;
  sources: {
    solana: string;
    kucoin: string;
  };
  notes: string[];
  rows: QuoteRow[];
};

export default function QuotesPage() {
  const [snapshot, setSnapshot] = useState<QuoteSnapshot | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receivedAt, setReceivedAt] = useState<Date | null>(null);
  const refreshInFlight = useRef(false);

  const fetchSnapshot = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    setIsRefreshing(true);
    try {
      const response = await fetch("/api/quotes", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          data.error || `Quote refresh failed: ${response.status}`,
        );
      }
      setSnapshot(data as QuoteSnapshot);
      setReceivedAt(new Date());
      setError(null);
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Quote refresh failed",
      );
    } finally {
      refreshInFlight.current = false;
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!cancelled) {
        await fetchSnapshot();
      }
    };
    run();
    const refresh = window.setInterval(run, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(refresh);
    };
  }, [fetchSnapshot]);

  return (
    <BridgeShell>
      <main id="main" className="bridge-main quotes-main">
        <div className="page-intro">
          <div>
            <p className="eyebrow">
              <span className="orange-dash" />
              MARKET COMPARISON
            </p>
            <h1>
              XMR quotes. <span>Side by side.</span>
            </h1>
            <p>
              Solana liquidity and the KuCoin public order book, by trade size.
            </p>
          </div>
          <StatusPill
            isRefreshing={isRefreshing}
            hasSnapshot={Boolean(snapshot)}
          />
        </div>
        <section className="mb-5 flex flex-wrap items-center gap-x-12 gap-y-4 rounded-xl border border-[var(--border)] bg-[var(--card)] px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              Reference XMR Price
            </p>
            <p className="mt-1 text-xl font-bold text-[#ff6600]">
              {formatUsd(snapshot?.referencePrice ?? null, 2, 2)}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              Last Exchange Tick
            </p>
            <p className="mt-1 text-xl font-bold text-white">
              {snapshot ? formatTime(snapshot.timestamp) : "--"}
            </p>
          </div>
          <div className="text-xs leading-relaxed text-[var(--muted)] sm:ml-auto sm:text-right">
            <p>USDC on Solana · USDT on KuCoin</p>
            <p>Sell inputs sized using the reference price</p>
            <p>
              Page received{" "}
              {receivedAt ? formatTime(receivedAt.toISOString()) : "--"}
            </p>
          </div>
        </section>

        {error && (
          <div className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
            {error}
          </div>
        )}

        <QuoteTable rows={snapshot?.rows ?? []} />

        <footer className="mt-5 space-y-3 text-xs text-[var(--muted)]">
          {snapshot && (
            <div className="space-y-1">
              {snapshot.notes.map((note) => (
                <p key={note}>{note}</p>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-3 md:flex-row md:items-center md:justify-between">
            <span>
              Solana source:{" "}
              {snapshot?.sources.solana ?? "Jupiter quote USDC/XMR on Solana"}
            </span>
            <span>
              KuCoin source:{" "}
              {snapshot?.sources.kucoin ?? "KuCoin public XMR-USDT order book"}
            </span>
          </div>
        </footer>
      </main>
    </BridgeShell>
  );
}

function StatusPill({
  isRefreshing,
  hasSnapshot,
}: {
  isRefreshing: boolean;
  hasSnapshot: boolean;
}) {
  return (
    <div className="flex h-10 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 text-sm text-[var(--muted)]">
      <span
        className={`h-2 w-2 rounded-full ${isRefreshing ? "animate-pulse bg-yellow-400" : hasSnapshot ? "bg-green-400" : "bg-[var(--muted)]"}`}
      />
      <span>
        {isRefreshing ? "Refreshing" : hasSnapshot ? "Live" : "Connecting"}
      </span>
    </div>
  );
}

function QuoteTable({ rows }: { rows: QuoteRow[] }) {
  const tableRows: Array<QuoteRow | { sizeUsd: number }> = rows.length
    ? rows
    : TRADE_SIZES_USD.map((sizeUsd) => ({ sizeUsd }));

  return (
    <section className="xmr-card overflow-hidden">
      <div
        className="overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#ff6600]"
        role="region"
        aria-label="Buy and sell XMR quotes; scroll horizontally to compare venues"
        tabIndex={0}
      >
        <table className="w-full min-w-[1280px] text-left text-sm tabular-nums">
          <caption className="sr-only">
            Buy and sell XMR quotes by USD trade size
          </caption>
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th
                rowSpan={2}
                scope="col"
                className="sticky left-0 z-10 w-28 border-r border-[var(--border)] bg-[var(--card)] px-4 py-4 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]"
              >
                USD Size
              </th>
              <th colSpan={3} scope="colgroup" className="px-4 py-4">
                <h2 className="sticky left-32 w-fit text-xl font-bold text-white">
                  Buy XMR
                </h2>
                <p className="mt-1 text-xs font-normal text-[var(--muted)]">
                  Spend USD notional, receive XMR
                </p>
              </th>
              <th
                colSpan={4}
                scope="colgroup"
                className="border-l border-[var(--border)] px-4 py-4"
              >
                <h2 className="sticky left-32 w-fit text-xl font-bold text-white">
                  Sell XMR
                </h2>
                <p className="mt-1 text-xs font-normal text-[var(--muted)]">
                  Sell approximate USD notional, receive USD
                </p>
              </th>
            </tr>
            <tr className="border-b border-[var(--border)] bg-black/20 text-xs uppercase tracking-wide text-[var(--muted)]">
              <th scope="col" className="px-4 py-3 font-semibold">
                Solana
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                KuCoin
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Edge
              </th>
              <th
                scope="col"
                className="border-l border-[var(--border)] px-4 py-3 font-semibold"
              >
                XMR In
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Solana
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                KuCoin
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Edge
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {tableRows.map((row) =>
              "buy" in row ? (
                <tr
                  key={row.sizeUsd}
                  className="group transition-colors hover:bg-white/[0.02]"
                >
                  <th
                    scope="row"
                    className="sticky left-0 z-10 whitespace-nowrap border-r border-[var(--border)] bg-[var(--card)] px-4 py-4 align-top text-base font-semibold text-white group-hover:bg-[var(--card-hover)]"
                  >
                    {formatUsd(row.sizeUsd, 0, 0)}
                  </th>
                  <td className="px-4 py-3 align-top">
                    <VenueCell quote={row.buy.solana} side="buy" />
                  </td>
                  <td className="px-4 py-3 align-top">
                    <VenueCell quote={row.buy.kucoin} side="buy" />
                  </td>
                  <td className="px-4 py-4 align-top">
                    <EdgeBadge
                      edgeBps={row.buy.solanaEdgeBps}
                      betterVenue={row.buy.betterVenue}
                    />
                  </td>
                  <td className="whitespace-nowrap border-l border-[var(--border)] px-4 py-4 align-top font-mono text-[var(--foreground)]">
                    {formatXmr(row.sellXmrAmount)}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <VenueCell quote={row.sell.solana} side="sell" />
                  </td>
                  <td className="px-4 py-3 align-top">
                    <VenueCell quote={row.sell.kucoin} side="sell" />
                  </td>
                  <td className="px-4 py-4 align-top">
                    <EdgeBadge
                      edgeBps={row.sell.solanaEdgeBps}
                      betterVenue={row.sell.betterVenue}
                    />
                  </td>
                </tr>
              ) : (
                <tr key={row.sizeUsd}>
                  <th
                    scope="row"
                    className="sticky left-0 z-10 whitespace-nowrap border-r border-[var(--border)] bg-[var(--card)] px-4 py-4 align-top text-base font-semibold text-white"
                  >
                    {formatUsd(row.sizeUsd, 0, 0)}
                  </th>
                  <td colSpan={7} className="px-4 py-4 text-[var(--muted)]">
                    Loading quotes...
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function VenueCell({
  quote,
  side,
}: {
  quote: VenueQuote;
  side: "buy" | "sell";
}) {
  if (!quote.ok) {
    return (
      <div>
        <p className="font-medium text-red-300">Unavailable</p>
        <p
          className="mt-1 max-w-[13rem] truncate text-xs text-[var(--muted)]"
          title={quote.error}
        >
          {quote.error ?? "No quote"}
        </p>
      </div>
    );
  }

  const primary =
    side === "buy"
      ? `${formatXmr(quote.xmrAmount)} XMR`
      : formatUsd(quote.usdAmount, 4, 4);

  return (
    <div>
      <p className="whitespace-nowrap font-mono text-base font-semibold text-white">
        {primary}
      </p>
      <p className="mt-1 text-xs text-[var(--muted)]">
        {formatUsd(quote.effectivePrice, 2, 2)} / XMR
      </p>
      {quote.venue === "solana" && (
        <p className="mt-1 text-xs text-[var(--muted)]">
          {quote.routeCount
            ? `${quote.routeCount} route${quote.routeCount === 1 ? "" : "s"}`
            : "Jupiter"}
          {quote.priceImpactPct !== null && quote.priceImpactPct !== undefined
            ? `, ${quote.priceImpactPct.toFixed(3)}% impact`
            : ""}
        </p>
      )}
    </div>
  );
}

function EdgeBadge({
  edgeBps,
  betterVenue,
}: {
  edgeBps: number | null;
  betterVenue: "solana" | "kucoin" | null;
}) {
  if (edgeBps === null || !betterVenue) {
    return (
      <span className="rounded-md bg-white/5 px-2.5 py-1 text-xs font-semibold text-[var(--muted)]">
        --
      </span>
    );
  }

  const isSolana = betterVenue === "solana";
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-semibold ${isSolana ? "bg-green-500/10 text-green-300" : "bg-blue-500/10 text-blue-300"}`}
    >
      {isSolana ? "Solana" : "KuCoin"} +
      {Math.abs(edgeBps).toLocaleString("en-US", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      })}{" "}
      bps
    </span>
  );
}

function formatXmr(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount))
    return "--";
  return amount.toLocaleString("en-US", {
    minimumFractionDigits: 6,
    maximumFractionDigits: 8,
  });
}

function formatUsd(
  amount: number | null | undefined,
  minimumFractionDigits: number,
  maximumFractionDigits: number,
): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount))
    return "--";
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits,
    maximumFractionDigits,
  });
}

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
