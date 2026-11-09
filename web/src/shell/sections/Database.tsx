// Database: every table WAYVE writes, live. Counts tick, new rows slide in, any table exports as CSV.
// "Stream" shows the append-only feed of records as they land (newest first).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, ChevronRight, ClipboardCopy, Database as DbIcon, Download, Rows3, Search, Waves } from 'lucide-react';
import { toast } from 'sonner';
import { DATA_TABLE_LABEL, DATA_TABLES, type DataPage as DataPageT, type DataTable, type Snapshot } from '@shared/contracts';
import { API } from '@/lib/api';
import { ago, clock, useNow } from '@/lib/time';
import { spring } from '@/design/motion';
import { AnimatedNumber } from '@/components/AnimatedNumber';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useShell } from '../context';
import { Empty, SectionHeader, Spark, panel } from '../ui';

const PAGE = 100;
const APPEND: DataTable[] = ['issues', 'reports', 'utterances', 'messages', 'observations', 'issue_events', 'proposals', 'incidents'];

/** Record timestamps per table from the live snapshot (for rows/minute and the stream). */
function stamps(snap: Snapshot, t: DataTable): number[] {
  switch (t) {
    case 'issues': return snap.issues.map((x) => x.createdAt);
    case 'reports': return snap.reports.map((x) => x.createdAt);
    case 'utterances': return snap.utterances.map((x) => x.startedAt);
    case 'messages': return snap.messages.map((x) => x.createdAt);
    case 'observations': return snap.observations.map((x) => x.observedAt);
    case 'issue_events': return snap.issueEvents.map((x) => x.at);
    case 'proposals': return snap.proposals.map((x) => x.createdAt);
    case 'incidents': return snap.incidents.map((x) => x.createdAt);
    default: return [];
  }
}
function perMinute(ts: number[], now: number, minutes = 15): number[] {
  const b = new Array(minutes).fill(0);
  for (const t of ts) { const k = Math.floor((now - t) / 60_000); if (k >= 0 && k < minutes) b[minutes - 1 - k]++; }
  return b;
}

type StreamRow = { id: string; at: number; table: DataTable; text: string };
function streamRows(snap: Snapshot): StreamRow[] {
  const out: StreamRow[] = [];
  for (const u of snap.utterances) out.push({ id: `u${u.id}`, at: u.startedAt, table: 'utterances', text: `${u.speaker}: “${u.text}”` });
  for (const e of snap.issueEvents) out.push({ id: `e${e.id}`, at: e.at, table: 'issue_events', text: `${e.issueKey} ${e.kind}${e.to ? ` → ${e.to}` : ''} · ${e.actorName}` });
  for (const r of snap.reports) out.push({ id: `r${r.id}`, at: r.createdAt, table: 'reports', text: `${r.authorName}: ${r.ai?.title ?? r.text ?? r.transcript ?? 'Report'}` });
  for (const m of snap.messages) out.push({ id: `m${m.id}`, at: m.createdAt, table: 'messages', text: `${m.fromName} → ${m.to.label}: “${m.text}”` });
  for (const o of snap.observations) out.push({ id: `o${o.id}`, at: o.observedAt, table: 'observations', text: `${o.modality} · ${'summary' in o.payload ? o.payload.summary : 'note' in o.payload ? o.payload.note ?? 'manual' : ''}` });
  for (const p of snap.proposals) out.push({ id: `p${p.id}`, at: p.createdAt, table: 'proposals', text: `${p.summary} (${Math.round(p.confidence * 100)}%)` });
  for (const i of snap.issues) out.push({ id: `i${i.id}`, at: i.createdAt, table: 'issues', text: `${i.key} ${i.title}` });
  return out.sort((a, b) => b.at - a.at).slice(0, 200);
}

