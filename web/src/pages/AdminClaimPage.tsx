// "/a/:eventId?k=KEY" — organizer share link: claim admin, then open the ops board.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Loader2 } from 'lucide-react';
import { API } from '@/lib/api';
import { Logo } from '@/design/Logo';

export default function AdminClaimPage() {
  const { eventId } = useParams();
  const [p] = useSearchParams();
  const nav = useNavigate();
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const k = p.get('k');
    if (!eventId || !k) { setErr('This organizer link is incomplete.'); return; }
    API.adminClaim(eventId, k).then(() => nav(`/e/${eventId}/dashboard`, { replace: true })).catch((e) => setErr((e as Error).message || 'This organizer link is not valid.'));
  }, [eventId, p, nav]);
  return (
    <div className="grid min-h-dvh place-items-center bg-canvas p-6 text-center">
      <div>
        <Logo size={20} />
        {err ? (
          <><p className="mt-6 text-[17px] font-semibold text-fg">{err}</p><Link to="/" className="mt-3 inline-block text-[14px] underline">Go home</Link></>
        ) : <p className="mt-6 inline-flex items-center gap-2 text-[15px] text-fg-2"><Loader2 className="size-4 animate-spin" />Opening the ops board…</p>}
      </div>
    </div>
  );
}
