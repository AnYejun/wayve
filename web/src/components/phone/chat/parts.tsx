// Attendee chat building blocks: crowd strip, hero, bubbles (+ report receipt), composer.
import { useState, type FormEvent } from 'react';
import { ArrowUp, Check, ChevronRight, RotateCw, TriangleAlert } from 'lucide-react';
import { INCIDENT_LABEL, ZONE_STALE_MS, type AttendeeTicket, type ChatMessage, type ChatReply, type PublicZone } from '@shared/contracts';
import { TicketCard } from './tickets';
import { cn } from '@/lib/utils';
import { AiTag, ZoneStatusPill } from '@/components/bits';
import { CARD, HAIR } from '../common';

export const SUGGESTIONS = ['When is lunch?', 'Where can I charge my laptop?', 'We need an extension cord at our table', 'The coffee corner is out of cups'];
export const MAX_CHARS = 500;

export type Receipt = ChatReply['report'] | 'generic';
export type Failure = { kind: 'ai' | 'rate' | 'network' | 'other'; message: string };
export type UiMsg = ChatMessage & { pending?: boolean; failed?: Failure; receipt?: Receipt };

/** Horizontal strip of zone crowd pills (name + status). Scrolls sideways, never wraps. */
export function CrowdStrip({ zones, now, className }: { zones: PublicZone[]; now: number; className?: string }) {
  if (!zones.length) return null;
  return (
    <div className={cn('-mx-4 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', className)} aria-label="Crowd by zone">
      <ul className="flex w-max gap-2">
        {zones.map((z) => {
          const stale = z.lastObservedAt != null && now - z.lastObservedAt > ZONE_STALE_MS;
          return (
            <li key={z.id} className={cn('flex h-10 items-center gap-2 rounded-full bg-white pr-1.5 pl-3.5', HAIR)}>
              <span className="text-[14px] font-medium whitespace-nowrap text-fg">{z.name}</span>
              <ZoneStatusPill status={z.status} stale={stale} size="sm" />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function ChatHero({ zones, now, onAsk, disabled }: { zones: PublicZone[]; now: number; onAsk: (q: string) => void; disabled: boolean }) {
  return (
    <div className="pt-6">
      <h1 className="text-[30px] leading-9 font-semibold tracking-[-0.03em] text-fg">Hi! How can we help?</h1>
      <p className="mt-2 text-[15px] leading-[22px] text-fg-2">Ask about the schedule, request something for your table, or flag what's off. You'll see the team's progress right here.</p>
      {zones.length ? (
        <section className="mt-6">
          <h2 className="mb-2 text-[13px] font-semibold text-fg-2">How busy it is now</h2>
          <CrowdStrip zones={zones} now={now} />
        </section>
      ) : null}
      <ul className={cn(CARD, 'mt-6 overflow-hidden')}>
        {SUGGESTIONS.map((s, i) => (
          <li key={s} className="relative">
            {i > 0 ? <span className="absolute top-0 right-0 left-4 h-px origin-top scale-y-50 bg-[rgb(23_21_15/.16)]" aria-hidden="true" /> : null}
            <button type="button" disabled={disabled} onClick={() => onAsk(s)}
              className="flex min-h-[52px] w-full items-center gap-3 px-4 text-left text-[16px] text-fg active:bg-[rgb(23_21_15/.05)] disabled:opacity-40">
              <span className="flex-1">{s}</span><ChevronRight className="size-4 text-fg-3" strokeWidth={1.75} />
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-4 px-1 text-[13px] leading-[18px] text-fg-3">The event team sees your requests anonymously, as an attendee number.</p>
    </div>
  );
}

export function UserBubble({ msg, zones, onRetry, ticket, now }: { msg: UiMsg; zones: PublicZone[]; onRetry: (m: UiMsg) => void; ticket?: AttendeeTicket; now: number }) {
  return (
    <div id={`msg-${msg.id}`} className="flex scroll-mt-24 flex-col items-end gap-1.5 animate-in fade-in slide-in-from-bottom-1 duration-200">
      <p className={cn('max-w-[82%] rounded-[20px] rounded-br-[6px] bg-[#17150f] px-4 py-2.5 text-[16px] leading-6 break-words whitespace-pre-wrap text-white',
        msg.pending && 'opacity-70', msg.failed && 'opacity-60')}>{msg.text}</p>
      {ticket ? <TicketCard t={ticket} zones={zones} now={now} /> : msg.receipt ? <ReceiptChip receipt={msg.receipt} zones={zones} /> : null}
      {msg.failed ? (
        <p className="flex max-w-[90%] items-center gap-1.5 text-[13px] text-fg-2" role="alert">
          <TriangleAlert className="size-3.5 shrink-0 text-[#c6824b]" strokeWidth={2} />
          <span>{msg.failed.message}</span>
          {msg.failed.kind !== 'ai' ? (
            <button type="button" onClick={() => onRetry(msg)} className="ml-1 inline-flex h-8 items-center gap-1 rounded-full px-2 font-semibold text-fg active:bg-[rgb(23_21_15/.06)]">
              <RotateCw className="size-3.5" strokeWidth={2} />Resend
            </button>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

function ReceiptChip({ receipt, zones }: { receipt: Receipt; zones: PublicZone[] }) {
  let text = 'Sent to the event team';
  if (receipt && receipt !== 'generic') {
    const zone = zones.find((z) => z.id === receipt.zoneId)?.name ?? '';
    const what = receipt.issueType === 'none' ? 'update' : INCIDENT_LABEL[receipt.issueType];
    text = `${receipt.joinedExisting ? 'Added to an existing report' : 'Sent to the event team'} · ${zone ? `${zone} ` : ''}${what}`;
  }
  return (
    <span className={cn('inline-flex h-7 max-w-[90%] items-center gap-1.5 rounded-full bg-white px-2.5 text-[12px] font-medium text-fg-2 animate-in fade-in duration-300', HAIR)}>
      <Check className="size-3.5 shrink-0 text-st-clear-fg" strokeWidth={2.5} />
      <span className="truncate">{text}</span>
    </span>
  );
}

export function AssistantBubble({ msg }: { msg: UiMsg }) {
  return (
    <div className="animate-in fade-in duration-300">
      <p className="text-[16px] leading-[1.6] break-words whitespace-pre-wrap text-fg">{msg.text}</p>
      <AiTag model={msg.model} className="mt-2" />
    </div>
  );
}

export function ChatComposer({ onSend, sending, disabled }: { onSend: (text: string) => void; sending: boolean; disabled?: boolean }) {
  const [value, setValue] = useState('');
  // Failed sends keep their text on the bubble (with a retry), so the field is always cleared on send.
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const t = value.trim();
    if (!t || sending || disabled) return;
    setValue('');
    onSend(t);
  };
  return (
    <div className="mat-bar fixed inset-x-0 bottom-0 z-(--z-sticky) border-t-[.5px] border-[rgb(23_21_15/.16)] px-4 pt-2.5 pb-[calc(var(--safe-b)+10px)]">
      <form className={cn('mx-auto flex max-w-[640px] items-center gap-2 rounded-full bg-white py-1.5 pr-1.5 pl-4', HAIR)} onSubmit={submit}>
        <input value={value} onChange={(e) => setValue(e.target.value.slice(0, MAX_CHARS))} maxLength={MAX_CHARS}
          placeholder="Message" aria-label="Message" enterKeyHint="send" autoComplete="off"
          className="h-9 min-w-0 flex-1 bg-transparent text-[16px] text-fg outline-none placeholder:text-fg-3" />
        {value.length > MAX_CHARS - 50 ? <span className="shrink-0 text-[12px] tabular-nums text-fg-3">{MAX_CHARS - value.length}</span> : null}
        <button type="submit" disabled={!value.trim() || sending || disabled} aria-label="Send"
          className="grid size-8 shrink-0 place-items-center rounded-full bg-[#17150f] text-white transition-[opacity,scale] duration-120 active:scale-[.92] disabled:opacity-30">
          <ArrowUp className="size-4" strokeWidth={2.5} />
        </button>
      </form>
    </div>
  );
}
