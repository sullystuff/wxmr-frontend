import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test, type TestContext } from "node:test";
import {
  browserCategory, deviceCategory, parsePageView, referrerCategory, suppressSmallCounts,
} from "../src/lib/analytics-policy";
import {
  analyticsEnabled, analyticsReport, countryCategory, recordPageView, reportAuthorized,
} from "../src/lib/analytics-server";
import { GET as configuration, POST } from "../src/app/api/analytics/route";
import { GET as report } from "../src/app/api/analytics/report/route";

const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36";

function environment(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "wxmr-analytics-test-"));
  const previous = { ...process.env };
  Object.assign(process.env, {
    WXMR_ANALYTICS_DB_PATH: join(directory, "traffic.analytics.sqlite"),
    WXMR_ANALYTICS_ENABLED: "1", WXMR_ANALYTICS_LOGGING_DISABLED: "1",
    WXMR_ANALYTICS_TRUST_PROXY: "0", WXMR_ANALYTICS_GEOIP_PATH: "",
    WXMR_ANALYTICS_ADMIN_TOKEN: "test-only-not-a-real-secret-token-123456789",
    WXMR_ANALYTICS_ORIGINS: "",
  });
  t.after(() => {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
    rmSync(directory, { recursive: true, force: true });
  });
  return process.env.WXMR_ANALYTICS_DB_PATH!;
}

test("only allowlisted public page paths and coarse source categories are accepted", () => {
  const valid = { path: "/docs", entry: false, source: "Internal" };
  assert.deepEqual(parsePageView(valid), valid);
  for (const path of ["/docs?wallet=secret", "/#address", "https://wxmr.io/", "/insights", "/api/analytics", "/wallet/secret"]) {
    assert.equal(parsePageView({ ...valid, path }), null);
  }
  for (const extra of ["ip", "wallet", "referrer", "visitorId", "amount"]) {
    assert.equal(parsePageView({ ...valid, [extra]: "sensitive" }), null);
  }
  assert.equal(parsePageView({ ...valid, source: "https://example.com/private?q=secret" }), null);
  assert.equal(parsePageView({ ...valid, entry: "yes" }), null);
  assert.equal(parsePageView(null), null);
  assert.equal(referrerCategory("https://www.google.co.uk/search?q=wallet-secret"), "Google");
  assert.equal(referrerCategory("https://old.reddit.com/r/Monero/?private=secret"), "Reddit");
  assert.equal(referrerCategory("https://secret.example.com/identity?q=private"), "Other website");
  assert.equal(referrerCategory("https://google.com.evil.example/"), "Other website");
  assert.equal(referrerCategory("invalid"), "Direct / unknown");
  assert.equal(deviceCategory(userAgent), "Desktop");
  assert.equal(browserCategory(userAgent), "Chrome / Chromium");
});

test("activation requires an explicit assertion that infrastructure logging is disabled", (t) => {
  environment(t);
  assert.equal(analyticsEnabled(), true);
  process.env.WXMR_ANALYTICS_LOGGING_DISABLED = "0";
  assert.equal(analyticsEnabled(), false);
  process.env.WXMR_ANALYTICS_LOGGING_DISABLED = "1";
  process.env.WXMR_ANALYTICS_ENABLED = "0";
  assert.equal(analyticsEnabled(), false);
});

test("the database retains only independent daily counts and suppresses tiny audience categories", (t) => {
  const path = environment(t);
  const headers = new Headers({ "user-agent": userAgent, "x-real-ip": "192.0.2.42", "x-forwarded-for": "visitor-secret" });
  const date = new Date("2026-10-24T12:34:56Z");
  for (let i = 0; i < 6; i++) recordPageView({ path: "/", entry: true, source: "Google" }, headers, date);
  for (let i = 0; i < 3; i++) recordPageView({ path: "/docs", entry: false, source: "Internal" }, headers, date);
  recordPageView({ path: "/wrapped-xmr", entry: true, source: "Reddit" }, headers, date);
  const result = JSON.parse(JSON.stringify(analyticsReport(7, date)));
  assert.equal(result.pageviews, 10);
  assert.equal(result.entries, 7);
  assert.equal(result.daily.length, 7);
  assert.equal(result.daily.at(-1)?.pageviews, 10);
  assert.deepEqual(result.pages, [
    { label: "/", count: 6 }, { label: "/docs", count: 3 }, { label: "/wrapped-xmr", count: 1 },
  ]);
  assert.deepEqual(result.landingPages, [{ label: "/", count: 6 }, { label: "/wrapped-xmr", count: 1 }]);
  assert.deepEqual(result.sources, [{ label: "Google", count: 6 }, { label: "Other / fewer than 5", count: 1 }]);
  const readOnly = new DatabaseSync(path, { readOnly: true });
  try {
    const schema = readOnly.prepare("PRAGMA table_info(counters)").all() as { name: string }[];
    assert.deepEqual(schema.map((column) => column.name), ["day", "metric", "label", "count"]);
    const rows = JSON.stringify(readOnly.prepare("SELECT * FROM counters").all());
    for (const sensitive of ["192.0.2.42", "visitor-secret", userAgent, "12:34:56", "wallet", "visitorId"]) {
      assert.ok(!rows.includes(sensitive));
      assert.ok(!readFileSync(path).includes(Buffer.from(sensitive)));
    }
    assert.equal(statSync(path).mode & 0o777, 0o600);
  } finally {
    readOnly.close();
  }
  assert.deepEqual(suppressSmallCounts([{ label: "US", count: 2 }, { label: "GB", count: 3 }]), [{ label: "Other / fewer than 5", count: 5 }]);
});

