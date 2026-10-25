import {
  ANALYTICS_HEADERS, analyticsEnabled, recordPageView,
} from "@/lib/analytics-server";
import { isAutomated, parsePageView } from "@/lib/analytics-policy";
import { SITE_URL } from "@/lib/site-metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ enabled: analyticsEnabled() }, { headers: ANALYTICS_HEADERS });
}

let windowStart = 0;
let requests = 0;

async function boundedBody(request: Request) {
  if (Number(request.headers.get("content-length")) > 512) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 512) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: Request) {
  const empty = (status = 204) => new Response(null, { status, headers: ANALYTICS_HEADERS });
  if (!analyticsEnabled() || request.headers.get("dnt") === "1" || request.headers.get("sec-gpc") === "1") return empty();
  if (isAutomated((request.headers.get("user-agent") ?? "").slice(0, 1024))) return empty();
  const origins = new Set([SITE_URL, ...(process.env.WXMR_ANALYTICS_ORIGINS ?? "").split(",").filter(Boolean)]);
  if (process.env.NODE_ENV !== "production") origins.add(new URL(request.url).origin);
  if (!origins.has(request.headers.get("origin") ?? "") || request.headers.get("sec-fetch-site") === "cross-site") return empty(403);
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") return empty(415);
  // Coarse global abuse cap, with no address-based keys or fingerprinting.
  const now = Date.now();
  if (now - windowStart >= 1000) { windowStart = now; requests = 0; }
  if (++requests > 30) return empty(429);
  const view = parsePageView(await boundedBody(request));
  if (!view) return empty(400);
  try {
    recordPageView(view, request.headers);
    return empty();
  } catch {
    // Do not log the request, headers, payload, exception, or filesystem path.
    return empty(503);
  }
}
