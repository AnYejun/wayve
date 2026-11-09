// Devices: every connected phone — cameras, meeting scribes, staff phones — with live connection state, what it watches,
// and where it is on the map. Calibrate cameras in place; add devices by QR.
import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Cable, Camera, Crosshair, MapPinned, Mic, Plus, Smartphone, TriangleAlert } from 'lucide-react';
import { InstallPlan } from '@/components/install/InstallPlan';
import { QRCodeSVG } from 'qrcode.react';
import type { Device, Snapshot } from '@shared/contracts';
import { VenueMap } from '@/components/VenueMap';
import { CameraCalibration } from '@/components/map/CameraCalibration';
import { isOnline } from '@/components/ops/util';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { ago, useNow } from '@/lib/time';
import { spring } from '@/design/motion';
import { cn } from '@/lib/utils';
import { useShell } from '../context';
import { DeviceSignal } from '../live/pulse';
import { Empty, KpiStrip, Page, PanelTitle, SectionHeader, panel } from '../ui';
import { withKey } from '@/lib/links';

const GROUPS: Array<{ type: Device['deviceType']; title: string; icon: typeof Camera; empty: string }> = [
  { type: 'camera', title: 'Cameras', icon: Camera, empty: 'Scan a zone camera QR with a spare phone.' },
  { type: 'scribe', title: 'Meeting scribes', icon: Mic, empty: 'Scan a scribe QR with the phone on the meeting table.' },
  { type: 'reporter', title: 'Staff phones', icon: Smartphone, empty: 'Staff join by scanning the staff QR and signing in.' },
];

