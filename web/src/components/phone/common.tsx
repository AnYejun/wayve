// Phone building blocks shared by /j, /device and /staff: session hook, centred states, pills, zone sheet, offline banner.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, MapPin, WifiOff } from 'lucide-react';
import { ZONE_STALE_MS, type EventInfo, type Me, type Zone } from '@shared/contracts';
import { API, HttpError } from '@/lib/api';
import type { LiveStatus } from '@/lib/live';
import { useNow } from '@/lib/time';
import { cn } from '@/lib/utils';
import { Logo } from '@/design/Logo';
import { ZoneStatusPill } from '@/components/bits';
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';

/** 0.5px hairline ring (Apple separator weight) for paper cards. */
export const HAIR = 'shadow-[inset_0_0_0_.5px_rgb(23_21_15/.16)]';
export const CARD = cn('rounded-[16px] bg-white', HAIR);

// ── Session ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export type MeState =
  | { status: 'loading' }
  | { status: 'ready'; me: Me | null; event: EventInfo | null }
  | { status: 'error'; error: HttpError };

export function useMe() {
  const [state, setState] = useState<MeState>({ status: 'loading' });
  const load = useCallback(() => {
    setState({ status: 'loading' });
    API.me().then((r) => setState({ status: 'ready', me: r.me, event: r.event }))
      .catch((e: HttpError) => setState({ status: 'error', error: e }));
  }, []);
  useEffect(load, [load]);
  return { state, reload: load };
}

// ── Pills ────────────────────────────────────────────────────────────────────────────────────────────────────────────

type PillProps = React.ComponentProps<'button'> & { tone?: 'ink' | 'paper' | 'wash'; size?: 'lg' | 'md' };

/** maru solid pill. lg = 50px (primary actions on phones), md = 40px. Press .97. */
export function Pill({ tone = 'ink', size = 'lg', className, ...props }: PillProps) {
  return (
    <button type="button" {...props}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap',
        'transition-[background-color,scale,opacity] duration-120 ease-out active:scale-[.97] motion-reduce:active:scale-100',
        'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#17150f]',
        'disabled:pointer-events-none disabled:opacity-40 [&_svg]:shrink-0',
        size === 'lg' ? 'h-[50px] px-6 text-[16px] [&_svg]:size-[18px]' : 'h-10 px-4 text-[15px] [&_svg]:size-4',
        tone === 'ink' && 'bg-[#17150f] text-white hover:bg-[#2c2922] active:bg-[#3a3833]',
        tone === 'paper' && cn('bg-white text-fg active:bg-[#f5f4f2]', HAIR),
        tone === 'wash' && 'bg-[rgb(23_21_15/.06)] text-fg hover:bg-[rgb(23_21_15/.08)] active:bg-[rgb(23_21_15/.1)]',
        className,
      )} />
  );
}

// ── Centred full-screen state (loading / error / empty) ──────────────────────────────────────────────────────────────

export function CenterState({ icon, title, body, children, tone = 'neutral' }: {
  icon?: ReactNode; title: ReactNode; body?: ReactNode; children?: ReactNode; tone?: 'neutral' | 'warn';
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas px-6 pt-[calc(var(--safe-t)+20px)] pb-[calc(var(--safe-b)+24px)]">
      <div className="flex h-8 items-center justify-center"><Logo size={22} /></div>
      <div className="mx-auto flex w-full max-w-[380px] flex-1 flex-col items-center justify-center text-center">
        {icon ? (
          <div className={cn('mb-5 grid size-16 place-items-center rounded-[20px] bg-white [&_svg]:size-7', HAIR,
            tone === 'warn' ? 'text-[#c6824b]' : 'text-fg')}>{icon}</div>
        ) : null}
        <h1 className="text-[22px] leading-7 font-semibold tracking-[-0.02em] text-fg">{title}</h1>
        {body ? <p className="mt-2 text-[15px] leading-[22px] text-fg-2">{body}</p> : null}
        {children ? <div className="mt-7 flex w-full flex-col gap-2.5">{children}</div> : null}
      </div>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span className={cn('inline-block size-5 animate-spin rounded-full border-2 border-[rgb(23_21_15/.12)] border-t-[#17150f] motion-reduce:animate-none', className)}
      aria-hidden="true" />
  );
}

// ── Zone picker (bottom sheet) ───────────────────────────────────────────────────────────────────────────────────────

/** Anything with the fields the zone picker shows (Zone or PublicZone). */
export type ZoneLike = Pick<Zone, 'id' | 'name' | 'status' | 'lastObservedAt'>;

