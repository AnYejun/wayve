// AI crew: personas bound to cameras, scribes or the whole event. They watch, listen, dispatch and verify —
// and talk on the radio as themselves. Every action is a post with its reason; anything risky becomes a suggestion.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { Camera, Mic, Plus, Trash2, Workflow } from 'lucide-react';
import { toast } from 'sonner';
import { AGENT_ROLES, AGENT_ROLE_DEFS, type AgentRole, type CrewAgent, type Device, type Snapshot } from '@shared/contracts';
import { api, HttpError } from '@/lib/api';
import { useNow } from '@/lib/time';
import { rise, spring } from '@/design/motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useShell } from '../context';
import { Empty, KpiStrip, Page, PanelTitle, SectionHeader, panel } from '../ui';
import { DeviceSignal } from '../live/pulse';
import { CrewPostRow, CrewStatusPill, PersonaGlyph, ROLE_TINT } from '../live/crew';

export default function CrewSection() {
  const { snap, eventId, apply } = useShell();
  const now = useNow(1000);
  const nav = useNavigate();
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const crew = useMemo(() => snap?.crew ?? [], [snap?.crew]);
  const posts = snap?.crewPosts ?? [];
  const byId = useMemo(() => new Map(crew.map((a) => [a.id, a])), [crew]);
  const openIssue = (key: string) => nav(`/e/${eventId}/dashboard?issue=${encodeURIComponent(key)}`);

  if (!snap) return <Page><Skeleton className="h-9 w-40" /><Skeleton className="mt-6 h-[92px] w-full rounded-[14px]" /><Skeleton className="mt-5 h-[420px] w-full rounded-[14px]" /></Page>;

  const today = posts.filter((p) => now - p.at < 24 * 3600_000);
  const live = crew.filter((a) => a.status === 'watching' || a.status === 'listening' || a.status === 'on_duty').length;

  return (
    <Page>
      <SectionHeader title="AI crew" sub="Personas that watch your cameras, listen to your meetings, dispatch work and confirm fixes — on the radio, like teammates."
        actions={<Button size="sm" onClick={() => setAdding(true)}><Plus />Add agent</Button>} />
      <div className="mt-6">
        <KpiStrip items={[
          { label: 'On duty', value: live, sub: `of ${crew.length} agents` },
          { label: 'Radio calls', value: today.filter((p) => p.kind === 'radio').length, sub: 'Today' },
          { label: 'Assigned', value: today.filter((p) => p.kind === 'assign').length, sub: 'By the dispatcher' },
          { label: 'Verified fixes', value: today.filter((p) => p.kind === 'verify').length, tone: 'good', sub: 'Watched until resolved' },
        ]} />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0">
          {crew.length === 0 ? (
            <div className={panel}><Empty icon={Workflow} title="No agents yet" body="Give a camera a Queue Watcher, put a Meeting Secretary on the HQ scribe, and turn on the Dispatcher." action={<Button size="sm" onClick={() => setAdding(true)}><Plus />Add agent</Button>} className="py-14" /></div>
          ) : (
            <motion.ul className="grid gap-4 sm:grid-cols-2" initial="initial" animate="animate" variants={{ animate: { transition: { staggerChildren: 0.04 } } }}>
              <AnimatePresence initial={false}>
                {crew.map((a) => <AgentCard key={a.id} a={a} snap={snap} now={now} onOpen={() => setOpenId(a.id)} />)}
              </AnimatePresence>
            </motion.ul>
          )}
        </div>
        <section className={cn(panel, 'self-start overflow-hidden xl:sticky xl:top-5')}>
          <PanelTitle title="Crew activity" meta={posts.length ? `${posts.length} recent` : undefined} />
          <div className="max-h-[calc(100dvh-220px)] divide-y divide-[rgb(23_21_15/.06)] overflow-y-auto px-4">
            {posts.length === 0 ? <Empty icon={Workflow} title="Quiet so far" body="Agents post here when they call something in, assign work or confirm a fix." className="py-10" /> : (
              <AnimatePresence initial={false}>
                {posts.map((p) => (
                  <motion.div key={p.id} layout variants={rise} initial="initial" animate="animate" exit="exit">
                    <CrewPostRow post={p} agent={byId.get(p.agentId)} now={now} onOpenIssue={openIssue} compact />
                  </motion.div>
                ))}
              </AnimatePresence>
            )}
          </div>
        </section>
      </div>

      <AddAgent snap={snap} eventId={eventId} open={adding} onOpenChange={setAdding} onCreated={(a) => apply({ kind: 'agent', data: a })} />
      <AgentSheet snap={snap} agent={crew.find((a) => a.id === openId) ?? null} onClose={() => setOpenId(null)} now={now}
        onSaved={(a) => apply({ kind: 'agent', data: a })} onOpenIssue={openIssue} />
    </Page>
  );
}

