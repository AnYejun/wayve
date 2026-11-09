// VenueMap — the live venue map (HQ, setup editor, staff phones). STABLE PROP API (the phone app imports it read-only):
//
//   <VenueMap map={snap.event.map} zones devices? issues? reports? selectedId? onSelect?(zoneId)
//             highlightZoneId? mode?: 'live' | 'edit' | 'preview' compact? grid? onZonesChange?(zones) />
//
// Extra optional props (setup/ops only): tool ('select' | 'grid'), suggestions (dashed AI proposals), devicesEditable +
// onDeviceMove(deviceId, [x, y]), onSelectIssue(issueId), onSelectReport(reportId), className.
//
// Coordinate space = map ? map.width × map.height : MAP_W × MAP_H. floorplan/photo maps draw the image under a white veil;
// schematic maps draw grid paper. Live layer: zones tinted by status (stale = hatch, never observed = dashed), issue pins
// (priority colour + count), report pins (photo reports), device markers at `position ?? centroid(zone)` with coverage lines
// to every zone a camera covers. Wheel / pinch / drag to zoom and pan; double-click zooms; "Fit" resets.
// Edit mode: click to select · drag a zone to move · drag a vertex · double-click an edge to add a vertex · Delete removes
// the selected vertex (or the zone) · grid tool: drag across cells to make a rectangular zone snapped to the grid.
import { MarkerRipple } from '@/shell/live/pulse';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Camera, Maximize2, Mic, Minus, Plus } from 'lucide-react';
import {
  DEVICE_OFFLINE_MS, MAP_H, MAP_W, ZONE_STALE_MS, ZONE_STATUS_LABEL,
  type Device, type Issue, type MapGrid, type Priority, type Report, type VenueMapInfo, type Zone, type ZoneSuggestion,
} from '@shared/contracts';
import { STATUS_COLOR } from '@/design/status';
import { spring } from '@/design/motion';
import { ago, useNow } from '@/lib/time';
import { cn } from '@/lib/utils';
import { PRIORITY_COLOR } from '@/components/ops-bits';

export type Pt = [number, number];
export type Poly = Pt[];
/** Zones as the map needs them. Live zones are full `Zone`s; editor zones may be drafts (temp ids, no status yet). */
export type MapZone = Pick<Zone, 'id' | 'name' | 'polygon'> & Partial<Omit<Zone, 'id' | 'name' | 'polygon'>>;

export interface VenueMapProps {
  map?: VenueMapInfo | null;
  zones: MapZone[];
  devices?: Device[];
  issues?: Issue[];
  reports?: Report[];
  selectedId?: string | null;
  onSelect?: (zoneId: string | null) => void;
  highlightZoneId?: string | null;
  /** Several zones to emphasise (inline answer maps); the other zones are dimmed. */
  highlightZoneIds?: string[];
  mode?: 'live' | 'edit' | 'preview';
  compact?: boolean;
  grid?: MapGrid | null;
  onZonesChange?: (zones: MapZone[]) => void;
  // ── extras (setup / ops) ──
  tool?: 'select' | 'grid' | 'rect' | 'poly';
  suggestions?: ZoneSuggestion[];
  devicesEditable?: boolean;
  onDeviceMove?: (deviceId: string, position: Pt) => void;
  onSelectIssue?: (issueId: string) => void;
  onSelectReport?: (reportId: string) => void;
  className?: string;
}

// ── geometry ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export function mapSize(map?: VenueMapInfo | null) { return map ? { w: map.width, h: map.height } : { w: MAP_W, h: MAP_H }; }
export function bbox(p: Poly) {
  const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
export const rectPoly = (r: { x: number; y: number; w: number; h: number }): Poly => [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];
export function centroid(p: Poly): Pt {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % p.length];
    const f = x0 * y1 - x1 * y0;
    a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-6) { const b = bbox(p); return [b.x + b.w / 2, b.y + b.h / 2]; }
  return [cx / (3 * a), cy / (3 * a)];
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const dist2 = (a: Pt, b: Pt) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
const colName = (i: number) => String.fromCharCode(65 + (i % 26)) + (i >= 26 ? String(Math.floor(i / 26)) : '');
export const newZoneId = () => `new_${Math.random().toString(36).slice(2, 9)}`;

const P_RANK: Record<Priority, number> = { p0: 0, p1: 1, p2: 2, p3: 3 };

type View = { s: number; x: number; y: number };
type Drag =
  | { kind: 'pan'; start: Pt; view: View; pid: number }
  | { kind: 'move'; id: string; start: Pt; orig: Poly; pid: number; moved: boolean }
  | { kind: 'vertex'; id: string; idx: number; pid: number; moved: boolean }
  | { kind: 'grid'; a: [number, number]; b: [number, number]; pid: number }
  | { kind: 'rect'; a: Pt; b: Pt; pid: number }
  | { kind: 'device'; id: string; pos: Pt; pid: number; moved: boolean };

