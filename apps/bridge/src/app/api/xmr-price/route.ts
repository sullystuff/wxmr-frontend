export async function GET() {
  try {
    const response = await fetch("https://coins.llama.fi/prices/current/coingecko:monero", {
      next: { revalidate: 300 }, signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error("Price lookup failed");
    const coin = (await response.json()).coins?.["coingecko:monero"];
    const now = Date.now() / 1000;
    if (!coin || typeof coin.price !== "number" || !Number.isFinite(coin.price) || coin.price <= 0 ||
        typeof coin.timestamp !== "number" || coin.timestamp > now + 60 || now - coin.timestamp > 900 || typeof coin.confidence !== "number" || coin.confidence < 0.9) throw new Error("Price unavailable");
    return Response.json({ usd: coin.price, at: coin.timestamp, source: "DefiLlama / CoinGecko" }, {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=60" },
    });
  } catch {
    return Response.json({ error: "XMR price unavailable" }, { status: 503 });
  }
}
