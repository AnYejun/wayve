// /chat — attendee event chatbot. Every message is stored server-side; recognised field reports flow into the same
// observation → incident pipeline and come back as a receipt chip under the user's bubble. No SSE for attendees:
// zone crowd pills refresh by polling GET /api/chat every 20 s while the page is visible.
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { QrCode, RotateCw, Unplug } from 'lucide-react';
import type { ChatState, PublicZone } from '@shared/contracts';
import { API, HttpError } from '@/lib/api';
import { useNow } from '@/lib/time';
import { Logo } from '@/design/Logo';
import { CenterState, Pill, Spinner, ZoneSheet, ZoneTrigger } from '@/components/phone/common';
import {
  AssistantBubble, ChatComposer, ChatHero, CrowdStrip, UserBubble, type Failure, type UiMsg,
} from '@/components/phone/chat/parts';
import { TicketStrip, useTickets } from '@/components/phone/chat/tickets';

const POLL_MS = 20_000;

type Load = { k: 'loading' } | { k: 'nosession' } | { k: 'error'; message: string } | { k: 'ready'; state: ChatState };

export default function ChatPage() {
  const [load, setLoad] = useState<Load>({ k: 'loading' });
  const fetchState = useCallback(() => {
    setLoad({ k: 'loading' });
    API.chatState().then((state) => {
      setLoad(['attendee', 'staff', 'admin'].includes(state.me.role) ? { k: 'ready', state } : { k: 'nosession' });
    }).catch((e: HttpError) => {
      if (e.status === 401 || e.status === 403 || e.status === 404) setLoad({ k: 'nosession' });
      else setLoad({ k: 'error', message: e.message });
    });
  }, []);
  useEffect(fetchState, [fetchState]);

  if (load.k === 'loading') return <CenterState icon={<Spinner className="size-6" />} title="Loading the chat" />;
  if (load.k === 'nosession') {
    return <CenterState icon={<QrCode strokeWidth={1.75} />} title="Scan the event QR to start chatting" body="Point your camera at an attendee QR code around the venue." />;
  }
  if (load.k === 'error') {
    return (
      <CenterState icon={<Unplug strokeWidth={1.75} />} tone="warn" title="Can't connect" body={load.message}>
        <Pill onClick={fetchState}><RotateCw />Try again</Pill>
      </CenterState>
    );
  }
  return <Chat initial={load.state} />;
}

