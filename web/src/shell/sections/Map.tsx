// Map: the live venue (zones tinted by status, issue/report pins, devices with coverage) + zone list, or the full zone table.
import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Check, Map as MapIcon, Move, Rows3, Settings2 } from 'lucide-react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { CROWD_LABEL, type Device, type Issue } from '@shared/contracts';
import { VenueMap } from '@/components/VenueMap';
import { ZoneStatusPill, isStale } from '@/components/bits';
import { ReportSheet, ZoneSheet } from '@/components/ops/OpsViews';
import { ZoneTable } from '@/components/tracking/ZoneTable';
import { IssueSheet } from '@/components/ops/IssueSheet';
import { zoneStats } from '@/components/ops/ZoneDetail';
import { AnimatedNumber } from '@/components/AnimatedNumber';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { api } from '@/lib/api';
import { ago, useNow } from '@/lib/time';
import { spring } from '@/design/motion';
import { cn } from '@/lib/utils';
import { useShell } from '../context';
import { Empty, Page, PanelTitle, SectionHeader, panel } from '../ui';

const STATUS_ORDER: Record<string, number> = { alert: 5, critical: 4, crowded: 3, busy: 2, clear: 1, unknown: 0 };

export default function MapSection() {
  const { snap, apply, eventId } = useShell();
  const now = useNow(1000);
  const [view, setView] = useState<'map' | 'table'>('map');
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [issueId, setIssueId] = useState<string | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);

  const zones = useMemo(() => (snap ? [...snap.zones].sort((a, b) => STATUS_ORDER[b.status] - STATUS_ORDER[a.status] || a.name.localeCompare(b.name)) : []), [snap]);
  if (!snap) return <Page bleed><Skeleton className="h-9 w-40" /><Skeleton className="mt-6 h-[620px] w-full rounded-[14px]" /></Page>;

  const move = (id: string, position: [number, number]) => {
    api<{ device: Device }>(`/api/devices/${id}/position`, { method: 'PUT', body: { position } }).catch((e) => toast.error((e as Error).message));
  };
  const kind = snap.event.map?.kind === 'floorplan' ? 'Floor plan' : snap.event.map?.kind === 'photo' ? 'Overview photo' : 'Canvas';

  return (
    <Page bleed>
      <SectionHeader title="Map" sub={<>{kind} · {snap.zones.length} zones · {snap.devices.length} devices. Tap a zone for its live brief.</>}
        actions={
          <>
            {view === 'map' && (
              <Button variant={placing ? 'default' : 'outline'} size="sm" onClick={() => setPlacing((v) => !v)}>
                {placing ? <Check /> : <Move />}{placing ? 'Done placing' : 'Place devices'}
              </Button>
            )}
            <Button asChild variant="outline" size="sm"><Link to={`/e/${eventId}/settings`}><Settings2 />Edit zones</Link></Button>
            <ToggleGroup type="single" variant="segmented" size="sm" value={view} onValueChange={(v) => v && setView(v as 'map' | 'table')} aria-label="View">
              <ToggleGroupItem value="map"><MapIcon />Map</ToggleGroupItem>
              <ToggleGroupItem value="table"><Rows3 />Table</ToggleGroupItem>
            </ToggleGroup>
          </>
        } />

      {snap.zones.length === 0 ? (
        <div className={cn(panel, 'mt-6')}>
          <Empty icon={MapIcon} title="No zones yet" body="Start from a blank canvas or your floor plan, then draw the zones you want tracked."
            action={<Button asChild size="sm"><Link to={`/e/${eventId}/settings`}>Set up the map</Link></Button>} />
        </div>
      ) : view === 'table' ? (
        <motion.div className="mt-6" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={spring.smooth}>
          <div className={cn(panel, 'overflow-x-auto')}>
            <ZoneTable snap={snap} onSelect={setZoneId} selectedId={zoneId} />
          </div>
        </motion.div>
      ) : (
        <motion.div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={spring.smooth}>
          <div className={cn(panel, 'min-w-0 p-3')}>
            <VenueMap map={snap.event.map} zones={snap.zones} devices={snap.devices} issues={snap.issues} reports={snap.reports}
              selectedId={zoneId} onSelect={setZoneId} onSelectIssue={setIssueId} onSelectReport={setReportId}
              devicesEditable={placing} onDeviceMove={move} />
            <Legend />
          </div>
          <div className={cn(panel, 'flex min-h-0 flex-col overflow-hidden xl:max-h-[calc(100dvh-180px)]')}>
            <PanelTitle title="Zones" meta={`${snap.zones.filter((z) => z.lastObservedAt && !isStale(z, now)).length} observed now`} />
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {zones.map((z) => {
                const st = zoneStats(snap, z, now);
                return (
                  <motion.li key={z.id} layout transition={spring.smooth}>
                    <button type="button" onClick={() => setZoneId(z.id)}
                      className={cn('flex w-full items-center gap-3 border-b border-[rgb(23_21_15/.06)] px-4 py-3 text-left transition-colors hover:bg-[rgb(23_21_15/.025)]', zoneId === z.id && 'bg-[rgb(23_21_15/.04)]')}>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-semibold text-fg">{z.name}</span>
                        <span className="mt-0.5 block truncate text-[12px] text-fg-3">
                          {z.crowdLevel ? CROWD_LABEL[z.crowdLevel] : 'No data'}
                          {z.peopleEstimate != null ? <> · <AnimatedNumber value={z.peopleEstimate} /> people</> : null}
                          {' · '}{z.lastObservedAt ? ago(z.lastObservedAt, now) : 'never observed'}
                        </span>
                      </span>
                      {st.issues.length ? <span className="text-[12px] font-semibold text-[#c8553f] tabular-nums">{st.issues.length} open</span> : null}
                      <ZoneStatusPill status={z.status} stale={isStale(z, now)} size="sm" />
                    </button>
                  </motion.li>
                );
              })}
            </ul>
          </div>
        </motion.div>
      )}

      <ZoneSheet snap={snap} zone={snap.zones.find((z) => z.id === zoneId) ?? null} now={now} onClose={() => setZoneId(null)} onIssue={setIssueId} onReport={setReportId} />
      <IssueSheet snap={snap} issueId={issueId} onClose={() => setIssueId(null)} apply={apply as (u: { kind: 'issue'; data: Issue }) => void} now={now} />
      <ReportSheet snap={snap} reportId={reportId} now={now} onClose={() => setReportId(null)} onOpenIssue={setIssueId} />
    </Page>
  );
}

function Legend() {
  const items: Array<[string, string]> = [['#58a069', 'Clear'], ['#c9a13f', 'Moderate'], ['#c6824b', 'Busy'], ['#c8553f', 'Packed'], ['#b91c1c', 'Alert']];
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 text-[12px] text-fg-2">
      {items.map(([c, l]) => <span key={l} className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: c }} />{l}</span>)}
      <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full border border-dashed border-[#9a988f]" />No data</span>
      <span className="ml-auto text-fg-3">Pins = open issues · camera pins = photo reports · dashed lines = what each camera watches</span>
    </div>
  );
}
