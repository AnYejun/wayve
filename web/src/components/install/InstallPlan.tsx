// Install plan for preset venues: where each camera / scribe / attendee-chat poster goes, what it watches, how to mount it,
// and a one-scan QR per spot (the phone sets itself up — label, zone, map position, crew persona — with no login).
// Self-contained: <InstallPlan snap eventId /> (mounted by the shell's Devices section).
import { useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Camera, Check, Copy, Mic, Printer, QrCode } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router';
import { AGENT_ROLE_DEFS, DEVICE_OFFLINE_MS, type Device, type InstallSlot, type Snapshot, type VenueTemplate } from '@shared/contracts';
import { presetById } from '@shared/templates';
import { usePulses } from '@/lib/live';
import { useNow } from '@/lib/time';
import { spring } from '@/design/motion';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { withKey } from '@/lib/links';
import { slotUrl } from './api';

type Filter = 'all' | 'camera' | 'scribe' | 'poster';
const KIND_LABEL: Record<InstallSlot['kind'], string> = { camera: 'Camera', scribe: 'Scribe', poster: 'Attendee QR' };
const KIND_ICON = { camera: Camera, scribe: Mic, poster: QrCode } as const;

/** The device installed in a slot (slot joins set the device label to the slot label). */
function deviceFor(slot: InstallSlot, devices: Device[]): Device | null {
  if (slot.kind === 'poster') return null;
  const type = slot.kind === 'scribe' ? 'scribe' : 'camera';
  return devices.filter((d) => d.deviceType === type && d.label === slot.label).sort((a, b) => b.lastSeenAt - a.lastSeenAt)[0] ?? null;
}

/** View cone path (facing: degrees clockwise from north/up). */
function conePath([x, y]: [number, number], facing: number, fov: number, range: number): string {
  const dir = (deg: number) => { const r = (deg * Math.PI) / 180; return [x + range * Math.sin(r), y - range * Math.cos(r)] as const; };
  const [ax, ay] = dir(facing - fov / 2);
  const [bx, by] = dir(facing + fov / 2);
  return `M ${x} ${y} L ${ax} ${ay} A ${range} ${range} 0 ${fov > 180 ? 1 : 0} 1 ${bx} ${by} Z`;
}

