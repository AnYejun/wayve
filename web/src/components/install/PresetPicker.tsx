// Preset venues (templates that ship a real floor plan + install plan). Two uses:
//  • variant "pick"  — /setup new-event flow: a large selectable card (selected = ink ring).
//  • variant "apply" — Settings → Map: "Start from a preset venue" → confirm → replaces the map and zones.
import { useState } from 'react';
import { motion } from 'motion/react';
import { Building2, Camera, Check, Loader2, Mic } from 'lucide-react';
import { toast } from 'sonner';
import type { VenueTemplate } from '@shared/contracts';
import { TEMPLATES } from '@shared/templates';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { rise, spring } from '@/design/motion';
import { cn } from '@/lib/utils';
import { presetApi } from './api';

export const PRESETS: VenueTemplate[] = TEMPLATES.filter((t) => !!t.map);

function counts(t: VenueTemplate) {
  const cams = t.install?.filter((s) => s.kind === 'camera').length ?? 0;
  const scribes = t.install?.filter((s) => s.kind === 'scribe').length ?? 0;
  return { zones: t.zones.length, cams, scribes };
}

function PresetCard({ t, selected, onClick, footer }: { t: VenueTemplate; selected?: boolean; onClick?: () => void; footer?: React.ReactNode }) {
  const c = counts(t);
  const Body = (
    <>
      <div className="relative overflow-hidden rounded-[12px] bg-[#f5f4f2] shadow-[inset_0_0_0_1px_rgb(23_21_15/.06)]">
        <img src={t.map!.thumbUrl ?? t.map!.imageUrl} alt={`${t.name} floor plan`} className="aspect-[16/10] w-full object-cover object-top" loading="lazy" />
        <span className="absolute top-2.5 left-2.5 inline-flex h-6 items-center gap-1 rounded-full bg-white/90 px-2 text-[11px] font-semibold tracking-[.02em] text-fg shadow-[0_1px_2px_rgb(23_21_15/.08)] backdrop-blur">
          <Building2 className="size-3" strokeWidth={2} />Preset venue
        </span>
      </div>
      <div className="mt-3 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[16px] font-semibold tracking-[-0.01em] text-fg">{selected ? <Check className="size-4" /> : null}{t.name}</div>
          <p className="mt-0.5 text-[13px] leading-[18px] text-fg-2">{t.description}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5 text-[12px] font-medium text-fg-2">
        <span className="inline-flex h-6 items-center rounded-full bg-[#f5f4f2] px-2.5 tabular-nums">{c.zones} zones</span>
        {c.cams ? <span className="inline-flex h-6 items-center gap-1 rounded-full bg-[#f5f4f2] px-2.5 tabular-nums"><Camera className="size-3" />{c.cams} camera spots</span> : null}
        {c.scribes ? <span className="inline-flex h-6 items-center gap-1 rounded-full bg-[#f5f4f2] px-2.5 tabular-nums"><Mic className="size-3" />{c.scribes} scribe spots</span> : null}
        <span className="inline-flex h-6 items-center rounded-full bg-[#f5f4f2] px-2.5">Install plan included</span>
      </div>
      {footer}
    </>
  );
  const cls = cn('block w-full rounded-[18px] border bg-white p-3.5 text-left transition-[border-color,box-shadow]',
    selected ? 'border-[#17150f] shadow-[0_0_0_1px_#17150f]' : 'border-[rgb(23_21_15/.1)] hover:border-[rgb(23_21_15/.25)]');
  return onClick
    ? <motion.button type="button" variants={rise} whileTap={{ scale: 0.985 }} transition={spring.snappy} onClick={onClick} className={cls}>{Body}</motion.button>
    : <motion.div variants={rise} className={cls}>{Body}</motion.div>;
}

/** /setup: pick a preset (or nothing). */
export function PresetPicker({ selected, onSelect }: { selected: string | null; onSelect: (id: string) => void }) {
  if (!PRESETS.length) return null;
  return (
    <motion.div className="grid gap-3" initial="initial" animate="animate" variants={{ animate: { transition: { staggerChildren: 0.05 } } }}>
      {PRESETS.map((t) => <PresetCard key={t.id} t={t} selected={selected === t.id} onClick={() => onSelect(t.id)} />)}
    </motion.div>
  );
}

/** Settings → Map: apply a preset to an existing event (replaces the map + zones). */
export function PresetApply({ eventId, currentPresetId, onApplied }: { eventId: string; currentPresetId?: string | null; onApplied?: () => void }) {
  const [confirm, setConfirm] = useState<VenueTemplate | null>(null);
  const [busy, setBusy] = useState(false);
  if (!PRESETS.length) return null;
  const apply = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      await presetApi.apply(eventId, confirm.id);
      toast.success(`${confirm.name} applied`, { description: `${confirm.zones.length} zones and the install plan are ready. Open Devices → Install plan.` });
      setConfirm(null);
      onApplied?.();
    } catch (e) { toast.error((e as Error).message || 'Could not apply the preset'); }
    finally { setBusy(false); }
  };
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-[14px] font-semibold text-fg">Start from a preset venue</span>
        <span className="text-[13px] text-fg-2">Real floor plan, zones and an install plan in one click.</span>
      </div>
      <motion.div className="grid gap-3 sm:grid-cols-2" initial="initial" animate="animate" variants={{ animate: { transition: { staggerChildren: 0.05 } } }}>
        {PRESETS.map((t) => (
          <PresetCard key={t.id} t={t} selected={currentPresetId === t.id}
            footer={(
              <div className="mt-3.5 flex items-center gap-2">
                {currentPresetId === t.id ? <span className="text-[13px] font-medium text-[#376c45]">In use</span> : null}
                <Button size="sm" className="ml-auto" variant={currentPresetId === t.id ? 'outline' : 'default'} onClick={() => setConfirm(t)}>
                  {currentPresetId === t.id ? 'Reset to preset' : 'Use this venue'}
                </Button>
              </div>
            )} />
        ))}
      </motion.div>
      <Dialog open={!!confirm} onOpenChange={(o) => { if (!o && !busy) setConfirm(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Use {confirm?.name}?</DialogTitle>
            <DialogDescription>
              This replaces the current map and all zones with the preset's {confirm?.zones.length} zones. Issues, reports, radio and devices stay;
              devices in removed zones need a new zone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)} disabled={busy}>Cancel</Button>
            <Button onClick={() => void apply()} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : null}Replace map and zones</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
