// Account menu (top bars) + event switcher (ops sidebar). Both read API.authMe().
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Check, ChevronsUpDown, LogIn, LogOut, Plus, UserPlus } from 'lucide-react';
import { JoinByCodeDialog } from '@/components/invite/JoinByCode';
import type { AuthState, MyEvent } from '@shared/contracts';
import { API } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Monogram } from "@/components/ops/Person";
import { cn } from '@/lib/utils';

let cache: AuthState | null = null;
export function useAuth() {
  const [auth, setAuth] = useState<AuthState | null>(cache);
  useEffect(() => { API.authMe().then((a) => { cache = a; setAuth(a); }).catch(() => setAuth({ user: null, events: [] })); }, []);
  return auth;
}

export function AccountMenu() {
  const auth = useAuth();
  const nav = useNavigate();
  if (!auth) return <span className="block size-8" />;
  if (!auth.user) return <Button asChild size="sm" shape="pill"><Link to={`/login?next=${encodeURIComponent(location.pathname)}`}>Sign in</Link></Button>;
  const out = async () => { await API.logout().catch(() => null); cache = null; nav('/login'); };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="flex items-center gap-2 rounded-full py-1 pr-2.5 pl-1 text-[13px] font-medium text-fg hover:bg-[rgb(23_21_15/.05)]">
          <Monogram name={auth.user.displayName} size={26} ink />{auth.user.displayName}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-[12px] font-normal text-fg-2">Signed in as <span className="font-semibold text-fg">@{auth.user.username}</span></DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => nav('/')}>Your events</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => nav('/setup')}><Plus />New event</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void out()}><LogOut />Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export const statusPill = (s: MyEvent['status']) => (
  <span className={cn('inline-flex h-6 items-center gap-1.5 rounded-full px-2 text-[12px] font-semibold',
    s === 'live' ? 'bg-[#eaf5ec] text-[#376c45]' : s === 'upcoming' ? 'bg-[#f5f4f2] text-fg-2' : 'bg-[#f5f4f2] text-fg-3')}>
    <span className="size-1.5 rounded-full" style={{ background: s === 'live' ? '#58a069' : '#b9b8b4' }} />
    {s === 'live' ? 'Live' : s === 'upcoming' ? 'Upcoming' : 'Ended'}
  </span>
);

export function EventSwitcher({ eventId, name, code }: { eventId: string; name: string; code: string }) {
  const auth = useAuth();
  const nav = useNavigate();
  const events = auth?.events ?? [];
  const [joinOpen, setJoinOpen] = useState(false);
  const isAdmin = events.some((e) => e.event.id === eventId && e.role === 'admin');
  return (
    <>
    <JoinByCodeDialog open={joinOpen} onOpenChange={setJoinOpen} />
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="flex w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left hover:bg-[rgb(23_21_15/.05)]">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold text-fg">{name}</span>
            <span className="block font-mono text-[11px] tracking-[.14em] text-fg-3">{code}</span>
          </span>
          <ChevronsUpDown className="size-4 text-fg-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-[12px] font-normal text-fg-2">Your events</DropdownMenuLabel>
        {events.length ? events.map((e) => (
          <DropdownMenuItem key={e.event.id} onSelect={() => nav(`/e/${e.event.id}/dashboard`)}>
            <span className="min-w-0 flex-1 truncate">{e.event.name}</span>
            {e.event.id === eventId ? <Check className="size-4" /> : statusPill(e.status)}
          </DropdownMenuItem>
        )) : <DropdownMenuItem disabled>No other events</DropdownMenuItem>}
        <DropdownMenuSeparator />
        {isAdmin ? <DropdownMenuItem onSelect={() => nav(`/e/${eventId}/settings?tab=people`)}><UserPlus />Invite people</DropdownMenuItem> : null}
        <DropdownMenuItem onSelect={() => setJoinOpen(true)}><LogIn />Join another event</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => nav('/setup')}><Plus />New event</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    </>
  );
}