function zonesOf(a: CrewAgent, snap: Snapshot): string[] {
  const d = a.deviceId ? snap.devices.find((x) => x.id === a.deviceId) : null;
  const ids = new Set([...a.zoneIds, ...(d ? (d.regions.length ? d.regions.map((r) => r.zoneId) : d.zoneId ? [d.zoneId] : []) : [])]);
  return [...ids].map((id) => snap.zones.find((z) => z.id === id)?.name).filter((x): x is string => !!x);
}

function AgentCard({ a, snap, now, onOpen }: { a: CrewAgent; snap: Snapshot; now: number; onOpen: () => void }) {
  const def = AGENT_ROLE_DEFS[a.role];
  const device = a.deviceId ? snap.devices.find((d) => d.id === a.deviceId) ?? null : null;
  const zones = zonesOf(a, snap);
  return (
    <motion.li layout variants={rise} exit="exit" transition={spring.smooth}>
      <button type="button" onClick={onOpen}
        className={cn(panel, 'group block h-full w-full p-4 text-left transition-shadow hover:shadow-[0_4px_18px_-6px_rgb(23_21_15/.18)]', !a.active && 'opacity-60')}>
        <div className="flex items-start gap-3">
          <PersonaGlyph role={a.role} size={40} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2"><span className="truncate text-[15px] font-semibold text-fg">{a.name}</span></div>
            <div className="mt-0.5 text-[12px] font-medium" style={{ color: ROLE_TINT[a.role] }}>{def.label}</div>
          </div>
          <CrewStatusPill status={a.status} />
        </div>
        <div className="mt-3 flex min-h-[26px] items-center gap-2 text-[12px] text-fg-2">
          {device ? (
            <>
              {device.deviceType === 'scribe' ? <Mic size={13} strokeWidth={1.8} className="text-fg-3" /> : <Camera size={13} strokeWidth={1.8} className="text-fg-3" />}
              <span className="truncate font-medium text-fg">{device.label}</span>
              <span className="ml-auto"><DeviceSignal device={device} /></span>
            </>
          ) : <span className="text-fg-3">{def.binds === 'none' ? 'Works across the whole event' : 'No device bound yet'}</span>}
        </div>
        {zones.length ? (
          <div className="mt-2 flex flex-wrap gap-1.5">{zones.slice(0, 4).map((z) => <span key={z} className="rounded-[6px] bg-wash-2 px-1.5 py-0.5 text-[11px] font-medium text-fg-2">{z}</span>)}</div>
        ) : null}
        <p className="mt-3 line-clamp-2 min-h-[36px] text-[13px] leading-[18px] text-fg-2">{a.lastAction ?? def.description}</p>
        <div className="mt-3 flex items-center gap-3 border-t border-[rgb(23_21_15/.06)] pt-2.5 text-[11.5px] text-fg-3 tabular-nums">
          <span>{a.stats.observations} seen</span><span>{a.stats.posts} posts</span><span>{a.stats.issues} issues</span>
          {a.watching.length ? <span className="ml-auto font-medium text-fg-2">Watching {a.watching.length}</span> : null}
        </div>
      </button>
    </motion.li>
  );
}

