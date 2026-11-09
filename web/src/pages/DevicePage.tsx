// /device/:id — camera mode. A phone watches ONE zone (picked / from its QR) or SEVERAL once an organizer outlines zones
// on this camera's own view (calibrated regions). Calibrated: numbered yellow outlines are burned into every frame and
// drawn over the preview; results come back per zone. Photos are analysed and dropped — only the results are stored.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { toast } from 'sonner';
import { Aperture, Camera, CameraOff, Loader2, MapPin, MessageSquareText, Pause, PenLine, Play, RotateCw, ShieldCheck, TriangleAlert, Unplug } from 'lucide-react';
import { CAPTURE_INTERVAL_MS, type CameraRegion, type Device, type Me, type Observation, type Zone } from '@shared/contracts';
import { API, HttpError } from '@/lib/api';
import { useLive } from '@/lib/live';
import { ago, useNow } from '@/lib/time';
import { cn } from '@/lib/utils';
import { Logo } from '@/design/Logo';
import { rise, spring, stagger } from '@/design/motion';
import { Confidence, LiveIndicator, ZoneStatusPill, isStale } from '@/components/bits';
import { CenterState, OfflineBanner, Pill, Spinner, ZoneSheet, ZoneTrigger, useMe, CARD } from '@/components/phone/common';
import { ManualSheet, type ManualTab } from '@/components/phone/ManualSheet';
import { ObservationCard } from '@/components/phone/ObservationCard';
import { MapCard } from '@/components/phone/MapCard';
import { REGION_COLOR, drawRegions, useCamera, type CamState } from '@/components/phone/useCamera';
import { MetricList, visionMetrics } from '@/components/phone/MetricList';

export default function DevicePage() {
  const { id = '' } = useParams();
  const { state, reload } = useMe();
  if (state.status === 'loading') return <CenterState icon={<Spinner className="size-6" />} title="Checking this camera" />;
  if (state.status === 'error') {
    return <CenterState icon={<Unplug strokeWidth={1.75} />} tone="warn" title="Can't connect" body={state.error.message}><Pill onClick={reload}><RotateCw />Try again</Pill></CenterState>;
  }
  const me = state.me;
  if (!me || (me.deviceId !== id && me.role !== 'admin')) {
    return <CenterState icon={<Unplug strokeWidth={1.75} />} tone="warn" title="This camera is disconnected" body="Scan the camera QR code again to reconnect." />;
  }
  return <CameraConsole me={me} deviceId={id} />;
}

