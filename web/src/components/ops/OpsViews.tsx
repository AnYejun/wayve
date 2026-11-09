// Ops main views besides the board: Map (live venue map + zone sheet), Zones (live table), Reports (field reports + sheet).
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowDown, ArrowUp, Camera, Check, Circle, Clock, Move } from 'lucide-react';
import { toast } from 'sonner';
import {
  CROWD_LABEL, REPORT_CATEGORY_LABEL, REPORT_STATUS_LABEL, URGENCY_LABEL,
  type Device, type Issue, type Report, type ReportStatus, type Snapshot, type Zone,
} from '@shared/contracts';
import { api } from '@/lib/api';
import { ago } from '@/lib/time';
import { spring } from '@/design/motion';
import { AnimatedNumber } from '@/components/AnimatedNumber';
import { ZoneStatusPill, isStale } from '@/components/bits';
import { IssueKey, IssueStatusPill } from '@/components/ops-bits';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { VenueMap } from '@/components/VenueMap';
import { ZoneDetail, zoneStats } from '@/components/ops/ZoneDetail';
import { cn } from '@/lib/utils';

const card = 'rounded-[16px] border border-[rgb(23_21_15/.1)] bg-white';

// ── Map ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
export function MapView({ snap, now, onOpenIssue, onOpenReport }: { snap: Snapshot; now: number; onOpenIssue: (id: string) => void; onOpenReport: (id: string) => void }) {
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [editDevices, setEditDevices] = useState(false);
  const move = (id: string, position: [number, number]) => {
    api<{ device: Device }>(`/api/devices/${id}/position`, { method: 'PUT', body: { position } }).catch((e) => toast.error((e as Error).message));
  };
  const zone = snap.zones.find((z) => z.id === zoneId) ?? null;
  return (
    <div className={cn(card, 'p-3')}>
      <div className="mb-2 flex items-center gap-2 px-1">
        <span className="text-[13px] text-fg-2">Pins: issues by priority · camera pins: photo reports · markers: devices and what they watch</span>
        <Button variant={editDevices ? 'default' : 'outline'} size="xs" className="ml-auto" onClick={() => setEditDevices((v) => !v)}>
          {editDevices ? <Check /> : <Move />}{editDevices ? 'Done' : 'Place devices'}
        </Button>
      </div>
      <VenueMap map={snap.event.map} zones={snap.zones} devices={snap.devices} issues={snap.issues} reports={snap.reports}
        selectedId={zoneId} onSelect={setZoneId} onSelectIssue={onOpenIssue} onSelectReport={onOpenReport}
        devicesEditable={editDevices} onDeviceMove={move} />
      <ZoneSheet snap={snap} zone={zone} now={now} onClose={() => setZoneId(null)} onIssue={onOpenIssue} onReport={onOpenReport} />
    </div>
  );
}

export function ZoneSheet({ snap, zone, now, onClose, onIssue, onReport }: {
  snap: Snapshot; zone: Zone | null; now: number; onClose: () => void; onIssue: (id: string) => void; onReport: (id: string) => void;
}) {
  return (
    <Sheet open={!!zone} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-6 sm:max-w-[440px]">
        <SheetHeader className="sr-only"><SheetTitle>{zone?.name ?? 'Zone'}</SheetTitle><SheetDescription>Zone details</SheetDescription></SheetHeader>
        {zone ? <ZoneDetail snap={snap} zone={zone} now={now} onIssue={(id) => { onClose(); onIssue(id); }} onReport={(id) => { onClose(); onReport(id); }} /> : null}
      </SheetContent>
    </Sheet>
  );
}

// ── Zones table ──────────────────────────────────────────────────────────────────────────────────────────────────────
type SortKey = 'name' | 'status' | 'people' | 'issues' | 'updated';
const STATUS_ORDER: Record<string, number> = { alert: 5, critical: 4, crowded: 3, busy: 2, clear: 1, unknown: 0 };

