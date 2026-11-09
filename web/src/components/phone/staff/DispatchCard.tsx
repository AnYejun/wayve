// Dispatch card: when HQ (or the AI dispatcher) assigns me work, a card slides up above the tab bar that says WHERE to go
// and WHAT to fix — "Go to Entrance · WV-12 Long queue" + the first step + a mini map. "On my way" reacts instantly
// (optimistic): the issue goes In progress and my location moves to that zone locally, then the server confirms.
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { toast } from 'sonner';
import { Check, MapPin, Navigation } from 'lucide-react';
import type { Me, Notify, Snapshot } from '@shared/contracts';
import { API } from '@/lib/api';
import type { useLive } from '@/lib/live';
import { PriorityBadge, IssueKey } from '@/components/ops-bits';
import { InlineMapCard } from '@/components/chat/parts';
import { spring } from '@/design/motion';
import { haptic } from './shell';

type Apply = ReturnType<typeof useLive>['apply'];
const SEEN_KEY = 'wayve:dispatch-seen';

function loadSeen(): Set<string> {
  try { return new Set(JSON.parse(sessionStorage.getItem(SEEN_KEY) ?? '[]') as string[]); } catch { return new Set(); }
}
function saveSeen(s: Set<string>) {
  try { sessionStorage.setItem(SEEN_KEY, JSON.stringify([...s].slice(-200))); } catch { /* storage off */ }
}

/** A short, soft two-note chime (no audio files). Silently does nothing where audio is blocked. */
function chime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    [880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, now + i * 0.14);
      g.gain.exponentialRampToValueAtTime(0.12, now + i * 0.14 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.14 + 0.32);
      o.connect(g).connect(ctx.destination);
      o.start(now + i * 0.14); o.stop(now + i * 0.14 + 0.34);
    });
    setTimeout(() => { void ctx.close().catch(() => {}); }, 900);
  } catch { /* audio unavailable */ }
}

