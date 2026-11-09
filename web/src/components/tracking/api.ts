// Zone-tracking client helpers (uses the shared `api` fetcher).
import { useEffect, useRef, useState } from 'react';
import type { Zone, ZoneSeriesBatch, ZoneType } from '@shared/contracts';
import { api } from '@/lib/api';

export const zoneSeries = (eventId: string, mins = 30) => api<ZoneSeriesBatch>(`/api/events/${eventId}/zone-series`, { query: { mins: String(mins) } });
export const setZoneType = (zoneId: string, zoneType: ZoneType) => api<{ zone: Zone }>(`/api/zones/${zoneId}`, { method: 'PATCH', body: { zoneType } });

/** Every zone's metric series; refreshes every 20 s and shortly after zones change (pass a changing `tick`). */
export function useZoneSeries(eventId: string | undefined, tick: unknown, mins = 30) {
  const [data, setData] = useState<ZoneSeriesBatch | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!eventId) return;
    let dead = false;
    const load = () => zoneSeries(eventId, mins).then((d) => { if (!dead) setData(d); }).catch(() => { /* keep last */ });
    load();
    const iv = setInterval(load, 20_000);
    return () => { dead = true; clearInterval(iv); };
  }, [eventId, mins]);
  useEffect(() => {
    if (!eventId) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { zoneSeries(eventId, mins).then(setData).catch(() => {}); }, 1500);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [eventId, mins, tick]);
  return data;
}
