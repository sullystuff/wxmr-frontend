import { PUBLIC_PATHS } from "./site-metadata";

export const ANALYTICS_OPT_OUT_KEY = "wxmr:anonymous-analytics:opt-out";
export const ANALYTICS_PREFERENCE_EVENT = "wxmr:analytics-preference";
export const REFERRERS = [
  "Direct / unknown", "Internal", "Google", "Bing", "DuckDuckGo",
  "Brave Search", "Yahoo", "GitHub", "Reddit", "X", "Other website",
] as const;

export type Referrer = typeof REFERRERS[number];
export type PageView = { path: string; entry: boolean; source: Referrer };

// Fixed categories only. Do not transmit a referrer URL, hostname, or query.
export function referrerCategory(raw: string): Referrer {
  if (!raw) return "Direct / unknown";
  try {
    const host = new URL(raw).hostname.toLowerCase();
    const matches = (domain: string) => host === domain || host.endsWith(`.${domain}`);
    if (matches("wxmr.io") || host.endsWith(".onion")) return "Internal";
    if (/^(?:www\.)?google\.(?:com|[a-z]{2}|com\.[a-z]{2}|co\.[a-z]{2})$/.test(host)) return "Google";
    if (matches("bing.com")) return "Bing";
    if (matches("duckduckgo.com")) return "DuckDuckGo";
    if (host === "search.brave.com") return "Brave Search";
    if (matches("yahoo.com")) return "Yahoo";
    if (matches("github.com")) return "GitHub";
    if (matches("reddit.com")) return "Reddit";
    if (matches("x.com") || matches("twitter.com") || host === "t.co") return "X";
    return "Other website";
  } catch {
    return "Direct / unknown";
  }
}

export function parsePageView(value: unknown): PageView | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).sort().join(",") !== "entry,path,source") return null;
  if (typeof body.path !== "string" || !PUBLIC_PATHS.some((path) => path === body.path)) return null;
  if (typeof body.entry !== "boolean" || !REFERRERS.some((source) => source === body.source)) return null;
  return { path: body.path, entry: body.entry, source: body.source as Referrer };
}

export function deviceCategory(userAgent: string) {
  if (/ipad|tablet|android(?!.*mobile)/i.test(userAgent)) return "Tablet";
  if (/mobi|iphone|ipod/i.test(userAgent)) return "Mobile";
  if (/windows|macintosh|linux|cros/i.test(userAgent)) return "Desktop";
  return "Other";
}

export function browserCategory(userAgent: string) {
  if (/edg(?:e|a|ios)?\//i.test(userAgent)) return "Edge";
  if (/firefox|fxios/i.test(userAgent)) return "Firefox";
  if (/chrome|crios|chromium/i.test(userAgent)) return "Chrome / Chromium";
  if (/safari/i.test(userAgent)) return "Safari";
  return "Other";
}

export function isAutomated(userAgent: string) {
  return !userAgent || /bot|spider|crawler|headless|lighthouse|pagespeed|preview|curl|wget|python|httpclient/i.test(userAgent);
}

export type CountRow = { label: string; count: number };

// Regions and device/referral categories are never exposed in tiny cohorts.
export function suppressSmallCounts(rows: CountRow[]): CountRow[] {
  const visible = rows.filter((row) => row.count >= 5);
  const small = rows.filter((row) => row.count < 5).reduce((sum, row) => sum + row.count, 0);
  if (small) visible.push({ label: "Other / fewer than 5", count: small });
  return visible.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
