// Event settings pieces (used by the Settings section of the app shell): teams, knowledge, invite QRs.
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Copy, Link2, Plus, Printer, Trash2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from 'sonner';
import type { Snapshot } from '@shared/contracts';
import { API } from '@/lib/api';
import { spring } from '@/design/motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export function Teams({ snap }: { snap: Snapshot }) {
  const [name, setName] = useState('');
  const counts = new Map<string, number>();
  for (const p of snap.participants) if (p.teamId) counts.set(p.teamId, (counts.get(p.teamId) ?? 0) + 1);
  const add = async () => {
    if (!name.trim()) return;
    try { await API.createTeam(snap.event.id, name.trim()); setName(''); } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <div className="max-w-[640px] overflow-hidden rounded-[16px] border border-[rgb(23_21_15/.1)] bg-white">
      <ul>
        <AnimatePresence initial={false}>
          {snap.teams.map((t) => (
            <motion.li key={t.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} transition={spring.smooth}
              className="flex items-center gap-2 border-b border-[rgb(23_21_15/.06)] px-3 py-1.5">
              <Input defaultValue={t.name} aria-label="Team name" className="h-9 flex-1 border-0 bg-transparent text-[15px] shadow-none focus-visible:bg-white"
                onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== t.name) API.renameTeam(t.id, v).catch((er) => toast.error((er as Error).message)); }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
              <span className="text-[13px] text-fg-3 tabular-nums">{counts.get(t.id) ?? 0} people</span>
              <Button variant="ghost" size="icon-xs" aria-label={`Delete ${t.name}`} onClick={() => { if (confirm(`Delete team “${t.name}”?`)) API.deleteTeam(t.id).catch((er) => toast.error((er as Error).message)); }}><Trash2 /></Button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      <div className="flex gap-2 p-3">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Add a team — e.g. Registration" className="h-9"
          onKeyDown={(e) => { if (e.key === 'Enter') void add(); }} />
        <Button size="sm" onClick={() => void add()} disabled={!name.trim()}><Plus />Add</Button>
      </div>
    </div>
  );
}

export function Knowledge({ eventId }: { eventId: string }) {
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { API.knowledge(eventId).then((k) => { setText(k.text); setSaved(k.text); }).catch(() => { setText(''); }); }, [eventId]);
  const save = async () => {
    if (text == null) return;
    setBusy(true);
    try { await API.setKnowledge(eventId, text); setSaved(text); toast.success('Knowledge saved'); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  if (text == null) return <Skeleton className="h-[240px] w-full rounded-[16px]" />;
  return (
    <div className="max-w-[820px]">
      <Textarea value={text} onChange={(e) => setText(e.target.value.slice(0, 20000))} rows={12}
        placeholder={'09:00 Doors open · Registration at Hall B\n10:00 Opening keynote — Main stage\nFirst aid: Room 102 · Lost & found: Info desk\nContacts: HQ 010-…'}
        className="min-h-[240px] font-[inherit] text-[15px] leading-[22px]" />
      <div className="mt-2 flex items-center gap-3">
        <span className="text-[12px] tabular-nums text-fg-3">{text.length.toLocaleString('en-US')} / 20,000</span>
        <Button size="sm" className="ml-auto" disabled={busy || text === saved} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</Button>
      </div>
    </div>
  );
}

export function Invite({ snap }: { snap: Snapshot }) {
  const origin = location.origin;
  const code = snap.event.joinCode;
  const printRef = useRef<HTMLDivElement>(null);
  const copyAdmin = async () => {
    try { const r = await API.adminLink(snap.event.id); await navigator.clipboard.writeText(r.url); toast.success('Organizer link copied'); } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => { void navigator.clipboard.writeText(code); toast.success('Join code copied'); }}
          className="flex items-center gap-3 rounded-[14px] bg-white px-4 py-2.5 shadow-[inset_0_0_0_1px_rgb(23_21_15/.1)]">
          <span className="text-[13px] text-fg-2">Join code</span>
          <span className="font-mono text-[20px] font-semibold tracking-[.18em] text-fg">{code}</span>
          <Copy className="size-4 text-fg-3" />
        </button>
        <Button variant="outline" size="sm" onClick={() => void copyAdmin()}><Link2 />Copy organizer link</Button>
        <Button variant="outline" size="sm" onClick={() => window.print()}><Printer />Print</Button>
      </div>
      <div ref={printRef} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 print:grid-cols-2">
        <QrCard big title="Attendees" sub="Post around the venue. Attendees chat with the event assistant; what they report reaches HQ." url={`${origin}/j/${code}?as=guest`} />
        {snap.teams.map((t) => (
          <div key={t.id} className="rounded-[16px] border border-[rgb(23_21_15/.1)] bg-white p-4 break-inside-avoid">
            <p className="text-[12px] font-semibold tracking-[.08em] text-fg-3 uppercase">{t.name}</p>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <MiniQr label="Staff · sign in" url={`${origin}/j/${code}?as=staff&team=${t.id}`} />
              <MiniQr label="Meeting scribe" url={`${origin}/j/${code}?as=scribe&team=${t.id}`} />
            </div>
          </div>
        ))}
        <QrCard title="Staff (any team)" sub="Staff sign in with their WAYVE ID." url={`${origin}/j/${code}?as=staff`} />
      </div>
      <p className="mt-8 mb-3 text-[13px] font-semibold text-fg">Zone cameras</p>
      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-4 print:grid-cols-3">
        {snap.zones.map((z) => <QrCard key={z.id} title={z.name} sub="Camera for this zone" url={`${origin}/j/${code}?as=camera&z=${z.id}`} small />)}
      </div>
    </div>
  );
}

export function QrCard({ title, sub, url, big, small }: { title: string; sub: string; url: string; big?: boolean; small?: boolean }) {
  return (
    <motion.div whileHover={{ y: -2 }} transition={spring.snappy} className={cn('flex gap-4 rounded-[16px] border border-[rgb(23_21_15/.1)] bg-white p-4 break-inside-avoid', big && 'sm:col-span-2 xl:col-span-1', small && 'flex-col items-center text-center')}>
      <div className="shrink-0 rounded-[10px] bg-white p-1.5 shadow-[0_0_0_.5px_rgb(23_21_15/.12)]"><QRCodeSVG value={url} size={small ? 108 : 124} level="M" /></div>
      <div className="min-w-0">
        <p className="text-[16px] font-semibold text-fg">{title}</p>
        <p className="mt-1 text-[13px] leading-[18px] text-fg-2">{sub}</p>
      </div>
    </motion.div>
  );
}
export function MiniQr({ label, url }: { label: string; url: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 text-center">
      <div className="rounded-[10px] bg-white p-1.5 shadow-[0_0_0_.5px_rgb(23_21_15/.12)]"><QRCodeSVG value={url} size={96} level="M" /></div>
      <span className="text-[12px] font-medium text-fg-2">{label}</span>
    </div>
  );
}