function CameraConsole({ me, deviceId }: { me: Me; deviceId: string }) {
  const { snap, status, error, apply, applyResult } = useLive(me.eventId);
  const device: Device | undefined = snap?.devices.find((d) => d.id === deviceId);
  const zones = snap?.zones ?? [];
  const regions: CameraRegion[] = device?.regions ?? [];
  const calibrated = regions.length > 0;
  const zone: Zone | undefined = zones.find((z) => z.id === device?.zoneId);
  const [zoneOpen, setZoneOpen] = useState(false);
  const [manual, setManual] = useState<{ open: boolean; tab: ManualTab }>({ open: false, tab: 'manual' });
  const [sendingSnap, setSendingSnap] = useState(false);
  const now = useNow(1000);

  const camera = useCamera({ deviceId, enabled: calibrated || !!device?.zoneId, onResult: applyResult, regions });
  const { attachVideo, cam, observing, inflight, ai, next, hidden } = camera;

  const mine = useMemo(() => (snap?.observations ?? []).filter((o) => o.deviceId === deviceId), [snap?.observations, deviceId]);
  const latest = mine[0] ?? null;
  const latestVision = mine.find((o) => o.modality === 'vision') ?? null;
  /** newest observation per calibrated region's zone */
  const perZone = useMemo(() => regions.map((r, i) => ({ n: i + 1, region: r, zone: zones.find((z) => z.id === r.zoneId), obs: mine.find((o) => o.zoneId === r.zoneId && o.modality === 'vision') ?? null })), [regions, zones, mine]);
  const covered = calibrated ? perZone.map((p) => p.zone?.name).filter(Boolean) as string[] : zone ? [zone.name] : [];

  const chooseZone = async (z: Zone) => {
    setZoneOpen(false);
    try { const r = await API.patchDevice(deviceId, { zoneId: z.id }); apply({ kind: 'device', data: r.device }); }
    catch (e) { toast.error((e as HttpError).message); }
  };
  const sendSnapshot = async () => {
    setSendingSnap(true);
    try {
      const blob = await camera.snapshot();
      if (!blob) { toast('Turn the camera on first'); return; }
      await API.cameraSnapshot(deviceId, blob);
      try { navigator.vibrate?.(20); } catch { /* unsupported */ }
      toast.success('Snapshot sent', { description: 'An organizer can now outline zones on this view.' });
    } catch (e) { toast.error((e as HttpError).message); } finally { setSendingSnap(false); }
  };

  if (status === 'error' && error) return <CenterState icon={<Unplug strokeWidth={1.75} />} tone="warn" title="This camera is disconnected" body="Scan the camera QR code again to reconnect." />;
  const showFallback = !ai.ok || cam === 'denied' || cam === 'unsupported' || cam === 'nocamera' || cam === 'error';

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="mat-bar sticky top-0 z-(--z-header) pt-(--safe-t) shadow-[inset_0_-.5px_0_rgb(23_21_15/.14)]">
        <div className="mx-auto flex h-[54px] max-w-[640px] items-center gap-2.5 px-4">
          <Logo size={18} />
          <div className="min-w-0 flex-1">
            {!snap ? <span className="block h-9 w-28 rounded-full bg-[#f5f4f2]" /> : calibrated ? (
              <span className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white px-3 text-[14px] font-semibold text-fg shadow-[inset_0_0_0_.5px_rgb(23_21_15/.16)]">
                <Aperture className="size-4 text-fg-2" strokeWidth={1.75} />Covers {regions.length} zones
              </span>
            ) : <ZoneTrigger zone={zone} placeholder="Choose zone" onClick={() => setZoneOpen(true)} />}
          </div>
          <LiveIndicator status={status} className="shrink-0" />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[640px] px-4 pt-4 pb-[calc(var(--safe-b)+96px)]">
        <Preview attachVideo={attachVideo} videoRef={camera.videoRef} cam={cam} observing={observing} inflight={inflight} next={next} hidden={hidden}
          noZone={!calibrated && !device?.zoneId} onPickZone={() => setZoneOpen(true)} latencyMs={latestVision?.latencyMs ?? null} regions={regions} label={device?.label} />

        {!calibrated && zone ? (
          <div className="mt-3 flex items-center gap-2 px-1 text-[13px] text-fg-2">
            <ZoneStatusPill status={zone.status} stale={isStale(zone, now)} size="sm" />
            <span className="truncate">{zone.lastObservedAt ? `Last seen ${ago(zone.lastObservedAt, now)}` : 'No observations yet'}</span>
          </div>
        ) : null}

        <AnimatePresence>{showFallback ? (
          <FallbackCard key="fb" cam={cam} aiMessage={ai.ok ? null : ai.message} aiCode={ai.ok ? null : ai.code} retryAt={ai.ok ? null : ai.retryAt} now={now}
            observing={observing} onManual={() => setManual({ open: true, tab: 'manual' })} onRetry={camera.retryNow} />
        ) : null}</AnimatePresence>

        {calibrated ? (
          <section className="mt-5">
            <h2 className="mb-2.5 px-1 text-[15px] font-semibold text-fg">Zones in view</h2>
            <motion.ul variants={stagger()} initial="initial" animate="animate" className={cn(CARD, 'overflow-hidden')}>
              {perZone.map((p, i) => <RegionRow key={p.region.zoneId + i} n={p.n} zone={p.zone} obs={p.obs} now={now} first={i === 0} />)}
            </motion.ul>
          </section>
        ) : latest ? (
          <motion.div variants={rise} initial="initial" animate="animate" className="mt-4">
            <ObservationCard obs={latest} incidents={snap?.incidents ?? []} zoneName={zone?.name} />
          </motion.div>
        ) : (
          <div className={cn(CARD, 'mt-4 px-4 py-5 text-center')}>
            <p className="text-[15px] font-semibold text-fg">No results yet</p>
            <p className="mt-1 text-[14px] text-fg-2">Start watching and results appear here every {CAPTURE_INTERVAL_MS / 1000} seconds.</p>
          </div>
        )}

        <section className={cn(CARD, 'mt-5 px-4 py-4')}>
          <div className="flex items-start gap-3">
            <span className={cn('grid size-10 shrink-0 place-items-center rounded-[12px]', calibrated ? 'bg-[#fff8d6] text-[#7a5d00]' : 'bg-[rgb(23_21_15/.05)] text-fg')}><Aperture className="size-5" strokeWidth={1.75} /></span>
            <div className="min-w-0 flex-1">
              <p className="text-[16px] font-semibold text-fg">{calibrated ? `Calibrated · covers ${covered.join(', ')}` : 'Watching one zone'}</p>
              <p className="mt-0.5 text-[14px] leading-5 text-fg-2">{calibrated ? 'Keep the phone still — the outlines must stay on their zones. Moved it? Send a new snapshot.' : 'To cover several zones, send a snapshot; an organizer outlines the zones on it from the dashboard.'}</p>
            </div>
          </div>
          <Pill size="md" tone="paper" className="mt-3 w-full" disabled={sendingSnap || cam !== 'on'} onClick={() => void sendSnapshot()}>
            {sendingSnap ? <Spinner className="size-4" /> : <Camera />}{cam === 'on' ? 'Send calibration snapshot' : 'Turn on the camera to send a snapshot'}
          </Pill>
        </section>

        {snap ? (
          <section className="mt-5">
            <h2 className="mb-2.5 px-1 text-[15px] font-semibold text-fg">On the map</h2>
            <MapCard snap={snap} highlightDeviceId={deviceId} highlightZoneId={calibrated ? null : device?.zoneId ?? null} />
            <p className="mt-2 flex items-start gap-1.5 px-1 text-[13px] leading-[18px] text-fg-3">
              <MapPin className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
              {device?.position ? `Placed on the map${covered.length ? ` · watching ${covered.join(', ')}` : ''}.` : 'Ask an organizer to drag this camera to its spot on the dashboard.'}
            </p>
          </section>
        ) : null}

        <p className="mt-5 flex items-center justify-center gap-1.5 text-center text-[12px] text-fg-3"><ShieldCheck className="size-3.5" strokeWidth={1.75} />Photos are analysed, then discarded — only results are kept.</p>
      </main>

      <footer className="mat-bar fixed inset-x-0 bottom-0 z-(--z-header) pb-[calc(var(--safe-b)+10px)] shadow-[inset_0_.5px_0_rgb(23_21_15/.14)]">
        <div className="mx-auto flex max-w-[640px] items-center gap-2 px-4 pt-2.5">
          {observing ? (
            <Pill tone="paper" className="flex-1" onClick={camera.pause}><Pause />Pause</Pill>
          ) : (
            <Pill className="flex-1" disabled={!snap || (!calibrated && !device?.zoneId) || cam === 'starting'} onClick={() => void camera.start()}>
              {cam === 'starting' ? <Spinner className="size-4 border-white/30 border-t-white" /> : <Play />}{cam === 'on' ? 'Resume' : 'Start watching'}
            </Pill>
          )}
          <Pill tone="wash" className="w-[50px] px-0" aria-label="Text report" onClick={() => setManual({ open: true, tab: 'report' })}><MessageSquareText /></Pill>
          <Pill tone="wash" className="px-4" onClick={() => setManual({ open: true, tab: 'manual' })}><PenLine />Manual</Pill>
        </div>
      </footer>

      <ZoneSheet open={zoneOpen} onOpenChange={setZoneOpen} zones={zones} selectedId={device?.zoneId} onSelect={(z) => void chooseZone(z)}
        title="Zone to watch" description="Pick the zone this phone is pointed at." />
      <ManualSheet open={manual.open} onOpenChange={(o) => setManual((m) => ({ ...m, open: o }))} initialTab={manual.tab} deviceId={deviceId}
        zoneId={device?.zoneId ?? regions[0]?.zoneId ?? null} zoneName={zone?.name ?? perZone[0]?.zone?.name} onResult={applyResult} />
      <OfflineBanner status={status} bottom={96} />
    </div>
  );
}

