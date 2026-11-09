// Chat — the staff phone's one place to ask AND to report. Ask anything (live answers with maps and issue cards), or tap +
// to attach a photo or a short video (3 key frames) and say what's wrong: it becomes a tracked issue for the team, and the
// reply is a live receipt (Received → On it → Done) with the spot on the map.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { toast } from 'sonner';
import { ArrowUp, Camera, Film, Image as ImageIcon, Lightbulb, MapPin, Mic, Plus, RotateCw, Square, Users, X } from 'lucide-react';
import type { Issue, Me, Report, Snapshot } from '@shared/contracts';
import { API, HttpError, blobToDataUrl } from '@/lib/api';
import type { useLive } from '@/lib/live';
import { useAssistant, type Turn } from '@/comms/assistant';
import { cn } from '@/lib/utils';
import { rise, spring } from '@/design/motion';
import { AnswerAttachments, InlineMapCard, RevealMarkdown, Thinking } from '@/components/chat/parts';
import { HAIR, Spinner } from '../common';
import { useTalkRecorder } from '../ops/recorder';
import { haptic } from './shell';

type Apply = ReturnType<typeof useLive>['apply'];
type Att = { id: string; url: string; video?: string };
type Sent = {
  id: string; at: number; text: string; thumbs: string[]; video: boolean; voice: boolean; state: 'sending' | 'sent' | 'error';
  reportId?: string; issueId?: string | null; issueKey?: string | null; title?: string | null; zoneId?: string | null; err?: string;
  retry?: { photos: string[]; audio: string | null };
};

const MAX = 4;
const rid = () => Math.random().toString(36).slice(2);

// ── media helpers ───────────────────────────────────────────────────────────────────────────────────────────────────

function drawJpeg(src: CanvasImageSource, w: number, h: number, max = 1280, q = 0.8): string {
  const k = Math.min(1, max / Math.max(w, h, 1));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', q);
}
async function imageToJpeg(file: Blob): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Couldn’t read that photo')); i.src = url; });
    return drawJpeg(img, img.naturalWidth, img.naturalHeight);
  } finally { URL.revokeObjectURL(url); }
}
function waitFor(el: HTMLVideoElement, ev: string, ms: number) {
  return new Promise<void>((res, rej) => {
    const done = (fn: () => void) => () => { clearTimeout(t); el.removeEventListener(ev, ok); el.removeEventListener('error', bad); fn(); };
    const ok = done(res);
    const bad = done(() => rej(new Error('Couldn’t read that video')));
    const t = setTimeout(done(() => rej(new Error('That video took too long to read'))), ms);
    el.addEventListener(ev, ok, { once: true });
    el.addEventListener('error', bad, { once: true });
  });
}
/** Three key frames (~20 / 50 / 80 %) via a hidden <video> + canvas, each ≤ 1280 px JPEG. */
async function videoFrames(file: Blob, at = [0.2, 0.5, 0.8]): Promise<string[]> {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto';
  v.setAttribute('playsinline', ''); v.setAttribute('muted', '');
  try {
    const ready = waitFor(v, 'loadeddata', 10_000);
    v.src = url; v.load();
    await ready;
    const d = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 1;
    const out: string[] = [];
    for (const f of at) {
      const seeked = waitFor(v, 'seeked', 8000);
      v.currentTime = Math.min(Math.max(0, d - 0.05), d * f);
      await seeked;
      out.push(drawJpeg(v, v.videoWidth, v.videoHeight));
    }
    return out;
  } finally { URL.revokeObjectURL(url); v.removeAttribute('src'); }
}

const loadSent = (eventId: string): Sent[] => { try { return JSON.parse(sessionStorage.getItem(`wayve:chat-sent:${eventId}`) ?? '[]') as Sent[]; } catch { return []; } };
const saveSent = (eventId: string, s: Sent[]) => {
  try { sessionStorage.setItem(`wayve:chat-sent:${eventId}`, JSON.stringify(s.filter((x) => x.state === 'sent').slice(-30).map((x) => ({ ...x, thumbs: x.thumbs.filter((t) => !t.startsWith('data:')), retry: undefined })))); } catch { /* storage off */ }
};