export default function DatabaseSection() {
  const { snap, eventId, lastFrameAt } = useShell();
  const now = useNow(1000);
  const [table, setTable] = useState<DataTable>('issues');
  const [mode, setMode] = useState<'table' | 'stream'>('table');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<DataPageT | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState(0);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [totals, setTotals] = useState<Partial<Record<DataTable, number>>>({});
  const known = useRef<Set<string> | null>(null);

  const load = useCallback(async (keepFresh = true) => {
    try {
      const p = await API.data(eventId, table, { limit: PAGE, offset, q });
      const key = (r: Record<string, unknown>) => String(r.id ?? JSON.stringify(r));
      if (keepFresh && known.current) {
        const n = new Set(p.rows.map(key).filter((k) => !known.current!.has(k)));
        if (n.size) { setFresh(n); setTimeout(() => setFresh(new Set()), 1600); }
      }
      known.current = new Set(p.rows.map(key));
      setPage(p); setErr(null); setUpdatedAt(Date.now());
      setTotals((t) => ({ ...t, [table]: p.total }));
    } catch (e) { setErr((e as Error).message); }
  }, [eventId, table, offset, q]);

  const loadTotals = useCallback(async () => {
    const res = await Promise.all(DATA_TABLES.map((t) => API.data(eventId, t, { limit: 1 }).then((p) => [t, p.total] as const).catch(() => null)));
    setTotals(Object.fromEntries(res.filter(Boolean) as Array<readonly [DataTable, number]>));
  }, [eventId]);

  useEffect(() => { known.current = null; setPage(null); void load(false); }, [table, offset, q]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void loadTotals(); }, [loadTotals]);

  // Live: refetch the open table + totals shortly after any frame (debounced).
  const t1 = useRef<ReturnType<typeof setTimeout> | null>(null);
  const t2 = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!lastFrameAt) return;
    if (t1.current) clearTimeout(t1.current);
    t1.current = setTimeout(() => void load(true), 400);
    if (t2.current) clearTimeout(t2.current);
    t2.current = setTimeout(() => void loadTotals(), 1500);
  }, [lastFrameAt]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (t1.current) clearTimeout(t1.current); if (t2.current) clearTimeout(t2.current); }, []);

  const lastMinute = useMemo(() => (snap ? APPEND.reduce((n, t) => n + stamps(snap, t).filter((s) => now - s < 60_000).length, 0) : 0), [snap, now]);
  const stream = useMemo(() => (snap ? streamRows(snap) : []), [snap]);
  const streamFresh = useRef<Set<string> | null>(null);
  const newStream = useMemo(() => {
    const prev = streamFresh.current;
    const ids = new Set(stream.map((r) => r.id));
    streamFresh.current = ids;
    if (!prev) return new Set<string>();
    return new Set(stream.filter((r) => !prev.has(r.id)).map((r) => r.id));
  }, [stream]);

  const copyCsv = async () => {
    try {
      const r = await fetch(API.dataCsvUrl(eventId, table), { credentials: 'same-origin' });
      if (!r.ok) throw new Error('Export failed');
      await navigator.clipboard.writeText((await r.text()).replace(/^﻿/, ''));
      toast.success(`${DATA_TABLE_LABEL[table]} copied as CSV`);
    } catch (e) { toast.error((e as Error).message); }
  };

  const cols = page?.columns ?? [];
  return (
    <div className="flex h-dvh flex-col md:h-[100dvh]">
      <div className="px-5 pt-7 md:px-8 lg:px-10">
        <SectionHeader title="Database" sub="Every record WAYVE writes — transcripts, radio, reports, observations, issue history — live. Export any table as CSV."
          actions={
            <>
              <span className={cn('inline-flex h-8 items-center gap-2 rounded-full px-3 text-[13px] font-medium tabular-nums', lastMinute ? 'bg-[#eaf5ec] text-[#2f6b3c]' : 'bg-[#f4f3f1] text-fg-2')}>
                <span className="live-dot" style={{ color: lastMinute ? '#3f9a55' : '#9a988f' }} data-ping={lastMinute ? true : undefined} />
                <span>Live · +<AnimatedNumber value={lastMinute} /> rows in the last minute</span>
              </span>
              <ToggleGroup type="single" variant="segmented" size="sm" value={mode} onValueChange={(v) => v && setMode(v as 'table' | 'stream')} aria-label="View">
                <ToggleGroupItem value="table"><Rows3 />Tables</ToggleGroupItem>
                <ToggleGroupItem value="stream"><Waves />Stream</ToggleGroupItem>
              </ToggleGroup>
            </>
          } />
      </div>

      {mode === 'stream' ? (
        <div className="min-h-0 flex-1 px-5 pt-5 pb-8 md:px-8 lg:px-10">
          <div className={cn(panel, 'h-full overflow-auto')}>
            {stream.length === 0 ? <Empty icon={Waves} title="Nothing written yet" body="Records appear here the moment a phone, a meeting or the radio produces them." /> : (
              <table className="w-full border-collapse text-[13px]">
                <thead className="sticky top-0 z-10 bg-[#fafaf9]"><tr>
                  {['time', 'table', 'record'].map((c) => <th key={c} className="border-b border-[rgb(23_21_15/.1)] px-4 py-2 text-left font-mono text-[11px] font-semibold text-fg-2">{c}</th>)}
                </tr></thead>
                <tbody>
                  <AnimatePresence initial={false}>
                    {stream.map((r) => (
                      <motion.tr key={r.id} layout initial={{ opacity: 0, y: -6 }} transition={spring.smooth}
                        animate={{ opacity: 1, y: 0, backgroundColor: newStream.has(r.id) ? ['rgba(255,214,153,.5)', 'rgba(255,214,153,0)'] : 'rgba(255,255,255,0)' }}
                        className="border-b border-[rgb(23_21_15/.05)]">
                        <td className="px-4 py-2 whitespace-nowrap text-fg-3 tabular-nums">{clock(r.at)}</td>
                        <td className="px-4 py-2 whitespace-nowrap"><span className="rounded-[6px] bg-[#f4f3f1] px-1.5 py-0.5 font-mono text-[11px] text-fg-2">{r.table}</span></td>
                        <td className="max-w-[900px] truncate px-4 py-2 text-fg">{r.text}</td>
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
            )}
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 gap-5 px-5 pt-5 pb-8 md:grid-cols-[250px_minmax(0,1fr)] md:px-8 lg:px-10">
          <nav className={cn(panel, 'min-h-0 overflow-auto p-2')} aria-label="Tables">
            {DATA_TABLES.map((t) => {
              const spark = snap && APPEND.includes(t) ? perMinute(stamps(snap, t), now) : null;
              return (
                <button key={t} type="button" onClick={() => { setTable(t); setOffset(0); }}
                  className={cn('relative flex h-10 w-full items-center gap-2 rounded-[9px] px-2.5 text-left text-[13px]', table === t ? 'font-semibold text-fg' : 'text-fg-2 hover:text-fg')}>
                  {table === t ? <motion.span layoutId="db-table" transition={spring.smooth} className="absolute inset-0 rounded-[9px] bg-[rgb(23_21_15/.055)]" /> : null}
                  <span className="relative min-w-0 flex-1 truncate">{DATA_TABLE_LABEL[t]}</span>
                  {spark ? <span className="relative"><Spark values={spark} w={40} h={14} /></span> : null}
                  <span className="relative w-10 text-right font-mono text-[11px] text-fg-3 tabular-nums">{totals[t] != null ? <AnimatedNumber value={totals[t]!} /> : '·'}</span>
                </button>
              );
            })}
          </nav>
          <div className={cn(panel, 'flex min-h-0 flex-col overflow-hidden')}>
            <div className="flex flex-wrap items-center gap-3 border-b border-[rgb(23_21_15/.07)] px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <h2 className="text-[16px] font-semibold text-fg">{DATA_TABLE_LABEL[table]}</h2>
                  <span className="font-mono text-[11px] text-fg-3">{table}</span>
                </div>
                <p className="mt-0.5 text-[12px] text-fg-3 tabular-nums">
                  {page ? <><AnimatedNumber value={page.total} /> rows</> : '—'} · updated {updatedAt ? ago(updatedAt, now) : '—'}
                </p>
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-3" />
                  <Input value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} placeholder="Search rows" className="h-8 w-[200px] pl-9 text-[13px]" />
                </div>
                <Button variant="outline" size="sm" onClick={() => void copyCsv()}><ClipboardCopy />Copy as CSV</Button>
                <Button asChild size="sm"><a href={API.dataCsvUrl(eventId, table)} download><Download />Download CSV</a></Button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {err ? <p className="p-6 text-[14px] text-[#b91c1c]">{err}</p> : !page ? (
                <div className="space-y-2 p-4">{Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="h-7 w-full" />)}</div>
              ) : page.rows.length === 0 ? (
                <Empty icon={DbIcon} title="No rows yet" body="They appear here the moment they’re written." />
              ) : (
                <table className="w-full border-collapse text-[12.5px]">
                  <thead className="sticky top-0 z-10 bg-[#fafaf9]">
                    <tr>{cols.map((c) => <th key={c} className="border-b border-[rgb(23_21_15/.1)] px-3 py-2 text-left font-mono text-[11px] font-semibold whitespace-nowrap text-fg-2">{c}</th>)}</tr>
                  </thead>
                  <tbody>
                    <AnimatePresence initial={false}>
                      {page.rows.map((r, i) => {
                        const k = String(r.id ?? i);
                        return (
                          <motion.tr key={k} layout initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0, backgroundColor: fresh.has(k) ? ['rgba(255,214,153,.55)', 'rgba(255,214,153,0)'] : 'rgba(255,255,255,0)' }}
                            transition={{ duration: fresh.has(k) ? 1.4 : 0.2 }} className="border-b border-[rgb(23_21_15/.05)] hover:bg-[rgb(23_21_15/.02)]">
                            {cols.map((c) => <Cell key={c} col={c} v={r[c]} />)}
                          </motion.tr>
                        );
                      })}
                    </AnimatePresence>
                  </tbody>
                </table>
              )}
            </div>
            {page && page.total > PAGE ? (
              <div className="flex items-center justify-end gap-2 border-t border-[rgb(23_21_15/.07)] px-4 py-2 text-[12px] text-fg-2 tabular-nums">
                {offset + 1}–{Math.min(offset + PAGE, page.total)} of {page.total}
                <Button variant="outline" size="icon-sm" aria-label="Previous page" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}><ChevronLeft /></Button>
                <Button variant="outline" size="icon-sm" aria-label="Next page" disabled={offset + PAGE >= page.total} onClick={() => setOffset(offset + PAGE)}><ChevronRight /></Button>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function Cell({ col, v }: { col: string; v: string | number | null | undefined }) {
  if (v == null || v === '') return <td className="px-3 py-1.5 text-fg-3">—</td>;
  const isId = col === 'id' || col.endsWith('_id');
  const isTime = typeof v === 'number' && /(_at|^at)$/.test(col) && v > 1e12;
  const text = isTime ? new Date(v).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }) : String(v);
  const long = text.length > 48;
  const td = (
    <td className={cn('max-w-[340px] truncate px-3 py-1.5 whitespace-nowrap', isId ? 'font-mono text-[11.5px] text-fg-2' : typeof v === 'number' ? 'text-right tabular-nums text-fg' : 'text-fg')}>{text}</td>
  );
  if (!long) return td;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{td}</TooltipTrigger>
      <TooltipContent className="max-w-[420px] whitespace-pre-wrap">{text}</TooltipContent>
    </Tooltip>
  );
}
