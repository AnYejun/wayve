// Field report (mockup 01) and report detail (mockup 02). Photo + voice + text, category, urgency → POST /api/reports.
// The AI writes a short summary; rules link it to an issue at the same spot. Live status follows the linked issue.
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { toast } from 'sonner';
import { Camera, Check, ChevronLeft, ChevronRight, Clock, Link2, MapPin, Mic, Plus, RefreshCw, Send, Trash2 } from 'lucide-react';
import {
  REPORT_CATEGORIES, REPORT_CATEGORY_LABEL, REPORT_STATUS_LABEL, URGENCIES, URGENCY_LABEL,
  type Issue, type Me, type Report, type ReportCategory, type ReportStatus, type Snapshot, type Urgency,
} from '@shared/contracts';
import { API, HttpError, blobToDataUrl } from '@/lib/api';
import { ago, clock, useNow } from '@/lib/time';
import { cn } from '@/lib/utils';
import { rise, spring, stagger } from '@/design/motion';
import { AiTag } from '@/components/bits';
import { IssueKey } from '@/components/ops-bits';
import { Skeleton } from '@/components/ui/skeleton';
import { CARD, HAIR, Spinner, ZoneSheet } from '../common';
import { fmtDur, useTalkRecorder } from '../ops/recorder';
import { DotChip, haptic, LargeTitle, SectionTitle } from './shell';

const CAT_COLOR: Record<ReportCategory, string> = { crowd: '#e5484d', facility: '#8a8884', supplies: '#8a8884', safety: '#e8833a', medical: '#e5484d', other: '#8a8884' };
const URG_COLOR: Record<Urgency, string> = { normal: '#8a8884', caution: '#e8a33a', urgent: '#e5484d' };
const STATUS_STYLE: Record<ReportStatus, string> = {
  received: 'bg-[rgb(23_21_15/.06)] text-fg-2', reviewing: 'bg-[#fdf3e3] text-[#8a5a12]', resolved: 'bg-[#e8f5ec] text-[#2f7a45]',
};

/** Live status from the linked issue (the report row itself is a snapshot). */
export function liveStatus(r: Report, issues: Issue[]): ReportStatus {
  const i = r.issueId ? issues.find((x) => x.id === r.issueId) : null;
  if (!i) return r.status;
  return i.status === 'done' ? 'resolved' : i.status === 'open' ? 'received' : 'reviewing';
}

async function downscale(file: File, max = 1600, q = 0.82): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), 'image/jpeg', q));
  } finally { URL.revokeObjectURL(url); }
}

