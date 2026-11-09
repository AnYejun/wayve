// Staff tasks: my tasks, then unassigned ones I can take, then a collapsed "Done" group.
// Steps are agent proposals (AI suggestion) or the deterministic template (standard steps) — never orders.
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Check, ChevronDown, Eye, Hand } from 'lucide-react';
import {
  INCIDENT_LABEL, INCIDENT_STATUS_LABEL, ZONE_STALE_MS,
  type Incident, type Me, type Snapshot, type Task, type TaskStatus,
} from '@shared/contracts';
import { API, HttpError } from '@/lib/api';
import { ago, useNow } from '@/lib/time';
import { cn } from '@/lib/utils';
import { AiTag, IncidentGlyph, ModalityTag, SeverityBadge, ZoneStatusPill } from '@/components/bits';
import { Skeleton } from '@/components/ui/skeleton';
import { CARD, Pill, Spinner } from './common';

type Apply = (u: { kind: 'task'; data: Task } | { kind: 'incident'; data: Incident }) => void;

export function TasksTab({ snap, me, apply }: { snap: Snapshot | null; me: Me; apply: Apply }) {
  const now = useNow(1000);
  const [showDone, setShowDone] = useState(false);
  useNewTaskAlert(snap, me);

  if (!snap) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-[188px] rounded-[16px]" />
        <Skeleton className="h-[188px] rounded-[16px]" />
      </div>
    );
  }

  const active = (t: Task) => t.status !== 'done';
  const mine = snap.tasks.filter((t) => t.assigneeId === me.participantId && active(t))
    .sort((a, b) => (a.status === b.status ? b.createdAt - a.createdAt : a.status === 'accepted' ? -1 : 1));
  const open = snap.tasks.filter((t) => t.assigneeId == null && active(t));
  const done = snap.tasks.filter((t) => t.assigneeId === me.participantId && t.status === 'done').slice(0, 10);

  return (
    <div className="flex flex-col gap-6">
      {mine.length === 0 && open.length === 0 ? (
        <EmptyTasks snap={snap} now={now} />
      ) : null}

      {mine.length > 0 ? (
        <section aria-label="Your tasks">
          <h2 className="mb-2.5 px-1 text-[13px] font-semibold text-fg-2">Your tasks <span className="tabular-nums text-fg-3">{mine.length}</span></h2>
          <div className="flex flex-col gap-3">
            {mine.map((t) => <TaskCard key={t.id} task={t} snap={snap} me={me} apply={apply} now={now} />)}
          </div>
        </section>
      ) : null}

      {open.length > 0 ? (
        <section aria-label="Unassigned">
          <h2 className="mb-2.5 px-1 text-[13px] font-semibold text-fg-2">Unassigned <span className="tabular-nums text-fg-3">{open.length}</span></h2>
          <div className="flex flex-col gap-3">
            {open.map((t) => <TaskCard key={t.id} task={t} snap={snap} me={me} apply={apply} now={now} />)}
          </div>
        </section>
      ) : null}

      {done.length > 0 ? (
        <section aria-label="Done">
          <button type="button" onClick={() => setShowDone((v) => !v)} aria-expanded={showDone}
            className="flex h-11 w-full items-center gap-1.5 px-1 text-[13px] font-semibold text-fg-2">
            Done <span className="tabular-nums text-fg-3">{done.length}</span>
            <ChevronDown className={cn('ml-auto size-4 transition-transform duration-200', showDone && 'rotate-180')} strokeWidth={1.75} />
          </button>
          {showDone ? (
            <ul className={cn(CARD, 'overflow-hidden animate-in fade-in duration-200')}>
              {done.map((t, i) => {
                const inc = snap.incidents.find((x) => x.id === t.incidentId);
                return (
                  <li key={t.id} className="relative flex min-h-[52px] items-center gap-3 px-4">
                    {i > 0 ? <span className="absolute top-0 right-0 left-4 h-px origin-top scale-y-50 bg-[rgb(23_21_15/.16)]" aria-hidden="true" /> : null}
                    <Check className="size-4 shrink-0 text-st-clear-fg" strokeWidth={2.25} />
                    <span className="min-w-0 flex-1 truncate text-[15px] text-fg-2">{t.title}</span>
                    <span className="shrink-0 text-[12px] tabular-nums text-fg-3">{ago(inc?.resolvedAt ?? t.updatedAt, now)}</span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function TaskCard({ task, snap, me, apply, now }: { task: Task; snap: Snapshot; me: Me; apply: Apply; now: number }) {
  const inc = snap.incidents.find((i) => i.id === task.incidentId);
  const zone = snap.zones.find((z) => z.id === inc?.zoneId);
  const [busy, setBusy] = useState<null | 'task' | 'ack'>(null);
  const mine = task.assigneeId === me.participantId;

  const patch = async (b: { status?: TaskStatus; assigneeId?: string | null }, ok?: string) => {
    setBusy('task');
    try {
      const r = await API.patchTask(task.id, b);
      apply({ kind: 'task', data: r.task });
      if (ok) toast.success(ok);
    } catch (e) { toast.error((e as HttpError).message); } finally { setBusy(null); }
  };
  const ack = async () => {
    if (!inc) return;
    setBusy('ack');
    try {
      const r = await API.patchIncident(inc.id, 'acknowledged');
      apply({ kind: 'incident', data: r.incident });
      toast.success('Marked as checked on site');
    } catch (e) { toast.error((e as HttpError).message); } finally { setBusy(null); }
  };

  return (
    <article className={cn(CARD, 'p-4 animate-in fade-in slide-in-from-bottom-2 duration-300')}>
      <header className="flex items-start gap-3">
        {inc ? <IncidentGlyph type={inc.incidentType} severity={inc.severity} size={40} /> : <Skeleton className="size-10 rounded-[10px]" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="min-w-0 truncate text-[17px] leading-6 font-semibold tracking-[-0.01em] text-fg">
              {inc ? INCIDENT_LABEL[inc.incidentType] : task.title}
            </h3>
            {inc ? <SeverityBadge severity={inc.severity} className="ml-auto" /> : null}
          </div>
          <p className="mt-0.5 flex items-center gap-1.5 text-[14px] text-fg-2">
            <span className="truncate">{zone?.name ?? 'Unknown zone'}</span>
            <span aria-hidden="true">·</span>
            <span className="shrink-0 tabular-nums">{ago(task.createdAt, now)}</span>
            {inc && inc.status !== 'open' ? <><span aria-hidden="true">·</span><span className="shrink-0">{INCIDENT_STATUS_LABEL[inc.status]}</span></> : null}
          </p>
        </div>
      </header>

      {inc?.description ? <p className="mt-3 text-[15px] leading-[22px] text-fg">{inc.description}</p> : null}

      {inc ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="text-[13px] tabular-nums text-fg-2">{inc.evidenceCount} sources</span>
          {inc.modalities.map((m) => <ModalityTag key={m} modality={m} />)}
        </div>
      ) : null}

      <Steps task={task} />

      <div className="mt-4 flex gap-2">
        {!mine && task.assigneeId == null ? (
          <Pill className="flex-1" disabled={!!busy} onClick={() => patch({ assigneeId: me.participantId, status: 'accepted' }, 'You took this task')}>
            {busy === 'task' ? <Spinner className="size-4 border-white/30 border-t-white" /> : <Hand />}Take it
          </Pill>
        ) : task.status === 'open' ? (
          <Pill className="flex-1" disabled={!!busy} onClick={() => patch({ status: 'accepted' }, 'Accepted')}>
            {busy === 'task' ? <Spinner className="size-4 border-white/30 border-t-white" /> : null}Accept
          </Pill>
        ) : (
          <Pill className="flex-1" disabled={!!busy} onClick={() => patch({ status: 'done' }, 'Marked resolved')}>
            {busy === 'task' ? <Spinner className="size-4 border-white/30 border-t-white" /> : <Check />}Resolved
          </Pill>
        )}
        {inc && inc.status === 'open' ? (
          <Pill tone="paper" disabled={!!busy} onClick={ack} className="px-4">
            {busy === 'ack' ? <Spinner className="size-4" /> : <Eye />}Just checked
          </Pill>
        ) : null}
      </div>
    </article>
  );
}

function Steps({ task }: { task: Task }) {
  if (task.stepsSource === 'pending') {
    return (
      <div className="mt-3.5 rounded-[12px] bg-[rgb(23_21_15/.03)] p-3" aria-busy="true">
        <p className="mb-2 flex items-center gap-2 text-[13px] text-fg-2"><span className="typing" aria-hidden="true"><i /><i /><i /></span>The assistant is drafting steps</p>
        <Skeleton className="mb-1.5 h-4 w-[88%]" />
        <Skeleton className="h-4 w-[64%]" />
      </div>
    );
  }
  if (!task.steps.length) return null;
  return (
    <div className="mt-3.5 rounded-[12px] bg-[rgb(23_21_15/.03)] p-3">
      <div className="mb-2 flex items-center gap-2">
        {task.stepsSource === 'ai' ? (
          <><AiTag /><span className="text-[12px] font-medium text-fg-2">Suggestion · your judgement on site comes first</span></>
        ) : (
          <span className="inline-flex h-5 items-center rounded-[6px] px-1.5 text-[11px] font-semibold text-fg-2 shadow-[inset_0_0_0_.5px_rgb(23_21_15/.24)]">Standard steps</span>
        )}
      </div>
      <ol className="flex flex-col gap-1.5">
        {task.steps.map((s, i) => (
          <li key={i} className="flex gap-2.5 text-[15px] leading-[22px] text-fg">
            <span className="mt-[3px] grid size-4 shrink-0 place-items-center rounded-full bg-[rgb(23_21_15/.08)] text-[11px] font-semibold tabular-nums text-fg-2">{i + 1}</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function EmptyTasks({ snap, now }: { snap: Snapshot; now: number }) {
  return (
    <div className="flex flex-col gap-4">
      <div className={cn(CARD, 'px-5 py-8 text-center')}>
        <div className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-[rgb(88_160_105/.12)] text-st-clear-fg">
          <Check className="size-6" strokeWidth={2} />
        </div>
        <p className="text-[17px] font-semibold text-fg">No tasks right now</p>
        <p className="mt-1 text-[14px] text-fg-2">We'll let you know the moment something comes in.</p>
      </div>
      {snap.zones.length ? (
        <section aria-label="Zones">
          <h2 className="mb-2 px-1 text-[13px] font-semibold text-fg-2">Zones</h2>
          <ul className={cn(CARD, 'overflow-hidden')}>
            {snap.zones.map((z, i) => {
              const stale = z.lastObservedAt != null && now - z.lastObservedAt > ZONE_STALE_MS;
              return (
                <li key={z.id} className="relative flex min-h-[52px] items-center gap-3 px-4">
                  {i > 0 ? <span className="absolute top-0 right-0 left-4 h-px origin-top scale-y-50 bg-[rgb(23_21_15/.16)]" aria-hidden="true" /> : null}
                  <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-fg">{z.name}</span>
                  <span className="shrink-0 text-[12px] tabular-nums text-fg-3">{z.lastObservedAt ? ago(z.lastObservedAt, now) : ''}</span>
                  <ZoneStatusPill status={z.status} stale={stale} size="sm" />
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** Toast + vibrate when a task newly lands on me (created for me or reassigned to me). */
function useNewTaskAlert(snap: Snapshot | null, me: Me) {
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!snap) return;
    const mineIds = snap.tasks.filter((t) => t.assigneeId === me.participantId && t.status !== 'done').map((t) => t.id);
    if (seen.current === null) { seen.current = new Set(mineIds); return; }
    const fresh = mineIds.filter((id) => !seen.current!.has(id));
    for (const id of mineIds) seen.current.add(id);
    if (!fresh.length) return;
    const t = snap.tasks.find((x) => x.id === fresh[0])!;
    const inc = snap.incidents.find((i) => i.id === t.incidentId);
    const zone = snap.zones.find((z) => z.id === inc?.zoneId);
    toast(fresh.length > 1 ? `${fresh.length} new tasks` : 'New task', {
      description: inc ? `${zone?.name ?? ''} · ${INCIDENT_LABEL[inc.incidentType]}` : t.title,
    });
    try { navigator.vibrate?.([80, 40, 80]); } catch { /* unsupported */ }
  }, [snap, me.participantId]);
}
