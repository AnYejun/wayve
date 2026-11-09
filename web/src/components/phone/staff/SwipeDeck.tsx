// New work, decided in one swipe: every open issue assigned to me (plus dispatch nudges that name a place) is a card in a
// full-screen stack — "Go to Entrance · WV-12 Long queue", the first step, the evidence, a mini map. Swipe right (or ✓, or →)
// to accept: In progress + my location moves there, instantly. Swipe left (✕, ←) to decline: it goes back to dispatch.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { AnimatePresence, animate, motion, useMotionValue, useTransform, type MotionValue, type PanInfo } from 'motion/react';
import { toast } from 'sonner';
import { Check, MapPin, Quote, X } from 'lucide-react';
import type { Issue, Me, Notify, Priority, Snapshot } from '@shared/contracts';
import { API } from '@/lib/api';
import { serverNow, type useLive } from '@/lib/live';
import { ago } from '@/lib/time';
import { cn } from '@/lib/utils';
import { spring } from '@/design/motion';
import { IssueKey, PriorityBadge } from '@/components/ops-bits';
import { InlineMapCard } from '@/components/chat/parts';
import { haptic } from './shell';

type Apply = ReturnType<typeof useLive>['apply'];
export type DeckItem = { issue: Issue; notify: Notify | null };

const ACTED_KEY = 'wayve:deck-acted';
const RANK: Record<Priority, number> = { p0: 0, p1: 1, p2: 2, p3: 3 } as Record<Priority, number>;
const loadActed = (): Record<string, number> => { try { return JSON.parse(sessionStorage.getItem(ACTED_KEY) ?? '{}') as Record<string, number>; } catch { return {}; } };
const saveActed = (m: Record<string, number>) => { try { sessionStorage.setItem(ACTED_KEY, JSON.stringify(m)); } catch { /* storage off */ } };

/** A short, soft two-note chime (no audio files). Silently does nothing where audio is blocked. */
function chime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const t0 = ctx.currentTime;
    [880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + i * 0.14);
      g.gain.exponentialRampToValueAtTime(0.12, t0 + i * 0.14 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.14 + 0.32);
      o.connect(g).connect(ctx.destination);
      o.start(t0 + i * 0.14); o.stop(t0 + i * 0.14 + 0.34);
    });
    setTimeout(() => { void ctx.close().catch(() => {}); }, 900);
  } catch { /* audio unavailable */ }
}

