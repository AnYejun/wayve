// More: assistant, profile, settings (radio auto-play, haptics), scribe hint, sign out.
import { motion } from 'motion/react';
import { AudioLines, ChevronRight, LogOut, Mic, QrCode, UserRound, Vibrate, Volume2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { rise, stagger } from '@/design/motion';
import { Switch } from '@/components/ui/switch';
import { CARD } from '../common';
import { LargeTitle, type Prefs } from './shell';

function Row({ icon, label, sub, right, onClick, danger }: { icon: ReactNode; label: string; sub?: string; right?: ReactNode; onClick?: () => void; danger?: boolean }) {
  const C = onClick ? 'button' : 'div';
  return (
    <C type={onClick ? 'button' : undefined} onClick={onClick} className="flex min-h-[58px] w-full items-center gap-3 px-4 py-2 text-left active:bg-[rgb(23_21_15/.04)]">
      <span className={cn('grid size-9 shrink-0 place-items-center rounded-[10px] [&_svg]:size-[18px]', danger ? 'bg-[#fdecec] text-[#b91c1c]' : 'bg-[rgb(23_21_15/.05)] text-fg')}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className={cn('block text-[16px] font-medium', danger ? 'text-[#b91c1c]' : 'text-fg')}>{label}</span>
        {sub ? <span className="block text-[13px] leading-[18px] text-fg-3">{sub}</span> : null}
      </span>
      {right ?? (onClick ? <ChevronRight className="size-4 text-fg-3" strokeWidth={1.75} /> : null)}
    </C>
  );
}
const Sep = () => <span className="block h-px origin-top scale-y-50 bg-[rgb(23_21_15/.16)] ml-16" aria-hidden />;

export function MoreTab({ name, teamName, prefs, setPrefs, onAssistant, onProfile, onSignOut, signedIn }: {
  name: string; teamName: string | null; prefs: Prefs; setPrefs: (p: Partial<Prefs>) => void;
  onAssistant: () => void; onProfile: () => void; onSignOut: () => void; signedIn: boolean;
}) {
  return (
    <motion.div variants={stagger()} initial="initial" animate="animate" className="flex flex-col gap-5">
      <LargeTitle title="More" />
      <motion.div variants={rise} className={cn(CARD, 'overflow-hidden')}>
        <Row icon={<AudioLines />} label="Assistant" sub="Ask or tell it anything — by voice or text." onClick={onAssistant} />
      </motion.div>
      <motion.div variants={rise} className={cn(CARD, 'overflow-hidden')}>
        <Row icon={<UserRound />} label={name} sub={`${teamName ?? 'No team'} · the name people call you in meetings`} onClick={onProfile} />
      </motion.div>
      <motion.div variants={rise} className={cn(CARD, 'overflow-hidden')}>
        <Row icon={<Volume2 />} label="Auto-play radio" sub="Play clips for you as they arrive on the Radio tab."
          right={<Switch checked={prefs.autoplay} onCheckedChange={(v) => setPrefs({ autoplay: v })} aria-label="Auto-play radio" />} />
        <Sep />
        <Row icon={<Vibrate />} label="Haptics" right={<Switch checked={prefs.haptics} onCheckedChange={(v) => setPrefs({ haptics: v })} aria-label="Haptics" />} />
      </motion.div>
      <motion.div variants={rise} className={cn(CARD, 'overflow-hidden')}>
        <Row icon={<Mic />} label="Use a phone as a meeting scribe" sub="Scan your team's 'Meeting scribe' QR on another phone and leave it on the table. Tasks from the meeting land here." />
      </motion.div>
      {signedIn ? (
        <motion.div variants={rise} className={cn(CARD, 'overflow-hidden')}>
          <Row icon={<LogOut />} label="Sign out" danger onClick={onSignOut} />
        </motion.div>
      ) : (
        <motion.div variants={rise} className={cn(CARD, 'overflow-hidden')}>
          <Row icon={<QrCode />} label="Joined with the staff QR" sub="No account needed. To switch events, scan another event's staff QR on this phone." />
        </motion.div>
      )}
    </motion.div>
  );
}