test("old counters expire at the 90 UTC-day retention boundary", (t) => {
  environment(t);
  const view = { path: "/", entry: true, source: "Google" as const };
  const headers = new Headers({ "user-agent": userAgent });
  const now = new Date("2026-10-24T12:00:00Z");
  const old = new Date(now); old.setUTCDate(old.getUTCDate() - 90);
  const edge = new Date(now); edge.setUTCDate(edge.getUTCDate() - 89);
  recordPageView(view, headers, old);
  recordPageView(view, headers, edge);
  recordPageView(view, headers, now);
  const result = analyticsReport(90, now);
  assert.equal(result.pageviews, 2);
  assert.equal(result.entries, 2);
  assert.equal(result.daily[0].pageviews, 1);
});

test("country lookup fails closed for untrusted headers, missing data, and onion requests", (t) => {
  environment(t);
  const headers = new Headers({ host: "wxmr.io", "x-real-ip": "8.8.8.8", "x-forwarded-for": "1.1.1.1" });
  assert.equal(countryCategory(headers), "Unknown");
  process.env.WXMR_ANALYTICS_TRUST_PROXY = "1";
  process.env.WXMR_ANALYTICS_GEOIP_PATH = "/not-present/country.mmdb";
  assert.equal(countryCategory(headers), "Unknown");
  headers.set("host", "example.onion");
  assert.equal(countryCategory(headers), "Unknown");
  headers.delete("x-real-ip");
  assert.equal(countryCategory(headers), "Unknown");
});

test("collector drops privacy opt-outs and automation, rejects arbitrary data and cross-origin writes", async (t) => {
  environment(t);
  const headers = { "content-type": "application/json", origin: "https://wxmr.io", "user-agent": userAgent };
  const payload = { path: "/", entry: true, source: "Google" };
  const request = (body = payload, extra = {}) => new Request("https://wxmr.io/api/analytics", {
    method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(body),
  });
  assert.equal((await POST(request(payload, { dnt: "1" }))).status, 204);
  assert.equal((await POST(request(payload, { "sec-gpc": "1" }))).status, 204);
  assert.equal((await POST(request(payload, { "user-agent": "Googlebot" }))).status, 204);
  assert.equal(analyticsReport(7).pageviews, 0);
  assert.equal((await POST(request(payload, { origin: "https://attacker.example" }))).status, 403);
  assert.equal((await POST(request(payload, { "sec-fetch-site": "cross-site" }))).status, 403);
  assert.equal((await POST(request(payload, { "content-type": "text/plain" }))).status, 415);
  assert.equal((await POST(request({ ...payload, path: "/?wallet=private" }))).status, 400);
  assert.equal((await POST(request({ ...payload, path: "x".repeat(900) }))).status, 400);
  assert.equal((await POST(request())).status, 204);
  assert.equal(analyticsReport(7).pageviews, 1);
  process.env.WXMR_ANALYTICS_LOGGING_DISABLED = "0";
  assert.equal((await POST(request())).status, 204);
  assert.equal(analyticsReport(7).pageviews, 1);
  assert.deepEqual(await configuration().json(), { enabled: false });
});

test("private reports require a strong bearer token and always prohibit caching", async (t) => {
  environment(t);
  assert.equal(reportAuthorized(null), false);
  assert.equal(reportAuthorized("Bearer wrong"), false);
  const denied = report(new Request("https://wxmr.io/api/analytics/report?token=not-supported"));
  assert.equal(denied.status, 401);
  assert.match(denied.headers.get("cache-control") ?? "", /no-store/);
  assert.match(denied.headers.get("x-robots-tag") ?? "", /noindex/);
  const headers = { authorization: `Bearer ${process.env.WXMR_ANALYTICS_ADMIN_TOKEN}` };
  const allowed = report(new Request("https://wxmr.io/api/analytics/report?days=7", { headers }));
  assert.equal(allowed.status, 200);
  assert.equal((await allowed.json()).days, 7);
  assert.equal(report(new Request("https://wxmr.io/api/analytics/report?days=1", { headers })).status, 400);
  process.env.WXMR_ANALYTICS_ADMIN_TOKEN = "weak";
  assert.equal(reportAuthorized("Bearer weak"), false);
});
