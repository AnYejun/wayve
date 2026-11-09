// Map source (canvas-first): "Start from a blank canvas" (default — a clean grid you draw zones on), "Upload a floor plan", or a preset venue
// (image background; AI proposes zones), with "or use a wide photo of the room" as the secondary option. Suggestions show
// dashed on the map with per-suggestion toggles; "Add to zones" merges them into the zone editor draft (saved there).
import { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, FileImage, Grid3x3, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { VenueMapInfo, Zone, ZoneSuggestion } from '@shared/contracts';
import { API } from '@/lib/api';
import { rise, spring } from '@/design/motion';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { VenueMap } from '@/components/VenueMap';
import { PresetApply } from '@/components/install/PresetPicker';

type Busy = null | 'floorplan' | 'photo' | 'suggest' | 'blank';

export function MapSource({ eventId, map, zones, onAccept, onBlank }: {
  eventId: string; map: VenueMapInfo | null; zones: Zone[]; onAccept: (s: ZoneSuggestion[]) => void; onBlank?: () => void;
}) {
  const [busy, setBusy] = useState<Busy>(null);
  const [suggestions, setSuggestions] = useState<ZoneSuggestion[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);
  const kindRef = useRef<'floorplan' | 'photo'>('floorplan');
  const hasImage = !!map?.imageUrl;

  const pick = (kind: 'floorplan' | 'photo') => { kindRef.current = kind; fileRef.current?.click(); };
  const upload = async (f: File) => {
    setBusy(kindRef.current);
    try {
      const res = await API.uploadMapAs(eventId, f, kindRef.current);
      setSuggestions(res.suggestions);
      setPicked(new Set(res.suggestions.map((_, i) => i)));
      toast.success(res.suggestions.length ? `Plan uploaded · AI found ${res.suggestions.length} zones` : 'Plan uploaded');
    } catch (e) { toast.error((e as Error).message || 'Upload failed'); }
    finally { setBusy(null); }
  };
  const suggest = async () => {
    setBusy('suggest');
    try {
      const res = await API.suggestZones(eventId);
      setSuggestions(res.suggestions);
      setPicked(new Set(res.suggestions.map((_, i) => i)));
      if (!res.suggestions.length) toast('No zones found on this image');
    } catch (e) { toast.error((e as Error).message || 'AI zoning failed'); }
    finally { setBusy(null); }
  };
  const blank = async () => {
    if (hasImage && !confirm('Remove the floor plan and use a blank canvas? Zones stay.')) return;
    setBusy('blank');
    try {
      if (hasImage) await API.deleteMap(eventId);
      await API.setGrid(eventId, { cols: 20, rows: 12 }).catch(() => null);
      setSuggestions([]);
      onBlank?.();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(null); }
  };
  const accept = () => {
    const s = suggestions.filter((_, i) => picked.has(i));
    if (!s.length) return;
    onAccept(s);
    setSuggestions([]);
    toast.success(`${s.length} zones added — fine-tune and save below`);
  };

  return (
    <div>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }} />
      <motion.div className="grid gap-3 sm:grid-cols-2" initial="initial" animate="animate" variants={{ animate: { transition: { staggerChildren: 0.05 } } }}>
        <motion.button type="button" variants={rise} whileTap={{ scale: 0.985 }} onClick={() => void blank()} disabled={!!busy}
          className={cn('flex items-start gap-4 rounded-[18px] border bg-white p-5 text-left transition-[border-color,box-shadow]',
            !hasImage ? 'border-[#17150f] shadow-[0_0_0_1px_#17150f]' : 'border-[rgb(23_21_15/.1)] hover:border-[rgb(23_21_15/.25)]')}>
          <span className="grid size-11 shrink-0 place-items-center rounded-[12px] bg-[#f5f4f2]">{busy === 'blank' ? <Loader2 className="size-5 animate-spin" /> : <Grid3x3 className="size-5" strokeWidth={1.75} />}</span>
          <span className="min-w-0">
            <span className="flex items-center gap-2 text-[16px] font-semibold text-fg">Start from a blank canvas{!hasImage ? <Check className="size-4" /> : null}</span>
            <span className="mt-1 block text-[14px] leading-[20px] text-fg-2">A clean grid. Paint zones with the grid tool, or draw rectangles and shapes. Fastest way to model any room.</span>
          </span>
        </motion.button>
        <motion.div variants={rise}
          className={cn('flex items-start gap-4 rounded-[18px] border bg-white p-5 transition-[border-color,box-shadow]',
            hasImage ? 'border-[#17150f] shadow-[0_0_0_1px_#17150f]' : 'border-[rgb(23_21_15/.1)]')}>
          <span className="grid size-11 shrink-0 place-items-center rounded-[12px] bg-[#f5f4f2]">{busy === 'floorplan' || busy === 'photo' ? <Loader2 className="size-5 animate-spin" /> : <FileImage className="size-5" strokeWidth={1.75} />}</span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 text-[16px] font-semibold text-fg">Upload a floor plan{hasImage ? <Check className="size-4" /> : null}</span>
            <span className="mt-1 block text-[14px] leading-[20px] text-fg-2">PNG or JPG of the venue layout. AI proposes zones on it; you decide.</span>
            <span className="mt-3 flex flex-wrap items-center gap-3">
              <Button size="sm" onClick={() => pick('floorplan')} disabled={!!busy}>{hasImage ? 'Replace plan' : 'Choose image'}</Button>
              <button type="button" onClick={() => pick('photo')} disabled={!!busy} className="text-[13px] font-medium text-fg-2 underline-offset-4 hover:text-fg hover:underline">
                or use a wide photo of the room
              </button>
            </span>
          </span>
        </motion.div>
      </motion.div>

      <div className="mt-6"><PresetApply eventId={eventId} currentPresetId={map?.presetId ?? null} onApplied={() => { setSuggestions([]); onBlank?.(); }} /></div>

      {hasImage ? (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={spring.smooth} className="mt-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-fg-2">{map!.kind === 'photo' ? 'Room photo' : 'Floor plan'} · {map!.width} × {map!.height}</span>
            <div className="ml-auto flex gap-2">
              <Button variant="outline" size="sm" onClick={() => void suggest()} disabled={!!busy}>{busy === 'suggest' ? <Loader2 className="animate-spin" /> : null}Suggest zones with AI</Button>
              <Button variant="ghost" size="sm" onClick={() => void blank()} disabled={!!busy}><Trash2 />Remove</Button>
            </div>
          </div>
          {suggestions.length ? (
            <VenueMap map={map} zones={zones} mode="preview" suggestions={suggestions.filter((_, i) => picked.has(i))} className="border border-[rgb(23_21_15/.1)]" />
          ) : null}
          <AnimatePresence>
            {suggestions.length ? (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring.smooth}
                className="mt-3 rounded-[16px] border border-[rgb(110_86_240/.25)] bg-[#faf9ff] p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-semibold text-fg">AI suggested {suggestions.length} zones</span>
                  <span className="text-[13px] text-fg-2">Keep the ones that look right.</span>
                  <Button size="sm" className="ml-auto" onClick={accept} disabled={!picked.size}>Add {picked.size} to zones</Button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {suggestions.map((s, i) => {
                    const on = picked.has(i);
                    return (
                      <motion.button key={i} type="button" whileTap={{ scale: 0.96 }} transition={spring.snappy}
                        onClick={() => setPicked((p) => { const n = new Set(p); if (n.has(i)) n.delete(i); else n.add(i); return n; })}
                        className={cn('inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium',
                          on ? 'bg-[#17150f] text-white' : 'bg-white text-fg-2 shadow-[inset_0_0_0_1px_rgb(23_21_15/.12)]')}>
                        {on ? <Check className="size-3.5" /> : null}{s.name}<span className={cn('tabular-nums', on ? 'text-white/60' : 'text-fg-3')}>{Math.round(s.confidence * 100)}%</span>
                      </motion.button>
                    );
                  })}
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </motion.div>
      ) : null}
    </div>
  );
}
