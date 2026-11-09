// Read-only live map for phones. Adapter over the laptop-owned VenueMap so the phone compiles against either its
// current props or the v3 API (map, issues, reports, highlightZoneId, mode). Only this file touches VenueMap.
// VenueMap sizes its labels in screen px (made for laptops). On a narrow phone the rooms get too small for them, so the
// map is laid out at a legible minimum width and the card scrolls sideways (centered on load), like a photo strip.
import { useEffect, useRef, type ComponentType } from 'react';
import type { Device, Issue, Report, Snapshot } from '@shared/contracts';
import { VenueMap } from '@/components/VenueMap';
import { cn } from '@/lib/utils';

const Map = VenueMap as unknown as ComponentType<Record<string, unknown>>;
/** Narrowest width the map is laid out at; wider screens use their own width. */
const MIN_W = 520;

export function MapCard({ snap, highlightZoneId, highlightDeviceId, onSelect, className, devices, issues, reports }: {
  snap: Snapshot; highlightZoneId?: string | null; highlightDeviceId?: string | null; onSelect?: (zoneId: string | null) => void;
  className?: string; devices?: Device[]; issues?: Issue[]; reports?: Report[];
}) {
  const scroller = useRef<HTMLDivElement>(null);
  // Start centered on my zone (or the middle of the venue).
  useEffect(() => {
    const el = scroller.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    const z = highlightZoneId ? snap.zones.find((x) => x.id === highlightZoneId) : null;
    const w = snap.event.map?.width ?? 1000;
    const cx = z ? z.polygon.reduce((s, p) => s + p[0], 0) / z.polygon.length / w : 0.5;
    el.scrollLeft = Math.max(0, cx * el.scrollWidth - el.clientWidth / 2);
  }, [highlightZoneId, snap.zones, snap.event.map]);

  return (
    <div className={cn('relative overflow-hidden rounded-[16px] bg-white shadow-[inset_0_0_0_.5px_rgb(23_21_15/.16)]', className)}>
      <div ref={scroller} className="overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div style={{ minWidth: MIN_W }}>
          <Map
            map={snap.event.map}
            zones={snap.zones}
            devices={devices ?? snap.devices}
            incidents={snap.incidents.filter((i) => i.status !== 'resolved')}
            issues={issues ?? snap.issues.filter((i) => i.status !== 'done')}
            reports={reports ?? snap.reports}
            selectedId={highlightZoneId ?? null}
            highlightZoneId={highlightZoneId ?? null}
            highlightDeviceId={highlightDeviceId ?? null}
            onSelect={onSelect}
            mode="live"
            compact
            ariaLabel="Venue map"
          />
        </div>
      </div>
    </div>
  );
}
