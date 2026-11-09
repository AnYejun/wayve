// "/" — signed out: hero + sign in. Signed in: your events.
import { useState } from 'react';
import { Link } from 'react-router';
import { motion } from 'motion/react';
import { ArrowRight, Camera, ClipboardList, LogIn, Mic, Plus, Radio } from 'lucide-react';
import { JoinByCodeDialog, JoinByCodeForm } from '@/components/invite/JoinByCode';
import { Logo } from '@/design/Logo';
import { rise, spring } from '@/design/motion';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AccountMenu, statusPill, useAuth } from '@/components/ops/AccountMenu';

export default function HomePage() {
  const auth = useAuth();
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="mat-bar sticky top-0 z-30 border-b border-[rgb(23_21_15/.08)]">
        <div className="mx-auto flex h-14 max-w-[1120px] items-center px-5">
          <Logo size={18} />
          <div className="ml-auto flex items-center gap-2">
            {auth && !auth.user ? <Button asChild variant="ghost" size="sm"><Link to="/signup">Create account</Link></Button> : null}
            <AccountMenu />
          </div>
        </div>
      </header>
      {auth === null ? (
        <div className="mx-auto max-w-[1120px] px-5 pt-16"><Skeleton className="h-12 w-96" /><Skeleton className="mt-4 h-6 w-[520px]" /></div>
      ) : auth.user ? <Events auth={auth} /> : <Hero />}
    </div>
  );
}

function Hero() {
  const [join, setJoin] = useState(false);
  const feats = [
    { icon: Mic, title: 'Meetings, transcribed', body: 'A phone on the table turns decisions and “can you…” into assigned tasks.' },
    { icon: Radio, title: 'Radio that remembers', body: 'Push to talk. Everyone hears it, everything is logged and acknowledged.' },
    { icon: Camera, title: 'Eyes on every zone', body: 'Cameras read crowds per zone on your real floor plan.' },
    { icon: ClipboardList, title: 'One live tracker', body: 'Field reports with photos become issues HQ can see, ask about and close.' },
  ];
  return (
    <main className="mx-auto max-w-[1120px] px-5 pt-20 pb-24">
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-[13px] font-semibold tracking-[.14em] text-fg-3 uppercase">Live event operations</motion.p>
      <motion.h1 initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={spring.gentle}
        className="mt-4 max-w-[820px] text-[56px] leading-[1.02] font-semibold tracking-[-0.045em] text-fg sm:text-[72px]">
        Every phone at your event becomes a live sensor.
      </motion.h1>
      <motion.p initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.gentle, delay: 0.06 }} className="mt-6 max-w-[620px] text-[19px] leading-[1.5] text-fg-2">
        Stop running a festival on phone calls. WAYVE listens, sees and keeps score — so HQ always knows what’s happening, where, and who’s on it.
      </motion.p>
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.gentle, delay: 0.12 }} className="mt-9 flex flex-wrap gap-3">
        <Button asChild size="lg" shape="pill" className="h-12 px-6 text-[15px]"><Link to="/signup">Get started<ArrowRight /></Link></Button>
        <Button asChild size="lg" shape="pill" variant="outline" className="h-12 px-6 text-[15px]"><Link to="/login">Sign in</Link></Button>
        <Button size="lg" shape="pill" variant="ghost" className="h-12 px-5 text-[15px]" onClick={() => setJoin(true)}><LogIn />Join with a code</Button>
      </motion.div>
      <JoinByCodeDialog open={join} onOpenChange={setJoin} />
      <motion.div className="mt-20 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" initial="initial" animate="animate" variants={{ animate: { transition: { staggerChildren: 0.06, delayChildren: 0.2 } } }}>
        {feats.map((f) => (
          <motion.div key={f.title} variants={rise} className="rounded-[18px] border border-[rgb(23_21_15/.08)] bg-white p-5">
            <span className="grid size-10 place-items-center rounded-[12px] bg-[#f5f4f2]"><f.icon className="size-5" strokeWidth={1.75} /></span>
            <p className="mt-4 text-[16px] font-semibold text-fg">{f.title}</p>
            <p className="mt-1.5 text-[14px] leading-[20px] text-fg-2">{f.body}</p>
          </motion.div>
        ))}
      </motion.div>
    </main>
  );
}

function Events({ auth }: { auth: NonNullable<ReturnType<typeof useAuth>> }) {
  const evs = auth.events;
  const [join, setJoin] = useState(false);
  return (
    <main className="mx-auto max-w-[1120px] px-5 pt-14 pb-24">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <motion.h1 initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={spring.gentle} className="text-[40px] leading-[1.08] font-semibold tracking-[-0.035em] text-fg">
            Your events
          </motion.h1>
          <p className="mt-1.5 text-[16px] text-fg-2">Hi {auth.user!.displayName}. Pick up where you left off.</p>
        </div>
        <div className="ml-auto flex gap-2">
          <Button shape="pill" variant="outline" onClick={() => setJoin(true)}><LogIn />Join an event</Button>
          <Button asChild shape="pill"><Link to="/setup"><Plus />New event</Link></Button>
        </div>
      </div>
      <JoinByCodeDialog open={join} onOpenChange={setJoin} />
      {evs.length === 0 ? (
        <div className="mt-10 grid gap-3 md:grid-cols-2">
          <div className="rounded-[20px] border border-[rgb(23_21_15/.1)] bg-white px-6 py-8">
            <p className="text-[17px] font-semibold text-fg">Joining as staff?</p>
            <p className="mt-1 text-[14px] text-fg-2">Enter the event code from your organizer.</p>
            <div className="mt-5"><JoinByCodeForm /></div>
          </div>
          <div className="flex flex-col items-start justify-center rounded-[20px] border border-dashed border-[rgb(23_21_15/.18)] bg-white px-6 py-8">
            <p className="text-[17px] font-semibold text-fg">Running an event?</p>
            <p className="mt-1 text-[14px] text-fg-2">Create one, add your floor plan, and invite your team with a link.</p>
            <Button asChild shape="pill" className="mt-5"><Link to="/setup"><Plus />Create your first event</Link></Button>
          </div>
        </div>
      ) : (
        <motion.div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" initial="initial" animate="animate" variants={{ animate: { transition: { staggerChildren: 0.04 } } }}>
          {evs.map((e) => (
            <motion.div key={e.event.id} variants={rise} whileHover={{ y: -2 }} whileTap={{ scale: 0.985 }} transition={spring.snappy}>
              <Link to={e.role === 'admin' ? `/e/${e.event.id}/dashboard` : `/staff?event=${e.event.id}`} className="block rounded-[18px] border border-[rgb(23_21_15/.1)] bg-white p-5 hover:border-[rgb(23_21_15/.22)]">
                <div className="flex items-center gap-2">{statusPill(e.status)}<span className="ml-auto text-[12px] font-medium text-fg-3 capitalize">{e.role === 'admin' ? 'Organizer' : e.role}</span></div>
                <p className="mt-4 text-[19px] font-semibold tracking-[-0.015em] text-fg">{e.event.name}</p>
                <p className="mt-1 font-mono text-[12px] tracking-[.14em] text-fg-3">{e.event.joinCode}</p>
                <p className="mt-4 inline-flex items-center gap-1 text-[13px] font-medium text-fg">{e.role === 'admin' ? 'Open ops board' : 'Open staff app'}<ArrowRight className="size-3.5" /></p>
              </Link>
            </motion.div>
          ))}
        </motion.div>
      )}
    </main>
  );
}
