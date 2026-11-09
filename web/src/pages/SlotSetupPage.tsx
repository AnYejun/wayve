// /s/:code/:slotId — one-scan device setup for a preset venue's install spot. No login: the phone joins as that spot's
// camera or scribe (label, zone, map position, team and AI crew persona are set by the server), shows how to mount it,
// then opens the camera / scribe screen. Poster spots forward to the attendee chat.
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { motion } from 'motion/react';
import { ArrowRight, Camera, Check, Loader2, Mic, RotateCw } from 'lucide-react';
import { AGENT_ROLE_DEFS, type Device, type EventInfo, type InstallSlot } from '@shared/contracts';
import { HttpError } from '@/lib/api';
import { Logo } from '@/design/Logo';
import { rise, spring } from '@/design/motion';
import { presetApi } from '@/components/install/api';

type State = { kind: 'loading' } | { kind: 'ready'; event: EventInfo; slot: InstallSlot; device: Device } | { kind: 'error'; message: string; retry: boolean };

export default function SlotSetupPage() {
  const { code = '', slotId = '' } = useParams();
  const nav = useNavigate();
  const [st, setSt] = useState<State>({ kind: 'loading' });
  const once = useRef(false);

  const run = async () => {
    setSt({ kind: 'loading' });
    try {
      const { event, slot } = await presetApi.slot(code, slotId);
      if (slot.kind === 'poster') { nav(`/j/${code}?as=guest`, { replace: true }); return; }
      const { device } = await presetApi.join(code, slot);
      navigator.vibrate?.(30);
      setSt({ kind: 'ready', event, slot, device });
    } catch (e) {
      const err = e as HttpError;
      setSt({ kind: 'error', message: err.status === 404 ? 'This setup QR isn’t part of the venue plan anymore.' : err.message || 'Could not set up this phone.', retry: err.status !== 404 });
    }
  };
  useEffect(() => { if (once.current) return; once.current = true; void run(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex min-h-dvh flex-col bg-canvas" style={{ paddingTop: 'var(--safe-t)', paddingBottom: 'var(--safe-b)' }}>
      <header className="flex h-14 items-center px-5"><Logo size={17} /></header>
      <main className="mx-auto flex w-full max-w-[460px] flex-1 flex-col px-5 pb-6">
        {st.kind === 'loading' ? (
          <div className="grid flex-1 place-items-center">
            <div className="flex flex-col items-center gap-3 text-center">
              <Loader2 className="size-6 animate-spin text-fg-2" />
              <p className="text-[15px] text-fg-2">Setting up this phone…</p>
            </div>
          </div>
        ) : st.kind === 'error' ? (
          <div className="grid flex-1 place-items-center text-center">
            <div>
              <p className="text-[20px] font-semibold tracking-[-0.02em] text-fg">Couldn’t set up this phone</p>
              <p className="mt-1.5 text-[15px] leading-[22px] text-fg-2">{st.message}</p>
              {st.retry ? (
                <button type="button" onClick={() => void run()} className="mt-5 inline-flex h-11 items-center gap-2 rounded-full bg-[#17150f] px-5 text-[15px] font-semibold text-white active:scale-[.97]">
                  <RotateCw className="size-4" />Try again
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <Ready st={st} onOpen={() => nav(st.slot.kind === 'scribe' ? `/scribe/${st.device.id}` : `/device/${st.device.id}`, { replace: true })} />
        )}
      </main>
    </div>
  );
}

function Ready({ st, onOpen }: { st: Extract<State, { kind: 'ready' }>; onOpen: () => void }) {
  const { event, slot } = st;
  const I = slot.kind === 'scribe' ? Mic : Camera;
  const steps = [
    { t: 'Mount', d: slot.mount },
    { t: 'Height', d: slot.height },
    ...slot.tips.map((d) => ({ t: '', d })),
    { t: 'Power', d: 'Plug it in and keep the screen on — it works while the page is open.' },
  ];
  return (
    <motion.div initial="initial" animate="animate" variants={{ animate: { transition: { staggerChildren: 0.05 } } }} className="flex flex-1 flex-col">
      <motion.div variants={rise} className="mt-4 flex items-center gap-3">
        <span className="relative grid size-12 place-items-center rounded-[14px] bg-[#17150f] text-white">
          <I className="size-6" strokeWidth={1.75} />
          <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ ...spring.snappy, delay: 0.15 }}
            className="absolute -right-1 -bottom-1 grid size-5 place-items-center rounded-full bg-[#58a069] text-white ring-2 ring-[var(--color-canvas)]">
            <Check className="size-3" strokeWidth={3} />
          </motion.span>
        </span>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-fg-2">{event.name}</p>
          <p className="text-[13px] text-fg-3">Connected · no account needed</p>
        </div>
      </motion.div>
      <motion.h1 variants={rise} className="mt-5 text-[30px] leading-[1.1] font-semibold tracking-[-0.03em] text-fg">
        This phone is the {slot.label} {slot.kind === 'scribe' ? 'scribe' : 'camera'}
      </motion.h1>
      <motion.div variants={rise} className="mt-3 flex flex-wrap gap-1.5 text-[12.5px] font-medium text-fg-2">
        {slot.persona ? <span className="inline-flex h-6 items-center rounded-full bg-white px-2.5 shadow-[inset_0_0_0_.5px_rgb(23_21_15/.2)]">{slot.agentName ?? AGENT_ROLE_DEFS[slot.persona].label} · {AGENT_ROLE_DEFS[slot.persona].label}</span> : null}
        {slot.zones.length ? <span className="inline-flex h-6 items-center rounded-full bg-white px-2.5 shadow-[inset_0_0_0_.5px_rgb(23_21_15/.2)]">Watches {slot.zones.join(' · ')}</span> : null}
      </motion.div>

      <motion.ol variants={rise} className="mt-6 overflow-hidden rounded-[18px] border border-[rgb(23_21_15/.08)] bg-white">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-3 border-b border-[rgb(23_21_15/.06)] px-4 py-3 last:border-0">
            <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-[#f5f4f2] text-[11px] font-semibold text-fg-2 tabular-nums">{i + 1}</span>
            <p className="text-[15px] leading-[21px] text-fg">{s.t ? <span className="font-semibold">{s.t}: </span> : null}{s.d}</p>
          </li>
        ))}
      </motion.ol>
      {slot.persona ? (
        <motion.p variants={rise} className="mt-3 text-[13px] leading-[18px] text-fg-3">
          {slot.agentName ?? 'The AI crew'} now {slot.kind === 'scribe' ? 'listens' : 'watches'} through this phone and reports on the radio. Video and audio are analyzed and never stored.
        </motion.p>
      ) : null}

      <div className="mt-auto pt-6">
        <motion.button type="button" variants={rise} whileTap={{ scale: 0.97 }} transition={spring.snappy} onClick={onOpen}
          className="flex h-[52px] w-full items-center justify-center gap-2 rounded-full bg-[#17150f] text-[16px] font-semibold text-white shadow-[0_1px_2px_rgb(23_21_15/.18)]">
          {slot.kind === 'scribe' ? 'Open scribe' : 'Open camera'}<ArrowRight className="size-4" />
        </motion.button>
      </div>
    </motion.div>
  );
}
