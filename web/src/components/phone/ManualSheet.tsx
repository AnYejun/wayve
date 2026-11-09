// Manual observation fallback (+ optional text report) in a bottom sheet. Works when the AI is down: a human picks
// the crowd level and/or an issue, and the server applies the same deterministic rules (confidence 1).
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  CROWD_LABEL, CROWD_LEVELS, INCIDENT_LABEL, INCIDENT_TYPES,
  type CrowdLevel, type IncidentType, type ObservationResult,
} from '@shared/contracts';
import { API, HttpError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { INCIDENT_ICON } from '@/components/bits';
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Textarea } from '@/components/ui/textarea';
import { HAIR, Pill, Spinner } from './common';

export type ManualTab = 'manual' | 'report';

export function ManualSheet({ open, onOpenChange, deviceId, zoneId, zoneName, onResult, initialTab = 'manual', allowReport = true }: {
  open: boolean; onOpenChange: (o: boolean) => void; deviceId: string; zoneId: string | null; zoneName?: string | null;
  onResult: (r: ObservationResult) => void; initialTab?: ManualTab; allowReport?: boolean;
}) {
  const [tab, setTab] = useState<ManualTab>(initialTab);
  const [crowd, setCrowd] = useState<CrowdLevel | null>(null);
  const [issue, setIssue] = useState<IncidentType | null>(null);
  const [note, setNote] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (open) { setTab(initialTab); setErr(null); } }, [open, initialTab]);

  const reset = () => { setCrowd(null); setIssue(null); setNote(''); setText(''); };

  const submitManual = async () => {
    if (!crowd && !issue) return;
    setBusy(true); setErr(null);
    try {
      const r = await API.manual(deviceId, { zoneId, crowdLevel: crowd, issueType: issue, note: note.trim() || null });
      onResult(r);
      toast.success('Observation recorded', { description: r.incidents.length ? `Linked to a ${INCIDENT_LABEL[r.incidents[0].incidentType]} incident` : undefined });
      reset();
      onOpenChange(false);
    } catch (e) {
      setErr((e as HttpError).message);
    } finally { setBusy(false); }
  };

  const submitReport = async () => {
    const t = text.trim();
    if (!t) return;
    setBusy(true); setErr(null);
    try {
      const r = await API.report(deviceId, t, zoneId);
      onResult(r);
      toast.success('Report sent', { description: r.incidents.length ? `Linked to a ${INCIDENT_LABEL[r.incidents[0].incidentType]} incident` : 'Nothing that needs an incident' });
      reset();
      onOpenChange(false);
    } catch (e) {
      const he = e as HttpError;
      setErr(he.status === 503 || he.status === 502 ? 'AI is not responding — use manual entry instead.' : he.message);
      if (he.status === 503 || he.status === 502) setTab('manual');
    } finally { setBusy(false); }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange} repositionInputs={false}>
      <DrawerContent>
        <DrawerHeader className="pb-2">
          <DrawerTitle>{tab === 'manual' ? 'Manual entry' : 'Text report'}</DrawerTitle>
          <DrawerDescription>{zoneName ? `Recorded for ${zoneName}` : 'Choose a zone first'}</DrawerDescription>
        </DrawerHeader>

        <div className="max-h-[70dvh] overflow-y-auto px-5 pb-5">
          {allowReport ? (
            <ToggleGroup type="single" variant="segmented" value={tab} onValueChange={(v) => v && setTab(v as ManualTab)}
              className="mb-5 h-9 w-full" aria-label="Input type">
              <ToggleGroupItem value="manual" className="h-full flex-1 text-[14px]">Observation</ToggleGroupItem>
              <ToggleGroupItem value="report" className="h-full flex-1 text-[14px]">Text report</ToggleGroupItem>
            </ToggleGroup>
          ) : null}

          {tab === 'manual' ? (
            <div className="flex flex-col gap-5">
              <section>
                <h3 className="mb-2 text-[13px] font-semibold text-fg-2">How crowded?</h3>
                <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="Crowd level">
                  {CROWD_LEVELS.map((c) => (
                    <button key={c} type="button" role="radio" aria-checked={crowd === c} onClick={() => setCrowd(crowd === c ? null : c)}
                      className={cn('h-11 rounded-[12px] px-1 text-[13px] font-semibold transition-[background-color,color,scale] duration-120 active:scale-[.97] motion-reduce:active:scale-100',
                        crowd === c ? 'bg-[#17150f] text-white' : cn('bg-white text-fg', HAIR))}>
                      {CROWD_LABEL[c]}
                    </button>
                  ))}
                </div>
              </section>
              <section>
                <h3 className="mb-2 text-[13px] font-semibold text-fg-2">Anything wrong?</h3>
                <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Issue type">
                  {INCIDENT_TYPES.map((t) => {
                    const I = INCIDENT_ICON[t];
                    const on = issue === t;
                    return (
                      <button key={t} type="button" role="radio" aria-checked={on} onClick={() => setIssue(on ? null : t)}
                        className={cn('flex h-[52px] flex-col items-center justify-center gap-0.5 rounded-[12px] text-[13px] font-medium transition-[background-color,color,scale] duration-120 active:scale-[.97] motion-reduce:active:scale-100',
                          on ? 'bg-[#17150f] text-white' : cn('bg-white text-fg', HAIR))}>
                        <I size={17} strokeWidth={1.75} className={on ? 'text-white' : 'text-fg-2'} />
                        {INCIDENT_LABEL[t]}
                      </button>
                    );
                  })}
                </div>
              </section>
              <section>
                <h3 className="mb-2 text-[13px] font-semibold text-fg-2">Note <span className="font-normal text-fg-3">· optional</span></h3>
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} rows={2}
                  placeholder="e.g. The floor by the entrance is slippery" className="min-h-[64px] rounded-[12px] text-[16px] sm:text-[16px]" />
              </section>
              {err ? <p className="text-[14px] text-[#b91c1c]" role="alert">{err}</p> : null}
              <Pill onClick={submitManual} disabled={busy || !zoneId || (!crowd && !issue)} className="w-full">
                {busy ? <Spinner className="size-4 border-white/30 border-t-white" /> : null}Record
              </Pill>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <Textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={500} rows={4} autoFocus
                placeholder="What did you see? e.g. A drink spilled at the food court entrance"
                className="min-h-[112px] rounded-[12px] text-[16px] leading-6 sm:text-[16px]" />
              {err ? <p className="text-[14px] text-[#b91c1c]" role="alert">{err}</p> : null}
              <Pill onClick={submitReport} disabled={busy || !text.trim()} className="w-full">
                {busy ? <Spinner className="size-4 border-white/30 border-t-white" /> : null}Send
              </Pill>
              <p className="text-center text-[12px] text-fg-3">AI structures it into an incident candidate. Rules make the call.</p>
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
