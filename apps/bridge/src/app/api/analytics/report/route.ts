import {
  ANALYTICS_HEADERS, analyticsReport, reportAuthorized,
} from "@/lib/analytics-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  if (!reportAuthorized(request.headers.get("authorization"))) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: ANALYTICS_HEADERS });
  }
  const days = Number(new URL(request.url).searchParams.get("days") ?? 30);
  if (![7, 30, 90].includes(days)) {
    return Response.json({ error: "Choose 7, 30, or 90 days" }, { status: 400, headers: ANALYTICS_HEADERS });
  }
  try {
    return Response.json(analyticsReport(days), { headers: ANALYTICS_HEADERS });
  } catch {
    return Response.json({ error: "Traffic reporting is not configured" }, { status: 503, headers: ANALYTICS_HEADERS });
  }
}