export function ZoneTable({ snap, now, onOpenZone }: { snap: Snapshot; now: number; onOpenZone: (id: string) => void }) {
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: 'status', dir: -1 });
  const rows = useMemo(() => snap.zones.map((z) => {
    const st = zoneStats(snap, z, now);
    const last = st.reports[0];
    return { z, st, last };
  }), [snap, now]);
  const sorted = useMemo(() => [...rows].sort((a, b) => {
    const v = (r: typeof a) => sort.k === 'name' ? r.z.name : sort.k === 'status' ? STATUS_ORDER[r.z.status] : sort.k === 'people' ? r.z.peopleEstimate ?? -1 : sort.k === 'issues' ? r.st.issues.length : r.z.lastObservedAt ?? 0;
    const x = v(a), y = v(b);
    return (typeof x === 'string' ? x.localeCompare(y as string) : (x as number) - (y as number)) * sort.dir;
  }), [rows, sort]);
  const flash = useVersionFlash(snap.zones);
  const H = ({ k, children, right }: { k?: SortKey; children: React.ReactNode; right?: boolean }) => (
    <th className={cn('px-3 py-2.5 text-[12px] font-semibold whitespace-nowrap text-fg-2', right ? 'text-right' : 'text-left')}>
      {k ? (
        <button type="button" onClick={() => setSort((s) => ({ k, dir: s.k === k ? (s.dir === 1 ? -1 : 1) : -1 }))} className="inline-flex items-center gap-1 hover:text-fg">
          {children}{sort.k === k ? (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />) : null}
        </button>
      ) : children}
    </th>
  );
  return (
    <div className={cn(card, 'overflow-x-auto')}>
      <table className="w-full min-w-[820px] border-collapse">
        <thead className="border-b border-[rgb(23_21_15/.08)] bg-[#fafaf9]">
          <tr><H k="name">Zone</H><H k="status">Status</H><H>Crowd</H><H k="people" right>People</H><H k="issues" right>Open issues</H><H>Last report</H><H>Cameras</H><H k="updated" right>Updated</H></tr>
          {/* metrics columns from the zone tracking schema slot in here */}
        </thead>
        <tbody>
          {sorted.map(({ z, st, last }) => (
            <motion.tr key={z.id} layout transition={spring.smooth} onClick={() => onOpenZone(z.id)}
              animate={flash.has(z.id) ? { backgroundColor: ['rgba(255,214,153,.4)', 'rgba(255,214,153,0)'] } : { backgroundColor: 'rgba(255,255,255,0)' }}
              className="cursor-pointer border-b border-[rgb(23_21_15/.06)] last:border-0 hover:bg-[rgb(23_21_15/.02)]">
              <td className="px-3 py-3 text-[14px] font-semibold text-fg">{z.name}</td>
              <td className="px-3 py-3"><ZoneStatusPill status={z.status} stale={isStale(z, now)} size="sm" /></td>
              <td className="px-3 py-3 text-[14px] text-fg-2">{z.crowdLevel ? CROWD_LABEL[z.crowdLevel] : '—'}</td>
              <td className="px-3 py-3 text-right text-[14px] font-medium text-fg tabular-nums">{z.peopleEstimate != null ? <AnimatedNumber value={z.peopleEstimate} /> : '—'}</td>
              <td className="px-3 py-3 text-right text-[14px] tabular-nums">{st.issues.length ? <span className="font-semibold text-[#c8553f]"><AnimatedNumber value={st.issues.length} /></span> : <span className="text-fg-3">0</span>}</td>
              <td className="max-w-[220px] truncate px-3 py-3 text-[13px] text-fg-2">{last ? `${last.ai?.title ?? last.text ?? 'Report'} · ${ago(last.createdAt, now)}` : '—'}</td>
              <td className="px-3 py-3 text-[13px] text-fg-2 tabular-nums"><span className="inline-flex items-center gap-1"><Camera className="size-3.5" />{st.online.length}/{st.cams.length}</span></td>
              <td className="px-3 py-3 text-right text-[13px] text-fg-3 tabular-nums">{z.lastObservedAt ? ago(z.lastObservedAt, now) : '—'}</td>
            </motion.tr>
          ))}
        </tbody>
      </table>
      {!snap.zones.length ? <p className="p-8 text-center text-[14px] text-fg-2">No zones yet — draw them in Setup.</p> : null}
    </div>
  );
}

function useVersionFlash(zones: Zone[]) {
  const seen = useRef<Map<string, number> | null>(null);
  const [f, setF] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!seen.current) { seen.current = new Map(zones.map((z) => [z.id, z.version])); return; }
    const ch = zones.filter((z) => (seen.current!.get(z.id) ?? 0) < z.version).map((z) => z.id);
    for (const z of zones) seen.current.set(z.id, z.version);
    if (!ch.length) return;
    setF(new Set(ch));
    const t = setTimeout(() => setF(new Set()), 1300);
    return () => clearTimeout(t);
  }, [zones]);
  return f;
}

// ── Reports ──────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Status follows the linked issue live (falls back to the report's own status). */
export function liveReportStatus(r: Report, issues: Issue[]): ReportStatus {
  const i = r.issueId ? issues.find((x) => x.id === r.issueId) : null;
  if (!i) return r.status;
  return i.status === 'done' ? 'resolved' : i.status === 'open' ? 'received' : 'reviewing';
}
const URG_COLOR = { normal: '#8a8884', caution: '#c6824b', urgent: '#b91c1c' } as const;

