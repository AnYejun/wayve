// Radio (walkie-talkie) helpers shared by the desktop Radio section and the phone Radio tab.
import { DEVICE_OFFLINE_MS, ESCALATE_AFTER_MS, type Me, type Participant, type Snapshot, type TalkMessage } from '@shared/contracts';

export function isForMe(m: TalkMessage, me: Me, myTeamId: string | null) {
  if (m.fromId === me.participantId) return false;
  return m.expected.includes(me.participantId) || m.to.type === 'all'
    || (m.to.type === 'team' && !!myTeamId && m.to.id === myTeamId)
    || (m.to.type === 'person' && m.to.id === me.participantId)
    || (m.to.type === 'hq' && me.role === 'admin');
}
export const ackedBy = (m: TalkMessage, pid: string) => m.acks.find((a) => a.participantId === pid);
export function unackedCount(snap: Snapshot | null, me: Me, myTeamId: string | null) {
  return snap ? snap.messages.filter((m) => isForMe(m, me, myTeamId) && !ackedBy(m, me.participantId)).length : 0;
}
/** Expected listeners excluding the sender, and who of them acked. */
export function heard(m: TalkMessage) {
  const expected = m.expected.filter((x) => x !== m.fromId);
  const acks = m.acks.filter((a) => expected.includes(a.participantId));
  return { expected, acks };
}
export const isOverdue = (m: TalkMessage, now: number) => { const h = heard(m); return h.acks.length < h.expected.length && now - m.createdAt > ESCALATE_AFTER_MS; };
export const personOnline = (p: Participant, now: number) => now - p.lastSeenAt < DEVICE_OFFLINE_MS;
export const initials = (name: string) => {
  const t = name.trim();
  if (!t) return '?';
  const parts = t.split(/\s+/);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : t.slice(0, 2)).toUpperCase();
};

/** A channel = a view of the radio log + the default send target. */
export type Channel =
  | { key: 'all-traffic'; label: string; to: 'all' }
  | { key: 'hq'; label: string; to: 'hq' }
  | { key: 'all'; label: string; to: 'all' }
  | { key: `team:${string}`; label: string; to: `team:${string}` }
  | { key: `person:${string}`; label: string; to: `person:${string}` };

export function messageInChannel(m: TalkMessage, ch: Channel, meId: string): boolean {
  if (ch.key === 'all-traffic') return true;
  if (ch.key === 'hq') return m.to.type === 'hq';
  if (ch.key === 'all') return m.to.type === 'all';
  if (ch.key.startsWith('team:')) return m.to.type === 'team' && m.to.id === ch.key.slice(5);
  const pid = ch.key.slice(7);
  return m.to.type === 'person' && ((m.to.id === pid && m.fromId === meId) || (m.to.id === meId && m.fromId === pid));
}