export function ReportComposer({ snap, me, myZoneId, parent, onSent, onCancelUpdate, onOpenReport }: {
  snap: Snapshot; me: Me; myZoneId: string | null; parent: Report | null; onSent: (r: Report) => void; onCancelUpdate: () => void; onOpenReport: (r: Report) => void;
}) {
  const [zoneId, setZoneId] = useState<string | null>(parent?.zoneId ?? myZoneId);
  const [zoneOpen, setZoneOpen] = useState(false);
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [voice, setVoice] = useState<{ blob: Blob; ms: number } | null>(null);
  const [text, setText] = useState('');
  const [category, setCategory] = useState<ReportCategory>(parent?.category ?? 'crowd');
  const [urgency, setUrgency] = useState<Urgency>(parent?.urgency ?? 'normal');
  const [sending, setSending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const now = useNow(10_000);
  const zone = snap.zones.find((z) => z.id === zoneId);
  useEffect(() => { if (!zoneId && myZoneId) setZoneId(myZoneId); }, [myZoneId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);

  const rec = useTalkRecorder({ maxMs: 60_000, onBlob: async (blob, ms) => { setVoice({ blob, ms }); haptic(15); }, onDenied: (m) => toast.error(m) });

  const pick = async (f: File | undefined) => {
    if (!f) return;
    try { const blob = await downscale(f); setPhoto({ blob, url: URL.createObjectURL(blob) }); haptic(12); }
    catch { toast.error("Couldn't read that photo. Try another one."); }
  };

  const canSend = !!(photo || voice || text.trim()) && !sending && rec.state === 'idle';
  const send = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      const r = await API.createReport({
        eventId: me.eventId, zoneId, category, urgency, text: text.trim() || null,
        photo: photo ? await blobToDataUrl(photo.blob) : null, audio: voice ? await blobToDataUrl(voice.blob) : null,
        parentReportId: parent?.id ?? null,
      });
      haptic([30, 40, 30]);
      setPhoto(null); setVoice(null); setText('');
      onSent(r.report);
    } catch (e) {
      const he = e as HttpError;
      toast.error(he.status === 503 ? 'AI is off — your report was not sent. Try text only.' : he.message);
    } finally { setSending(false); }
  };

  const mine = snap.reports.filter((r) => r.authorId === me.participantId).slice(0, 8);

  return (
    <div className="flex flex-col gap-4">
      <LargeTitle title={parent ? 'Add an update' : 'Field report'} sub={parent ? `To "${parent.ai?.title ?? 'your report'}"` : "Share what's happening, fast."}
        right={parent ? <button type="button" onClick={onCancelUpdate} className="h-9 rounded-full px-3 text-[15px] font-semibold text-fg-2 active:bg-[rgb(23_21_15/.05)]">Cancel</button> : null} />

      <button type="button" onClick={() => setZoneOpen(true)} className={cn(CARD, 'flex min-h-[56px] items-center gap-3 px-4 text-left active:scale-[.99] transition-transform')}>
        <MapPin className="size-5 text-fg-2" strokeWidth={1.75} />
        <span className={cn('flex-1 text-[17px] font-semibold', zone ? 'text-fg' : 'text-fg-3')}>{zone?.name ?? 'Choose location'}</span>
        <span className="flex items-center gap-0.5 text-[14px] text-fg-2">Change<ChevronRight className="size-4" strokeWidth={1.75} /></span>
      </button>

      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
      <AnimatePresence initial={false}>
        {photo ? (
          <motion.div key="photo" variants={rise} initial="initial" animate="animate" exit="exit" className="relative overflow-hidden rounded-[18px]">
            <img src={photo.url} alt="Attached" className="aspect-[16/9] w-full object-cover" />
            <span className="mat-float absolute top-3 left-3 inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-fg">
              <span className="grid size-4 place-items-center rounded-full bg-[#34a853] text-white"><Check className="size-3" strokeWidth={3} /></span>Photo attached
            </span>
            <button type="button" onClick={() => fileRef.current?.click()} className="mat-float absolute top-3 right-3 inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-fg">
              <RefreshCw className="size-3.5" strokeWidth={2} />Retake
            </button>
          </motion.div>
        ) : (
          <motion.button key="add-photo" type="button" variants={rise} initial="initial" animate="animate" exit="exit" whileTap={{ scale: 0.99 }}
            onClick={() => fileRef.current?.click()}
            className="flex aspect-[16/7] w-full flex-col items-center justify-center gap-2 rounded-[18px] border-[1.5px] border-dashed border-[rgb(23_21_15/.18)] bg-white/60 text-fg-2">
            <span className="grid size-11 place-items-center rounded-full bg-white shadow-[0_1px_2px_rgb(23_21_15/.08),0_0_0_.5px_rgb(23_21_15/.1)]"><Camera className="size-5 text-fg" strokeWidth={1.75} /></span>
            <span className="text-[15px] font-semibold text-fg">Add a photo</span>
            <span className="-mt-1.5 text-[13px] text-fg-3">The AI reads it for you</span>
          </motion.button>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-2 gap-3">
        <motion.button type="button" whileTap={{ scale: 0.97 }} transition={spring.snappy} onClick={() => fileRef.current?.click()}
          className={cn(CARD, 'flex h-[52px] items-center justify-center gap-2 text-[16px] font-semibold text-fg')}>
          <Camera className="size-5" strokeWidth={1.75} />{photo ? 'Retake' : 'Take photo'}
        </motion.button>
        <motion.button type="button" whileTap={{ scale: 0.97 }} transition={spring.snappy}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); rec.pressStart(); }} onPointerUp={rec.pressEnd} onPointerCancel={rec.pressEnd}
          onContextMenu={(e) => e.preventDefault()} disabled={!rec.supported}
          className={cn(CARD, 'flex h-[52px] touch-none select-none items-center justify-center gap-2 text-[16px] font-semibold', rec.state === 'recording' ? 'bg-[#fdecec]! text-[#b91c1c]' : 'text-fg')}>
          {rec.state === 'recording' ? (
            <><span className="flex h-4 items-end gap-[2px]" aria-hidden>{[0.5, 1, 0.7, 0.9].map((k, i) => <span key={i} className="w-[3px] rounded-full bg-current transition-[height] duration-75" style={{ height: 4 + rec.level * 12 * k }} />)}</span>{fmtDur(rec.elapsed)}</>
          ) : <><Mic className="size-5" strokeWidth={1.75} />Voice note</>}
        </motion.button>
      </div>
      <AnimatePresence initial={false}>
        {voice ? (
          <motion.div key="voice" variants={rise} initial="initial" animate="animate" exit="exit"
            className="flex h-11 items-center gap-2 self-start rounded-full bg-[rgb(23_21_15/.05)] pr-1.5 pl-3.5 text-[14px] font-semibold text-fg">
            <Mic className="size-4" strokeWidth={2} />Voice note · {fmtDur(voice.ms)}
            <button type="button" onClick={() => setVoice(null)} aria-label="Delete voice note" className="grid size-8 place-items-center rounded-full text-fg-2 active:bg-[rgb(23_21_15/.08)]"><Trash2 className="size-4" strokeWidth={1.75} /></button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <section className={cn(CARD, 'px-4 py-4')}>
        <label htmlFor="report-text" className="text-[15px] font-semibold text-fg">What's happening?</label>
        <textarea id="report-text" value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={800} placeholder="The line at the Zone B entrance is getting long."
          className={cn('mt-2 w-full resize-none rounded-[12px] bg-white px-3.5 py-3 text-[16px] leading-[23px] text-fg outline-none placeholder:text-fg-3 focus-visible:shadow-[inset_0_0_0_1.5px_#17150f]', HAIR)} />
        <p className="mt-4 mb-2 text-[14px] font-semibold text-fg-2">Category</p>
        <div className="flex flex-wrap gap-2">{REPORT_CATEGORIES.map((c) => <DotChip key={c} label={REPORT_CATEGORY_LABEL[c]} color={CAT_COLOR[c]} on={category === c} onClick={() => setCategory(c)} />)}</div>
        <p className="mt-4 mb-2 text-[14px] font-semibold text-fg-2">Urgency</p>
        <div className="flex flex-wrap gap-2">{URGENCIES.map((u) => <DotChip key={u} label={URGENCY_LABEL[u]} color={URG_COLOR[u]} on={urgency === u} onClick={() => setUrgency(u)} />)}</div>
      </section>

      <motion.button type="button" whileTap={{ scale: 0.97 }} transition={spring.snappy} disabled={!canSend} onClick={() => void send()}
        className="flex h-[54px] items-center justify-center gap-2 rounded-[16px] bg-[#17150f] text-[17px] font-semibold text-white disabled:opacity-35">
        {sending ? <><Spinner className="size-5 border-white/30 border-t-white" />Sending…</> : <><Send className="size-[18px]" strokeWidth={2} />{parent ? 'Send update' : 'Send report'}</>}
      </motion.button>
      <p className="-mt-1 text-center text-[13px] text-fg-3">Photo, voice or text — any one is enough.</p>

      {!parent && mine.length ? (
        <section className="mt-4">
          <SectionTitle>Your reports</SectionTitle>
          <motion.ul variants={stagger()} initial="initial" animate="animate" className={cn(CARD, 'overflow-hidden')}>
            {mine.map((r, i) => {
              const st = liveStatus(r, snap.issues);
              return (
                <motion.li key={r.id} variants={rise} className="relative">
                  {i > 0 ? <span className="absolute top-0 right-0 left-4 h-px origin-top scale-y-50 bg-[rgb(23_21_15/.16)]" aria-hidden /> : null}
                  <button type="button" onClick={() => onOpenReport(r)} className="flex min-h-[60px] w-full items-center gap-3 px-4 py-2 text-left active:bg-[rgb(23_21_15/.04)]">
                    {r.photoUrl ? <img src={r.photoUrl} alt="" className="size-11 shrink-0 rounded-[10px] object-cover" /> : <span className="grid size-11 shrink-0 place-items-center rounded-[10px] bg-[rgb(23_21_15/.05)] text-fg-3"><MapPin className="size-5" strokeWidth={1.75} /></span>}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold text-fg">{r.ai?.title ?? r.text ?? r.transcript ?? 'Report'}</span>
                      <span className="block text-[13px] text-fg-3">{snap.zones.find((z) => z.id === r.zoneId)?.name ?? 'No location'} · {ago(r.createdAt, now)}</span>
                    </span>
                    <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold', STATUS_STYLE[st])}>{REPORT_STATUS_LABEL[st]}</span>
                  </button>
                </motion.li>
              );
            })}
          </motion.ul>
        </section>
      ) : null}

      <ZoneSheet open={zoneOpen} onOpenChange={setZoneOpen} zones={snap.zones} selectedId={zoneId} title="Where is it?"
        onSelect={(z) => { setZoneId(z.id); setZoneOpen(false); }} />
    </div>
  );
}

export function ReportDetail({ id, initial, snap, fresh, onBack, onAddUpdate, onOpenIssue }: {
  id: string; initial: Report | null; snap: Snapshot; fresh: boolean; onBack: () => void; onAddUpdate: (r: Report) => void; onOpenIssue: (i: Issue) => void;
}) {
  const [data, setData] = useState<{ report: Report; issue: Issue | null; related: Report[] } | null>(initial ? { report: initial, issue: null, related: [] } : null);
  const [err, setErr] = useState<string | null>(null);
  const now = useNow(10_000);
  useEffect(() => {
    let alive = true;
    API.getReport(id).then((r) => { if (alive) setData(r); }).catch((e: HttpError) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [id]);
  const report = snap.reports.find((r) => r.id === id) ?? data?.report ?? null;
  const issue = report?.issueId ? snap.issues.find((i) => i.id === report.issueId) ?? data?.issue ?? null : null;
  const linked = issue ? Math.max(report?.linkedReports ?? 1, snap.reports.filter((r) => r.issueId === issue.id).length) : 0;
  const st = report ? liveStatus(report, snap.issues) : 'received';
  const zone = snap.zones.find((z) => z.id === report?.zoneId);
  const reviewingAt = issue?.status !== 'open' ? report?.statusAt.reviewing ?? issue?.updatedAt ?? null : null;
  const resolvedAt = st === 'resolved' ? report?.statusAt.resolved ?? issue?.updatedAt ?? null : null;
  const steps: Array<{ label: string; at: number | null; state: 'done' | 'current' | 'todo' }> = report ? [
    { label: 'Report received', at: report.createdAt, state: 'done' },
    { label: 'Ops team reviewing', at: reviewingAt, state: st === 'reviewing' ? 'current' : st === 'resolved' ? 'done' : 'todo' },
    { label: 'Resolved', at: resolvedAt, state: st === 'resolved' ? 'done' : 'todo' },
  ] : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-1">
        <button type="button" onClick={onBack} aria-label="Back" className="-ml-2 grid size-11 place-items-center rounded-full active:bg-[rgb(23_21_15/.05)]"><ChevronLeft className="size-6" strokeWidth={2} /></button>
        <h1 className="text-[22px] font-bold tracking-[-0.02em] text-fg">Report</h1>
      </div>
      <AnimatePresence>
        {fresh ? (
          <motion.div key="ok" initial={{ opacity: 0, y: -8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={spring.gentle}
            className="flex items-center gap-3 rounded-[16px] bg-[#e8f5ec] px-4 py-3.5">
            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ ...spring.snappy, delay: 0.12 }} className="grid size-9 shrink-0 place-items-center rounded-full bg-[#34a853] text-white"><Check className="size-5" strokeWidth={3} /></motion.span>
            <span><span className="block text-[17px] font-bold text-fg">Report sent</span><span className="block text-[14px] text-fg-2">Shared live with the ops team.</span></span>
          </motion.div>
        ) : null}
      </AnimatePresence>
      {!report ? (err ? <p className="rounded-[14px] bg-[#f5f4f2] p-4 text-[15px] text-fg-2">{err}</p> : <Skeleton className="h-64 rounded-[16px]" />) : (
        <>
          <section className={cn(CARD, 'px-4 py-4')}>
            <div className="flex items-start gap-2">
              <h2 className="flex-1 text-[19px] leading-[25px] font-bold tracking-[-0.015em] text-fg">{report.ai?.title ?? report.text ?? report.transcript ?? 'Field report'}</h2>
              <motion.span key={st} initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring.snappy}
                className={cn('shrink-0 rounded-full px-2.5 py-1 text-[13px] font-semibold', STATUS_STYLE[st])}>{REPORT_STATUS_LABEL[st]}</motion.span>
            </div>
            <p className="mt-1.5 flex items-center gap-3 text-[13px] text-fg-2">
              <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" strokeWidth={1.75} />{zone?.name ?? 'No location'}</span>
              <span className="inline-flex items-center gap-1"><Clock className="size-3.5" strokeWidth={1.75} />{ago(report.createdAt, now)}</span>
            </p>
            <div className="mt-3 flex gap-3">
              {report.photoUrl ? <img src={report.photoUrl} alt="Report photo" className="size-[92px] shrink-0 rounded-[12px] object-cover" /> : null}
              <p className="text-[15px] leading-[22px] text-fg">{report.text ?? report.transcript ?? report.ai?.summary ?? ''}</p>
            </div>
            {report.ai ? (
              <div className="mt-4 rounded-[14px] bg-[#fafaf9] px-3.5 py-3">
                <div className="flex items-center gap-2"><span className="text-[14px] font-semibold text-fg">AI summary</span><AiTag model={report.ai.model} /></div>
                <dl className="mt-2 grid grid-cols-[84px_1fr] gap-y-2 text-[14px] leading-[20px]">
                  <dt className="text-fg-3">Location</dt><dd className="text-fg">{report.ai.location ?? zone?.name ?? '—'}</dd>
                  <dt className="text-fg-3">Situation</dt><dd className="text-fg">{report.ai.situation}</dd>
                  <dt className="text-fg-3">Summary</dt><dd className="text-fg-2">{report.ai.summary}</dd>
                </dl>
              </div>
            ) : null}
          </section>

          {issue ? (
            <motion.button type="button" whileTap={{ scale: 0.985 }} transition={spring.snappy} onClick={() => onOpenIssue(issue)} className={cn(CARD, 'flex items-center gap-3 px-4 py-3.5 text-left')}>
              <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-[#fdf3e3] text-[#c6824b]"><Link2 className="size-5" strokeWidth={1.75} /></span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-[13px] font-semibold text-fg-2">Linked issue <IssueKey k={issue.key} /></span>
                <span className="mt-0.5 block truncate text-[16px] font-semibold text-fg">{issue.title}</span>
                <span className="block text-[13px] text-fg-3">{linked > 1 ? `Reviewing ${linked} reports from the same spot together` : 'Opened from your report'}</span>
              </span>
              <ChevronRight className="size-5 shrink-0 text-fg-3" strokeWidth={1.75} />
            </motion.button>
          ) : null}

          <section className={cn(CARD, 'px-4 py-4')} aria-label="Status">
            <ol className="relative flex flex-col gap-5">
              {steps.map((s, i) => (
                <li key={s.label} className="relative flex items-center gap-3">
                  {i < steps.length - 1 ? <span className={cn('absolute top-6 left-[11px] h-[calc(100%+4px)] w-0.5', s.state === 'done' ? 'bg-[#34a853]' : 'bg-[rgb(23_21_15/.1)]')} aria-hidden /> : null}
                  <motion.span layout transition={spring.smooth}
                    className={cn('relative grid size-6 shrink-0 place-items-center rounded-full',
                      s.state === 'done' ? 'bg-[#34a853] text-white' : s.state === 'current' ? 'border-[3px] border-[#e8a33a] bg-white' : 'border-2 border-[rgb(23_21_15/.15)] bg-white')}>
                    {s.state === 'done' ? <Check className="size-3.5" strokeWidth={3} /> : null}
                  </motion.span>
                  <span className={cn('flex-1 text-[16px]', s.state === 'todo' ? 'text-fg-3' : 'font-semibold text-fg')}>{s.label}</span>
                  {s.at ? <span className="text-[13px] tabular-nums text-fg-3">{clock(s.at)}</span> : null}
                </li>
              ))}
            </ol>
          </section>

          <motion.button type="button" whileTap={{ scale: 0.97 }} transition={spring.snappy} onClick={() => onAddUpdate(report)}
            className={cn(CARD, 'flex h-[52px] items-center justify-center gap-2 text-[16px] font-semibold text-fg')}>
            <Plus className="size-5" strokeWidth={2} />Add an update
          </motion.button>
        </>
      )}
    </div>
  );
}