export function ZoneTrigger({ zone, placeholder = 'Choose zone', onClick, className, icon = true }: {
  zone: Pick<Zone, 'name'> | null | undefined; placeholder?: string; onClick: () => void; className?: string; icon?: boolean;
}) {
  return (
    <button type="button" onClick={onClick}
      className={cn('inline-flex h-9 max-w-[min(52vw,220px)] min-w-0 items-center gap-1.5 rounded-full bg-white pr-2.5 pl-3 text-[15px] font-semibold text-fg',
        'transition-[scale,background-color] duration-120 active:scale-[.97] active:bg-[#f5f4f2] motion-reduce:active:scale-100', HAIR, className)}
      aria-label={zone ? `Zone: ${zone.name}. Change` : placeholder}>
      {icon ? <MapPin className="size-4 shrink-0 text-fg-2" strokeWidth={1.75} /> : null}
      <span className={cn('truncate', !zone && 'text-fg-2')}>{zone?.name ?? placeholder}</span>
      <ChevronDown className="size-4 shrink-0 text-fg-3" strokeWidth={1.75} />
    </button>
  );
}

export function ZoneSheet<Z extends ZoneLike>({ open, onOpenChange, zones, selectedId, onSelect, title = 'Choose zone', description }: {
  open: boolean; onOpenChange: (o: boolean) => void; zones: Z[]; selectedId: string | null | undefined;
  onSelect: (zone: Z) => void; title?: string; description?: string;
}) {
  const now = useNow(5000);
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader className="pb-3">
          <DrawerTitle>{title}</DrawerTitle>
          {description ? <DrawerDescription>{description}</DrawerDescription> : null}
        </DrawerHeader>
        <div className="max-h-[60dvh] overflow-y-auto px-4 pb-5">
          {zones.length === 0 ? (
            <p className="py-8 text-center text-[15px] text-fg-2">No zones yet. Ask an organizer to draw them on the dashboard.</p>
          ) : (
            <ul className={cn('overflow-hidden', CARD)} role="listbox" aria-label={title}>
              {zones.map((z, i) => {
                const sel = z.id === selectedId;
                const stale = z.lastObservedAt != null && now - z.lastObservedAt > ZONE_STALE_MS;
                return (
                  <li key={z.id} className="relative">
                    {i > 0 ? <span className="absolute top-0 right-0 left-4 h-px origin-top scale-y-50 bg-[rgb(23_21_15/.16)]" aria-hidden="true" /> : null}
                    <button type="button" role="option" aria-selected={sel} onClick={() => onSelect(z)}
                      className="flex min-h-[56px] w-full items-center gap-3 px-4 text-left transition-colors active:bg-[rgb(23_21_15/.05)]">
                      <span className="min-w-0 flex-1 truncate text-[16px] font-medium text-fg">{z.name}</span>
                      <ZoneStatusPill status={z.status} stale={stale} size="sm" />
                      <span className="grid size-5 place-items-center">{sel ? <Check className="size-[18px] text-fg" strokeWidth={2.25} /> : null}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

// ── Offline banner: shows after the stream has been down for > 3 s ───────────────────────────────────────────────────

export function OfflineBanner({ status, bottom = 16 }: { status: LiveStatus; bottom?: number }) {
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    clearTimeout(timer.current);
    if (status === 'live') { setShow(false); return; }
    timer.current = setTimeout(() => setShow(true), 3000);
    return () => clearTimeout(timer.current);
  }, [status]);
  if (!show) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 z-(--z-toast) flex justify-center px-4" style={{ bottom: `calc(var(--safe-b) + ${bottom}px)` }}>
      <div role="status" aria-live="polite"
        className="mat-dark inline-flex h-10 items-center gap-2 rounded-full px-4 text-[14px] font-medium animate-in fade-in slide-in-from-bottom-2 duration-200">
        <WifiOff className="size-4" strokeWidth={1.75} />
        {status === 'error' ? 'Connection lost' : 'Connection lost · reconnecting'}
      </div>
    </div>
  );
}

/** Inset grouped row (52–56px) with a leading label and trailing content; used for "My location", "Zone". */
export function GroupRow({ label, icon, children, onClick, className }: {
  label: string; icon?: ReactNode; children?: ReactNode; onClick?: () => void; className?: string;
}) {
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp type={onClick ? 'button' : undefined} onClick={onClick}
      className={cn('flex min-h-[56px] w-full items-center gap-3 px-4 text-left', CARD,
        onClick && 'transition-[scale,background-color] duration-120 active:scale-[.985] active:bg-[#fafaf9] motion-reduce:active:scale-100', className)}>
      {icon ? <span className="text-fg-2 [&_svg]:size-[18px]">{icon}</span> : null}
      <span className="text-[15px] text-fg-2">{label}</span>
      <span className="ml-auto flex min-w-0 items-center gap-2">{children}</span>
    </Comp>
  );
}