export function VenueMap(props: VenueMapProps) {
  const {
    map, zones, devices = [], issues = [], reports = [], selectedId = null, onSelect, highlightZoneId, highlightZoneIds, mode = 'live', compact,
    grid: gridProp, onZonesChange, tool = 'select', suggestions = [], devicesEditable, onDeviceMove, onSelectIssue, onSelectReport, className,
  } = props;
  const uid = useId().replace(/:/g, '');
  const reduced = useReducedMotion();
  const now = useNow(1000);
  const { w: W, h: H } = mapSize(map);
  const grid = gridProp ?? map?.grid ?? null;
  const edit = mode === 'edit';

  const wrapRef = useRef<HTMLDivElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const [px, setPx] = useState(800); // rendered width of the svg in CSS px
  const [view, setView] = useState<View>({ s: 1, x: 0, y: 0 });
  const [animateView, setAnimateView] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [draft, setDraft] = useState<MapZone[] | null>(null);
  const [selVertex, setSelVertex] = useState<number | null>(null);
  const [hoverDev, setHoverDev] = useState<string | null>(null);
  const [devPos, setDevPos] = useState<Record<string, Pt>>({});
  const [polyDraft, setPolyDraft] = useState<Pt[] | null>(null);
  const [cursor, setCursor] = useState<Pt | null>(null);
  useEffect(() => { if (tool !== 'poly') setPolyDraft(null); }, [tool]);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPx(el.getBoundingClientRect().width || 800));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // map units → screen px (at zoom 1 the whole map fits the width)
  const k = (px / W) * view.s;
  const fs = (screenPx: number) => screenPx / k;

  const list = draft ?? zones;
  const zoneById = useMemo(() => new Map(list.map((z) => [z.id, z])), [list]);

  const toMap = useCallback((e: { clientX: number; clientY: number }): Pt => {
    const g = gRef.current;
    const m = g?.getScreenCTM();
    if (!g || !m) return [0, 0];
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return [p.x, p.y];
  }, []);

  // ── zoom / pan ──
  const zoomAt = useCallback((factor: number, cx?: number, cy?: number, animate = false) => {
    setAnimateView(animate);
    setView((v) => {
      const s = clamp(v.s * factor, 1, 8);
      const fx = cx ?? W / 2, fy = cy ?? H / 2;
      // keep the map point under the cursor fixed
      const x = clamp(fx - (fx - v.x) * (v.s / s), -W * 0.1, W - W / s + W * 0.1);
      const y = clamp(fy - (fy - v.y) * (v.s / s), -H * 0.1, H - H / s + H * 0.1);
      return s === 1 ? { s: 1, x: 0, y: 0 } : { s, x, y };
    });
  }, [W, H]);
  const fitView = () => { setAnimateView(true); setView({ s: 1, x: 0, y: 0 }); };

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || mode === 'preview') return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey && Math.abs(e.deltaY) < 2) return;
      e.preventDefault();
      const [x, y] = toMap(e);
      // translate map coords at current view back to "base" coords for the zoom anchor
      zoomAt(Math.exp(-e.deltaY * 0.0022), x, y);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [mode, toMap, zoomAt]);

  // ── edit helpers ──
  const commit = (next: MapZone[]) => { setDraft(null); onZonesChange?.(next); };
  const gridCell = (p: Pt): [number, number] | null => {
    if (!grid) return null;
    return [clamp(Math.floor((p[0] / W) * grid.cols), 0, grid.cols - 1), clamp(Math.floor((p[1] / H) * grid.rows), 0, grid.rows - 1)];
  };
  const cellRect = (a: [number, number], b: [number, number]) => {
    if (!grid) return null;
    const cw = W / grid.cols, ch = H / grid.rows;
    const c0 = Math.min(a[0], b[0]), c1 = Math.max(a[0], b[0]), r0 = Math.min(a[1], b[1]), r1 = Math.max(a[1], b[1]);
    return { x: c0 * cw, y: r0 * ch, w: (c1 - c0 + 1) * cw, h: (r1 - r0 + 1) * ch, name: `${colName(c0)}${r0 + 1}` };
  };

  // ── pointer handlers ──
  const onBgDown = (e: RPointerEvent<SVGElement>) => {
    if (e.button !== 0) return;
    const p = toMap(e);
    if (edit && tool === 'rect') {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      setDrag({ kind: 'rect', a: p, b: p, pid: e.pointerId });
      return;
    }
    if (edit && tool === 'poly') {
      const q: Pt = [Math.round(clamp(p[0], 0, W)), Math.round(clamp(p[1], 0, H))];
      if (polyDraft && polyDraft.length >= 3 && Math.sqrt(dist2(q, polyDraft[0])) * k < 12) { finishPoly(polyDraft); return; }
      setPolyDraft((d) => [...(d ?? []), q]);
      return;
    }
    if (edit && tool === 'grid' && grid) {
      const c = gridCell(p);
      if (!c) return;
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      setDrag({ kind: 'grid', a: c, b: c, pid: e.pointerId });
      return;
    }
    if (mode !== 'preview') {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      setAnimateView(false);
      setDrag({ kind: 'pan', start: [e.clientX, e.clientY], view, pid: e.pointerId });
    }
    if (edit) { onSelect?.(null); setSelVertex(null); }
  };
  const onZoneDown = (e: RPointerEvent<SVGElement>, z: MapZone) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    if (!edit) { onSelect?.(z.id); return; }
    if (tool !== 'select') { onBgDown(e); return; }
    onSelect?.(z.id);
    setSelVertex(null);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setDrag({ kind: 'move', id: z.id, start: toMap(e), orig: z.polygon.map((q) => [q[0], q[1]] as Pt), pid: e.pointerId, moved: false });
  };
  const onVertexDown = (e: RPointerEvent<SVGElement>, z: MapZone, idx: number) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setSelVertex(idx);
    setDrag({ kind: 'vertex', id: z.id, idx, pid: e.pointerId, moved: false });
  };
  const onDeviceDown = (e: RPointerEvent<SVGElement>, d: Device, pos: Pt) => {
    e.stopPropagation();
    if (!devicesEditable) { setHoverDev((h) => (h === d.id ? null : d.id)); return; }
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setDrag({ kind: 'device', id: d.id, pos, pid: e.pointerId, moved: false });
  };
  const onMove = (e: RPointerEvent<SVGElement>) => {
    if (edit && tool === 'poly' && polyDraft) setCursor(toMap(e));
    if (!drag || e.pointerId !== drag.pid) return;
    if (drag.kind === 'pan') {
      const dx = (e.clientX - drag.start[0]) / ((px / W) * drag.view.s);
      const dy = (e.clientY - drag.start[1]) / ((px / W) * drag.view.s);
      if (drag.view.s === 1 && !edit) return; // nothing to pan at fit
      setView({ s: drag.view.s, x: clamp(drag.view.x - dx, -W * 0.1, W - W / drag.view.s + W * 0.1), y: clamp(drag.view.y - dy, -H * 0.1, H - H / drag.view.s + H * 0.1) });
      return;
    }
    const p = toMap(e);
    if (drag.kind === 'grid') { const c = gridCell(p); if (c) setDrag({ ...drag, b: c }); return; }
    if (drag.kind === 'rect') { setDrag({ ...drag, b: [clamp(p[0], 0, W), clamp(p[1], 0, H)] }); return; }
    if (drag.kind === 'device') { setDevPos((m) => ({ ...m, [drag.id]: [clamp(p[0], 0, W), clamp(p[1], 0, H)] })); setDrag({ ...drag, moved: true }); return; }
    const base = draft ?? zones;
    if (drag.kind === 'move') {
      const b = bbox(drag.orig);
      const dx = clamp(p[0] - drag.start[0], -b.x, W - (b.x + b.w));
      const dy = clamp(p[1] - drag.start[1], -b.y, H - (b.y + b.h));
      const snapT = grid ? Math.min(W / grid.cols, H / grid.rows) / 2 : 0;
      const sx = snapT ? Math.round(dx / snapT) * snapT : Math.round(dx), sy = snapT ? Math.round(dy / snapT) * snapT : Math.round(dy);
      setDraft(base.map((z) => (z.id === drag.id ? { ...z, polygon: drag.orig.map(([x, y]) => [x + sx, y + sy] as Pt) } : z)));
      if (!drag.moved) setDrag({ ...drag, moved: true });
    } else if (drag.kind === 'vertex') {
      const q: Pt = [Math.round(clamp(p[0], 0, W)), Math.round(clamp(p[1], 0, H))];
      setDraft(base.map((z) => (z.id === drag.id ? { ...z, polygon: z.polygon.map((v, i) => (i === drag.idx ? q : v)) } : z)));
      if (!drag.moved) setDrag({ ...drag, moved: true });
    }
  };
  const onUp = (e: RPointerEvent<SVGElement>) => {
    if (!drag || e.pointerId !== drag.pid) return;
    const d = drag;
    setDrag(null);
    if (d.kind === 'grid') {
      const r = cellRect(d.a, d.b);
      if (r) {
        const z: MapZone = { id: newZoneId(), name: uniqueName(r.name, zones), polygon: rectPoly(r) };
        commit([...zones, z]);
        onSelect?.(z.id);
      }
      return;
    }
    if (d.kind === 'rect') {
      const x = Math.round(Math.min(d.a[0], d.b[0])), y = Math.round(Math.min(d.a[1], d.b[1]));
      const w = Math.round(Math.abs(d.a[0] - d.b[0])), h = Math.round(Math.abs(d.a[1] - d.b[1]));
      if (w * k > 12 && h * k > 12) {
        const z: MapZone = { id: newZoneId(), name: uniqueName(`Zone ${zones.length + 1}`, zones), polygon: rectPoly({ x, y, w, h }) };
        commit([...zones, z]);
        onSelect?.(z.id);
      }
      return;
    }
    if (d.kind === 'device') {
      const pos = devPos[d.id];
      if (d.moved && pos) onDeviceMove?.(d.id, [Math.round(pos[0]), Math.round(pos[1])]);
      return;
    }
    if ((d.kind === 'move' || d.kind === 'vertex') && d.moved && draft) commit(draft);
    else setDraft(null);
  };
  const finishPoly = (pts: Pt[]) => {
    setPolyDraft(null); setCursor(null);
    if (pts.length < 3) return;
    const z: MapZone = { id: newZoneId(), name: uniqueName(`Zone ${zones.length + 1}`, zones), polygon: pts };
    commit([...zones, z]);
    onSelect?.(z.id);
  };
  useEffect(() => {
    if (!edit || tool !== 'poly') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setPolyDraft(null); setCursor(null); }
      if (e.key === 'Enter' && polyDraft && polyDraft.length >= 3) finishPoly(polyDraft);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const onEdgeDbl = (e: React.MouseEvent, z: MapZone, i: number) => {
    e.stopPropagation();
    const p = toMap(e);
    const poly = [...z.polygon];
    poly.splice(i + 1, 0, [Math.round(p[0]), Math.round(p[1])]);
    commit(zones.map((x) => (x.id === z.id ? { ...x, polygon: poly } : x)));
    setSelVertex(i + 1);
  };

  // Delete key in edit mode
  useEffect(() => {
    if (!edit || !selectedId) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      e.preventDefault();
      const z = zones.find((x) => x.id === selectedId);
      if (!z) return;
      if (selVertex != null && z.polygon.length > 3) {
        commit(zones.map((x) => (x.id === z.id ? { ...x, polygon: x.polygon.filter((_, i) => i !== selVertex) } : x)));
        setSelVertex(null);
      } else {
        commit(zones.filter((x) => x.id !== z.id));
        onSelect?.(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ── derived live layers ──
  const openIssues = useMemo(() => issues.filter((i) => i.status !== 'done' && i.zoneId), [issues]);
  const issuesByZone = useMemo(() => {
    const m = new Map<string, Issue[]>();
    for (const i of openIssues) { const a = m.get(i.zoneId!) ?? []; a.push(i); m.set(i.zoneId!, a); }
    for (const a of m.values()) a.sort((x, y) => P_RANK[x.priority] - P_RANK[y.priority]);
    return m;
  }, [openIssues]);
  const photoReports = useMemo(() => reports.filter((r) => r.photoUrl && r.zoneId && now - r.createdAt < 3 * 3600_000 && r.status !== 'resolved').slice(0, 30), [reports, now]);
  const devMarkers = useMemo(() => devices.filter((d) => d.deviceType !== 'reporter' || d.position).map((d) => {
    const z = d.zoneId ? zoneById.get(d.zoneId) : undefined;
    const pos = devPos[d.id] ?? d.position ?? (z ? centroid(z.polygon) : null);
    const covers = d.regions?.length ? d.regions.map((r) => r.zoneId) : d.zoneId ? [d.zoneId] : [];
    return pos ? { d, pos: pos as Pt, covers } : null;
  }).filter((x): x is { d: Device; pos: Pt; covers: string[] } => !!x), [devices, zoneById, devPos]);
  const coveredByOnline = useMemo(() => {
    const s = new Set<string>();
    for (const m of devMarkers) if (now - m.d.lastSeenAt < DEVICE_OFFLINE_MS) for (const z of m.covers) s.add(z);
    return s;
  }, [devMarkers, now]);

  const gridDraft = drag?.kind === 'grid' ? cellRect(drag.a, drag.b) : null;
  const rectDraft = drag?.kind === 'rect' ? { x: Math.min(drag.a[0], drag.b[0]), y: Math.min(drag.a[1], drag.b[1]), w: Math.abs(drag.a[0] - drag.b[0]), h: Math.abs(drag.a[1] - drag.b[1]) } : null;
  const sel = selectedId ? zoneById.get(selectedId) : undefined;

  return (
    <div ref={wrapRef} className={cn('relative w-full select-none overflow-hidden rounded-[14px] bg-[#f7f6f3]', className)}
      style={{ aspectRatio: `${W} / ${H}`, touchAction: mode === 'preview' ? 'auto' : 'none' }}>
      <svg viewBox={`0 0 ${W} ${H}`} className={cn('absolute inset-0 size-full', edit && tool !== 'select' ? 'cursor-crosshair' : drag?.kind === 'pan' ? 'cursor-grabbing' : '')}
        onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        onDoubleClick={(e) => { if (mode === 'preview' || edit) return; const [x, y] = toMap(e); zoomAt(2, x, y, true); }}
        role="img" aria-label="Venue map">
        <defs>
          <pattern id={`hatch-${uid}`} width={fs(7)} height={fs(7)} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2={fs(7)} stroke="rgba(23,21,15,.10)" strokeWidth={fs(2)} />
          </pattern>
          <pattern id={`paper-${uid}`} width={W / 20} height={W / 20} patternUnits="userSpaceOnUse">
            <path d={`M ${W / 20} 0 L 0 0 0 ${W / 20}`} fill="none" stroke="rgba(23,21,15,.06)" strokeWidth={fs(1)} />
          </pattern>
        </defs>
        <g ref={gRef} transform={`scale(${view.s}) translate(${-view.x} ${-view.y})`}
          style={{ transition: animateView && !reduced ? 'transform 420ms cubic-bezier(.16,1,.3,1)' : undefined }}>
          {/* background */}
          <rect x={0} y={0} width={W} height={H} fill={map?.imageUrl ? '#fff' : `url(#paper-${uid})`} onPointerDown={onBgDown} />
          {map?.imageUrl ? (
            <>
              <image href={map.imageUrl} x={0} y={0} width={W} height={H} preserveAspectRatio="xMidYMid meet" style={{ filter: 'saturate(.55) contrast(.96)' }} pointerEvents="none" />
              <rect x={0} y={0} width={W} height={H} fill="rgba(255,255,255,.38)" pointerEvents="none" />
            </>
          ) : null}
          {grid && (edit || mode === 'live') ? (
            <g pointerEvents="none" opacity={edit ? 1 : 0.5}>
              {Array.from({ length: grid.cols - 1 }, (_, i) => <line key={`c${i}`} x1={((i + 1) * W) / grid.cols} y1={0} x2={((i + 1) * W) / grid.cols} y2={H} stroke="rgba(23,21,15,.10)" strokeWidth={fs(1)} />)}
              {Array.from({ length: grid.rows - 1 }, (_, i) => <line key={`r${i}`} x1={0} y1={((i + 1) * H) / grid.rows} x2={W} y2={((i + 1) * H) / grid.rows} stroke="rgba(23,21,15,.10)" strokeWidth={fs(1)} />)}
              {edit && k * (W / grid.cols) > 28 ? Array.from({ length: grid.cols }, (_, c) => (
                <text key={`l${c}`} x={((c + 0.5) * W) / grid.cols} y={fs(12)} fontSize={fs(10)} textAnchor="middle" fill="rgba(23,21,15,.35)" fontWeight={600}>{colName(c)}</text>
              )) : null}
            </g>
          ) : null}

          {/* AI suggestions (dashed) */}
          {suggestions.map((s, i) => (
            <polygon key={`s${i}`} points={s.polygon.map((p) => p.join(',')).join(' ')} fill="rgba(110,86,240,.06)" stroke="#6E56F0"
              strokeDasharray={`${fs(6)} ${fs(4)}`} strokeWidth={fs(1.5)} pointerEvents="none" />
          ))}

          {/* zones */}
          {list.map((z) => {
            const st = z.status ?? 'unknown';
            const c = STATUS_COLOR[st];
            const stale = z.lastObservedAt != null && now - z.lastObservedAt > ZONE_STALE_MS;
            const never = !edit && (z.lastObservedAt == null);
            const isSel = z.id === selectedId;
            const isHi = z.id === highlightZoneId || !!highlightZoneIds?.includes(z.id);
            const dimmed = !!highlightZoneIds?.length && !isHi;
            const covered = coveredByOnline.has(z.id);
            const pts = z.polygon.map((p) => p.join(',')).join(' ');
            const b = bbox(z.polygon);
            const wpx = b.w * k, hpx = b.h * k;
            return (
              <g key={z.id} opacity={dimmed ? 0.32 : 1}>
                <motion.polygon points={pts}
                  initial={false}
                  animate={{ fill: edit ? (isSel ? 'rgba(23,21,15,.08)' : 'rgba(255,255,255,.55)') : c.fill }}
                  transition={{ duration: 0.4 }}
                  stroke={edit ? (isSel ? '#17150f' : 'rgba(23,21,15,.35)') : isSel || isHi ? '#17150f' : covered && st === 'unknown' ? 'rgba(23,21,15,.3)' : c.stroke}
                  strokeWidth={fs(isSel || isHi ? 2 : 1.25)} strokeDasharray={never && !covered ? `${fs(5)} ${fs(4)}` : undefined}
                  style={{ cursor: mode === 'preview' ? 'default' : edit ? (tool !== 'select' ? 'crosshair' : 'move') : 'pointer' }}
                  onPointerDown={(e) => onZoneDown(e, z)} />
                {stale && !edit ? <polygon points={pts} fill={`url(#hatch-${uid})`} pointerEvents="none" /> : null}
                {/* label */}
                {wpx > 46 && hpx > 22 ? (
                  <g pointerEvents="none">
                    {/* On a floor plan / photo, labels sit on a paper chip so they never collide with text printed on the image. */}
                    {map?.imageUrl ? (() => {
                      const name = clip(z.name, wpx - 20, compact ? 11.5 : 13);
                      const showSt = !edit && hpx > 46 && wpx > 90;
                      const stText = `${ZONE_STATUS_LABEL[st]}${z.peopleEstimate != null ? ` · ~${z.peopleEstimate}` : ''}${stale ? ' · stale' : ''}`;
                      const wChars = Math.max(name.length * (compact ? 11.5 : 13), showSt ? stText.length * 11 : 0) * 0.58;
                      const showAgo = !edit && !compact && hpx > 70 && wpx > 110 && !!z.lastObservedAt;
                      const h = showAgo ? 60 : showSt ? (compact ? 36 : 46) : (compact ? 22 : 28);
                      return <rect x={b.x + fs(4)} y={b.y + fs(4)} width={fs(Math.min(wChars + 14, wpx - 8))} height={fs(h)} rx={fs(7)} fill="rgba(255,255,255,.94)" stroke="rgba(23,21,15,.08)" strokeWidth={fs(0.75)} />;
                    })() : null}
                    <text x={b.x + fs(10)} y={b.y + fs(compact ? 16 : 20)} fontSize={fs(compact ? 11.5 : 13)} fontWeight={650} fill="#17150f" letterSpacing={-0.1}>
                      {clip(z.name, wpx - 20, compact ? 11.5 : 13)}
                    </text>
                    {!edit && hpx > 46 && wpx > 90 ? (
                      <text x={b.x + fs(10)} y={b.y + fs(compact ? 31 : 38)} fontSize={fs(11)} fill={c.fg} fontWeight={600}>
                        {ZONE_STATUS_LABEL[st]}{z.peopleEstimate != null ? ` · ~${z.peopleEstimate}` : ''}{stale ? ' · stale' : ''}
                      </text>
                    ) : null}
                    {!edit && !compact && hpx > 70 && wpx > 110 && z.lastObservedAt ? (
                      <text x={b.x + fs(10)} y={b.y + fs(53)} fontSize={fs(10.5)} fill="rgba(23,21,15,.5)">{ago(z.lastObservedAt, now)}</text>
                    ) : null}
                  </g>
                ) : null}
              </g>
            );
          })}

          {/* grid draft */}
          {gridDraft ? (
            <g pointerEvents="none">
              <rect x={gridDraft.x} y={gridDraft.y} width={gridDraft.w} height={gridDraft.h} fill="rgba(23,21,15,.08)" stroke="#17150f" strokeWidth={fs(1.5)} />
              <text x={gridDraft.x + fs(8)} y={gridDraft.y + fs(18)} fontSize={fs(12)} fontWeight={650} fill="#17150f">{gridDraft.name}</text>
            </g>
          ) : null}

          {rectDraft ? <rect x={rectDraft.x} y={rectDraft.y} width={rectDraft.w} height={rectDraft.h} fill="rgba(23,21,15,.08)" stroke="#17150f" strokeWidth={fs(1.5)} pointerEvents="none" /> : null}
          {polyDraft ? (
            <g pointerEvents="none">
              <polyline points={[...polyDraft, ...(cursor ? [cursor] : [])].map((p) => p.join(',')).join(' ')} fill="rgba(23,21,15,.06)" stroke="#17150f" strokeWidth={fs(1.5)} strokeDasharray={`${fs(5)} ${fs(3)}`} />
              {polyDraft.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={fs(i === 0 ? 6 : 4)} fill={i === 0 ? '#17150f' : '#fff'} stroke="#17150f" strokeWidth={fs(1.5)} />)}
            </g>
          ) : null}

          {/* edit: vertices + edges of the selected zone */}
          {edit && sel && tool === 'select' ? (
            <g>
              {sel.polygon.map((p, i) => {
                const q = sel.polygon[(i + 1) % sel.polygon.length];
                return <line key={`e${i}`} x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} stroke="transparent" strokeWidth={fs(12)} style={{ cursor: 'copy' }}
                  onDoubleClick={(e) => onEdgeDbl(e, sel, i)} />;
              })}
              {sel.polygon.map((p, i) => (
                <circle key={`v${i}`} cx={p[0]} cy={p[1]} r={fs(selVertex === i ? 6.5 : 5)} fill={selVertex === i ? '#17150f' : '#fff'} stroke="#17150f" strokeWidth={fs(1.5)}
                  style={{ cursor: 'grab' }} onPointerDown={(e) => onVertexDown(e, sel, i)} />
              ))}
            </g>
          ) : null}

          {/* coverage lines (device → zone centroid) */}
          {mode !== 'edit' || devicesEditable ? devMarkers.map(({ d, pos, covers }) => covers.map((zid) => {
            const z = zoneById.get(zid);
            if (!z) return null;
            const c = centroid(z.polygon);
            const online = now - d.lastSeenAt < DEVICE_OFFLINE_MS;
            return <line key={`cov-${d.id}-${zid}`} x1={pos[0]} y1={pos[1]} x2={c[0]} y2={c[1]} stroke={online ? 'rgba(23,21,15,.28)' : 'rgba(23,21,15,.12)'}
              strokeWidth={fs(1)} strokeDasharray={`${fs(3)} ${fs(3)}`} pointerEvents="none" />;
          })) : null}

          {/* issue pins */}
          {mode !== 'edit' ? [...issuesByZone].map(([zid, arr]) => {
            const z = zoneById.get(zid);
            if (!z) return null;
            const b = bbox(z.polygon);
            const top = arr[0];
            const col = PRIORITY_COLOR[top.priority];
            const cx = b.x + b.w - fs(16), cy = b.y + fs(16);
            return (
              <g key={`pin-${zid}`} style={{ cursor: 'pointer' }} onPointerDown={(e) => { e.stopPropagation(); onSelectIssue?.(top.id); }}>
                {top.priority === 'p0' && !reduced ? (
                  <motion.circle cx={cx} cy={cy} r={fs(9)} fill={col} initial={{ opacity: 0.45, scale: 1 }} animate={{ opacity: 0, scale: 2.4 }}
                    transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }} style={{ transformOrigin: `${cx}px ${cy}px`, transformBox: 'fill-box' }} />
                ) : null}
                <circle cx={cx} cy={cy} r={fs(9)} fill={col} stroke="#fff" strokeWidth={fs(2)} />
                <text x={cx} y={cy + fs(3.6)} fontSize={fs(10)} fontWeight={700} fill="#fff" textAnchor="middle">{arr.length > 9 ? '9+' : arr.length}</text>
                <title>{arr.map((i) => `${i.key} ${i.title}`).join('\n')}</title>
              </g>
            );
          }) : null}

          {/* report pins (photo) */}
          {mode !== 'edit' ? photoReports.map((r, i) => {
            const z = zoneById.get(r.zoneId!);
            if (!z) return null;
            const b = bbox(z.polygon);
            const cx = b.x + fs(18) + (i % 4) * fs(20), cy = b.y + b.h - fs(16);
            return (
              <g key={`rp-${r.id}`} style={{ cursor: 'pointer' }} onPointerDown={(e) => { e.stopPropagation(); onSelectReport?.(r.id); }}>
                <circle cx={cx} cy={cy} r={fs(9)} fill="#fff" stroke="rgba(23,21,15,.35)" strokeWidth={fs(1)} />
                <Camera x={cx - fs(5.5)} y={cy - fs(5.5)} width={fs(11)} height={fs(11)} strokeWidth={2} color="#17150f" />
                <title>{r.ai?.title ?? r.text ?? 'Report'}</title>
              </g>
            );
          }) : null}

          {/* devices */}
          {devMarkers.map(({ d, pos }) => {
            const online = now - d.lastSeenAt < DEVICE_OFFLINE_MS;
            const receiving = online && d.lastFrameAt != null && now - d.lastFrameAt < 6000;
            const isCam = d.deviceType === 'camera', isScribe = d.deviceType === 'scribe';
            const r = fs(isCam || isScribe ? 9 : 5);
            const Icon = isCam ? Camera : Mic;
            return (
              <motion.g key={`dev-${d.id}`} style={{ cursor: devicesEditable ? 'grab' : 'pointer' }} initial={false}
                animate={{ x: pos[0], y: pos[1] }} transition={devicesEditable || reduced ? { duration: 0 } : spring.smooth}
                onPointerDown={(e) => onDeviceDown(e, d, pos)} onPointerEnter={() => setHoverDev(d.id)} onPointerLeave={() => setHoverDev((h) => (h === d.id ? null : h))}>
                {/* drawn at the origin; the group glides to the device's spot (people moving between zones animate) */}
                {receiving && !reduced ? (
                  <motion.circle cx={0} cy={0} r={r} fill="#58a069" initial={{ opacity: 0.35, scale: 1 }} animate={{ opacity: 0, scale: 2.2 }}
                    transition={{ duration: 1.4, repeat: Infinity, ease: 'easeOut' }} style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />
                ) : null}
                <MarkerRipple deviceId={d.id} cx={0} cy={0} r={r} />
                <circle cx={0} cy={0} r={r} fill={isCam || isScribe ? '#fff' : online ? '#17150f' : '#b9b8b4'}
                  stroke={online ? '#17150f' : '#b9b8b4'} strokeWidth={fs(1.5)} strokeDasharray={online ? undefined : `${fs(2)} ${fs(2)}`} />
                {isCam || isScribe ? <Icon x={-fs(5.5)} y={-fs(5.5)} width={fs(11)} height={fs(11)} strokeWidth={2.2} color={online ? '#17150f' : '#a3a29f'} /> : null}
                {online && (isCam || isScribe) ? <circle cx={r * 0.72} cy={-r * 0.72} r={fs(2.6)} fill="#58a069" stroke="#fff" strokeWidth={fs(1)} /> : null}
              </motion.g>
            );
          })}
        </g>
      </svg>

      {/* device tooltip (screen space) */}
      <AnimatePresence>
        {hoverDev ? (() => {
          const m = devMarkers.find((x) => x.d.id === hoverDev);
          if (!m) return null;
          const sx = ((m.pos[0] - view.x) * view.s * px) / W;
          const sy = ((m.pos[1] - view.y) * view.s * px) / W;
          const online = now - m.d.lastSeenAt < DEVICE_OFFLINE_MS;
          const zn = m.covers.map((z) => zoneById.get(z)?.name).filter(Boolean).join(', ');
          return (
            <motion.div key="tip" initial={{ opacity: 0, y: 4, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }} transition={spring.snappy}
              className="mat-float pointer-events-none absolute z-10 w-max max-w-[240px] rounded-[12px] px-3 py-2 text-[12px] leading-[17px]"
              style={{ left: clamp(sx + 14, 4, px - 200), top: Math.max(4, sy - 10) }}>
              <div className="text-[13px] font-semibold text-fg">{m.d.label}</div>
              <div className="text-fg-2">{online ? (m.d.mode === 'observing' ? (m.d.deviceType === 'scribe' ? 'Transcribing' : 'Observing') : m.d.mode === 'paused' ? 'Paused' : 'Idle') : `Offline · seen ${ago(m.d.lastSeenAt, now)}`}</div>
              {zn ? <div className="text-fg-2">Covers {zn}</div> : null}
              {m.d.lastFrameAt ? <div className="text-fg-3 tabular-nums">Last frame {ago(m.d.lastFrameAt, now)}</div> : null}
            </motion.div>
          );
        })() : null}
      </AnimatePresence>

      {/* zoom controls */}
      {mode !== 'preview' && !compact ? (
        <div className="absolute right-3 bottom-3 flex flex-col overflow-hidden rounded-[12px] mat-float">
          <ZoomBtn label="Zoom in" onClick={() => zoomAt(1.5, undefined, undefined, true)}><Plus className="size-4" /></ZoomBtn>
          <ZoomBtn label="Zoom out" onClick={() => zoomAt(1 / 1.5, undefined, undefined, true)}><Minus className="size-4" /></ZoomBtn>
          <ZoomBtn label="Fit" onClick={fitView}><Maximize2 className="size-3.5" /></ZoomBtn>
        </div>
      ) : null}
    </div>
  );
}

function ZoomBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <motion.button type="button" aria-label={label} title={label} onClick={onClick} whileTap={{ scale: 0.92 }} transition={spring.snappy}
      className="grid size-9 place-items-center text-fg-2 hover:bg-[rgb(23_21_15/.05)] hover:text-fg [&+&]:border-t [&+&]:border-[rgb(23_21_15/.08)]">
      {children}
    </motion.button>
  );
}

function clip(s: string, maxPx: number, fontPx: number) {
  const maxCh = Math.max(1, Math.floor(maxPx / (fontPx * 0.58)));
  return s.length <= maxCh ? s : s.slice(0, Math.max(1, maxCh - 1)) + '…';
}

function uniqueName(base: string, zones: MapZone[]) {
  const names = new Set(zones.map((z) => z.name));
  if (!names.has(base)) return base;
  for (let i = 2; i < 99; i++) if (!names.has(`${base}-${i}`)) return `${base}-${i}`;
  return base;
}

export default VenueMap;
