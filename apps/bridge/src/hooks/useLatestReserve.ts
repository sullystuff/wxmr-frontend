"use client";
import { useEffect, useState } from "react";
import { fetchReserveAccount } from "@/lib/audits";
import { useHeartbeat } from "./useHeartbeat";
export function useLatestReserve() {
  const { heartbeat, loading: heartbeatLoading } = useHeartbeat();
  const [reserve, setReserve] = useState<Awaited<ReturnType<typeof fetchReserveAccount>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const id = heartbeat?.latestReserve?.id, account = heartbeat?.latestReserve?.account;
  useEffect(() => {
    if (id === undefined || !account) return;
    let cancelled = false, retry: ReturnType<typeof setTimeout>;
    async function load() {
      setLoading(true);
      try {
        const next = await fetchReserveAccount(id!, account!);
        if (!cancelled) { setReserve(next); setError(false); }
      } catch {
        if (!cancelled) { setError(true); retry = setTimeout(load, 30_000); }
      } finally { if (!cancelled) setLoading(false); }
    }
    void load();
    return () => { cancelled = true; clearTimeout(retry); };
  }, [id, account]);
  return { reserve, loading: heartbeatLoading || loading, error };
}
