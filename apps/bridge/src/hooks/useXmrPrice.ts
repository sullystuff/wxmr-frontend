"use client";
import { useEffect, useState } from "react";
type Price = { usd: number; at: number; source: string };
let cached: Price | null = null;
let pending: Promise<Price> | null = null;
async function fetchPrice(): Promise<Price> {
  if (cached && Date.now()/1000-cached.at < 300) return cached;
  if (pending) return pending;
  pending = (async () => {
    const response = await fetch("/api/xmr-price", { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error("Price unavailable");
    const price = await response.json();
    if (typeof price.usd !== "number" || !Number.isFinite(price.usd) || price.usd <= 0 ||
        typeof price.at !== "number" || Date.now()/1000-price.at > 900 || price.at > Date.now()/1000+60) throw new Error("Price unavailable");
    cached = price; return price;
  })();
  try { return await pending; } finally { pending = null; }
}
export function useXmrPrice() {
  const [price, setPrice] = useState<Price | null>(null);
  useEffect(() => {
    let cancelled = false, timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try { const next = await fetchPrice(); if (!cancelled) setPrice(next); }
      catch { if (!cancelled) setPrice(null); }
      if (!cancelled) timer = setTimeout(refresh, 60_000);
    }
    void refresh(); return () => { cancelled = true; clearTimeout(timer); };
  }, []);
  return price;
}
export function usdValue(atomic: string | bigint, price: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(atomic)/1e12*price);
}
