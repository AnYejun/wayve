// /setup — create an event (signed-in organizers). Event settings live in the app shell: /e/:eventId/settings.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { motion } from 'motion/react';
import { ArrowRight, Check } from 'lucide-react';
import { toast } from 'sonner';
import type { VenueTemplate } from '@shared/contracts';
import { API, HttpError } from '@/lib/api';
import { rise, spring } from '@/design/motion';
import { Logo } from '@/design/Logo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { VenueMap } from '@/components/VenueMap';
import { AccountMenu } from '@/components/ops/AccountMenu';
import { PresetPicker } from '@/components/install/PresetPicker';
import { cn } from '@/lib/utils';

export default function SetupPage() {
  return <CreateEvent />;
}

// ── create ───────────────────────────────────────────────────────────────────────────────────────────────────────────
function CreateEvent() {
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [templates, setTemplates] = useState<VenueTemplate[] | null>(null);
  const [tpl, setTpl] = useState('startup-branch');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    API.authMe().then((a) => { if (!a.user) nav('/login?next=/setup', { replace: true }); }).catch(() => nav('/login?next=/setup', { replace: true }));
    API.templates().then((r) => setTemplates(r.templates)).catch(() => setTemplates([]));
  }, [nav]);
  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const r = await API.createEvent({ name: name.trim(), templateId: tpl });
      nav(`/e/${r.event.id}/dashboard`);
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) nav('/login?next=/setup');
      else toast.error((e as Error).message);
    } finally { setBusy(false); }
  };
  return (
    <div className="min-h-dvh bg-canvas">
      <TopBar />
      <main className="mx-auto max-w-[880px] px-5 pt-12 pb-24">
        <motion.h1 initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={spring.gentle} className="text-[40px] leading-[1.08] font-semibold tracking-[-0.035em] text-fg">New event</motion.h1>
        <p className="mt-2 text-[16px] text-fg-2">Name it and pick where it happens — your real venue with its install plan, or a generic layout you can replace with a floor plan.</p>
        <label className="mt-8 block text-[13px] font-semibold text-fg">Event name</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="c0mpiled-17: Seoul" className="mt-2 h-12 text-[16px]" autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter') void create(); }} />
        <p className="mt-8 text-[13px] font-semibold text-fg">Venue</p>
        <div className="mt-3"><PresetPicker selected={tpl} onSelect={setTpl} /></div>
        <p className="mt-7 text-[13px] font-semibold text-fg">Or a generic layout</p>
        <motion.div className="mt-3 grid gap-3 sm:grid-cols-3" initial="initial" animate="animate" variants={{ animate: { transition: { staggerChildren: 0.05 } } }}>
          {templates === null ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-[190px] rounded-[16px]" />) : templates.filter((t) => !t.map).map((t) => (
            <motion.button key={t.id} type="button" variants={rise} whileTap={{ scale: 0.98 }} onClick={() => setTpl(t.id)}
              className={cn('rounded-[16px] border bg-white p-3 text-left', tpl === t.id ? 'border-[#17150f] shadow-[0_0_0_1px_#17150f]' : 'border-[rgb(23_21_15/.1)] hover:border-[rgb(23_21_15/.25)]')}>
              <VenueMap zones={t.zones.map((z, i) => ({ id: `t${i}`, name: z.name, polygon: z.polygon }))} mode="preview" compact />
              <span className="mt-2.5 flex items-center gap-1.5 text-[15px] font-semibold text-fg">{tpl === t.id ? <Check className="size-4" /> : null}{t.name}</span>
              <span className="mt-0.5 block text-[12px] leading-[17px] text-fg-2">{t.description}</span>
            </motion.button>
          ))}
        </motion.div>
        <Button size="lg" shape="pill" className="mt-8 h-12 px-6 text-[15px]" disabled={!name.trim() || busy} onClick={() => void create()}>
          {busy ? 'Creating…' : 'Create event'}<ArrowRight />
        </Button>
      </main>
    </div>
  );
}

function TopBar({ children }: { children?: React.ReactNode }) {
  return (
    <header className="mat-bar sticky top-0 z-30 border-b border-[rgb(23_21_15/.08)]">
      <div className="mx-auto flex h-14 max-w-[1280px] items-center gap-3 px-5">
        <Link to="/" aria-label="Home"><Logo size={18} /></Link>
        {children}
        <div className="ml-auto"><AccountMenu /></div>
      </div>
    </header>
  );
}

