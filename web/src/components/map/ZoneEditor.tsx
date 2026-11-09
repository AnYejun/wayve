// Zone editor: VenueMap in edit mode + toolbar (Select / Grid, grid size, undo/redo) + zone list + Save/Discard bar.
// Zones are edited locally; Save sends the whole set in one request (API.replaceZones). ⌘Z / ⇧⌘Z undo/redo.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Grid3x3, MousePointer2, PenLine, Redo2, Square, Trash2, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Device, MapGrid, VenueMapInfo, Zone, ZoneSuggestion } from '@shared/contracts';
import { API } from '@/lib/api';
import { spring } from '@/design/motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { VenueMap, newZoneId, type MapZone } from '@/components/VenueMap';

const strip = (zs: MapZone[]) => zs.map((z) => ({ id: z.id, name: z.name, polygon: z.polygon }));

export function ZoneEditor({ eventId, map, zones, devices, pending, onPendingConsumed, onDeviceMove }: {
  eventId: string; map: VenueMapInfo | null; zones: Zone[]; devices: Device[];
  /** AI suggestions accepted elsewhere — merged into the draft once. */
  pending?: ZoneSuggestion[] | null; onPendingConsumed?: () => void;
  onDeviceMove?: (deviceId: string, pos: [number, number]) => void;
}) {
  const [hist, setHist] = useState<{ stack: MapZone[][]; i: number }>(() => ({ stack: [strip(zones)], i: 0 }));
  const cur = hist.stack[hist.i];
  const [dirty, setDirty] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [tool, setTool] = useState<'select' | 'grid' | 'rect' | 'poly'>(zones.length ? 'select' : 'grid');
  const [grid, setGrid] = useState<MapGrid>(() => map?.grid ?? { cols: 20, rows: 12 });
  const [saving, setSaving] = useState(false);

  // Server zones changed and we're clean → follow them.
  const serverKey = zones.map((z) => `${z.id}:${z.version}`).join('|');
  useEffect(() => { if (!dirty) setHist({ stack: [strip(zones)], i: 0 }); }, [serverKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const push = useCallback((next: MapZone[]) => {
    setHist((h) => ({ stack: [...h.stack.slice(0, h.i + 1), next].slice(-60), i: Math.min(h.i + 1, 59) }));
    setDirty(true);
  }, []);
  const undo = useCallback(() => setHist((h) => (h.i > 0 ? { ...h, i: h.i - 1 } : h)), []);
  const redo = useCallback(() => setHist((h) => (h.i < h.stack.length - 1 ? { ...h, i: h.i + 1 } : h)), []);

  useEffect(() => {
    if (!pending?.length) return;
    push([...cur, ...pending.map((s) => ({ id: newZoneId(), name: s.name, polygon: s.polygon }))]);
    onPendingConsumed?.();
  }, [pending]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const save = async () => {
    setSaving(true);
    try {
      if (map?.grid?.cols !== grid.cols || map?.grid?.rows !== grid.rows) await API.setGrid(eventId, grid).catch(() => null);
      const res = await API.replaceZones(eventId, cur.map((z) => ({ id: z.id.startsWith('new_') ? undefined : z.id, name: z.name.trim() || 'Zone', polygon: z.polygon })));
      setHist({ stack: [strip(res.zones)], i: 0 });
      setDirty(false);
      toast.success('Zones saved');
    } catch (e) {
      toast.error((e as Error).message || "Couldn't save zones");
    } finally { setSaving(false); }
  };
  const discard = () => { setHist({ stack: [strip(zones)], i: 0 }); setDirty(false); setSel(null); };

  const live = useMemo(() => new Map(zones.map((z) => [z.id, z])), [zones]);
  const display: MapZone[] = cur.map((z) => ({ ...live.get(z.id), ...z }));

  return (
    <div className="relative">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-[10px] bg-[#f0efec] p-[3px]" role="radiogroup" aria-label="Tool">
          {([['select', MousePointer2, 'Select'], ['grid', Grid3x3, 'Grid'], ['rect', Square, 'Rectangle'], ['poly', PenLine, 'Polygon']] as const).map(([k, I, label]) => (
            <button key={k} type="button" role="radio" aria-checked={tool === k} onClick={() => setTool(k)}
              className={cn('relative flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-[13px] font-medium', tool === k ? 'text-fg' : 'text-fg-2')}>
              {tool === k ? <motion.span layoutId="zone-tool" transition={spring.smooth} className="absolute inset-0 rounded-[8px] bg-white shadow-[0_1px_2px_rgb(23_21_15/.08),0_0_0_.5px_rgb(23_21_15/.08)]" /> : null}
              <I className="relative size-4" strokeWidth={1.75} /><span className="relative">{label}</span>
            </button>
          ))}
        </div>
        <AnimatePresence initial={false}>
          {tool === 'grid' ? (
            <motion.div initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={spring.smooth}
              className="flex items-center gap-1.5 text-[13px] text-fg-2">
              <NumField label="Columns" value={grid.cols} onChange={(cols) => { setGrid((g) => ({ ...g, cols })); setDirty(true); }} />
              <span>×</span>
              <NumField label="Rows" value={grid.rows} onChange={(rows) => { setGrid((g) => ({ ...g, rows })); setDirty(true); }} />
              <span className="ml-1 text-fg-3">Drag across cells to make a zone</span>
            </motion.div>
          ) : (
            <motion.span key={`hint-${tool}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-[13px] text-fg-3">
              {tool === 'rect' ? 'Drag to draw a zone' : tool === 'poly' ? 'Click points · click the first point or press Enter to close · Esc cancels' : 'Drag to move · drag a point · double-click an edge to add a point · Delete removes'}
            </motion.span>
          )}
        </AnimatePresence>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" aria-label="Undo" onClick={undo} disabled={hist.i === 0}><Undo2 /></Button>
          <Button variant="ghost" size="icon-sm" aria-label="Redo" onClick={redo} disabled={hist.i >= hist.stack.length - 1}><Redo2 /></Button>
        </div>
      </div>

      <VenueMap map={map} zones={display} devices={devices} mode="edit" tool={tool} grid={grid}
        selectedId={sel} onSelect={setSel} onZonesChange={push} devicesEditable={!!onDeviceMove} onDeviceMove={onDeviceMove}
        className="border border-[rgb(23_21_15/.1)]" />

      <div className="mt-4 overflow-hidden rounded-[14px] border border-[rgb(23_21_15/.1)] bg-white">
        <div className="flex items-center justify-between border-b border-[rgb(23_21_15/.08)] px-4 py-2.5">
          <span className="text-[13px] font-semibold text-fg">Zones <span className="font-normal text-fg-3 tabular-nums">{cur.length}</span></span>
        </div>
        {cur.length === 0 ? (
          <p className="px-4 py-6 text-center text-[14px] text-fg-2">No zones yet. Use the grid tool or accept AI suggestions.</p>
        ) : (
          <ul className="max-h-[280px] overflow-auto">
            <AnimatePresence initial={false}>
              {cur.map((z) => (
                <motion.li key={z.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring.smooth}
                  className={cn('flex items-center gap-2 border-b border-[rgb(23_21_15/.06)] px-3 py-1.5 last:border-0', sel === z.id && 'bg-[rgb(23_21_15/.04)]')}
                  onClick={() => setSel(z.id)}>
                  <Input value={z.name} aria-label="Zone name" className="h-8 flex-1 border-0 bg-transparent text-[14px] shadow-none focus-visible:bg-white"
                    onChange={(e) => {
                      const v = e.target.value;
                      setHist((h) => { const s = h.stack.slice(0, h.i + 1); s[h.i] = s[h.i].map((x) => (x.id === z.id ? { ...x, name: v } : x)); return { stack: s, i: h.i }; });
                      setDirty(true);
                    }} />
                  <span className="text-[12px] text-fg-3 tabular-nums">{z.polygon.length} pts</span>
                  <Button variant="ghost" size="icon-xs" aria-label={`Delete ${z.name}`} onClick={(e) => { e.stopPropagation(); push(cur.filter((x) => x.id !== z.id)); }}>
                    <Trash2 />
                  </Button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>

      <AnimatePresence>
        {dirty ? (
          <motion.div initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 24, opacity: 0 }} transition={spring.sheet}
            className="mat-float sticky bottom-4 z-20 mt-4 flex items-center gap-3 rounded-[14px] px-4 py-3">
            <span className="text-[14px] text-fg">Unsaved zone changes</span>
            <div className="ml-auto flex gap-2">
              <Button variant="outline" size="sm" onClick={discard} disabled={saving}>Discard</Button>
              <Button size="sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save zones'}</Button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <input aria-label={label} type="number" min={2} max={40} value={value}
      onChange={(e) => onChange(Math.max(2, Math.min(40, Number(e.target.value) || 2)))}
      className="h-8 w-14 rounded-[8px] border border-[rgb(23_21_15/.12)] bg-white px-2 text-center text-[13px] tabular-nums text-fg" />
  );
}
