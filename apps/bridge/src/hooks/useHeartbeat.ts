"use client";
import { useEffect, useState } from "react";
import { fetchHeartbeat, heartbeatOnline, type Heartbeat } from "@/lib/heartbeat";
export function useHeartbeat() {
  const [heartbeat, setHeartbeat] = useState<Heartbeat | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    let cancelled = false, timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const next = await fetchHeartbeat();
        if (!cancelled) { setHeartbeat(next); setError(false); }
      } catch { if (!cancelled) setError(true); }
      finally {
        if (!cancelled) { setLoading(false); timer = setTimeout(refresh, 10_000); }
      }
    }
    void refresh();
    const clock = setInterval(() => setNow(Date.now() / 1000), 5_000);
    return () => { cancelled = true; clearTimeout(timer); clearInterval(clock); };
  }, []);
  return { heartbeat, loading, error, online: heartbeat !== null && heartbeatOnline(heartbeat, now) };
}
