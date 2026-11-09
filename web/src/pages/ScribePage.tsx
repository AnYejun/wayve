// /scribe/:id — the phone left on a meeting table. Transcribes continuously (cut on silence, ≤ 20 s per segment);
// the server turns utterances into tracked issues. Audio never leaves memory except as the upload itself.
import { useCallback, useMemo } from 'react';
import { useParams } from 'react-router';
import { Mic, MicOff, Pause, Play, RotateCw, Square, Unplug, Users } from 'lucide-react';
import type { Issue, Me, Utterance } from '@shared/contracts';
import { useLive } from '@/lib/live';
import { useNow } from '@/lib/time';
import { cn } from '@/lib/utils';
import { Logo } from '@/design/Logo';
import { LiveIndicator } from '@/components/bits';
import { RecDot } from '@/components/ops-bits';
import { CARD, CenterState, HAIR, Pill, Spinner, useMe } from '@/components/phone/common';
import { Banner, BannerIcons, ConsentCard, LevelMeter, RecentIssues, TranscriptList } from '@/components/phone/scribe/parts';
import { useScribe } from '@/components/phone/scribe/useScribe';
import type { ScribeError } from '@/lib/scribe';

export default function ScribePage() {
  const { id = '' } = useParams();
  const { state, reload } = useMe();
  if (state.status === 'loading') return <CenterState icon={<Spinner className="size-6" />} title="Checking this scribe" />;
  if (state.status === 'error') {
    return (
      <CenterState icon={<Unplug strokeWidth={1.75} />} tone="warn" title="Can't connect" body={state.error.message}>
        <Pill onClick={reload}><RotateCw />Try again</Pill>
      </CenterState>
    );
  }
  if (!state.me) return <Reconnect />;
  return <ScribeGate me={state.me} deviceId={id} />;
}

function Reconnect() {
  return <CenterState icon={<Unplug strokeWidth={1.75} />} tone="warn" title="Scan the QR again" body="This phone isn't set up as a meeting scribe. Scan your team's meeting scribe QR code." />;
}

function ScribeGate({ me, deviceId }: { me: Me; deviceId: string }) {
  const live = useLive(me.eventId);
  const owned = me.deviceId === deviceId || !!live.snap?.devices.some((d) => d.id === deviceId && d.participantId === me.participantId);
  if (live.status === 'error') return <Reconnect />;
  if (!owned) {
    if (!live.snap) return <CenterState icon={<Spinner className="size-6" />} title="Checking this scribe" />;
    return <Reconnect />;
  }
  return <ScribeConsole deviceId={deviceId} live={live} />;
}

const hms = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':');
};

const MIC_ERROR: Record<ScribeError, { title: string; body: string }> = {
  denied: { title: 'Microphone access is off', body: 'Safari: tap "aA" in the address bar → Website Settings → Microphone → Allow. Chrome: tap the lock → Permissions → Microphone → Allow. Then try again.' },
  unsupported: { title: "This browser can't transcribe", body: 'Open the QR link again in Safari (iPhone) or Chrome (Android).' },
  nomic: { title: 'No microphone found', body: 'Check that no other app is using the microphone.' },
  mic_lost: { title: 'Microphone disconnected', body: 'A call or another app may have taken it. Start again to keep transcribing.' },
  error: { title: "Couldn't turn on the microphone", body: 'Reload the page and try again.' },
};