export function InstallPlan({ snap, eventId }: { snap: Snapshot; eventId: string }) {
  const nav = useNavigate();
  const preset: VenueTemplate | null = presetById(snap.event.map?.presetId ?? null);
  const slots = preset?.install ?? [];
  const [filter, setFilter] = useState<Filter>('all');
  const [sel, setSel] = useState<string | null>(slots.find((s) => s.kind === 'camera')?.id ?? null);
  const printRef = useRef<HTMLDivElement>(null);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const now = useNow(4000);
  const shown = slots.filter((s) => filter === 'all' || s.kind === filter);
  const installed = useMemo(() => slots.filter((s) => s.kind !== 'poster' && deviceFor(s, snap.devices)).length, [slots, snap.devices]);
  const needed = slots.filter((s) => s.kind !== 'poster').length;

  if (!preset || !slots.length || !snap.event.map) {
    return (
      <div className="grid place-items-center rounded-[18px] border border-dashed border-[rgb(23_21_15/.15)] bg-white px-6 py-14 text-center">
        <span className="grid size-11 place-items-center rounded-[12px] bg-[#f5f4f2]"><Camera className="size-5" strokeWidth={1.75} /></span>
        <p className="mt-3 text-[16px] font-semibold text-fg">No install plan for this venue yet</p>
        <p className="mt-1 max-w-[440px] text-[14px] leading-[20px] text-fg-2">Start from a preset venue in Settings → Map to get recommended camera and scribe spots with one-scan QR codes.</p>
        <Button className="mt-4" size="sm" onClick={() => nav(`/e/${eventId}/settings`)}>Open Settings</Button>
      </div>
    );
  }

  const W = snap.event.map.width, H = snap.event.map.height, k = W / 1000;
  const print = () => {
    const html = printRef.current?.innerHTML ?? '';
    const w = window.open('', '_blank', 'width=900,height=1200');
    if (!w) { toast.error('Allow pop-ups to print the install sheet'); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${snap.event.name} · Install sheet</title><style>
      *{box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Pretendard Variable",Inter,Helvetica,Arial,sans-serif;color:#17150f;margin:28px}
      h1{font-size:22px;margin:0 0 4px;letter-spacing:-.02em}p.sub{margin:0 0 20px;color:#4a4844;font-size:13px}
      .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.card{border:1px solid #d9d6cf;border-radius:14px;padding:14px;display:flex;gap:14px;break-inside:avoid}
      .n{font:600 12px ui-monospace,Menlo,monospace;color:#6b6965}.t{font-size:16px;font-weight:650;margin:2px 0 6px}.k{font-size:12px;color:#4a4844}
      ul{margin:8px 0 0;padding-left:16px;font-size:12px;color:#4a4844}li{margin:2px 0}.qr{flex:none;text-align:center;font-size:10px;color:#6b6965}
      @media print{body{margin:12mm}.card{page-break-inside:avoid}}</style></head><body>
      <h1>${snap.event.name} — install sheet</h1><p class="sub">Scan each QR with the phone you mount at that spot. It sets itself up — no account needed. Keep phones plugged in with the screen on.</p>
      <div class="grid">${html}</div></body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 350);
  };

  return (
    <section>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-fg">Install plan</h2>
          <p className="mt-0.5 text-[14px] text-fg-2">
            {preset.name} · <span className="tabular-nums">{installed}/{needed}</span> devices installed. Scan a spot's QR with the phone you're mounting — it sets itself up, no login.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-[10px] bg-[#f0f0f2] p-[3px]" role="tablist" aria-label="Filter spots">
            {(['all', 'camera', 'scribe', 'poster'] as const).map((f) => (
              <button key={f} type="button" role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
                className={cn('relative h-7 rounded-[8px] px-2.5 text-[13px] font-medium transition-colors', filter === f ? 'text-fg' : 'text-fg-2 hover:text-fg')}>
                {filter === f ? <motion.span layoutId="install-filter" transition={spring.smooth} className="absolute inset-0 rounded-[8px] bg-white shadow-[0_1px_2px_rgb(0_0_0/.06),0_1px_1px_rgb(0_0_0/.04)]" /> : null}
                <span className="relative">{f === 'all' ? 'All' : f === 'poster' ? 'Posters' : `${KIND_LABEL[f]}s`}</span>
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={print}><Printer />Print install sheet</Button>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        {/* plan */}
        <div className="overflow-hidden rounded-[18px] border border-[rgb(23_21_15/.1)] bg-white">
          <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Install plan on the venue floor plan">
            {snap.event.map.imageUrl ? <image href={snap.event.map.imageUrl} x={0} y={0} width={W} height={H} preserveAspectRatio="none" opacity={0.92} /> : <rect width={W} height={H} fill="#fafaf9" />}
            {snap.zones.map((z) => (
              <g key={z.id}>
                <polygon points={z.polygon.map((p) => p.join(',')).join(' ')} fill="rgba(23,21,15,.015)" stroke="rgba(23,21,15,.22)" strokeWidth={1.5 * k} />
                <text x={z.polygon[0][0] + 14 * k} y={z.polygon[0][1] + 30 * k} fontSize={15 * k} fontWeight={600} fill="rgba(23,21,15,.55)" style={{ letterSpacing: '.01em' }}>{z.name}</text>
              </g>
            ))}
            {shown.filter((s) => s.kind === 'camera').map((s) => {
              const dev = deviceFor(s, snap.devices);
              const on = !!dev && now - dev.lastSeenAt < DEVICE_OFFLINE_MS;
              const active = sel === s.id;
              return (
                <path key={`cone-${s.id}`} d={conePath(s.position, s.facing, s.fov, s.range)}
                  fill={on ? 'rgba(88,160,105,.14)' : active ? 'rgba(23,21,15,.10)' : 'rgba(23,21,15,.05)'}
                  stroke={on ? 'rgba(88,160,105,.7)' : active ? 'rgba(23,21,15,.55)' : 'rgba(23,21,15,.28)'}
                  strokeWidth={(active ? 2.5 : 1.6) * k} strokeDasharray={on ? undefined : `${8 * k} ${7 * k}`} style={{ transition: 'fill .25s, stroke .25s' }} />
              );
            })}
            {shown.map((s) => <SlotMarker key={s.id} slot={s} index={slots.indexOf(s) + 1} k={k} device={deviceFor(s, snap.devices)} now={now}
              active={sel === s.id} onClick={() => setSel(s.id)} />)}
          </svg>
        </div>

        {/* spots */}
        <div className="flex max-h-[min(78vh,880px)] flex-col gap-2.5 overflow-y-auto pr-0.5">
          {shown.map((s) => (
            <SlotCard key={s.id} slot={s} index={slots.indexOf(s) + 1} active={sel === s.id} onSelect={() => setSel(s.id)}
              device={deviceFor(s, snap.devices)} url={slotUrl(origin, snap.event.joinCode, s, snap.joinKey)} now={now} />
          ))}
        </div>
      </div>

      {/* printable sheet (copied into a print window) */}
      <div ref={printRef} style={{ display: 'none' }} aria-hidden>
        {slots.map((s) => (
          <div key={s.id} className="card">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="n">#{slots.indexOf(s) + 1} · {KIND_LABEL[s.kind]}{s.persona ? ` · ${AGENT_ROLE_DEFS[s.persona].label}` : ''}</div>
              <div className="t">{s.label}</div>
              <div className="k">{s.zones.length ? `Watches: ${s.zones.join(', ')} · ` : ''}{s.mount} · {s.height}</div>
              <ul>{s.tips.map((t) => <li key={t}>{t}</li>)}</ul>
            </div>
            <div className="qr"><QRCodeSVG value={slotUrl(origin, snap.event.joinCode, s, snap.joinKey)} size={112} level="M" marginSize={1} /><div>{s.kind === 'poster' ? 'Attendee chat' : 'Scan to set up'}</div></div>
          </div>
        ))}
        <div className="card">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="n">Staff · radio, tasks, assistant</div>
            <div className="t">Join as staff</div>
            <div className="k">Scan before the event starts — just a name, no account. Keep this sheet with the team (it carries the staff key).</div>
            <ul><li>Korean or English, by voice or chat</li><li>New tasks arrive as cards: swipe right to take, left to pass</li></ul>
          </div>
          <div className="qr"><QRCodeSVG value={withKey(`${origin}/j/${snap.event.joinCode}?as=staff`, snap.joinKey)} size={112} level="M" marginSize={1} /><div>Staff sign-up</div></div>
        </div>
      </div>
    </section>
  );
}

function useSlotLive(device: Device | null, now: number) {
  const pulses = usePulses(device?.id ?? null);
  const last = pulses[0]?.at ?? 0;                      // newest first, client clock
  const online = !!device && now - device.lastSeenAt < DEVICE_OFFLINE_MS;
  const receiving = online && Date.now() - last < 6000;
  return { online, receiving };
}

function SlotMarker({ slot, index, k, device, now, active, onClick }: {
  slot: InstallSlot; index: number; k: number; device: Device | null; now: number; active: boolean; onClick: () => void;
}) {
  const reduced = useReducedMotion();
  const { online, receiving } = useSlotLive(device, now);
  const I = KIND_ICON[slot.kind];
  const r = (slot.kind === 'poster' ? 22 : 30) * k;
  const [x, y] = slot.position;
  const ring = online ? '#58a069' : active ? '#17150f' : 'rgba(23,21,15,.35)';
  return (
    <g onClick={onClick} style={{ cursor: 'pointer' }} role="button" aria-label={`${slot.label} · ${online ? 'live' : device ? 'offline' : 'not installed'}`}>
      {receiving && !reduced ? (
        <motion.circle cx={x} cy={y} r={r} fill="none" stroke="#58a069" strokeWidth={2 * k}
          initial={{ opacity: 0.55, scale: 1 }} animate={{ opacity: 0, scale: 2.1 }} transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
          style={{ transformOrigin: `${x}px ${y}px`, transformBox: 'view-box' }} />
      ) : null}
      <circle cx={x} cy={y} r={r} fill={online ? '#ffffff' : active ? '#17150f' : '#ffffff'} stroke={ring} strokeWidth={(active ? 3 : 2) * k}
        style={{ filter: 'drop-shadow(0 2px 6px rgba(23,21,15,.18))' }} />
      <g transform={`translate(${x - r * 0.55} ${y - r * 0.55})`} color={active && !online ? '#ffffff' : online ? '#376c45' : '#17150f'}>
        <I width={r * 1.1} height={r * 1.1} strokeWidth={2} />
      </g>
      {slot.kind !== 'poster' ? (
        <g transform={`translate(${x + r * 0.75} ${y - r * 0.95})`}>
          <circle r={12 * k} fill={online ? '#58a069' : '#17150f'} />
          <text textAnchor="middle" dy={4.5 * k} fontSize={13 * k} fontWeight={700} fill="#fff">{index}</text>
        </g>
      ) : null}
    </g>
  );
}

function SlotCard({ slot, index, active, onSelect, device, url, now }: {
  slot: InstallSlot; index: number; active: boolean; onSelect: () => void; device: Device | null; url: string; now: number;
}) {
  const { online, receiving } = useSlotLive(device, now);
  const [copied, setCopied] = useState(false);
  const I = KIND_ICON[slot.kind];
  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch { toast.error('Copy failed'); }
  };
  const status = slot.kind === 'poster' ? null
    : online ? { dot: '#58a069', text: receiving ? `Live · ${slot.kind === 'scribe' ? 'transcribing' : 'receiving frames'}` : 'Live · connected', tone: 'text-[#376c45]' }
      : device ? { dot: '#b9b8b4', text: 'Installed · offline', tone: 'text-fg-2' }
        : { dot: 'transparent', text: 'Not installed', tone: 'text-fg-3' };
  return (
    <motion.div layout transition={spring.smooth} onClick={onSelect}
      className={cn('cursor-pointer rounded-[16px] border bg-white p-3.5 transition-[border-color,box-shadow]',
        active ? 'border-[#17150f] shadow-[0_0_0_1px_#17150f]' : 'border-[rgb(23_21_15/.1)] hover:border-[rgb(23_21_15/.22)]')}>
      <div className="flex gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cn('grid size-7 shrink-0 place-items-center rounded-[8px]', online ? 'bg-[#e9f4ec] text-[#376c45]' : 'bg-[#f5f4f2] text-fg')}>
              <I className="size-4" strokeWidth={1.75} />
            </span>
            <span className="truncate text-[15px] font-semibold tracking-[-0.01em] text-fg">{slot.kind !== 'poster' ? <span className="mr-1 font-mono text-[12px] text-fg-3 tabular-nums">#{index}</span> : null}{slot.label}</span>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5 text-[12px] font-medium">
            <span className="inline-flex h-5 items-center rounded-[6px] bg-[#f5f4f2] px-1.5 text-fg-2">{KIND_LABEL[slot.kind]}</span>
            {slot.persona ? <span className="inline-flex h-5 items-center rounded-[6px] px-1.5 text-fg-2 shadow-[inset_0_0_0_.5px_rgb(23_21_15/.24)]">{AGENT_ROLE_DEFS[slot.persona].label}</span> : null}
            {slot.zones.length ? <span className="text-fg-3">Watches {slot.zones.join(' · ')}</span> : null}
          </div>
          {status ? (
            <div className={cn('mt-2 flex items-center gap-1.5 text-[12.5px] font-medium', status.tone)}>
              <span className={cn('live-dot', !device && 'ring-1 ring-[rgb(23_21_15/.3)]')} style={{ color: status.dot, background: status.dot }} data-ping={receiving || undefined} />
              {status.text}{device && device.label !== slot.label ? ` · ${device.label}` : ''}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <div className="rounded-[10px] bg-white p-1.5 shadow-[inset_0_0_0_1px_rgb(23_21_15/.1)]">
            <QRCodeSVG value={url} size={active ? 104 : 64} level="M" marginSize={0} />
          </div>
          <button type="button" onClick={copy} className="inline-flex h-6 items-center gap-1 rounded-full px-2 text-[11.5px] font-medium text-fg-2 hover:bg-[#f5f4f2] hover:text-fg">
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}{copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {active ? (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={spring.smooth} className="overflow-hidden">
            <dl className="mt-3 grid grid-cols-[72px_1fr] gap-x-3 gap-y-1.5 border-t border-[rgb(23_21_15/.08)] pt-3 text-[13px]">
              <dt className="text-fg-3">Mount</dt><dd className="text-fg">{slot.mount}</dd>
              <dt className="text-fg-3">Height</dt><dd className="text-fg">{slot.height}</dd>
            </dl>
            <ul className="mt-2 space-y-1 text-[13px] leading-[18px] text-fg-2">
              {slot.tips.map((t) => <li key={t} className="flex gap-2"><span className="mt-[7px] size-1 shrink-0 rounded-full bg-fg-3" />{t}</li>)}
            </ul>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}