export function DispatchCard({ snap, me, notifies, apply }: { snap: Snapshot; me: Me; notifies: Notify[]; apply: Apply }) {
  const reduced = useReducedMotion();
  const seen = useRef<Set<string>>(loadSeen());
  const [queue, setQueue] = useState<Notify[]>([]);
  const [going, setGoing] = useState<string | null>(null); // notify id currently marked "On my way"

  // New dispatches for me (assigned, or anything that names a place) join the queue once.
  useEffect(() => {
    const fresh = notifies.filter((n) => n.participantId === me.participantId && (n.kind === 'assigned' || !!n.zoneName) && n.issueId && !seen.current.has(n.id));
    if (!fresh.length) return;
    for (const n of fresh) seen.current.add(n.id);
    saveSeen(seen.current);
    setQueue((q) => [...q, ...fresh.reverse()]); // notifies are newest first → oldest first in the queue
    haptic([120, 60, 120]);
    chime();
  }, [notifies, me.participantId]);

  const cur = queue[0] ?? null;
  const issue = useMemo(() => (cur?.issueId ? snap.issues.find((i) => i.id === cur.issueId) ?? null : null), [cur, snap.issues]);
  const zoneId = cur?.zoneId ?? issue?.zoneId ?? null;
  const zoneName = cur?.zoneName ?? (zoneId ? snap.zones.find((z) => z.id === zoneId)?.name ?? null : null);
  const done = !!issue && issue.status === 'done';

  const next = () => { setGoing(null); setQueue((q) => q.slice(1)); };

  const onMyWay = async () => {
    if (!cur?.issueId) return next();
    setGoing(cur.id);
    haptic(14);
    // Optimistic: issue In progress + assigned to me, my location → that zone. Server confirms; roll back on failure.
    const prevIssue = issue;
    const prevDevice = me.deviceId ? snap.devices.find((d) => d.id === me.deviceId) ?? null : null;
    if (prevIssue) apply({ kind: 'issue', data: { ...prevIssue, status: 'in_progress', assigneeId: me.participantId, version: prevIssue.version + 1, updatedAt: Date.now() } });
    if (prevDevice && zoneId) apply({ kind: 'device', data: { ...prevDevice, zoneId } });
    try {
      const [r, d] = await Promise.all([
        API.patchIssue(cur.issueId, { status: 'in_progress', assigneeId: me.participantId }),
        me.deviceId && zoneId ? API.patchDevice(me.deviceId, { zoneId }) : Promise.resolve(null),
      ]);
      apply({ kind: 'issue', data: r.issue });
      if (d) apply({ kind: 'device', data: d.device });
      toast.success(zoneName ? `On your way to ${zoneName}` : 'On your way', { description: `${cur.issueKey ?? ''} is now In progress` });
      setTimeout(next, 700);
    } catch (e) {
      if (prevIssue) apply({ kind: 'issue', data: prevIssue });
      if (prevDevice) apply({ kind: 'device', data: prevDevice });
      setGoing(null);
      toast.error('Couldn’t update', { description: (e as Error).message });
    }
  };

  return (
    <AnimatePresence>
      {cur && (
        <motion.section key={cur.id} role="alertdialog" aria-label={cur.title}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={reduced ? { opacity: 0 } : { opacity: 0, y: 24 }}
          transition={spring.sheet}
          className="fixed inset-x-3 z-(--z-sheet) mx-auto max-w-[560px] overflow-hidden rounded-[22px] bg-white shadow-[0_24px_64px_-16px_rgb(23_21_15/.35),0_0_0_.5px_rgb(23_21_15/.12)]"
          style={{ bottom: 'calc(var(--safe-b) + 72px)' }}>
          <div className="px-4 pt-4">
            <div className="flex items-center gap-2 text-[12px] font-semibold tracking-[.04em] text-fg-3 uppercase">
              <Navigation size={13} strokeWidth={2} />{cur.kind === 'assigned' ? 'New assignment' : 'Needs you'}
              {queue.length > 1 ? <span className="ml-auto rounded-full bg-wash-2 px-2 py-0.5 text-[11px] text-fg-2 normal-case tracking-normal">+{queue.length - 1} more</span> : null}
            </div>
            <h2 className="mt-1.5 flex items-center gap-2 text-[26px] leading-[1.15] font-bold tracking-[-0.02em] text-fg">
              {zoneName ? <><MapPin size={22} strokeWidth={2.25} className="shrink-0" />Go to {zoneName}</> : cur.title}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {cur.issueKey ? <IssueKey k={cur.issueKey} /> : null}
              {cur.priority ? <PriorityBadge priority={cur.priority} /> : null}
              <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-fg">{cur.issueTitle ?? issue?.title ?? cur.body}</span>
            </div>
            {cur.action ? <p className="mt-2 text-[14px] leading-[20px] text-fg-2">First step: <span className="text-fg">{cur.action}</span></p> : null}
          </div>
          {zoneId ? (
            <div className="mt-3 px-3">
              <InlineMapCard snap={snap} zoneIds={[zoneId]} issueIds={cur.issueId ? [cur.issueId] : []} deviceIds={me.deviceId ? [me.deviceId] : []} height={150} className="rounded-[14px]" />
            </div>
          ) : null}
          <div className="grid grid-cols-[1fr_auto] gap-2 p-3 pt-3">
            <motion.button type="button" whileTap={{ scale: 0.97 }} transition={spring.snappy} disabled={going === cur.id || done} onClick={() => void onMyWay()}
              className="flex h-[52px] items-center justify-center gap-2 rounded-full bg-[#17150f] text-[16px] font-semibold text-white disabled:opacity-90">
              {going === cur.id ? <><Check size={18} strokeWidth={2.5} />On my way</> : done ? 'Already done' : 'On my way'}
            </motion.button>
            <motion.button type="button" whileTap={{ scale: 0.97 }} transition={spring.snappy} onClick={next}
              className="h-[52px] rounded-full bg-wash-2 px-5 text-[15px] font-medium text-fg-2">Later</motion.button>
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
