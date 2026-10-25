"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import type { AnalyticsReport } from "@/lib/analytics-server";
import type { CountRow } from "@/lib/analytics-policy";

function Breakdown({ title, rows, countries = false }: { title: string; rows: CountRow[]; countries?: boolean }) {
  const maximum = Math.max(1, ...rows.map((row) => row.count));
  const regions = new Intl.DisplayNames(["en"], { type: "region" });
  return (
    <section className="insights-panel">
      <h2>{title}</h2>
      {rows.length ? <ol className="insights-breakdown">
        {rows.map((row) => <li key={row.label}>
          <div><span>{countries && /^[A-Z]{2}$/.test(row.label) ? regions.of(row.label) : row.label}</span><strong>{row.count.toLocaleString()}</strong></div>
          <div className="insights-bar"><span style={{ width: `${row.count / maximum * 100}%` }} /></div>
        </li>)}
      </ol> : <p className="insights-muted">No traffic recorded in this period.</p>}
    </section>
  );
}

export default function InsightsPage() {
  const [token, setToken] = useState("");
  const [days, setDays] = useState(30);
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setReport(null);
    try {
      const response = await fetch(`/api/analytics/report?days=${days}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer",
      });
      if (!response.ok) throw new Error(response.status === 401 ? "The administrator token was not accepted." : "Traffic reporting is not configured or is unavailable.");
      setReport(await response.json());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load statistics.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="insights-main">
      <Link className="text-link" href="/">← wXMR bridge</Link>
      <div className="page-intro"><div>
        <p className="eyebrow">PRIVATE · AGGREGATE ONLY</p>
        <h1>Website <span>traffic.</span></h1>
        <p>Daily trends, popular pages, and broad audience categories.</p>
      </div></div>
      <form className="insights-form" onSubmit={load}>
        <label>Administrator token
          <input type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} required minLength={32} />
        </label>
        <label>Period
          <select value={days} onChange={(event) => setDays(Number(event.target.value))}>
            <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
          </select>
        </label>
        <button className="primary-button" disabled={busy} type="submit">{busy ? "Loading…" : "Load report"}</button>
        {report && <button className="secondary-button" type="button" onClick={() => { setToken(""); setReport(null); }}>Lock report</button>}
      </form>
      <p className="insights-muted">The token stays in this page’s memory. It is never put in a URL, cookie, or browser storage.</p>
      {error && <p role="alert">{error}</p>}
      {report && <>
        <p className="insights-muted">{report.from} through {report.to} · UTC · {report.enabled ? "Collection enabled" : "Collection disabled"} · {report.retentionDays}-day retention</p>
        <div className="insights-totals">
          <section className="insights-panel"><span>Page views</span><strong>{report.pageviews.toLocaleString()}</strong></section>
          <section className="insights-panel"><span>Visit entries</span><strong>{report.entries.toLocaleString()}</strong></section>
          <section className="insights-panel"><span>Views per entry</span><strong>{report.entries ? (report.pageviews / report.entries).toFixed(2) : "—"}</strong></section>
        </div>
        <p className="insights-muted">Entries are fresh document loads or tabs, including reloads. They are not unique visitors or timed sessions. Audience categories are independent totals; counts below five are combined. Known automation is excluded, but scripted traffic can still inflate counts.</p>
        <section className="insights-panel">
          <h2>Daily traffic</h2>
          <div className="insights-table-scroll"><table className="insights-table">
            <thead><tr><th scope="col">Date (UTC)</th><th scope="col">Page views</th><th scope="col">Entries</th></tr></thead>
            <tbody>{report.daily.map((row) => <tr key={row.day}><th scope="row">{row.day}</th><td>{row.pageviews.toLocaleString()}</td><td>{row.entries.toLocaleString()}</td></tr>)}</tbody>
          </table></div>
        </section>
        <div className="insights-grid">
          <Breakdown title="Most viewed pages" rows={report.pages} />
          <Breakdown title="Landing pages" rows={report.landingPages} />
          <Breakdown title="Countries · entries" rows={report.countries} countries />
          <Breakdown title="Referral sources · entries" rows={report.sources} />
          <Breakdown title="Devices · entries" rows={report.devices} />
          <Breakdown title="Browsers · entries" rows={report.browsers} />
        </div>
        <p className="insights-muted">Country estimates are approximate. VPNs, proxies, and Tor may show an exit country or Unknown. {report.countryLookup ? "Local country lookup configured." : "Country lookup is not configured; countries show Unknown."} <a className="text-link" href="https://db-ip.com" rel="noreferrer">IP Geolocation by DB-IP</a>.</p>
      </>}
      <p><Link className="text-link" href="/privacy">Privacy and measurement policy</Link></p>
    </main>
  );
}
