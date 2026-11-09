// One-click invite at the top of the sidebar: the main button copies the staff link (QR-only, no account);
// the chevron opens every join link with its QR (staff, attendees, camera, scribe).
import { useState } from 'react';
import { Check, ChevronDown, Link2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from 'sonner';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

type Kind = 'staff' | 'guest' | 'camera' | 'scribe';
const LINKS: Array<{ kind: Kind; label: string; hint: string }> = [
  { kind: 'staff', label: 'Staff', hint: 'Radio, tasks, reports · no account' },
  { kind: 'guest', label: 'Attendees', hint: 'Event chatbot for questions and requests' },
  { kind: 'camera', label: 'Camera phone', hint: 'Watches a zone · pick it after scanning' },
  { kind: 'scribe', label: 'Meeting scribe', hint: 'Transcribes a meeting table' },
];

async function copy(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

export function InviteQuick({ joinCode }: { joinCode: string }) {
  const [copied, setCopied] = useState<Kind | null>(null);
  const [qr, setQr] = useState<Kind>('staff');
  const url = (k: Kind) => `${location.origin}/j/${joinCode}?as=${k}`;

  const doCopy = async (k: Kind) => {
    const ok = await copy(url(k));
    if (!ok) { toast.error('Couldn’t copy', { description: url(k) }); return; }
    setCopied(k);
    setTimeout(() => setCopied((c) => (c === k ? null : c)), 1600);
    toast.success(`${LINKS.find((l) => l.kind === k)?.label} link copied`, { description: k === 'staff' ? 'Anyone with it joins as staff — just a name, no account.' : url(k) });
  };

  return (
    <div className="flex h-9 w-full items-stretch overflow-hidden rounded-[10px] bg-[#17150f] text-white shadow-[0_1px_2px_rgb(23_21_15/.18)]">
      <button type="button" onClick={() => void doCopy('staff')}
        className="flex min-w-0 flex-1 items-center gap-2 whitespace-nowrap px-3 text-[13px] font-semibold transition-[background-color,transform] active:scale-[.98] hover:bg-white/10"
        aria-label="Copy the staff invite link">
        {copied === 'staff' ? <Check size={15} strokeWidth={2.25} className="shrink-0" /> : <Link2 size={15} strokeWidth={2} className="shrink-0" />}
        <span className="truncate">{copied === 'staff' ? 'Link copied' : 'Copy invite link'}</span>
      </button>
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className="grid w-8 place-items-center border-l border-white/15 transition-colors hover:bg-white/10" aria-label="All invite links and QR codes">
            <ChevronDown size={15} strokeWidth={2} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={8} className="w-[340px] p-3">
          <div className="flex gap-3">
            <div className="shrink-0 rounded-[10px] bg-white p-2 shadow-[inset_0_0_0_.5px_rgb(23_21_15/.15)]">
              <QRCodeSVG value={url(qr)} size={112} level="M" fgColor="#17150f" bgColor="#ffffff" />
            </div>
            <div className="min-w-0 pt-1">
              <div className="text-[13px] font-semibold text-fg">Scan to join · {LINKS.find((l) => l.kind === qr)?.label}</div>
              <div className="mt-1 text-[12px] leading-[17px] text-fg-2">{LINKS.find((l) => l.kind === qr)?.hint}</div>
              <div className="mt-2 font-mono text-[12px] tracking-[.14em] text-fg-3">CODE {joinCode}</div>
            </div>
          </div>
          <div className="mt-3 divide-y divide-[rgb(23_21_15/.08)] rounded-[10px] shadow-[inset_0_0_0_.5px_rgb(23_21_15/.12)]">
            {LINKS.map((l) => (
              <div key={l.kind} className={cn('flex items-center gap-2 px-3 py-2', qr === l.kind && 'bg-[rgb(23_21_15/.03)]')}>
                <button type="button" onClick={() => setQr(l.kind)} className="min-w-0 flex-1 text-left">
                  <div className="text-[13px] font-medium text-fg">{l.label}</div>
                  <div className="truncate text-[11.5px] text-fg-3">{l.hint}</div>
                </button>
                <button type="button" onClick={() => void doCopy(l.kind)}
                  className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12px] font-medium text-fg shadow-[inset_0_0_0_.5px_rgb(23_21_15/.2)] transition-transform active:scale-[.96] hover:bg-[rgb(23_21_15/.04)]">
                  {copied === l.kind ? <Check size={13} strokeWidth={2.25} /> : <Link2 size={13} strokeWidth={2} />}{copied === l.kind ? 'Copied' : 'Copy'}
                </button>
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