export default function DevicesSection() {
  const { snap, eventId } = useShell();
  const now = useNow(1000);
  const [selected, setSelected] = useState<string | null>(null);
  const [plan, setPlan] = useState(() => new URLSearchParams(location.search).get('plan') === '1');
  const [calibrate, setCalibrate] = useState(false);
  const [adding, setAdding] = useState(false);

  const counts = useMemo(() => {
    const d = snap?.devices ?? [];
    const on = d.filter((x) => isOnline(x, now));
    return { total: d.length, online: on.length, observing: on.filter((x) => x.mode === 'observing').length, errors: d.filter((x) => x.lastError).length,
      cams: d.filter((x) => x.deviceType === 'camera').length, calibrated: d.filter((x) => x.regions.length).length };
  }, [snap?.devices, now]);

  if (!snap) return <Page><Skeleton className="h-9 w-40" /><Skeleton className="mt-6 h-[92px] w-full rounded-[14px]" /><Skeleton className="mt-5 h-[420px] w-full rounded-[14px]" /></Page>;

  return (
    <Page>
      <SectionHeader title="Devices" sub="Every phone feeding the live database — where it is, what it watches, and whether it’s still talking to us."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setPlan(true)}><MapPinned />Install plan</Button>
            <Button variant="outline" size="sm" onClick={() => setCalibrate(true)}><Crosshair />Calibrate cameras</Button>
            <Button size="sm" onClick={() => setAdding(true)}><Plus />Add a device</Button>
          </>
        } />

      <div className="mt-6">
        <KpiStrip items={[
          { label: 'Connected', value: counts.online, sub: `of ${counts.total} devices` },
          { label: 'Sending now', value: counts.observing, sub: 'Observing or recording' },
          { label: 'Offline', value: counts.total - counts.online, tone: 'danger', sub: counts.total - counts.online ? 'Check battery or Wi‑Fi' : 'All connected' },
          { label: 'Cameras', value: counts.cams, sub: `${counts.calibrated} calibrated` },
          { label: 'Errors', value: counts.errors, tone: 'danger', sub: counts.errors ? 'See rows below' : 'No errors' },
          { label: 'Zones covered', value: new Set(snap.devices.flatMap((d) => d.regions.length ? d.regions.map((r) => r.zoneId) : d.zoneId ? [d.zoneId] : [])).size, sub: `of ${snap.zones.length} zones` },
        ]} />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 space-y-5">
          {GROUPS.map((g) => {
            const list = snap.devices.filter((d) => d.deviceType === g.type).sort((a, b) => Number(isOnline(b, now)) - Number(isOnline(a, now)) || a.label.localeCompare(b.label));
            return (
              <section key={g.type} className={cn(panel, 'overflow-hidden')}>
                <PanelTitle title={g.title} meta={`${list.filter((d) => isOnline(d, now)).length}/${list.length} online`} />
                {list.length === 0 ? <Empty icon={g.icon} title={`No ${g.title.toLowerCase()} yet`} body={g.empty} className="py-8" /> : (
                  <ul>
                    {list.map((d) => <Row key={d.id} d={d} snap={snap} now={now} selected={selected === d.id} onSelect={() => setSelected(selected === d.id ? null : d.id)} />)}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
        <div className={cn(panel, 'self-start overflow-hidden xl:sticky xl:top-5')}>
          <PanelTitle title="On the map" meta={selected ? snap.devices.find((d) => d.id === selected)?.label : 'Tap a device to highlight it'} />
          <div className="p-3">
            {snap.zones.length ? (
              <VenueMap map={snap.event.map} zones={snap.zones} devices={snap.devices} mode="preview"
                highlightZoneId={snap.devices.find((d) => d.id === selected)?.zoneId ?? null} compact />
            ) : <Empty icon={Cable} title="No map yet" body="Draw zones in Settings to see devices in place." className="py-10" />}
          </div>
        </div>
      </div>

      <Sheet open={plan} onOpenChange={setPlan}>
        <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-6 sm:max-w-[1100px]">
          <SheetHeader className="mb-4 p-0"><SheetTitle>Install plan</SheetTitle><SheetDescription>Where each camera and scribe goes. Scan a spot’s QR with the phone you mount there — it sets itself up, no account.</SheetDescription></SheetHeader>
          <InstallPlan snap={snap} eventId={eventId} />
        </SheetContent>
      </Sheet>
      <Sheet open={calibrate} onOpenChange={setCalibrate}>
        <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-6 sm:max-w-[760px]">
          <SheetHeader className="mb-4 p-0"><SheetTitle>Calibrate cameras</SheetTitle><SheetDescription>Draw the zones a camera sees once — every frame is then read zone by zone.</SheetDescription></SheetHeader>
          <CameraCalibration devices={snap.devices} zones={snap.zones} />
        </SheetContent>
      </Sheet>
      <AddDevice snap={snap} open={adding} onOpenChange={setAdding} />
    </Page>
  );
}

function Row({ d, snap, now, selected, onSelect }: { d: Device; snap: Snapshot; now: number; selected: boolean; onSelect: () => void }) {
  const on = isOnline(d, now);
  const owner = snap.participants.find((p) => p.id === d.participantId);
  const zoneNames = (d.regions.length ? d.regions.map((r) => r.zoneId) : d.zoneId ? [d.zoneId] : []).map((id) => snap.zones.find((z) => z.id === id)?.name).filter(Boolean);
  const sending = on && d.lastFrameAt != null && now - d.lastFrameAt < 6000;
  const mode = !on ? 'Offline' : d.mode === 'observing' ? (d.deviceType === 'scribe' ? 'Recording' : 'Observing') : d.mode === 'paused' ? 'Paused' : 'Idle';
  return (
    <motion.li layout transition={spring.smooth}>
      <button type="button" onClick={onSelect}
        className={cn('grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-[rgb(23_21_15/.06)] px-4 py-3 text-left transition-colors last:border-0 hover:bg-[rgb(23_21_15/.02)]', selected && 'bg-[rgb(23_21_15/.04)]')}>
        <span className="relative grid size-9 place-items-center rounded-[10px] bg-[#f4f3f1] text-fg">
          {d.deviceType === 'camera' ? <Camera size={17} strokeWidth={1.75} /> : d.deviceType === 'scribe' ? <Mic size={17} strokeWidth={1.75} /> : <Smartphone size={17} strokeWidth={1.75} />}
          <span className={cn('absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-white', on ? 'bg-[#3f9a55]' : 'bg-[#b9b8b4]')} />
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="truncate text-[14px] font-semibold text-fg">{d.label}</span>
            {owner && owner.displayName !== d.label ? <span className="truncate text-[12px] text-fg-3">{owner.displayName}</span> : null}
          </span>
          <span className="mt-0.5 block truncate text-[12px] text-fg-2">
            {zoneNames.length ? zoneNames.join(' · ') : 'No zone yet'}
            {d.regions.length ? <span className="text-fg-3"> · calibrated</span> : null}
            {d.lastError ? <span className="text-[#b91c1c]"> · <TriangleAlert className="inline size-3 -translate-y-px" /> {d.lastError}</span> : null}
          </span>
        </span>
        <span className="text-right">
          <span className={cn('inline-flex h-6 items-center gap-1.5 rounded-full px-2 text-[12px] font-medium', on ? 'bg-[#eaf5ec] text-[#2f6b3c]' : 'bg-[#f4f3f1] text-fg-3')}>
            <span className="live-dot" style={{ color: on ? '#3f9a55' : '#b9b8b4' }} data-ping={sending || undefined} />{mode}
          </span>
          <span className="mt-1.5 flex justify-end">{on ? <DeviceSignal device={d} /> : <span className="text-[11px] text-fg-3 tabular-nums">{d.lastFrameAt ? `frame ${ago(d.lastFrameAt, now)}` : `seen ${ago(d.lastSeenAt, now)}`}</span>}</span>
        </span>
      </button>
    </motion.li>
  );
}

function AddDevice({ snap, open, onOpenChange }: { snap: Snapshot; open: boolean; onOpenChange: (o: boolean) => void }) {
  const origin = location.origin;
  const code = snap.event.joinCode;
  const Q = ({ label, sub, url }: { label: string; sub: string; url: string }) => (
    <div className="flex items-center gap-4 rounded-[12px] border border-[rgb(23_21_15/.09)] p-3">
      <div className="rounded-[8px] bg-white p-1 shadow-[0_0_0_.5px_rgb(23_21_15/.12)]"><QRCodeSVG value={url} size={84} level="M" /></div>
      <div className="min-w-0"><p className="text-[14px] font-semibold text-fg">{label}</p><p className="mt-0.5 text-[12px] leading-[17px] text-fg-2">{sub}</p></div>
    </div>
  );
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-6 sm:max-w-[480px]">
        <SheetHeader className="mb-4 p-0"><SheetTitle>Add a device</SheetTitle><SheetDescription>Scan with the phone you want to connect. No app to install.</SheetDescription></SheetHeader>
        <div className="space-y-3">
          {snap.zones.map((z) => <Q key={z.id} label={`Camera · ${z.name}`} sub="Point it at this zone and tap Start." url={withKey(`${origin}/j/${code}?as=camera&z=${z.id}`, snap.joinKey)} />)}
          {snap.teams.map((t) => <Q key={t.id} label={`Meeting scribe · ${t.name}`} sub="Leave it on the meeting table. Speech becomes tasks." url={withKey(`${origin}/j/${code}?as=scribe&team=${t.id}`, snap.joinKey)} />)}
          <Q label="Staff phone" sub="Staff sign in with their WAYVE ID." url={withKey(`${origin}/j/${code}?as=staff`, snap.joinKey)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