function ScribeConsole({ deviceId, live }: { deviceId: string; live: ReturnType<typeof useLive> }) {
  const { snap, status, apply } = live;
  const onUtterance = useCallback((u: Utterance) => apply({ kind: 'utterance', data: u }), [apply]);
  const s = useScribe({ deviceId, onUtterance });
  const now = useNow(1000);

  const device = snap?.devices.find((d) => d.id === deviceId);
  const participant = snap?.participants.find((p) => p.id === device?.participantId);
  const team = snap?.teams.find((t) => t.id === participant?.teamId);
  const where = [team?.name ?? device?.label ?? 'Meeting scribe', snap?.event.name].filter(Boolean).join(' · ');

  const utterances = useMemo(
    () => (snap?.utterances ?? []).filter((u) => u.deviceId === deviceId).sort((a, b) => a.startedAt - b.startedAt),
    [snap?.utterances, deviceId],
  );
  const issues = useMemo(() => {
    if (!snap) return [] as Issue[];
    const seen = new Set<string>();
    const out: Issue[] = [];
    for (let i = utterances.length - 1; i >= 0; i--) {
      for (const k of utterances[i].issueKeys) {
        if (seen.has(k)) continue;
        seen.add(k);
        const issue = snap.issues.find((x) => x.key === k);
        if (issue) out.push(issue);
      }
    }
    return out;
  }, [snap, utterances]);

  const listening = s.state === 'listening';
  const paused = s.state === 'paused';
  const starting = s.state === 'starting';
  const running = listening || paused || starting;
  const transcribing = s.queue.inflight;

  // ── header ──
  const header = (
    <header className="mat-bar hairline-b sticky top-0 z-(--z-header) pt-(--safe-t)">
      <div className="flex h-[52px] items-center gap-2 px-4">
        <Logo size={19} />
        <span className={cn('ml-1 inline-flex h-8 min-w-0 items-center gap-1.5 rounded-full bg-white pr-3 pl-2.5 text-[14px] font-semibold text-fg', HAIR)}>
          <Users className="size-4 shrink-0 text-fg-2" strokeWidth={1.75} />
          <span className="truncate">{team?.name ?? device?.label ?? 'Meeting scribe'}</span>
        </span>
        <LiveIndicator status={status} className="ml-auto shrink-0" />
      </div>
    </header>
  );

  // ── consent (before the first start) ──
  if (!s.everStarted) {
    return (
      <div className="flex h-dvh flex-col overflow-hidden bg-canvas">
        {header}
        <main className="min-h-0 flex-1 overflow-y-auto px-5 pt-10 pb-6"><ConsentCard where={where} /></main>
        <footer className="mat-bar border-t-[.5px] border-[rgb(23_21_15/.16)] px-5 pt-3 pb-[calc(var(--safe-b)+12px)]">
          <Pill className="mx-auto flex w-full max-w-[420px]" onClick={s.start}><Mic />Everyone knows — start</Pill>
        </footer>
      </div>
    );
  }

  // ── mic error ──
  if (s.state === 'error' && s.error) {
    const m = MIC_ERROR[s.error];
    return (
      <div className="flex h-dvh flex-col overflow-hidden bg-canvas">
        {header}
        <main className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
          <div className={cn('mb-5 grid size-16 place-items-center rounded-[20px] bg-white text-[#c6824b] [&_svg]:size-7', HAIR)}><MicOff strokeWidth={1.75} /></div>
          <h1 className="text-[22px] leading-7 font-semibold tracking-[-0.02em] text-fg">{m.title}</h1>
          <p className="mt-2 max-w-[340px] text-[15px] leading-[22px] text-fg-2">{m.body}</p>
          {utterances.length ? <p className="mt-4 text-[13px] text-fg-3 tabular-nums">The {utterances.length} lines so far are saved on the HQ board</p> : null}
        </main>
        <footer className="mat-bar border-t-[.5px] border-[rgb(23_21_15/.16)] px-5 pt-3 pb-[calc(var(--safe-b)+12px)]">
          <Pill className="mx-auto flex w-full max-w-[420px]" onClick={s.start}><RotateCw />Try again</Pill>
        </footer>
      </div>
    );
  }

  // ── ended ──
  if (s.ended && !running) {
    return (
      <div className="flex h-dvh flex-col overflow-hidden bg-canvas">
        {header}
        <main className="min-h-0 flex-1 overflow-y-auto px-5 pt-10 pb-6">
          <div className="mx-auto w-full max-w-[420px] animate-in fade-in duration-300">
            <h1 className="text-[28px] leading-9 font-semibold tracking-[-0.03em] text-fg">Meeting wrapped up</h1>
            <p className="mt-1.5 text-[15px] text-fg-2 tabular-nums">Recorded {hms(s.elapsed(now))} · {utterances.length} lines · {issues.length} items</p>
            {issues.length ? <RecentIssues issues={issues} participants={snap?.participants ?? []} max={8} title="Captured in this meeting" className="mt-7" />
              : <div className={cn(CARD, 'mt-7 px-4 py-6 text-center text-[15px] text-fg-2')}>Nothing was captured in this meeting</div>}
            <p className="mt-4 px-1 text-[13px] text-fg-3">The transcript and captured items are saved on the HQ board.</p>
          </div>
        </main>
        <footer className="mat-bar border-t-[.5px] border-[rgb(23_21_15/.16)] px-5 pt-3 pb-[calc(var(--safe-b)+12px)]">
          <Pill className="mx-auto flex w-full max-w-[420px]" onClick={s.start}><Mic />Start again</Pill>
        </footer>
      </div>
    );
  }

  // ── recording / paused ──
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-canvas">
      {header}
      <main className="mx-auto flex min-h-0 w-full max-w-[560px] flex-1 flex-col gap-3 px-4 pt-6 pb-3">
        <section className="shrink-0 text-center" aria-live="polite">
          <div className="flex items-center justify-center gap-3">
            {starting ? <Spinner className="size-5" /> : <RecDot on={listening} className="size-3" />}
            <h1 className="text-[28px] leading-9 font-semibold tracking-[-0.03em] text-fg">
              {starting ? 'Turning on the mic…' : listening ? 'Listening' : 'Paused'}
            </h1>
          </div>
          <p className="mt-1 text-[15px] text-fg-2 tabular-nums">
            <span className="font-medium text-fg">{hms(s.elapsed(now))}</span>
            <span className="text-fg-3"> · </span>{utterances.length} lines<span className="text-fg-3"> · </span>{issues.length} items
          </p>
          <LevelMeter level={s.level} active={listening} className="mt-3" />
          {listening ? <p className="mt-1 text-[12px] text-fg-3">Keep the screen on — transcribing stops when it sleeps</p> : null}
        </section>

        <div className="flex shrink-0 flex-col gap-2 empty:hidden">
          {s.queue.aiDisabled ? <Banner tone="warn" icon={BannerIcons.warn}>AI is off, so nothing can be transcribed. Let HQ know.</Banner> : null}
          {s.queue.offline && s.queue.pending > 0 ? <Banner tone="warn" icon={BannerIcons.offline}>Offline — {s.queue.pending} waiting. They'll send when you're back.</Banner> : null}
          {s.queue.dropped > 0 ? <Banner icon={BannerIcons.warn}>{s.queue.dropped} segments couldn't be sent</Banner> : null}
          {s.wasHidden && listening ? <Banner icon={BannerIcons.screen}>Nothing was transcribed while the screen was off.</Banner> : null}
        </div>

        <TranscriptList utterances={utterances} transcribing={transcribing} className="flex-1" />
        <RecentIssues issues={issues} participants={snap?.participants ?? []} className="shrink-0" />
      </main>

      <footer className="mat-bar border-t-[.5px] border-[rgb(23_21_15/.16)] px-4 pt-3 pb-[calc(var(--safe-b)+12px)]">
        <div className="mx-auto flex w-full max-w-[560px] gap-2.5">
          {paused ? (
            <>
              <Pill className="flex-1" onClick={s.resume}><Play />Resume</Pill>
              <Pill tone="paper" className="flex-1" onClick={s.stop}><Square />End</Pill>
            </>
          ) : (
            <>
              <Pill tone="paper" className="flex-1" disabled={!listening} onClick={s.pause}><Pause />Pause</Pill>
              <Pill className="flex-1" disabled={starting} onClick={s.stop}><Square />End</Pill>
            </>
          )}
        </div>
      </footer>
    </div>
  );
}
