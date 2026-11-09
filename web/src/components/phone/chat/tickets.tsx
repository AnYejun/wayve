// Attendee tickets: a request/problem the attendee sent, shown as a live card under their message and as a strip of
// open requests at the top of the conversation. Status follows the ops-board issue (polled; attendees have no SSE).
import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Check, CircleDot, Hand, TriangleAlert } from 'lucide-react';
import type { AttendeeTicket, PublicZone } from '@shared/contracts';
import { api } from '@/lib/api';
import { ago } from '@/lib/time';
import { cn } from '@/lib/utils';
import { spring } from '@/design/motion';
import { HAIR } from '../common';

const POLL_MS = 10_000;
type Step = 0 | 1 | 2;
export const stepOf = (t: AttendeeTicket): Step => (t.status === 'done' ? 2 : t.status === 'open' ? 0 : 1);
const STEPS = ['Received', 'On it', 'Done'] as const;

/** Tickets keyed by the attendee message they came from; polls while any is still open and the page is visible. */
export function useTickets(eventId: string, initial: AttendeeTicket[] = []) {
  const [byMsg, setByMsg] = useState<Record<string, AttendeeTicket>>(() => Object.fromEntries(initial.map((t) => [t.messageId, t])));
  const ref = useRef(byMsg);
  ref.current = byMsg;
  const upsert = useCallback((t: AttendeeTicket | null | undefined) => { if (t) setByMsg((m) => ({ ...m, [t.messageId]: t })); }, []);
  const refresh = useCallback(() => {
    api<{ tickets: AttendeeTicket[] }>('/api/chat/tickets', { query: { eventId } })
      .then((r) => setByMsg((m) => ({ ...m, ...Object.fromEntries(r.tickets.map((t) => [t.messageId, t])) })))
      .catch(() => { /* keep last known */ });
  }, [eventId]);
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      if (Object.values(ref.current).some((t) => t.status !== 'done')) refresh();
    };
    const t = setInterval(tick, POLL_MS);
    const onVis = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [refresh]);
  return { byMsg, upsert };
}

/** Live card under the attendee's bubble: what the team got + Received → On it → Done. */
export function TicketCard({ t, zones, now }: { t: AttendeeTicket; zones: PublicZone[]; now: number }) {
  const reduced = useReducedMotion();
  const step = stepOf(t);
  const zone = t.zoneId ? zones.find((z) => z.id === t.zoneId)?.name ?? null : null;
  const Icon = t.kind === 'request' ? Hand : TriangleAlert;
  const done = step === 2;
  return (
    <motion.div layout initial={reduced ? false : { opacity: 0, y: 6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={spring.smooth}
      className={cn('w-[min(320px,86%)] rounded-[18px] bg-white p-3.5', HAIR)} role="status" aria-live="polite"
      aria-label={`${t.kind === 'request' ? 'Request' : 'Report'} ${t.issueKey}: ${STEPS[step]}`}>
      <div className="flex items-start gap-2">
        <span className={cn('mt-px grid size-7 shrink-0 place-items-center rounded-full', done ? 'bg-[#e9f4ec] text-[#376c45]' : 'bg-[rgb(23_21_15/.05)] text-fg')}>
          {done ? <Check className="size-4" strokeWidth={2.5} /> : <Icon className="size-[15px]" strokeWidth={2} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-[14px] leading-5 font-semibold text-fg">{t.title}</p>
          <p className="truncate text-[12px] leading-4 text-fg-3">
            {t.kind === 'request' ? 'Request' : 'Report'}{zone ? ` · ${zone}` : ''} · {done ? `done ${ago(t.updatedAt, now)}` : `sent ${ago(t.createdAt, now)}`}
          </p>
        </div>
      </div>
      <ol className="mt-3 grid grid-cols-3 gap-1.5" aria-hidden="true">
        {STEPS.map((label, i) => {
          const on = i <= step;
          const current = i === step && !done;
          return (
            <li key={label} className="min-w-0">
              <div className="relative h-[5px] overflow-hidden rounded-full bg-[rgb(23_21_15/.08)]">
                <motion.div className="absolute inset-y-0 left-0 rounded-full" style={{ background: done ? '#58a069' : '#17150f' }}
                  initial={false} animate={{ width: on ? '100%' : '0%' }} transition={reduced ? { duration: 0 } : { duration: 0.5, ease: [0.16, 1, 0.3, 1] }} />
                {current && !reduced ? <span className="absolute inset-0 animate-pulse rounded-full bg-white/40" /> : null}
              </div>
              <span className={cn('mt-1.5 block truncate text-[11px] font-medium', on ? 'text-fg' : 'text-fg-3')}>{label}</span>
            </li>
          );
        })}
      </ol>
      {t.joinedExisting && !done ? (
        <p className="mt-2 text-[12px] leading-4 text-fg-2">Someone asked for this too — it's already on the team's list.</p>
      ) : null}
    </motion.div>
  );
}

/** Compact strip of the attendee's open tickets at the top of the conversation (tap to jump to the message). */
export function TicketStrip({ tickets, onJump }: { tickets: AttendeeTicket[]; onJump: (messageId: string) => void }) {
  const open = tickets.filter((t) => t.status !== 'done');
  if (!open.length) return null;
  return (
    <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Your open requests">
      <ul className="flex w-max gap-2">
        {open.map((t) => (
          <li key={t.messageId}>
            <button type="button" onClick={() => onJump(t.messageId)}
              className={cn('flex h-9 max-w-[260px] items-center gap-2 rounded-full bg-white pr-3 pl-2.5 text-[13px] font-medium text-fg active:scale-[.97] transition-transform', HAIR)}>
              <CircleDot className={cn('size-3.5 shrink-0', stepOf(t) === 1 ? 'text-[#c9a13f]' : 'text-fg-3')} strokeWidth={2.5} />
              <span className="truncate">{t.title}</span>
              <span className="shrink-0 text-fg-3">· {STEPS[stepOf(t)]}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
