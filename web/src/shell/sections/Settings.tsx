// Settings: map & zones, teams, cameras, knowledge and invite QRs — inside the shell, as tabs.
import { useState } from 'react';
import { motion } from 'motion/react';
import { BookOpen, Camera, Grid3x3, QrCode, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import type { Device, ZoneSuggestion } from '@shared/contracts';
import { MapSource } from '@/components/map/MapSource';
import { ZoneEditor } from '@/components/map/ZoneEditor';
import { CameraCalibration } from '@/components/map/CameraCalibration';
import { Invite, Knowledge, Teams } from '@/components/ops/SetupParts';
import { PeopleInvites } from '@/components/invite/PeopleInvites';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { spring } from '@/design/motion';
import { cn } from '@/lib/utils';
import { useShell } from '../context';
import { Page, SectionHeader } from '../ui';

const TABS = [
  { id: 'map', label: 'Map & zones', icon: Grid3x3 },
  { id: 'teams', label: 'Teams', icon: Users },
  { id: 'cameras', label: 'Cameras', icon: Camera },
  { id: 'knowledge', label: 'Knowledge', icon: BookOpen },
  { id: 'people', label: 'People & invites', icon: UserPlus },
  { id: 'invite', label: 'Devices & attendees', icon: QrCode },
] as const;
type Tab = (typeof TABS)[number]['id'];

const SUB: Record<Tab, string> = {
  map: 'Start from a blank canvas or your floor plan, then draw the zones you want tracked. Drag devices to where they really are.',
  teams: 'Radio channels and ownership. People pick their team when they join.',
  cameras: 'One camera can watch several zones. Draw what it sees once — every frame is then read zone by zone.',
  knowledge: 'Run of show, FAQ, contacts, venue notes. The staff assistant reads this for every answer.',
  people: 'Invite organizers and staff with a link, a code or their username. They join in one tap.',
  invite: 'QR codes for cameras, meeting scribes and attendees — print them and place them. No account needed.',
};

export default function SettingsSection() {
  const { snap, eventId } = useShell();
  const [tab, setTab] = useState<Tab>(() => {
    const t = new URLSearchParams(location.search).get('tab');
    return (TABS.some((x) => x.id === t) ? t : 'map') as Tab;
  });
  const [pending, setPending] = useState<ZoneSuggestion[] | null>(null);
  if (!snap) return <Page><Skeleton className="h-9 w-40" /><Skeleton className="mt-6 h-[480px] w-full rounded-[14px]" /></Page>;
  if (snap.me.role !== 'admin') return <Page><SectionHeader title="Settings" sub="Only organizers can change event settings." /></Page>;
  const moveDevice = (id: string, position: [number, number]) => {
    api<{ device: Device }>(`/api/devices/${id}/position`, { method: 'PUT', body: { position } }).catch((e) => toast.error((e as Error).message));
  };
  return (
    <Page>
      <SectionHeader title="Settings" sub={SUB[tab]} />
      <div className="mt-5 flex flex-wrap gap-1 border-b border-[rgb(23_21_15/.08)]" role="tablist">
        {TABS.map((t) => {
          const I = t.icon;
          const on = tab === t.id;
          return (
            <button key={t.id} type="button" role="tab" aria-selected={on} onClick={() => setTab(t.id)}
              className={cn('relative flex h-10 items-center gap-2 px-3 text-[14px] font-medium', on ? 'text-fg' : 'text-fg-2 hover:text-fg')}>
              <I size={16} strokeWidth={1.75} />{t.label}
              {on ? <motion.span layoutId="settings-tab" transition={spring.smooth} className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-[#17150f]" /> : null}
            </button>
          );
        })}
      </div>
      <motion.div key={tab} className="mt-6" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={spring.smooth}>
        {tab === 'map' && (
          <div className="space-y-6">
            <MapSource eventId={eventId} map={snap.event.map} zones={snap.zones} onBlank={() => undefined} onAccept={(s) => setPending(s)} />
            <ZoneEditor eventId={eventId} map={snap.event.map} zones={snap.zones} devices={snap.devices} pending={pending} onPendingConsumed={() => setPending(null)} onDeviceMove={moveDevice} />
          </div>
        )}
        {tab === 'teams' && <Teams snap={snap} />}
        {tab === 'cameras' && <CameraCalibration devices={snap.devices} zones={snap.zones} />}
        {tab === 'knowledge' && <Knowledge eventId={eventId} />}
        {tab === 'people' && <PeopleInvites snap={snap} eventId={eventId} />}
        {tab === 'invite' && <Invite snap={snap} />}
      </motion.div>
    </Page>
  );
}