/** Deck state, lifted so the header can show "2 waiting" after "Later". */
export function useDeck(snap: Snapshot, me: Me, notifies: Notify[], apply: Apply) {
  const acted = useRef<Record<string, number>>(loadActed());
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [snoozed, setSnoozed] = useState<Set<string>>(new Set());

  const items = useMemo<DeckItem[]>(() => {
    const isFresh = (i: Issue) => i.status === 'open' && !(acted.current[i.id] && i.updatedAt <= acted.current[i.id]);
    const byIssue = new Map<string, DeckItem>();
    for (const i of snap.issues) if (i.assigneeId === me.participantId && isFresh(i)) byIssue.set(i.id, { issue: i, notify: null });
    for (const n of notifies) {
      if (n.participantId !== me.participantId || !n.issueId || n.messageId) continue;
      if (n.kind !== 'assigned' && !n.zoneName) continue;
      const i = snap.issues.find((x) => x.id === n.issueId);
      // a nudge I already answered stays answered until a newer nudge for it arrives
      if (!i || i.status !== 'open' || (acted.current[i.id] && n.at <= acted.current[i.id]) || (i.assigneeId && i.assigneeId !== me.participantId)) continue;
      if (i.assigneeId === me.participantId && !isFresh(i)) continue;
      const cur = byIssue.get(i.id);
      if (!cur || !cur.notify) byIssue.set(i.id, { issue: i, notify: n });
    }
    return [...byIssue.values()].sort((a, b) => (RANK[a.issue.priority] ?? 9) - (RANK[b.issue.priority] ?? 9) || a.issue.createdAt - b.issue.createdAt);
  }, [snap.issues, notifies, me.participantId]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = items.some((it) => !snoozed.has(it.issue.id));

  // A new card arrived → chime + buzz once.
  const known = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = items.map((it) => it.issue.id);
    if (!known.current) { known.current = new Set(ids); if (ids.length) haptic([120, 60, 120]); return; }
    const fresh = ids.filter((id) => !known.current!.has(id));
    for (const id of fresh) known.current.add(id);
    if (fresh.length) { haptic([120, 60, 120]); chime(); }
  }, [items]);

  const mark = (id: string, on: boolean) => {
    if (on) acted.current[id] = serverNow(); else delete acted.current[id];
    saveActed(acted.current);
    bump();
  };

  const accept = useCallback(async (it: DeckItem) => {
    const { issue } = it;
    const zoneId = issue.zoneId ?? it.notify?.zoneId ?? null;
    const zoneName = (zoneId ? snap.zones.find((z) => z.id === zoneId)?.name : null) ?? it.notify?.zoneName ?? null;
    const prevDevice = me.deviceId ? snap.devices.find((d) => d.id === me.deviceId) ?? null : null;
    haptic([20, 30, 20]);
    mark(issue.id, true);
    apply({ kind: 'issue', data: { ...issue, status: 'in_progress', assigneeId: me.participantId } });
    if (prevDevice && zoneId) apply({ kind: 'device', data: { ...prevDevice, zoneId } });
    toast.success(zoneName ? `On your way to ${zoneName}` : 'Accepted', { description: `${issue.key} is In progress` });
    try {
      const r = await API.patchIssue(issue.id, { status: 'in_progress', assigneeId: me.participantId });
      apply({ kind: 'issue', data: r.issue });
      if (me.deviceId && zoneId) { const d = await API.patchDevice(me.deviceId, { zoneId }); apply({ kind: 'device', data: d.device }); }
    } catch (e) {
      apply({ kind: 'issue', data: issue });
      if (prevDevice) apply({ kind: 'device', data: prevDevice });
      mark(issue.id, false);
      toast.error('Couldn’t accept', { description: (e as Error).message });
    }
  }, [snap.zones, snap.devices, me, apply]); // eslint-disable-line react-hooks/exhaustive-deps

  const decline = useCallback(async (it: DeckItem) => {
    const { issue } = it;
    haptic(10);
    mark(issue.id, true);
    if (issue.assigneeId !== me.participantId) return; // a nudge, not an assignment: nothing to hand back
    try {
      const r = await API.declineIssue(issue.id);
      apply({ kind: 'issue', data: r.issue });
      toast('Declined', { description: `${issue.key} goes back to dispatch` });
    } catch (e) {
      mark(issue.id, false);
      toast.error('Couldn’t decline', { description: (e as Error).message });
    }
  }, [me.participantId, apply]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    items, visible,
    later: () => setSnoozed(new Set(items.map((it) => it.issue.id))),
    reopen: () => setSnoozed(new Set()),
    accept, decline,
  };
}

export type Deck = ReturnType<typeof useDeck>;

const OUT = () => (typeof window === 'undefined' ? 600 : window.innerWidth + 200);

