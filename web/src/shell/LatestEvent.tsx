// /ops and /dashboard without an id → the signed-in organizer's most recent event, else home.
import { useEffect, useState } from 'react';
import { Navigate } from 'react-router';
import { API } from '@/lib/api';

export default function LatestEvent() {
  const [to, setTo] = useState<string | null>(null);
  useEffect(() => {
    API.authMe()
      .then((a) => { const e = a.events.find((x) => x.role === 'admin') ?? a.events[0]; setTo(e ? (e.role === 'admin' ? `/e/${e.event.id}/dashboard` : '/staff') : a.user ? '/setup' : '/login?next=/ops'); })
      .catch(() => setTo('/'));
  }, []);
  return to ? <Navigate to={to} replace /> : <div className="min-h-dvh bg-canvas" aria-busy="true" />;
}