function RegionRow({ n, zone, obs, now, first }: { n: number; zone: Zone | undefined; obs: Observation | null; now: number; first: boolean }) {
  const p = obs?.payload.kind === 'vision' ? obs.payload : null;
  return (
    <motion.li variants={rise} layout className="relative flex gap-3 px-4 py-3">
      {!first ? <span className="absolute top-0 right-0 left-14 h-px origin-top scale-y-50 bg-[rgb(23_21_15/.16)]" aria-hidden /> : null}
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full text-[13px] font-bold text-black shadow-[inset_0_0_0_1.5px_rgb(0_0_0/.55)]" style={{ background: REGION_COLOR }}>{n}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="min-w-0 truncate text-[16px] font-semibold text-fg">{zone?.name ?? 'Unknown zone'}</span>
          {zone ? <ZoneStatusPill status={zone.status} stale={isStale(zone, now)} size="sm" className="ml-auto" /> : null}
        </div>
        {p ? (
          <motion.div key={obs!.id} initial={{ opacity: 0.4 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
            {p.scene_ok ? <MetricList metrics={visionMetrics(p)} className="mt-2" /> : null}
            <p className="mt-2 text-[14px] leading-5 text-fg">{p.scene_ok ? p.summary : "Can't see this zone clearly — check the outline."}</p>
            <div className="mt-1.5 flex items-center gap-2"><Confidence value={obs!.confidence} /><span className="text-[12px] text-fg-3">{ago(obs!.observedAt, now)}</span></div>
          </motion.div>
        ) : <p className="mt-0.5 text-[13px] text-fg-3">Waiting for the first frame</p>}
      </div>
    </motion.li>
  );
}

function Preview({ attachVideo, videoRef, cam, observing, inflight, next, hidden, noZone, onPickZone, latencyMs, regions, label }: {
  attachVideo: (el: HTMLVideoElement | null) => void; videoRef: React.RefObject<HTMLVideoElement | null>; cam: CamState; observing: boolean; inflight: boolean;
  next: { at: number; ms: number } | null; hidden: boolean; noZone: boolean; onPickZone: () => void; latencyMs: number | null; regions: CameraRegion[]; label?: string;
}) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const calibrated = regions.length > 0;
  useEffect(() => {
    const el = barRef.current;
    if (!el || !next) return;
    const remaining = Math.max(0, next.at - Date.now());
    const from = next.ms ? 1 - remaining / next.ms : 1;
    const a = el.animate([{ transform: `scaleX(${from})` }, { transform: 'scaleX(1)' }], { duration: remaining, fill: 'forwards', easing: 'linear' });
    return () => a.cancel();
  }, [next]);

  // Overlay the calibrated regions over the (letterboxed, object-contain) preview so the user sees what the model sees.
  useEffect(() => {
    const c = overlayRef.current, box = boxRef.current;
    if (!c || !box) return;
    const draw = () => {
      const v = videoRef.current;
      const dpr = window.devicePixelRatio || 1;
      const W = box.clientWidth, H = box.clientHeight;
      c.width = W * dpr; c.height = H * dpr; c.style.width = `${W}px`; c.style.height = `${H}px`;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (!calibrated || !v || !v.videoWidth) return;
      const s = Math.min(W / v.videoWidth, H / v.videoHeight);
      const w = v.videoWidth * s, h = v.videoHeight * s;
      ctx.translate((W - w) / 2, (H - h) / 2);
      drawRegions(ctx, w, h, regions, 0.9);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(box);
    const v = videoRef.current;
    v?.addEventListener('loadedmetadata', draw);
    return () => { ro.disconnect(); v?.removeEventListener('loadedmetadata', draw); };
  }, [regions, calibrated, cam, videoRef]);

  const on = cam === 'on';
  return (
    <div ref={boxRef} className="relative mx-auto aspect-[3/4] max-h-[min(48dvh,520px)] w-full overflow-hidden rounded-[18px] bg-[#0d0c0a]">
      <video ref={attachVideo} playsInline muted autoPlay className={cn('absolute inset-0 size-full transition-opacity duration-300', calibrated ? 'object-contain' : 'object-cover', on ? 'opacity-100' : 'opacity-0')} />
      <canvas ref={overlayRef} className={cn('pointer-events-none absolute inset-0 transition-opacity duration-300', on ? 'opacity-100' : 'opacity-0')} aria-hidden />
      <AnimatePresence>
        {!on ? (
          <motion.div key="off" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center text-white">
            {cam === 'starting' ? <Loader2 className="size-7 animate-spin text-white/80" /> : <Camera className="size-8 text-white/70" strokeWidth={1.5} />}
            <p className="mt-3 text-[17px] font-semibold">{cam === 'starting' ? 'Turning on the camera' : 'Camera is off'}</p>
            <p className="mt-1 text-[14px] leading-5 text-white/65">
              {noZone ? 'First, pick the zone this phone is pointed at.' : calibrated ? `Start watching to read all ${regions.length} zones every ${CAPTURE_INTERVAL_MS / 1000} seconds.` : `Start watching to read this zone every ${CAPTURE_INTERVAL_MS / 1000} seconds.`}
            </p>
            {noZone ? <button type="button" onClick={onPickZone} className="mt-4 inline-flex h-10 items-center rounded-full bg-white px-4 text-[15px] font-semibold text-fg active:scale-[.97]">Choose zone</button> : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
      {on ? (
        <>
          <div className="absolute top-3 left-3">
            <span className="mat-dark inline-flex h-8 items-center gap-2 rounded-full px-3 text-[13px] font-semibold">
              <span className="live-dot" style={{ color: observing && !hidden ? '#34c759' : '#ff9f0a' }} data-ping={observing && !hidden ? '' : undefined} />
              {observing ? (hidden ? 'Paused — screen is off' : `Watching · every ${CAPTURE_INTERVAL_MS / 1000}s`) : 'Paused'}
            </span>
          </div>
          <div className="absolute top-3 right-3">
            <AnimatePresence mode="wait">
              {inflight ? (
                <motion.span key="a" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={spring.snappy}
                  className="mat-dark inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold"><Loader2 className="size-3.5 animate-spin" />Reading</motion.span>
              ) : latencyMs != null ? (
                <motion.span key="l" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mat-dark inline-flex h-8 items-center rounded-full px-3 text-[13px] font-semibold tabular-nums">AI {(latencyMs / 1000).toFixed(1)}s</motion.span>
              ) : null}
            </AnimatePresence>
          </div>
          {label ? <span className="absolute bottom-4 left-3 text-[12px] font-medium text-white/70">{label}</span> : null}
          <div className="absolute inset-x-3 bottom-2.5 h-[3px] overflow-hidden rounded-full bg-white/20" aria-hidden>
            {observing && next ? <div ref={barRef} className="h-full w-full origin-left rounded-full bg-white" style={{ transform: 'scaleX(0)' }} /> : null}
            {observing && inflight ? <div className="h-full w-full animate-pulse rounded-full bg-white/70" /> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

function FallbackCard({ cam, aiMessage, aiCode, retryAt, now, onManual, onRetry, observing }: {
  cam: CamState; aiMessage: string | null; aiCode: string | null; retryAt: number | null; now: number; onManual: () => void; onRetry: () => void; observing: boolean;
}) {
  let title = 'AI is not responding — you can enter it manually';
  let body: string | null = aiCode === 'AI_DISABLED' ? 'AI analysis is turned off for this event.' : aiMessage;
  let icon = <TriangleAlert className="size-[18px]" strokeWidth={1.75} />;
  if (cam === 'denied') {
    title = 'Camera access is needed';
    body = 'Safari: tap "aA" in the address bar → Website Settings → Camera → Allow. Chrome: tap the lock → Permissions → Camera → Allow, then reload. Manual entry still works.';
    icon = <CameraOff className="size-[18px]" strokeWidth={1.75} />;
  } else if (cam === 'unsupported') {
    title = "This browser can't use the camera";
    body = 'Make sure the address starts with https, or open it in Safari or Chrome. Manual entry still works.';
    icon = <CameraOff className="size-[18px]" strokeWidth={1.75} />;
  } else if (cam === 'nocamera' || cam === 'error') {
    title = "Can't turn on the camera";
    body = 'Check that no other app is using it. Manual entry still works.';
    icon = <CameraOff className="size-[18px]" strokeWidth={1.75} />;
  }
  const retryIn = retryAt && observing ? Math.max(0, Math.ceil((retryAt - now) / 1000)) : null;
  return (
    <motion.div variants={rise} initial="initial" animate="animate" exit="exit" className={cn(CARD, 'mt-3 p-4')} role="alert">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-[#c6824b]">{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] leading-[22px] font-semibold text-fg">{title}</p>
          {body ? <p className="mt-0.5 text-[14px] leading-5 text-fg-2">{body}</p> : null}
          {retryIn != null && aiMessage ? <p className="mt-1 text-[12px] tabular-nums text-fg-3">{retryIn > 0 ? `Retrying in ${retryIn}s` : 'Retrying…'}</p> : null}
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <Pill size="md" onClick={onManual} className="flex-1"><PenLine />Manual entry</Pill>
        {aiMessage && observing ? <Pill size="md" tone="paper" onClick={onRetry}><RotateCw />Retry now</Pill> : null}
      </div>
    </motion.div>
  );
}