export function SwipeDeck({ deck, snap, me }: { deck: Deck; snap: Snapshot; me: Me }) {
  const { items, visible } = deck;
  const x = useMotionValue(0);
  const flying = useRef(false);
  const top = items[0] ?? null;

  const fly = useCallback((dir: 1 | -1, velocity = 0) => {
    if (!top || flying.current) return;
    flying.current = true;
    void animate(x, dir * OUT(), { type: 'spring', stiffness: 260, damping: 32, velocity });
    setTimeout(() => {
      flying.current = false;
      x.jump(0);
      void (dir === 1 ? deck.accept(top) : deck.decline(top));
    }, 210);
  }, [top, x, deck]);

  useEffect(() => {
    if (!visible) return;
    const on = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); fly(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); fly(-1); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [visible, fly]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x > 110 || info.velocity.x > 500) fly(1, info.velocity.x);
    else if (info.offset.x < -110 || info.velocity.x < -500) fly(-1, info.velocity.x);
    else void animate(x, 0, { type: 'spring', stiffness: 500, damping: 34 });
  };

  return (
    <AnimatePresence>
      {visible && top ? (
        <motion.div key="deck" role="dialog" aria-modal="true" aria-label="New assignments"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.18 } }} transition={{ duration: 0.2 }}
          className="fixed inset-0 z-(--z-sheet) flex flex-col bg-[rgb(245_244_242/.97)] pt-(--safe-t) pb-(--safe-b) backdrop-blur-xl">
          <div className="mx-auto flex h-[56px] w-full max-w-[520px] items-center gap-2 px-5">
            <div className="min-w-0">
              <div className="text-[17px] font-bold tracking-[-0.01em] text-fg">{items.length === 1 ? 'New for you' : `${items.length} new for you`}</div>
              <div className="text-[12.5px] text-fg-3">Swipe right to take it · left to pass</div>
            </div>
            <button type="button" onClick={() => { haptic(8); deck.later(); }} className="ml-auto h-10 rounded-full px-4 text-[15px] font-semibold text-fg-2 active:bg-[rgb(23_21_15/.06)]">Later</button>
          </div>

          <div className="relative mx-auto w-full max-w-[520px] flex-1 px-4">
            {items.slice(0, 3).map((it, depth) => (
              <DeckCard key={it.issue.id} it={it} depth={depth} snap={snap} me={me} x={depth === 0 ? x : null} onDragEnd={onDragEnd} />
            )).reverse()}
          </div>

          <div className="mx-auto flex w-full max-w-[520px] items-center justify-center gap-10 px-6 pt-4 pb-5">
            <DeckButton label="Pass" onClick={() => fly(-1)} tone="no"><X className="size-7" strokeWidth={2.5} /></DeckButton>
            <DeckButton label="Take it" onClick={() => fly(1)} tone="yes"><Check className="size-8" strokeWidth={2.75} /></DeckButton>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function DeckButton({ label, onClick, tone, children }: { label: string; onClick: () => void; tone: 'yes' | 'no'; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <motion.button type="button" whileTap={{ scale: 0.9 }} transition={spring.snappy} onClick={onClick} aria-label={label}
        className={cn('grid place-items-center rounded-full shadow-[0_14px_30px_-14px_rgb(23_21_15/.5)]',
          tone === 'yes' ? 'size-[76px] bg-[#17150f] text-white' : 'size-[64px] bg-white text-[#e5484d] shadow-[0_14px_30px_-14px_rgb(23_21_15/.35),inset_0_0_0_.5px_rgb(23_21_15/.14)]')}>
        {children}
      </motion.button>
      <span className="text-[12.5px] font-semibold text-fg-2">{label}</span>
    </div>
  );
}