function Chat({ initial }: { initial: ChatState }) {
  const eventId = initial.event.id;
  const [zones, setZones] = useState<PublicZone[]>(initial.zones);
  const [myZoneId, setMyZoneId] = useState<string | null>(initial.myZoneId);
  const [msgs, setMsgs] = useState<UiMsg[]>(() => initial.messages.map((m) => (m.role === 'user' && m.observationId ? { ...m, receipt: 'generic' as const } : m)));
  const [sending, setSending] = useState(false);
  const [aiOff, setAiOff] = useState(!initial.ai.enabled);
  const [zoneOpen, setZoneOpen] = useState(false);
  const now = useNow(5000);
  const { byMsg: tickets, upsert: upsertTicket } = useTickets(eventId, initial.tickets ?? []);
  const seq = useRef(0);
  const endRef = useRef<HTMLDivElement | null>(null);
  const myZone = zones.find((z) => z.id === myZoneId) ?? null;

  // First paint jumps straight to the latest message; later messages glide in.
  const scrolledOnce = useRef(false);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: scrolledOnce.current ? 'smooth' : 'auto', block: 'end' });
    scrolledOnce.current = true;
  }, [msgs.length, sending]);

  // Poll zone crowd levels while visible.
  useEffect(() => {
    let t: ReturnType<typeof setInterval> | undefined;
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      API.chatState(eventId).then((s) => {
        setZones(s.zones);
        setMyZoneId((cur) => s.myZoneId ?? cur);
        setAiOff(!s.ai.enabled);
      }).catch(() => { /* keep last known */ });
    };
    const arm = () => { clearInterval(t); t = setInterval(tick, POLL_MS); };
    const onVis = () => { if (document.visibilityState === 'visible') { tick(); arm(); } else clearInterval(t); };
    arm();
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [eventId]);

  const send = useCallback(async (text: string, replaceId?: string) => {
    const tempId = replaceId ?? `tmp-${++seq.current}`;
    const optimistic: UiMsg = { id: tempId, role: 'user', text, at: Date.now(), zoneId: myZoneId, observationId: null, model: null, pending: true };
    setMsgs((m) => (replaceId ? m.map((x) => (x.id === replaceId ? optimistic : x)) : [...m, optimistic]));
    setSending(true);
    try {
      const r = await API.chat(text, myZoneId, eventId);
      setMsgs((m) => [
        ...m.filter((x) => x.id !== tempId),
        { ...r.user, receipt: r.report ?? (r.user.observationId ? 'generic' : undefined) },
        r.reply,
      ]);
      upsertTicket(r.ticket);
      setZones(r.zones);
      setMyZoneId(r.myZoneId);
      setAiOff(false);
      if (r.ticket && typeof navigator !== 'undefined') navigator.vibrate?.(30);
    } catch (e) {
      const he = e as HttpError;
      const failed: Failure =
        he.status === 503 ? { kind: 'ai', message: 'The chat assistant is taking a break' }
          : he.status === 429 ? { kind: 'rate', message: 'Slow down a little' }
            : he.status === 0 ? { kind: 'network', message: "Couldn't send" }
              : { kind: 'other', message: he.message };
      if (he.status === 503) setAiOff(true);
      setMsgs((m) => m.map((x) => (x.id === tempId ? { ...x, pending: false, failed } : x)));
    } finally {
      setSending(false);
    }
  }, [eventId, myZoneId, upsertTicket]);

  const chooseZone = async (z: PublicZone) => {
    setZoneOpen(false);
    const prev = myZoneId;
    setMyZoneId(z.id);
    try {
      const r = await API.chatZone(z.id, eventId);
      setMyZoneId(r.myZoneId);
    } catch (e) {
      setMyZoneId(prev);
      toast.error((e as HttpError).message);
    }
  };

  const empty = msgs.length === 0;

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="mat-bar hairline-b sticky top-0 z-(--z-header) pt-(--safe-t)">
        <div className="flex h-[52px] items-center gap-2.5 px-4">
          <Logo size={19} markOnly />
          <span className="min-w-0 flex-1 truncate text-[17px] leading-6 font-semibold tracking-[-0.01em] text-fg">{initial.event.name}</span>
          <ZoneTrigger zone={myZone} placeholder="Location" onClick={() => setZoneOpen(true)} className="max-w-[42vw] shrink-0" />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[640px] px-4 pb-[calc(var(--safe-b)+96px)]">
        {empty ? (
          <ChatHero zones={zones} now={now} onAsk={(q) => void send(q)} disabled={sending} />
        ) : (
          <>
            <CrowdStrip zones={zones} now={now} className="pt-3 pb-1" />
            <div className="pt-2"><TicketStrip tickets={Object.values(tickets).sort((a, b) => b.createdAt - a.createdAt)}
              onJump={(id) => document.getElementById(`msg-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })} /></div>
            <div className="flex flex-col gap-5 pt-4" aria-live="polite">
              {msgs.map((m) => (m.role === 'user'
                ? <UserBubble key={m.id} msg={m} zones={zones} now={now} ticket={tickets[m.id]} onRetry={(x) => void send(x.text, x.id)} />
                : <AssistantBubble key={m.id} msg={m} />))}
              {sending ? <span className="typing py-2" aria-label="Writing a reply"><i /><i /><i /></span> : null}
            </div>
          </>
        )}
        {aiOff && !empty ? (
          <p className="mt-5 text-center text-[13px] text-fg-3">The chat assistant is taking a break. Crowd levels keep updating.</p>
        ) : null}
        <div ref={endRef} />
      </main>

      <ChatComposer onSend={(t) => void send(t)} sending={sending} />

      <ZoneSheet open={zoneOpen} onOpenChange={setZoneOpen} zones={zones} selectedId={myZoneId} onSelect={(z) => void chooseZone(z)}
        title="Where are you?" description="We'll answer for that area, and your reports go to it." />
    </div>
  );
}
