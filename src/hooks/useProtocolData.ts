'use client';

import { useEffect, useState } from 'react';
import { fetchProtocolStats, fetchRecentActivity, type ProtocolStats, type ActivityEvent } from '@/lib/protocol';

/** Single source of protocol-wide data for the homepage — fetched once,
 *  refreshed on an interval, shared by the hero metrics, status dashboard,
 *  and the activity feed. */
export function useProtocolData() {
  const [stats, setStats] = useState<ProtocolStats | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [transfers, setTransfers] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [s, a] = await Promise.all([
        fetchProtocolStats().catch(() => null),
        fetchRecentActivity().catch(() => ({ events: [], total: 0 })),
      ]);
      if (!alive) return;
      if (s) setStats(s);
      setActivity(a.events);
      setTransfers(a.total);
      setLoading(false);
    };
    load();
    const id = setInterval(load, 30000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return { stats, activity, transfers, loading };
}