function DeckCard({ it, depth, snap, me, x, onDragEnd }: {
  it: DeckItem; depth: number; snap: Snapshot; me: Me; x: MotionValue<number> | null; onDragEnd: (e: unknown, info: PanInfo) => void;
}) {
  const idle = useMotionValue(0);
  const mx = x ?? idle;
  const rotate = useTransform(mx, [-220, 0, 220], [-12, 0, 12]);
  const yes = useTransform(mx, [24, 110], [0, 1]);
  const no = useTransform(mx, [-110, -24], [1, 0]);
  const { issue, notify } = it;
  const zoneId = issue.zoneId ?? notify?.zoneId ?? null;
  const zoneName = (zoneId ? snap.zones.find((z) => z.id === zoneId)?.name : null) ?? notify?.zoneName ?? null;
  const step = notify?.action ?? null;
  const ev = issue.lastEvidence;
  const isTop = depth === 0;

  return (
    <motion.article
      initial={{ opacity: 0, scale: 0.9, y: 40 }}
      animate={{ opacity: depth > 2 ? 0 : 1, scale: 1 - depth * 0.05, y: depth * 16 }}
      transition={spring.smooth}
      drag={isTop ? 'x' : false} dragMomentum={false} onDragEnd={isTop ? onDragEnd : undefined}
      style={{ x: isTop ? mx : 0, rotate: isTop ? rotate : 0, zIndex: 10 - depth, touchAction: 'pan-y', transformOrigin: '50% 90%' }}
      className={cn('absolute inset-x-4 top-1 bottom-1 flex flex-col overflow-hidden rounded-[28px] bg-white shadow-[0_30px_60px_-28px_rgb(23_21_15/.45),0_0_0_.5px_rgb(23_21_15/.1)]',
        isTop ? 'cursor-grab active:cursor-grabbing' : 'pointer-events-none')}
      aria-hidden={!isTop}>
      {isTop ? (
        <>
          <motion.span style={{ opacity: yes }} className="pointer-events-none absolute top-6 left-5 z-10 -rotate-12 rounded-[10px] border-[3px] border-[#2f7a45] px-2.5 py-0.5 text-[24px] font-black tracking-[.08em] text-[#2f7a45]">ACCEPT</motion.span>
          <motion.span style={{ opacity: no }} className="pointer-events-none absolute top-6 right-5 z-10 rotate-12 rounded-[10px] border-[3px] border-[#e5484d] px-2.5 py-0.5 text-[24px] font-black tracking-[.08em] text-[#e5484d]">DECLINE</motion.span>
        </>
      ) : null}
      <div className="px-5 pt-6">
        <div className="flex items-center gap-2 text-[12px] font-semibold tracking-[.05em] text-fg-3 uppercase">
          <span className="live-dot size-[7px]" style={{ color: issue.priority === 'p0' || issue.priority === 'p1' ? '#e5484d' : '#17150f' }} data-ping />
          {issue.assigneeId === me.participantId ? 'Assigned to you' : 'Needs someone'} · {ago(issue.createdAt)}
        </div>
        <h2 className="mt-2 text-[34px] leading-[38px] font-bold tracking-[-0.03em] text-fg">
          {zoneName ? <>Go to <span className="whitespace-nowrap"><MapPin className="mb-1 inline size-7" strokeWidth={2.4} />{zoneName}</span></> : issue.title}
        </h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <IssueKey k={issue.key} />
          <PriorityBadge priority={issue.priority} />
        </div>
        {zoneName ? <p className="mt-2 text-[18px] leading-[24px] font-semibold tracking-[-0.01em] text-fg">{issue.title}</p> : null}
        {step ? <p className="mt-2 text-[15px] leading-[21px] text-fg-2">First step: <span className="font-medium text-fg">{step}</span></p> : null}
        {ev?.text ? (
          <blockquote className="mt-3 flex gap-2 rounded-[14px] bg-[#f5f4f2] px-3.5 py-2.5">
            <Quote className="mt-0.5 size-4 shrink-0 text-fg-3" strokeWidth={2} />
            <span className="min-w-0">
              <span className="line-clamp-3 text-[14.5px] leading-[20px] text-fg">{ev.text}</span>
              <span className="mt-0.5 block text-[12px] text-fg-3">{[ev.speaker, ev.source].filter(Boolean).join(' · ')}{issue.evidenceCount > 1 ? ` · ${issue.evidenceCount} sources` : ''}</span>
            </span>
          </blockquote>
        ) : null}
      </div>
      <div className="mt-auto p-3 [&_*]:pointer-events-none!">
        {zoneId ? <InlineMapCard snap={snap} zoneIds={[zoneId]} issueIds={[issue.id]} deviceIds={me.deviceId ? [me.deviceId] : []} height={150} className="rounded-[18px]" /> : null}
      </div>
    </motion.article>
  );
}