export function ReportsView({ snap, now, onOpenReport }: { snap: Snapshot; now: number; onOpenReport: (id: string) => void }) {
  const zoneName = new Map(snap.zones.map((z) => [z.id, z.name]));
  if (!snap.reports.length) {
    return <div className={cn(card, 'px-6 py-16 text-center')}><Camera className="mx-auto size-6 text-fg-3" strokeWidth={1.75} /><p className="mt-2 text-[16px] font-semibold text-fg">No field reports yet</p><p className="mt-1 text-[14px] text-fg-2">Staff send photo, voice or text reports from the Report tab on their phones.</p></div>;
  }
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      <AnimatePresence initial={false}>
        {snap.reports.map((r) => {
          const st = liveReportStatus(r, snap.issues);
          return (
            <motion.li key={r.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring.smooth}>
              <motion.button type="button" whileTap={{ scale: 0.985 }} onClick={() => onOpenReport(r.id)} className={cn(card, 'flex w-full gap-3 p-3 text-left hover:border-[rgb(23_21_15/.22)]')}>
                {r.photoUrl ? <img src={r.photoUrl} alt="" className="size-20 shrink-0 rounded-[12px] object-cover" /> : <span className="grid size-20 shrink-0 place-items-center rounded-[12px] bg-[#f5f4f2] text-fg-3"><Camera className="size-5" /></span>}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: URG_COLOR[r.urgency] }}><Circle className="size-2 fill-current" />{URGENCY_LABEL[r.urgency]}</span>
                    <span className="text-[12px] text-fg-3">{REPORT_CATEGORY_LABEL[r.category]}</span>
                    <StatusChip s={st} className="ml-auto" />
                  </span>
                  <span className="mt-1 block truncate text-[15px] font-semibold text-fg">{r.ai?.title ?? r.text ?? r.transcript ?? 'Report'}</span>
                  <span className="mt-0.5 block truncate text-[13px] text-fg-2">{r.zoneId ? zoneName.get(r.zoneId) : 'No zone'} · {r.authorName} · {ago(r.createdAt, now)}</span>
                  {r.issueKey ? <span className="mt-1 inline-flex items-center gap-1.5 text-[12px] text-fg-2"><IssueKey k={r.issueKey} />{r.linkedReports > 1 ? `${r.linkedReports} reports` : null}</span> : null}
                </span>
              </motion.button>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}

function StatusChip({ s, className }: { s: ReportStatus; className?: string }) {
  const c = s === 'resolved' ? ['#eaf5ec', '#376c45'] : s === 'reviewing' ? ['#fdf3e7', '#86552e'] : ['#f5f4f2', '#4a4844'];
  return <span className={cn('inline-flex h-6 items-center rounded-full px-2 text-[12px] font-semibold', className)} style={{ background: c[0], color: c[1] }}>{REPORT_STATUS_LABEL[s]}</span>;
}

export function ReportSheet({ snap, reportId, now, onClose, onOpenIssue }: { snap: Snapshot; reportId: string | null; now: number; onClose: () => void; onOpenIssue: (id: string) => void }) {
  const r = reportId ? snap.reports.find((x) => x.id === reportId) ?? null : null;
  const st = r ? liveReportStatus(r, snap.issues) : 'received';
  const issue = r?.issueId ? snap.issues.find((i) => i.id === r.issueId) : null;
  const related = r?.issueId ? snap.reports.filter((x) => x.issueId === r.issueId && x.id !== r.id) : [];
  const zoneName = r?.zoneId ? snap.zones.find((z) => z.id === r.zoneId)?.name : null;
  const steps: Array<[ReportStatus, string]> = [['received', 'Report received'], ['reviewing', 'HQ reviewing'], ['resolved', 'Resolved']];
  const reached = (s: ReportStatus) => steps.findIndex((x) => x[0] === s) <= steps.findIndex((x) => x[0] === st);
  return (
    <Sheet open={!!r} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[480px]">
        <SheetHeader className="sr-only"><SheetTitle>{r?.ai?.title ?? 'Report'}</SheetTitle><SheetDescription>Field report</SheetDescription></SheetHeader>
        {r ? (
          <div>
            {r.photoUrl ? <img src={r.photoUrl} alt="Report photo" className="aspect-[4/3] w-full object-cover" /> : null}
            <div className="p-6">
              <div className="flex items-center gap-2"><StatusChip s={st} /><span className="text-[12px] font-semibold" style={{ color: URG_COLOR[r.urgency] }}>{URGENCY_LABEL[r.urgency]}</span><span className="text-[12px] text-fg-3">{REPORT_CATEGORY_LABEL[r.category]}</span></div>
              <h2 className="mt-3 text-[22px] leading-[1.2] font-semibold tracking-[-0.02em] text-fg">{r.ai?.title ?? r.text ?? 'Report'}</h2>
              <p className="mt-1 text-[13px] text-fg-2">{zoneName ?? 'No zone'} · {r.authorName} · {ago(r.createdAt, now)}</p>
              {r.text || r.transcript ? <blockquote className="mt-4 border-l-2 border-[rgb(23_21_15/.15)] pl-3 text-[15px] leading-[22px] text-fg">“{r.text ?? r.transcript}”</blockquote> : null}
              {r.ai ? (
                <div className="mt-5 overflow-hidden rounded-[14px] bg-[#fafaf9] p-4">
                  <p className="text-[12px] font-semibold tracking-[.06em] text-fg-3 uppercase">AI summary <span className="font-normal normal-case">· {r.ai.model} · {Math.round(r.ai.confidence * 100)}%</span></p>
                  <dl className="mt-2 grid grid-cols-[96px_1fr] gap-y-1.5 text-[14px]">
                    <dt className="text-fg-2">Location</dt><dd className="text-fg">{r.ai.location ?? zoneName ?? '—'}</dd>
                    <dt className="text-fg-2">Situation</dt><dd className="text-fg">{r.ai.situation}</dd>
                    <dt className="text-fg-2">Summary</dt><dd className="text-fg">{r.ai.summary}</dd>
                  </dl>
                </div>
              ) : null}
              {issue ? (
                <button type="button" onClick={() => { onClose(); onOpenIssue(issue.id); }} className="mt-4 flex w-full items-center gap-2 rounded-[14px] border border-[rgb(23_21_15/.1)] p-3 text-left hover:border-[rgb(23_21_15/.22)]">
                  <IssueStatusPill status={issue.status} iconOnly /><IssueKey k={issue.key} /><span className="min-w-0 flex-1 truncate text-[14px] font-medium text-fg">{issue.title}</span>
                  <span className="text-[12px] text-fg-3">{r.linkedReports > 1 ? `${r.linkedReports} reports` : ''}</span>
                </button>
              ) : null}
              <ol className="mt-6 space-y-0">
                {steps.map(([s, label], i) => {
                  const on = reached(s);
                  const at = s === 'received' ? r.statusAt.received : s === 'reviewing' ? r.statusAt.reviewing : r.statusAt.resolved;
                  return (
                    <li key={s} className="relative flex gap-3 pb-4 last:pb-0">
                      {i < steps.length - 1 ? <span className="absolute top-5 left-[9px] h-[calc(100%-12px)] w-px" style={{ background: on ? '#58a069' : 'rgba(23,21,15,.12)' }} /> : null}
                      <motion.span initial={false} animate={{ scale: on ? 1 : 0.9 }} transition={spring.snappy}
                        className="relative mt-0.5 grid size-[19px] place-items-center rounded-full" style={{ background: on ? '#58a069' : '#fff', boxShadow: on ? 'none' : 'inset 0 0 0 1.5px rgba(23,21,15,.2)' }}>
                        {on ? <Check className="size-3 text-white" strokeWidth={3} /> : null}
                      </motion.span>
                      <span className="flex-1 text-[14px]" style={{ color: on ? '#17150f' : '#8a8884' }}>{label}</span>
                      {at ? <span className="inline-flex items-center gap-1 text-[12px] text-fg-3 tabular-nums"><Clock className="size-3" />{new Date(at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span> : null}
                    </li>
                  );
                })}
              </ol>
              {related.length ? (
                <div className="mt-6">
                  <p className="text-[12px] font-semibold tracking-[.06em] text-fg-3 uppercase">Same spot · {related.length} more</p>
                  <ul className="mt-2 space-y-2">
                    {related.slice(0, 6).map((x) => (
                      <li key={x.id} className="flex items-center gap-3">
                        {x.photoUrl ? <img src={x.photoUrl} alt="" className="size-10 rounded-[8px] object-cover" /> : <span className="size-10 rounded-[8px] bg-[#f5f4f2]" />}
                        <span className="min-w-0 flex-1 truncate text-[14px] text-fg">{x.ai?.title ?? x.text ?? x.transcript ?? 'Report'}</span>
                        <span className="text-[12px] text-fg-3">{ago(x.createdAt, now)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
