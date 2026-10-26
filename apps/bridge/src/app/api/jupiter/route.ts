import { jupiterSwapService, SwapRequestError } from "@/lib/jupiter-swap-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

function errorResponse(error: unknown) {
  return Response.json({ error: error instanceof SwapRequestError ? error.message : "Jupiter is temporarily unavailable. Please try again." },
    { status: error instanceof SwapRequestError ? error.status : 502, headers });
}

export async function GET(request: Request) {
  try { return Response.json(await jupiterSwapService.quote(new URL(request.url).searchParams), { headers }); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    const host = request.headers.get("host") ?? new URL(request.url).host;
    if ((origin && new URL(origin).host !== host) || request.headers.get("sec-fetch-site") === "cross-site") {
      throw new SwapRequestError("Cross-site requests are not allowed.", 403);
    }
    const body = await request.text();
    if (body.length > 500) throw new SwapRequestError("Invalid swap request.");
    let data;
    try { data = JSON.parse(body); } catch { throw new SwapRequestError("Invalid swap request."); }
    if (typeof data?.quoteId !== "string" || typeof data?.wallet !== "string") throw new SwapRequestError("Invalid swap request.");
    return Response.json(await jupiterSwapService.build(data.quoteId, data.wallet), { headers });
  } catch (error) { return errorResponse(error); }
}