const devicesFor = (role: AgentRole, devices: Device[]) => {
  const binds = AGENT_ROLE_DEFS[role].binds;
  return binds === 'none' ? [] : devices.filter((d) => d.deviceType === binds);
};

function AddAgent({ snap, eventId, open, onOpenChange, onCreated }: { snap: Snapshot; eventId: string; open: boolean; onOpenChange: (o: boolean) => void; onCreated: (a: CrewAgent) => void }) {
  const [role, setRole] = useState<AgentRole>('queue_watcher');
  const [name, setName] = useState('');
  const [instructions, setInstructions] = useState(AGENT_ROLE_DEFS.queue_watcher.instructions);
  const [deviceId, setDeviceId] = useState<string>('');
  const [zoneIds, setZoneIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const pick = (r: AgentRole) => { setRole(r); setInstructions(AGENT_ROLE_DEFS[r].instructions); setDeviceId(''); };
  const devices = devicesFor(role, snap.devices);
  const submit = async () => {
    setBusy(true);
    try {
      const { agent } = await api<{ agent: CrewAgent }>(`/api/events/${eventId}/agents`, { body: { name: name.trim() || AGENT_ROLE_DEFS[role].label, role, instructions, deviceId: deviceId || null, zoneIds } });
      onCreated(agent);
      toast.success(`${agent.name} joined the crew`);
      onOpenChange(false);
      setName('');
    } catch (e) {
      toast.error((e as HttpError).message);
    } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-6 sm:max-w-[560px]">
        <SheetHeader className="mb-5 p-0"><SheetTitle>Add an agent</SheetTitle><SheetDescription>Pick a persona, give it a device and a focus. It reports on the radio and proposes — your rules decide.</SheetDescription></SheetHeader>
        <div className="grid grid-cols-2 gap-2.5">
          {AGENT_ROLES.map((r) => {
            const on = r === role;
            return (
              <button key={r} type="button" onClick={() => pick(r)}
                className={cn('relative rounded-[12px] border p-3 text-left transition-colors', on ? 'border-fg bg-white shadow-[0_0_0_1px_#17150f]' : 'border-[rgb(23_21_15/.1)] bg-white hover:bg-wash-1')}>
                <div className="flex items-center gap-2.5"><PersonaGlyph role={r} size={30} /><span className="text-[14px] font-semibold text-fg">{AGENT_ROLE_DEFS[r].label}</span></div>
                <p className="mt-2 text-[12px] leading-[17px] text-fg-2">{AGENT_ROLE_DEFS[r].description}</p>
              </button>
            );
          })}
        </div>
        <div className="mt-6 space-y-4">
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={AGENT_ROLE_DEFS[role].label} /></Field>
          {AGENT_ROLE_DEFS[role].binds !== 'none' ? (
            <Field label={AGENT_ROLE_DEFS[role].binds === 'camera' ? 'Camera' : 'Meeting scribe'}>
              <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} className="h-10 w-full rounded-[10px] border border-[rgb(23_21_15/.15)] bg-white px-3 text-[14px]">
                <option value="">Bind later</option>
                {devices.map((d) => <option key={d.id} value={d.id}>{d.label}{d.zoneId ? ` · ${snap.zones.find((z) => z.id === d.zoneId)?.name ?? ''}` : ''}</option>)}
              </select>
            </Field>
          ) : null}
          {AGENT_ROLE_DEFS[role].binds === 'camera' ? (
            <Field label="Zones to watch">
              <div className="flex flex-wrap gap-1.5">
                {snap.zones.map((z) => {
                  const on = zoneIds.includes(z.id);
                  return <button key={z.id} type="button" onClick={() => setZoneIds(on ? zoneIds.filter((x) => x !== z.id) : [...zoneIds, z.id])}
                    className={cn('h-8 rounded-full px-3 text-[13px] font-medium transition-colors', on ? 'bg-fg text-white' : 'bg-wash-2 text-fg-2 hover:bg-wash-3')}>{z.name}</button>;
                })}
              </div>
            </Field>
          ) : null}
          <Field label="Instructions"><Textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={5} className="text-[14px] leading-[20px]" /></Field>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy}>{busy ? 'Adding…' : 'Add to crew'}</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-[12px] font-semibold tracking-[.02em] text-fg-2">{label}</span>{children}</label>;
}

