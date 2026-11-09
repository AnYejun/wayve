// Camera calibration: pick a camera phone → its calibration snapshot → draw boxes (drag) or polygons (click points, close on
// the first point / Enter) in NORMALIZED frame coords → link each region to a zone → Save (API.setRegions).
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Camera, PenLine, Square, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { DEVICE_OFFLINE_MS, type CameraRegion, type Device, type Zone } from '@shared/contracts';
import { API } from '@/lib/api';
import { spring } from '@/design/motion';
import { ago, useNow } from '@/lib/time';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Pt = [number, number];
const COLORS = ['#3e6390', '#006c71', '#86552e', '#8d4f48', '#6a578b', '#4a4844'];

export function CameraCalibration({ devices, zones }: { devices: Device[]; zones: Zone[] }) {
  const cams = useMemo(() => devices.filter((d) => d.deviceType === 'camera'), [devices]);
  const [camId, setCamId] = useState<string | null>(cams[0]?.id ?? null);
  const cam = cams.find((c) => c.id === camId) ?? null;
  const now = useNow(2000);
  useEffect(() => { if (!camId && cams[0]) setCamId(cams[0].id); }, [cams, camId]);

  if (!cams.length) {
    return (
      <div className="rounded-[16px] border border-dashed border-[rgb(23_21_15/.18)] bg-white px-6 py-10 text-center">
        <Camera className="mx-auto size-6 text-fg-3" strokeWidth={1.75} />
        <p className="mt-2 text-[15px] font-semibold text-fg">No cameras yet</p>
        <p className="mt-1 text-[13px] text-fg-2">Scan a zone camera QR (Invite step) with a phone, then come back to calibrate it.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
      <ul className="flex gap-2 overflow-x-auto lg:flex-col">
        {cams.map((c) => {
          const online = now - c.lastSeenAt < DEVICE_OFFLINE_MS;
          const covers = c.regions.length ? c.regions.map((r) => zones.find((z) => z.id === r.zoneId)?.name).filter(Boolean).join(', ') : zones.find((z) => z.id === c.zoneId)?.name ?? 'No zone';
          return (
            <li key={c.id}>
              <button type="button" onClick={() => setCamId(c.id)}
                className={cn('relative w-full min-w-[180px] rounded-[12px] border px-3 py-2.5 text-left', camId === c.id ? 'border-[#17150f] bg-white' : 'border-[rgb(23_21_15/.1)] bg-white hover:border-[rgb(23_21_15/.25)]')}>
                <span className="flex items-center gap-2 text-[14px] font-semibold text-fg">
                  <span className="live-dot" style={{ color: online ? '#58a069' : '#b9b8b4' }} />{c.label}
                </span>
                <span className="mt-0.5 block truncate text-[12px] text-fg-2">{c.regions.length ? `${c.regions.length} regions · ${covers}` : covers}</span>
                <span className="block text-[12px] text-fg-3">{online ? 'Online' : `Seen ${ago(c.lastSeenAt, now)}`}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {cam ? <RegionEditor key={cam.id} cam={cam} zones={zones} /> : null}
    </div>
  );
}

function RegionEditor({ cam, zones }: { cam: Device; zones: Zone[] }) {
  const [regions, setRegions] = useState<CameraRegion[]>(cam.regions);
  const [tool, setTool] = useState<'box' | 'poly'>('box');
  const [draft, setDraft] = useState<Pt[] | null>(null);
  const [boxStart, setBoxStart] = useState<Pt | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const ref = useRef<SVGSVGElement>(null);
  const dirty = JSON.stringify(regions) !== JSON.stringify(cam.regions);

  const norm = (e: { clientX: number; clientY: number }): Pt => {
    const r = ref.current!.getBoundingClientRect();
    return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))].map((v) => Math.round(v * 1000) / 1000) as Pt;
  };
  const defaultZone = () => zones.find((z) => !regions.some((r) => r.zoneId === z.id))?.id ?? zones[0]?.id ?? '';
  const addRegion = (poly: Pt[]) => { setRegions((rs) => [...rs, { zoneId: defaultZone(), polygon: poly }]); setSel(regions.length); };

  const onDown = (e: RPointerEvent<SVGSVGElement>) => {
    const p = norm(e);
    if (tool === 'box') { (e.currentTarget as Element).setPointerCapture(e.pointerId); setBoxStart(p); setDraft([p, p, p, p]); return; }
    if (draft && draft.length >= 3 && Math.hypot(p[0] - draft[0][0], p[1] - draft[0][1]) < 0.025) { addRegion(draft); setDraft(null); return; }
    setDraft((d) => [...(d ?? []), p]);
  };
  const onMove = (e: RPointerEvent<SVGSVGElement>) => {
    if (tool !== 'box' || !boxStart) return;
    const p = norm(e);
    const [x0, y0] = boxStart;
    setDraft([[x0, y0], [p[0], y0], [p[0], p[1]], [x0, p[1]]]);
  };
  const onUp = () => {
    if (tool !== 'box' || !boxStart || !draft) return;
    const w = Math.abs(draft[2][0] - draft[0][0]), h = Math.abs(draft[2][1] - draft[0][1]);
    if (w > 0.02 && h > 0.02) addRegion(draft);
    setBoxStart(null); setDraft(null);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && draft && draft.length >= 3 && tool === 'poly') { addRegion(draft); setDraft(null); }
      if (e.key === 'Escape') setDraft(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const save = async () => {
    setSaving(true);
    try { await API.setRegions(cam.id, regions.filter((r) => r.zoneId)); toast.success(`${cam.label} calibrated · ${regions.length} regions`); }
    catch (e) { toast.error((e as Error).message || "Couldn't save regions"); }
    finally { setSaving(false); }
  };

  if (!cam.snapshotUrl) {
    return (
      <div className="grid place-items-center rounded-[16px] border border-dashed border-[rgb(23_21_15/.18)] bg-white px-6 py-14 text-center">
        <div>
          <Camera className="mx-auto size-6 text-fg-3" strokeWidth={1.75} />
          <p className="mt-2 text-[15px] font-semibold text-fg">Waiting for a snapshot</p>
          <p className="mx-auto mt-1 max-w-sm text-[13px] text-fg-2">On the camera phone, tap “Send calibration snapshot”. It appears here and you can draw what this camera sees.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="flex rounded-[10px] bg-[#f0efec] p-[3px]">
          {([['box', Square, 'Box'], ['poly', PenLine, 'Polygon']] as const).map(([k, I, l]) => (
            <button key={k} type="button" onClick={() => { setTool(k); setDraft(null); }}
              className={cn('relative flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-[13px] font-medium', tool === k ? 'text-fg' : 'text-fg-2')}>
              {tool === k ? <motion.span layoutId={`cal-tool-${cam.id}`} transition={spring.smooth} className="absolute inset-0 rounded-[8px] bg-white shadow-[0_1px_2px_rgb(23_21_15/.08)]" /> : null}
              <I className="relative size-4" strokeWidth={1.75} /><span className="relative">{l}</span>
            </button>
          ))}
        </div>
        <span className="text-[13px] text-fg-3">{tool === 'box' ? 'Drag a box over each zone the camera sees' : 'Click points, click the first point (or Enter) to close'}</span>
        <Button size="sm" className="ml-auto" disabled={!dirty || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save calibration'}</Button>
      </div>
      <div className="relative overflow-hidden rounded-[14px] border border-[rgb(23_21_15/.1)] bg-black">
        <img src={cam.snapshotUrl} alt={`${cam.label} view`} className="block w-full select-none" draggable={false} />
        <svg ref={ref} viewBox="0 0 1 1" preserveAspectRatio="none" className="absolute inset-0 size-full cursor-crosshair touch-none"
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
          {regions.map((r, i) => (
            <g key={i} onPointerDown={(e) => { e.stopPropagation(); setSel(i); }}>
              <polygon points={r.polygon.map((p) => p.join(',')).join(' ')} fill={`${COLORS[i % COLORS.length]}33`} stroke={sel === i ? '#fff' : COLORS[i % COLORS.length]}
                strokeWidth={sel === i ? 0.006 : 0.004} vectorEffect="non-scaling-stroke" />
            </g>
          ))}
          {draft ? <polyline points={draft.map((p) => p.join(',')).join(' ')} fill="rgba(255,255,255,.15)" stroke="#fff" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeDasharray="4 3" /> : null}
        </svg>
        {/* numbered labels in px space */}
        {regions.map((r, i) => {
          const xs = r.polygon.map((p) => p[0]), ys = r.polygon.map((p) => p[1]);
          return (
            <span key={`n${i}`} className="pointer-events-none absolute grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-[12px] font-bold text-white shadow"
              style={{ left: `${(Math.min(...xs) + 0.02) * 100}%`, top: `${(Math.min(...ys) + 0.035) * 100}%`, background: COLORS[i % COLORS.length] }}>{i + 1}</span>
          );
        })}
      </div>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        <AnimatePresence initial={false}>
          {regions.map((r, i) => (
            <motion.li key={i} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring.smooth}
              className={cn('flex items-center gap-2 rounded-[12px] border bg-white px-3 py-2', sel === i ? 'border-[#17150f]' : 'border-[rgb(23_21_15/.1)]')}>
              <span className="grid size-6 place-items-center rounded-full text-[12px] font-bold text-white" style={{ background: COLORS[i % COLORS.length] }}>{i + 1}</span>
              <select value={r.zoneId} aria-label={`Zone for region ${i + 1}`} onChange={(e) => setRegions((rs) => rs.map((x, j) => (j === i ? { ...x, zoneId: e.target.value } : x)))}
                className="h-8 flex-1 rounded-[8px] border border-[rgb(23_21_15/.12)] bg-white px-2 text-[14px] text-fg">
                {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
              <Button variant="ghost" size="icon-xs" aria-label={`Remove region ${i + 1}`} onClick={() => setRegions((rs) => rs.filter((_, j) => j !== i))}><Trash2 /></Button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      {!regions.length ? <p className="mt-2 text-[13px] text-fg-3">No regions — this camera reports only its own zone ({zones.find((z) => z.id === cam.zoneId)?.name ?? 'none set'}).</p> : null}
    </div>
  );
}