// ── tab ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function ChatTab({ snap, me, apply, myZoneId, onOpenIssue }: { snap: Snapshot; me: Me; apply: Apply; myZoneId: string | null; onOpenIssue: (i: Issue) => void }) {
  const asst = useAssistant(me.eventId);
  const { turns, busy } = asst;
  const [sent, setSent] = useState<Sent[]>(() => loadSent(me.eventId));
  const [text, setText] = useState('');
  const [atts, setAtts] = useState<Att[]>([]);
  const [reading, setReading] = useState(false);
  const [menu, setMenu] = useState(false);
  const [dock, setDock] = useState(96);
  const dockRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const libRef = useRef<HTMLInputElement>(null);
  const vidRef = useRef<HTMLInputElement>(null);

  useEffect(() => { saveSent(me.eventId, sent); }, [me.eventId, sent]);
  useLayoutEffect(() => {
    const el = dockRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setDock(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const count = turns.length + sent.length;
  useEffect(() => { if (count) requestAnimationFrame(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' })); }, [count, turns[turns.length - 1]?.res]);

  const timeline = useMemo(() => [
    ...turns.map((t) => ({ kind: 'turn' as const, at: t.at, t })),
    ...sent.map((s) => ({ kind: 'sent' as const, at: s.at, s })),
  ].sort((a, b) => a.at - b.at), [turns, sent]);

  // ── attachments ──
  const addPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    const room = MAX - atts.length;
    if (room <= 0) { toast('Up to 4 photos', { description: 'Remove one to add another.' }); return; }
    setReading(true);
    try {
      const urls = await Promise.all([...files].slice(0, room).map(imageToJpeg));
      setAtts((a) => [...a, ...urls.map((url) => ({ id: rid(), url }))].slice(0, MAX));
      if (files.length > room) toast('Up to 4 photos', { description: `Added the first ${room}.` });
      haptic(8);
    } catch (e) { toast.error((e as Error).message); } finally { setReading(false); }
  };
  const addVideo = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    try {
      const frames = await videoFrames(file);
      const vid = rid();
      setAtts((a) => [...a.filter((x) => !x.video).slice(0, MAX - frames.length), ...frames.map((url) => ({ id: rid(), url, video: vid }))]);
      haptic(8);
    } catch (e) { toast.error((e as Error).message, { description: 'Try a photo instead.' }); } finally { setReading(false); }
  };
  const remove = (a: Att) => setAtts((cur) => cur.filter((x) => (a.video ? x.video !== a.video : x.id !== a.id)));
  const pick = (r: React.RefObject<HTMLInputElement | null>) => { setMenu(false); r.current?.click(); };

  // ── send ──
  const report = async (item: Sent, photos: string[], audio: string | null) => {
    const patch = (p: Partial<Sent>) => setSent((all) => all.map((x) => (x.id === item.id ? { ...x, ...p } : x)));
    const body = { eventId: me.eventId, category: 'auto' as const, urgency: 'auto' as const, text: item.text || null, photo: photos[0] ?? null, photos, audio, hereZoneId: myZoneId ?? null };
    try {
      let r: { report: Report; issue: Issue | null };
      try { r = await API.createReport(body); }
      catch (e) { if (e instanceof HttpError && e.status === 400) r = await API.createReport({ ...body, category: 'other', urgency: 'normal', photos: undefined }); else throw e; }
      apply({ kind: 'report', data: r.report });
      if (r.issue) apply({ kind: 'issue', data: r.issue });
      patch({
        state: 'sent', reportId: r.report.id, issueId: r.issue?.id ?? r.report.issueId, issueKey: r.issue?.key ?? r.report.issueKey,
        title: r.report.ai?.title ?? r.issue?.title ?? null, zoneId: r.report.zoneId ?? r.issue?.zoneId ?? null,
        thumbs: r.report.photoUrl ? [r.report.photoUrl, ...item.thumbs.slice(1)] : item.thumbs, retry: undefined,
      });
      haptic([20, 30, 20]);
    } catch (e) {
      patch({ state: 'error', err: (e as Error).message, retry: { photos, audio } });
      toast.error('Couldn’t send that', { description: (e as Error).message });
    }
  };
  const sendReport = (photos: string[], q: string, audio: string | null, video: boolean) => {
    const item: Sent = { id: rid(), at: Date.now(), text: q, thumbs: photos, video, voice: !!audio, state: 'sending' };
    setSent((s) => [...s, item]);
    setAtts([]); setText(''); setMenu(false);
    haptic(12);
    void report(item, photos, audio);
  };
  const send = () => {
    const q = text.trim();
    if (atts.length) { sendReport(atts.map((a) => a.url), q, null, atts.some((a) => a.video)); return; }
    if (!q || busy) return;
    setText(''); haptic(8);
    void asst.ask(q);
  };
  const rec = useTalkRecorder({
    maxMs: 30_000,
    onBlob: async (blob) => {
      if (atts.length) { sendReport(atts.map((a) => a.url), text.trim(), await blobToDataUrl(blob), atts.some((a) => a.video)); return; }
      await asst.askVoice(blob, { speak: false });
    },
    onDenied: (msg) => toast.error('Microphone is off', { description: msg }),
  });
  const recording = rec.state === 'recording';
  const canSend = (!!text.trim() || atts.length > 0) && !reading && (atts.length > 0 || !busy);

  const entrance = (snap.zones.find((z) => /^entrance$/i.test(z.name)) ?? snap.zones.find((z) => /entrance/i.test(z.name)) ?? snap.zones[0])?.name ?? 'the Entrance';
  const suggestions = [
    { q: 'What needs me right now?', icon: Lightbulb, run: () => void asst.ask('What needs me right now?') },
    { q: 'Report something', icon: Camera, run: () => setMenu(true) },
    { q: 'Where is the nearest first aid?', icon: MapPin, run: () => void asst.ask('Where is the nearest first aid?') },
    { q: `Who's at ${entrance.startsWith('the ') ? entrance : `the ${entrance}`}?`, icon: Users, run: () => void asst.ask(`Who's at the ${entrance.replace(/^the /, '')}?`) },
  ];

  return (
    <div>
      {timeline.length === 0 ? (
        <motion.div variants={rise} initial="initial" animate="animate" className="pt-3">
          <p className="text-[30px] leading-[36px] font-bold tracking-[-0.03em] text-fg">What do you need?</p>
          <p className="mt-2 text-[15px] leading-[22px] text-fg-2">Ask about anything on site — or attach a photo or video of a problem and it goes straight to the team.</p>
          <div className="mt-5 grid grid-cols-2 gap-2">
            {suggestions.map((s, i) => (
              <motion.button key={s.q} type="button" onClick={() => { haptic(8); s.run(); }} disabled={busy && s.icon !== Camera}
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.smooth, delay: 0.04 * i }} whileTap={{ scale: 0.97 }}
                className={cn('flex min-h-[84px] flex-col items-start justify-between gap-2 rounded-[18px] bg-white p-3.5 text-left disabled:opacity-50', HAIR)}>
                <s.icon className="size-[19px] text-fg-2" strokeWidth={1.8} />
                <span className="text-[14.5px] leading-[19px] font-semibold text-fg">{s.q}</span>
              </motion.button>
            ))}
          </div>
        </motion.div>
      ) : (
        <div className="flex flex-col gap-6 pt-2">
          {timeline.map((row) => row.kind === 'turn'
            ? <TurnView key={row.t.id} t={row.t} last={row.t.id === turns[turns.length - 1]?.id} snap={snap} onOpenIssue={onOpenIssue} onRetry={() => asst.retry(row.t)} />
            : <SentView key={row.s.id} s={row.s} snap={snap} onOpenIssue={onOpenIssue}
                onRetry={() => { const r = row.s.retry; if (!r) return; setSent((all) => all.map((x) => (x.id === row.s.id ? { ...x, state: 'sending', err: undefined } : x))); void report(row.s, r.photos, r.audio); }} />)}
        </div>
      )}
      <div aria-hidden style={{ height: dock + 12 }} />

      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files; void addPhotos(f).finally(() => { e.target.value = ''; }); }} />
      <input ref={libRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { const f = e.target.files; void addPhotos(f).finally(() => { e.target.value = ''; }); }} />
      <input ref={vidRef} type="file" accept="video/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void addVideo(f); }} />

      <div ref={dockRef} className="fixed inset-x-0 z-(--z-sticky)" style={{ bottom: 'calc(var(--safe-b) + 62px)' }}>
        <div className="mx-auto max-w-[640px] bg-[linear-gradient(to_top,rgb(245_244_242)_62%,rgb(245_244_242/0))] px-3 pt-5 pb-2">
          <AnimatePresence>
            {menu ? (
              <motion.div initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }} transition={spring.snappy}
                className={cn('mb-2 grid grid-cols-3 gap-1.5 rounded-[22px] bg-white p-1.5 shadow-[0_18px_40px_-20px_rgb(23_21_15/.45)]', HAIR)}>
                {[
                  { label: 'Camera', Icon: Camera, r: camRef },
                  { label: 'Photos', Icon: ImageIcon, r: libRef },
                  { label: 'Video', Icon: Film, r: vidRef },
                ].map(({ label, Icon, r }) => (
                  <motion.button key={label} type="button" whileTap={{ scale: 0.95 }} transition={spring.snappy} onClick={() => { haptic(8); pick(r); }}
                    className="flex h-[76px] flex-col items-center justify-center gap-1.5 rounded-[16px] bg-[#f5f4f2] text-[13.5px] font-semibold text-fg active:bg-[#eceae6]">
                    <Icon className="size-[22px]" strokeWidth={1.8} />{label}
                  </motion.button>
                ))}
              </motion.div>
            ) : null}
          </AnimatePresence>
          <div className={cn('rounded-[24px] bg-white shadow-[0_1px_2px_rgb(23_21_15/.04),0_10px_28px_-14px_rgb(23_21_15/.3)]', HAIR)}>
            <AnimatePresence initial={false}>
              {atts.length || reading ? (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={spring.smooth} className="overflow-hidden">
                  <div className="flex gap-2 overflow-x-auto px-2.5 pt-2.5">
                    <Thumbs atts={atts} onRemove={remove} />
                    {reading ? <span className="grid size-[64px] shrink-0 place-items-center rounded-[14px] bg-[#f5f4f2]"><Spinner className="size-5" /></span> : null}
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
            <div className="flex items-end gap-1 py-1.5 pr-1.5 pl-1.5">
              <motion.button type="button" onClick={() => { haptic(8); setMenu((m) => !m); }} aria-label={menu ? 'Close attachments' : 'Attach a photo or video'} aria-expanded={menu}
                animate={{ rotate: menu ? 45 : 0 }} transition={spring.snappy}
                className="grid size-10 shrink-0 place-items-center rounded-full bg-[#f5f4f2] text-fg active:bg-[#eceae6]">
                <Plus className="size-[21px]" strokeWidth={2} />
              </motion.button>
              <AutoText inputRef={inputRef} value={text} onChange={setText} onSend={() => { if (canSend) send(); }} onFocus={() => setMenu(false)}
                placeholder={atts.length ? 'What’s going on here?' : recording ? 'Listening…' : 'Ask, or attach a photo'} />
              {!text.trim() && !reading ? (
                <button type="button" onClick={() => { haptic(12); rec.toggle(); }} aria-label={recording ? 'Stop and send' : atts.length ? 'Describe it by voice' : 'Ask by voice'}
                  className={cn('relative grid size-10 shrink-0 place-items-center rounded-full transition-colors', recording ? 'bg-[#e5484d] text-white' : atts.length ? 'bg-[#17150f] text-white' : 'text-fg-2 active:bg-[rgb(23_21_15/.06)]')}>
                  {recording ? <motion.span className="absolute inset-0 rounded-full bg-[#e5484d]" animate={{ scale: [1, 1.12 + rec.level * 0.5, 1], opacity: [0.5, 0, 0.5] }} transition={{ duration: 1.1, repeat: Infinity }} /> : null}
                  {recording ? <Square className="relative size-3.5 fill-white" strokeWidth={0} /> : <Mic className="size-[19px]" strokeWidth={1.9} />}
                </button>
              ) : null}
              {text.trim() || atts.length ? (
                <motion.button type="button" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring.snappy} onClick={send} disabled={!canSend} aria-label={atts.length ? 'Send to the team' : 'Send'}
                  className="grid size-10 shrink-0 place-items-center rounded-full bg-[#17150f] text-white disabled:opacity-30">
                  {busy && !atts.length ? <Spinner className="size-4 border-white/30 border-t-white" /> : <ArrowUp className="size-[19px]" strokeWidth={2.25} />}
                </motion.button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AutoText({ value, onChange, onSend, onFocus, placeholder, inputRef }: {
  value: string; onChange: (v: string) => void; onSend: () => void; onFocus: () => void; placeholder: string; inputRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(140, Math.max(24, el.scrollHeight))}px`;
  }, [value, inputRef]);
  return (
    <textarea ref={inputRef} value={value} onChange={(e) => onChange(e.target.value)} onFocus={onFocus} rows={1} placeholder={placeholder} aria-label="Message" maxLength={800} enterKeyHint="send"
      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); onSend(); } }}
      className="max-h-[140px] min-h-[24px] flex-1 resize-none bg-transparent px-1.5 py-[9px] text-[16px] leading-[22px] text-fg outline-none placeholder:text-fg-3" />
  );
}

function Thumbs({ atts, onRemove }: { atts: Att[]; onRemove: (a: Att) => void }) {
  const photos = atts.filter((a) => !a.video);
  const video = atts.filter((a) => a.video);
  return (
    <>
      {photos.map((a) => (
        <motion.span key={a.id} initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring.snappy} className="relative size-[64px] shrink-0">
          <img src={a.url} alt="" className="size-full rounded-[14px] object-cover shadow-[inset_0_0_0_.5px_rgb(23_21_15/.1)]" />
          <RemoveBtn onClick={() => onRemove(a)} />
        </motion.span>
      ))}
      {video.length ? (
        <motion.span initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring.snappy} className="relative flex h-[64px] shrink-0">
          <span className="flex overflow-hidden rounded-[14px] bg-[#17150f]">
            {video.map((a) => <img key={a.id} src={a.url} alt="" className="h-[64px] w-[48px] object-cover" />)}
          </span>
          <span className="absolute bottom-1 left-1 inline-flex h-5 items-center gap-1 rounded-full bg-black/60 px-1.5 text-[10.5px] font-semibold text-white"><Film className="size-3" strokeWidth={2.25} />{video.length} frames</span>
          <RemoveBtn onClick={() => onRemove(video[0])} />
        </motion.span>
      ) : null}
    </>
  );
}
function RemoveBtn({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label="Remove" className="absolute -top-1.5 -right-1.5 grid size-6 place-items-center rounded-full bg-[#17150f] text-white ring-2 ring-white">
      <X className="size-3.5" strokeWidth={2.5} />
    </button>
  );
}

function TurnView({ t, last, snap, onOpenIssue, onRetry }: { t: Turn; last: boolean; snap: Snapshot; onOpenIssue: (i: Issue) => void; onRetry: () => void }) {
  return (
    <motion.div variants={rise} initial="initial" animate="animate" className="flex flex-col gap-2.5">
      <p className="max-w-[85%] self-end rounded-[20px] bg-[rgb(23_21_15/.07)] px-4 py-2.5 text-[16px] leading-[23px] text-fg">
        {t.voice ? <Mic className="mr-1.5 inline size-3.5 align-[-2px] text-fg-3" strokeWidth={2} /> : null}{t.q}
      </p>
      {t.err ? (
        <p className="flex items-center gap-2 text-[15px] text-[#b91c1c]">{t.err}
          {!t.voice ? <button type="button" onClick={onRetry} className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-[13px] font-semibold text-fg-2 active:bg-[rgb(23_21_15/.05)]"><RotateCw className="size-3.5" />Retry</button> : null}
        </p>
      ) : !t.res ? <Thinking label="Reading the live event" /> : (
        <div>
          <RevealMarkdown text={t.res.answer} animate={last} className="text-[16px] leading-[24px]"
            onIssue={(k) => { const i = snap.issues.find((x) => x.key === k || x.id === k); if (i) onOpenIssue(i); }} />
          <AnswerAttachments res={t.res} snap={snap} compact nav={{ onOpenIssue }} />
        </div>
      )}
    </motion.div>
  );
}

const STEPS = ['Received', 'On it', 'Done'] as const;

function SentView({ s, snap, onOpenIssue, onRetry }: { s: Sent; snap: Snapshot; onOpenIssue: (i: Issue) => void; onRetry: () => void }) {
  const live = s.reportId ? snap.reports.find((r) => r.id === s.reportId) : undefined;
  const issueId = s.issueId ?? live?.issueId ?? null;
  const issue = issueId ? snap.issues.find((i) => i.id === issueId) : undefined;
  const key = issue?.key ?? s.issueKey ?? live?.issueKey ?? null;
  const title = live?.ai?.title ?? s.title ?? issue?.title ?? (s.state === 'sending' ? 'Sending to the team…' : 'Report received');
  const zoneId = live?.zoneId ?? s.zoneId ?? issue?.zoneId ?? null;
  const zone = zoneId ? snap.zones.find((z) => z.id === zoneId) : undefined;
  const step = issue ? (issue.status === 'done' ? 2 : issue.status === 'open' ? 0 : 1) : live ? (live.status === 'resolved' ? 2 : live.status === 'reviewing' ? 1 : 0) : 0;
  const who = issue?.assigneeId ? snap.participants.find((p) => p.id === issue.assigneeId)?.displayName ?? null : null;
  const thumb = s.thumbs[0] ?? live?.photoUrl ?? null;

  return (
    <motion.div variants={rise} initial="initial" animate="animate" className="flex flex-col gap-2.5">
      <div className="flex max-w-[85%] flex-col items-end gap-1.5 self-end">
        <div className="flex gap-1">
          {s.video ? (
            <span className="relative flex overflow-hidden rounded-[16px] bg-[#17150f]">
              {s.thumbs.slice(0, 3).map((u, i) => <img key={i} src={u} alt="" className="h-[96px] w-[64px] object-cover" />)}
              <span className="absolute bottom-1.5 left-1.5 inline-flex h-5 items-center gap-1 rounded-full bg-black/60 px-1.5 text-[10.5px] font-semibold text-white"><Film className="size-3" />Video</span>
            </span>
          ) : s.thumbs.slice(0, 4).map((u, i) => <img key={i} src={u} alt="" className="size-[96px] rounded-[16px] object-cover shadow-[inset_0_0_0_.5px_rgb(23_21_15/.1)]" />)}
        </div>
        {s.text || s.voice ? (
          <p className="rounded-[20px] bg-[rgb(23_21_15/.07)] px-4 py-2.5 text-[16px] leading-[23px] text-fg">
            {s.voice ? <Mic className="mr-1.5 inline size-3.5 align-[-2px] text-fg-3" strokeWidth={2} /> : null}{s.text || (live?.transcript ?? 'Voice note')}
          </p>
        ) : null}
      </div>

      <motion.div role={issue ? 'button' : undefined} tabIndex={issue ? 0 : undefined} whileTap={issue ? { scale: 0.985 } : undefined} transition={spring.snappy}
        onClick={() => { if (issue) onOpenIssue(issue); }} onKeyDown={(e) => { if (issue && e.key === 'Enter') onOpenIssue(issue); }}
        className={cn('w-full overflow-hidden rounded-[20px] bg-white text-left', issue && 'cursor-pointer', HAIR)}>
        <div className="flex gap-3 p-3">
          <span className="relative size-[60px] shrink-0 overflow-hidden rounded-[13px] bg-[#f5f4f2]">
            {thumb ? <img src={thumb} alt="" className="size-full object-cover" /> : <Camera className="m-auto mt-[19px] size-5 text-fg-3" />}
            {s.state === 'sending' ? <span className="absolute inset-0 grid place-items-center bg-white/60"><Spinner className="size-5" /></span> : null}
          </span>
          <span className="min-w-0 flex-1">
            <span className={cn('block text-[11.5px] font-semibold tracking-[.05em] uppercase', s.state === 'error' ? 'text-[#b91c1c]' : 'text-fg-3')}>
              {s.state === 'sending' ? 'Sending' : s.state === 'error' ? 'Not sent' : 'Sent to the team'}{key ? <> · <span className="font-mono tracking-normal">{key}</span></> : null}
            </span>
            <span className="mt-0.5 line-clamp-2 block text-[15.5px] leading-[21px] font-semibold text-fg">{s.state === 'error' ? (s.err ?? 'Something went wrong') : title}</span>
            <span className="mt-0.5 flex items-center gap-1 truncate text-[13px] text-fg-2">
              {zone ? <><MapPin className="size-3.5 shrink-0" strokeWidth={2} />{zone.name}</> : s.state === 'sent' ? 'Location from the photo' : null}
              {who ? <span className="truncate text-fg-3"> · {who}</span> : null}
            </span>
          </span>
        </div>
        {s.state === 'error' ? (
          <div className="border-t border-[rgb(23_21_15/.06)] px-3 py-2">
            <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); onRetry(); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onRetry(); } }}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#17150f] px-3.5 text-[13.5px] font-semibold text-white"><RotateCw className="size-3.5" />Try again</span>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1.5 border-t border-[rgb(23_21_15/.06)] px-3 pt-2.5 pb-3" aria-label={`Status: ${STEPS[step]}`}>
            {STEPS.map((label, i) => (
              <span key={label} className="flex flex-col gap-1.5">
                <span className="h-1 overflow-hidden rounded-full bg-[rgb(23_21_15/.08)]">
                  <motion.span className={cn('block h-full rounded-full', step === 2 ? 'bg-[#2f7a45]' : 'bg-[#17150f]')}
                    initial={false} animate={{ width: s.state === 'sent' && i <= step ? '100%' : '0%' }} transition={{ ...spring.smooth, delay: 0.08 * i }} />
                </span>
                <span className={cn('text-[12px] font-semibold', s.state === 'sent' && i <= step ? 'text-fg' : 'text-fg-3')}>{label}</span>
              </span>
            ))}
          </div>
        )}
      </motion.div>
      {zoneId && s.state === 'sent' ? <InlineMapCard snap={snap} zoneIds={[zoneId]} issueIds={issue ? [issue.id] : []} deviceIds={[]} height={170} /> : null}
    </motion.div>
  );
}
