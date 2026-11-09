// "About me" sheet: the name people call me in meetings (speech assigns work by it), my team, and where I am.
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Check } from 'lucide-react';
import type { Device, Me, Participant, Snapshot } from '@shared/contracts';
import { API, HttpError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { CARD, HAIR, Pill, Spinner } from '../common';

type ApplyMe = (u: { kind: 'participant'; data: Participant } | { kind: 'device'; data: Device }) => void;

export function MeSheet({ open, onOpenChange, snap, me, apply }: {
  open: boolean; onOpenChange: (o: boolean) => void; snap: Snapshot | null; me: Me; apply: ApplyMe;
}) {
  const p = snap?.participants.find((x) => x.id === me.participantId);
  const device = snap?.devices.find((d) => d.id === me.deviceId);
  const [name, setName] = useState('');
  const [teamId, setTeamId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(p?.displayName ?? me.displayName);
    setTeamId(p?.teamId ?? null);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = name.trim() !== (p?.displayName ?? me.displayName) || teamId !== (p?.teamId ?? null);

  const save = async () => {
    const n = name.trim();
    if (!n) { toast.error('Add your name'); return; }
    setSaving(true);
    try {
      const r = await API.updateMe(me.eventId, { displayName: n, teamId });
      apply({ kind: 'participant', data: r.participant });
      toast.success('Profile updated');
      onOpenChange(false);
    } catch (e) { toast.error((e as HttpError).message); } finally { setSaving(false); }
  };

  const setZone = async (zoneId: string) => {
    if (!me.deviceId) return;
    try {
      const r = await API.patchDevice(me.deviceId, { zoneId });
      apply({ kind: 'device', data: r.device });
    } catch (e) { toast.error((e as HttpError).message); }
  };

  const teams = snap?.teams ?? [];
  const zones = snap?.zones ?? [];

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader className="pb-3 text-left">
          <DrawerTitle className="text-left">Your profile</DrawerTitle>
          <DrawerDescription className="text-left">When this name comes up in a meeting, the task is assigned to you automatically.</DrawerDescription>
        </DrawerHeader>
        <div className="max-h-[66dvh] overflow-y-auto px-4 pb-[calc(var(--safe-b)+20px)]">
          <label className="mb-1.5 block px-1 text-[13px] font-semibold text-fg-2" htmlFor="me-name">The name people call you</label>
          <input id="me-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} autoComplete="nickname" placeholder="e.g. Jimin"
            className={cn('h-12 w-full rounded-[12px] bg-white px-4 text-[16px] text-fg outline-none placeholder:text-fg-3 focus-visible:shadow-[inset_0_0_0_1.5px_#17150f]', HAIR)} />

          <p className="mt-6 mb-1.5 px-1 text-[13px] font-semibold text-fg-2">Team</p>
          {teams.length === 0 ? (
            <p className="rounded-[12px] bg-[#f5f4f2] px-4 py-3 text-[14px] text-fg-2">No teams yet. Once HQ creates teams you can pick one.</p>
          ) : (
            <ul className={cn(CARD, 'overflow-hidden')} role="radiogroup" aria-label="Team">
              {[{ id: null as string | null, name: 'No team' }, ...teams].map((t, i) => {
                const sel = teamId === t.id;
                return (
                  <li key={t.id ?? 'none'} className="relative">
                    {i > 0 ? <span className="absolute top-0 right-0 left-4 h-px origin-top scale-y-50 bg-[rgb(23_21_15/.16)]" aria-hidden="true" /> : null}
                    <button type="button" role="radio" aria-checked={sel} onClick={() => setTeamId(t.id)}
                      className="flex min-h-[52px] w-full items-center gap-3 px-4 text-left active:bg-[rgb(23_21_15/.05)]">
                      <span className={cn('flex-1 text-[16px]', t.id ? 'font-medium text-fg' : 'text-fg-2')}>{t.name}</span>
                      {sel ? <Check className="size-[18px] text-fg" strokeWidth={2.25} /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <Pill className="mt-5 w-full" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? <Spinner className="size-4 border-white/30 border-t-white" /> : null}Save
          </Pill>

          {me.deviceId && zones.length ? (
            <>
              <p className="mt-7 mb-1.5 px-1 text-[13px] font-semibold text-fg-2">Where you are now</p>
              <div className="flex flex-wrap gap-2">
                {zones.map((z) => {
                  const on = device?.zoneId === z.id;
                  return (
                    <button key={z.id} type="button" onClick={() => void setZone(z.id)} aria-pressed={on}
                      className={cn('inline-flex h-9 items-center rounded-full px-3.5 text-[14px] font-medium transition-[background-color,scale] duration-120 active:scale-[.97]',
                        on ? 'bg-[#17150f] text-white' : cn('bg-white text-fg', HAIR))}>
                      {z.name}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 px-1 text-[12px] text-fg-3">Nearby field incidents are routed to you first.</p>
            </>
          ) : null}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
