// /scan/:eventId — informational: venue maps are drawn by organizers on the dashboard (floor plan or canvas).
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { motion } from 'motion/react';
import { Camera, LayoutGrid, Monitor } from 'lucide-react';
import { API } from '@/lib/api';
import { rise, spring, stagger } from '@/design/motion';
import { Logo } from '@/design/Logo';
import { CARD, Pill } from '@/components/phone/common';
import { cn } from '@/lib/utils';

export default function ScanPage() {
  const { eventId = '' } = useParams();
  const navigate = useNavigate();
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    API.authMe().then((a) => setAdmin(a.events.some((e) => e.event.id === eventId && e.role === 'admin'))).catch(() => {});
  }, [eventId]);
  const steps = [
    { Icon: LayoutGrid, title: 'Draw the venue', body: 'Upload a floor plan or sketch zones on the canvas — on your laptop.' },
    { Icon: Camera, title: 'Point the cameras', body: 'A phone watches one zone, or several once you outline them on its view.' },
    { Icon: Monitor, title: 'Watch it live', body: 'Every zone updates on the map and in the zone table as things change.' },
  ];
  return (
    <div className="flex min-h-dvh flex-col bg-canvas px-5 pt-[calc(var(--safe-t)+18px)] pb-[calc(var(--safe-b)+24px)]">
      <div className="flex h-8 items-center"><Logo size={20} /></div>
      <motion.div variants={stagger(0.06)} initial="initial" animate="animate" className="mx-auto mt-10 flex w-full max-w-[420px] flex-1 flex-col">
        <motion.h1 variants={rise} className="text-[32px] leading-[38px] font-bold tracking-[-0.03em] text-fg">Maps are drawn on the dashboard</motion.h1>
        <motion.p variants={rise} className="mt-2 text-[16px] leading-[24px] text-fg-2">Organizers lay out the venue once on a laptop. Phones then keep every zone live.</motion.p>
        <motion.ol variants={stagger(0.06, 0.1)} className={cn(CARD, 'mt-7 overflow-hidden')}>
          {steps.map(({ Icon, title, body }, i) => (
            <motion.li key={title} variants={rise} className="relative flex gap-3.5 px-4 py-4">
              {i > 0 ? <span className="absolute top-0 right-0 left-16 h-px origin-top scale-y-50 bg-[rgb(23_21_15/.16)]" aria-hidden /> : null}
              <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-[rgb(23_21_15/.05)] text-fg"><Icon className="size-5" strokeWidth={1.75} /></span>
              <span><span className="block text-[16px] font-semibold text-fg">{title}</span><span className="mt-0.5 block text-[14px] leading-5 text-fg-2">{body}</span></span>
            </motion.li>
          ))}
        </motion.ol>
        <motion.div variants={rise} className="mt-auto flex flex-col gap-2.5 pt-8">
          {admin ? (
            <motion.div whileTap={{ scale: 0.97 }} transition={spring.snappy}>
              <Pill className="w-full" onClick={() => navigate(`/setup/${eventId}`)}>Open the map editor</Pill>
            </motion.div>
          ) : null}
          <Pill tone="paper" className="w-full" onClick={() => navigate('/staff')}>Back to the staff app</Pill>
        </motion.div>
      </motion.div>
    </div>
  );
}
