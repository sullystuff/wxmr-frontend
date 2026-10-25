// Server routes only. No raw event, address, user agent, or identifier is stored.
import { createHash, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync } from "node:fs";
import { isIP } from "node:net";
import { dirname, isAbsolute } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Reader, type CountryResponse } from "mmdb-lib";
import {
  browserCategory, deviceCategory, suppressSmallCounts,
  type CountRow, type PageView,
} from "./analytics-policy";

export const RETENTION_DAYS = 90;
export const ANALYTICS_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
};

export function analyticsEnabled() {
  // Activation is explicit, after the operator has disabled request/error logs
  // that can contain addresses, URLs, referrers, or request bodies at every edge.
  const path = process.env.WXMR_ANALYTICS_DB_PATH;
  return process.env.WXMR_ANALYTICS_ENABLED === "1" &&
    process.env.WXMR_ANALYTICS_LOGGING_DISABLED === "1" &&
    Boolean(path && isAbsolute(path));
}

let database: DatabaseSync | undefined;
let databasePath: string | undefined;
let lastPrunedDay: string | undefined;

function openDatabase() {
  const path = process.env.WXMR_ANALYTICS_DB_PATH;
  if (!path || !isAbsolute(path)) throw new Error("Analytics requires an absolute private database path");
  if (database && databasePath === path) return database;
  database?.close();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  database = new DatabaseSync(path);
  databasePath = path;
  lastPrunedDay = undefined;
  chmodSync(path, 0o600);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA secure_delete = ON;
    PRAGMA busy_timeout = 1000;
    CREATE TABLE IF NOT EXISTS counters (
      day TEXT NOT NULL,
      metric TEXT NOT NULL CHECK (metric IN ('total', 'page', 'landing', 'country', 'source', 'device', 'browser')),
      label TEXT NOT NULL,
      count INTEGER NOT NULL CHECK (count >= 0),
      PRIMARY KEY (day, metric, label)
    ) WITHOUT ROWID;
  `);
  return database;
}

let geoReader: Reader<CountryResponse> | undefined;
let geoPath: string | undefined;

export function countryCategory(headers: Headers) {
  // X-Real-IP must be overwritten by our loopback-only reverse proxy. Never use
  // the first X-Forwarded-For value, which a visitor can forge.
  if (process.env.WXMR_ANALYTICS_TRUST_PROXY !== "1") return "Unknown";
  const host = headers.get("host")?.split(":")[0] ?? "";
  if (host.endsWith(".onion")) return "Unknown";
  const address = headers.get("x-real-ip") ?? "";
  if (!isIP(address)) return "Unknown";
  const path = process.env.WXMR_ANALYTICS_GEOIP_PATH;
  if (!path || !isAbsolute(path)) return "Unknown";
  try {
    if (!geoReader || geoPath !== path) {
      geoReader = new Reader<CountryResponse>(readFileSync(path));
      geoPath = path;
    }
    // The address is used only for this local lookup: no IP hash, logs, address
    // cache, network call, city, coordinates, or persisted raw result.
    const code = geoReader.get(address)?.country?.iso_code;
    return code && /^[A-Z]{2}$/.test(code) && code !== "ZZ" ? code : "Unknown";
  } catch {
    return "Unknown";
  }
}

function prune(db: DatabaseSync, now: Date) {
  const day = now.toISOString().slice(0, 10);
  if (lastPrunedDay === day) return;
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - (RETENTION_DAYS - 1));
  db.prepare("DELETE FROM counters WHERE day < ?").run(cutoff.toISOString().slice(0, 10));
  lastPrunedDay = day;
}

export function recordPageView(view: PageView, headers: Headers, now = new Date()) {
  const db = openDatabase();
  prune(db, now);
  const day = now.toISOString().slice(0, 10);
  const counters: [string, string][] = [["total", "pageviews"], ["page", view.path]];
  if (view.entry) {
    const userAgent = (headers.get("user-agent") ?? "").slice(0, 1024);
    counters.push(
      ["total", "entries"], ["landing", view.path],
      ["country", countryCategory(headers)], ["source", view.source],
      ["device", deviceCategory(userAgent)], ["browser", browserCategory(userAgent)],
    );
  }
  const increment = db.prepare(`INSERT INTO counters (day, metric, label, count) VALUES (?, ?, ?, 1)
    ON CONFLICT (day, metric, label) DO UPDATE SET count = count + 1`);
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const [metric, label] of counters) increment.run(day, metric, label);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function reportAuthorized(header: string | null) {
  const expected = process.env.WXMR_ANALYTICS_ADMIN_TOKEN;
  if (!expected || expected.length < 32 || !header?.startsWith("Bearer ") || header.length > 512) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(header.slice(7)), digest(expected));
}

export function analyticsReport(days: number, now = new Date()) {
  const db = openDatabase();
  prune(db, now);
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - days + 1);
  const from = start.toISOString().slice(0, 10);
  const to = now.toISOString().slice(0, 10);
  const breakdown = (metric: string, suppress = true) => {
    const rows = db.prepare(`SELECT label, SUM(count) AS count FROM counters
      WHERE day BETWEEN ? AND ? AND metric = ? GROUP BY label ORDER BY count DESC, label`)
      .all(from, to, metric) as CountRow[];
    return suppress ? suppressSmallCounts(rows) : rows;
  };
  const totals = breakdown("total", false);
  const history = db.prepare(`SELECT day, label, count FROM counters
    WHERE day BETWEEN ? AND ? AND metric = 'total' ORDER BY day`)
    .all(from, to) as { day: string; label: string; count: number }[];
  return {
    from, to, days, enabled: analyticsEnabled(), retentionDays: RETENTION_DAYS,
    pageviews: totals.find((row) => row.label === "pageviews")?.count ?? 0,
    entries: totals.find((row) => row.label === "entries")?.count ?? 0,
    daily: Array.from({ length: days }, (_, index) => {
      const date = new Date(`${from}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + index);
      const day = date.toISOString().slice(0, 10);
      return { day,
        pageviews: history.find((row) => row.day === day && row.label === "pageviews")?.count ?? 0,
        entries: history.find((row) => row.day === day && row.label === "entries")?.count ?? 0 };
    }),
    pages: breakdown("page", false), landingPages: breakdown("landing", false),
    countries: breakdown("country"), sources: breakdown("source"),
    devices: breakdown("device"), browsers: breakdown("browser"),
    countryLookup: Boolean(process.env.WXMR_ANALYTICS_GEOIP_PATH) && process.env.WXMR_ANALYTICS_TRUST_PROXY === "1",
  };
}

export type AnalyticsReport = ReturnType<typeof analyticsReport>;