function AgentSheet({ snap, agent, onClose, now, onSaved, onOpenIssue }: { snap: Snapshot; agent: CrewAgent | null; onClose: () => void; now: number; onSaved: (a: CrewAgent) => void; onOpenIssue: (k: string) => void }) {
  const [instructions, setInstructions] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastId, setLastId] = useState<string | null>(null);
  if (agent && agent.id !== lastId) { setLastId(agent.id); setInstructions(agent.instructions); setDeviceId(agent.deviceId ?? ''); }
  const patch = async (b: Record<string, unknown>, msg?: string) => {
    if (!agent) return;
    setBusy(true);
    try { const { agent: a } = await api<{ agent: CrewAgent }>(`/api/agents/${agent.id}`, { method: 'PATCH', body: b }); onSaved(a); if (msg) toast.success(msg); }
    catch (e) { toast.error((e as HttpError).message); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!agent) return;
    try { await api(`/api/agents/${agent.id}`, { method: 'DELETE' }); toast.success(`${agent.name} left the crew`); onClose(); } catch (e) { toast.error((e as HttpError).message); }
  };
  const posts = (snap.crewPosts ?? []).filter((p) => p.agentId === agent?.id);
  const devices = agent ? devicesFor(agent.role, snap.devices) : [];
  return (
    <Sheet open={!!agent} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-6 sm:max-w-[520px]">
        {agent ? (
          <>
            <SheetHeader className="mb-5 p-0">
              <div className="flex items-center gap-3">
                <PersonaGlyph role={agent.role} size={44} />
                <div className="min-w-0"><SheetTitle className="truncate">{agent.name}</SheetTitle><SheetDescription>{AGENT_ROLE_DEFS[agent.role].label} · {AGENT_ROLE_DEFS[agent.role].description}</SheetDescription></div>
              </div>
            </SheetHeader>
            <div className="flex items-center justify-between rounded-[12px] bg-wash-1 px-3 py-2.5">
              <CrewStatusPill status={agent.status} />
              <label className="flex items-center gap-2 text-[13px] font-medium text-fg-2">Active<Switch checked={agent.active} onCheckedChange={(v) => void patch({ active: v }, v ? 'Back on duty' : 'Paused')} /></label>
            </div>
            {AGENT_ROLE_DEFS[agent.role].binds !== 'none' ? (
              <div className="mt-4">
                <Field label="Bound device">
                  <select value={deviceId} onChange={(e) => { setDeviceId(e.target.value); void patch({ deviceId: e.target.value || null }, 'Device updated'); }}
                    className="h-10 w-full rounded-[10px] border border-[rgb(23_21_15/.15)] bg-white px-3 text-[14px]">
                    <option value="">None</option>
                    {devices.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                  </select>
                </Field>
              </div>
            ) : null}
            <div className="mt-4">
              <Field label="Instructions"><Textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={5} className="text-[14px] leading-[20px]" /></Field>
              <div className="mt-2 flex justify-end">
                <Button size="sm" variant="outline" disabled={busy || instructions === agent.instructions} onClick={() => void patch({ instructions }, 'Instructions saved')}>Save instructions</Button>
              </div>
            </div>
            <div className="mt-6">
              <div className="mb-1 text-[12px] font-semibold tracking-[.02em] text-fg-2">Activity</div>
              {posts.length ? <div className="divide-y divide-[rgb(23_21_15/.06)]">{posts.map((p) => <CrewPostRow key={p.id} post={p} agent={agent} now={now} onOpenIssue={onOpenIssue} compact />)}</div>
                : <p className="py-4 text-[13px] text-fg-3">Nothing yet — it posts when it calls something in.</p>}
            </div>
            <div className="mt-8 border-t border-[rgb(23_21_15/.08)] pt-4">
              <Button variant="ghost" size="sm" className="text-[#b91c1c]" onClick={() => void remove()}><Trash2 />Remove from crew</Button>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
