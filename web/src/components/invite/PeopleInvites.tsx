// Settings → People & invites: create a link (role · team · uses · expiry) → copy / QR / share; active links with revoke;
// members table (role, team, last seen, online) with "Add by username".
import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { QRCodeSVG } from 'qrcode.react';
import { Check, Copy, Link2, Loader2, Share2, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import type { InviteInfo, InviteRole, Member, Snapshot } from '@shared/contracts';
import type { HttpError } from '@/lib/api';
import { ago, useNow } from '@/lib/time';
import { spring } from '@/design/motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Monogram } from '@/components/ops/Person';
import { cn } from '@/lib/utils';
import { InviteAPI } from './api';

const card = 'rounded-[16px] border border-[rgb(23_21_15/.1)] bg-white';
const EXPIRY = [{ h: 24, label: '24 hours' }, { h: 72, label: '3 days' }, { h: 24 * 7, label: '7 days' }] as const;

function Segmented<T extends string>({ value, onChange, options, id }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string }>; id: string }) {
  return (
    <div className="inline-flex rounded-[10px] bg-[#f3f2ef] p-[3px]" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={cn('relative h-8 rounded-[8px] px-3 text-[13px] font-medium', value === o.value ? 'text-fg' : 'text-fg-2 hover:text-fg')}>
          {value === o.value ? <motion.span layoutId={`seg-${id}`} transition={spring.snappy} className="absolute inset-0 rounded-[8px] bg-white shadow-[0_1px_2px_rgb(23_21_15/.08),0_0_0_.5px_rgb(23_21_15/.08)]" /> : null}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function PeopleInvites({ snap, eventId }: { snap: Snapshot; eventId: string }) {
  const now = useNow(15_000);
  const [role, setRole] = useState<InviteRole>('staff');
  const [teamId, setTeamId] = useState<string>('');
  const [uses, setUses] = useState<number>(50);
  const [hours, setHours] = useState<number>(24);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<{ url: string; invite: InviteInfo } | null>(null);
  const [copied, setCopied] = useState(false);
  const [invites, setInvites] = useState<InviteInfo[] | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [username, setUsername] = useState('');
  const [addRole, setAddRole] = useState<InviteRole>('staff');
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    InviteAPI.list(eventId).then((r) => setInvites(r.invites)).catch(() => setInvites([]));
    InviteAPI.members(eventId).then((r) => setMembers(r.members)).catch(() => setMembers([]));
  }, [eventId]);
  useEffect(() => { load(); }, [load]);
  // People join live: refresh the members list when the participants in the snapshot change.
  const pCount = snap.participants.filter((p) => p.role === 'staff' || p.role === 'admin').length;
  useEffect(() => { if (members && members.length !== pCount) load(); }, [pCount]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async () => {
    setBusy(true);
    try {
      const r = await InviteAPI.create(eventId, { role, teamId: teamId || null, maxUses: uses, expiresInHours: hours });
      setLink(r); setCopied(false);
      setInvites((cur) => [r.invite, ...(cur ?? [])]);
    } catch (e) { toast.error((e as HttpError).message); } finally { setBusy(false); }
  };
  const copy = async () => {
    if (!link) return;
    try { await navigator.clipboard.writeText(link.url); setCopied(true); toast.success('Invite link copied'); setTimeout(() => setCopied(false), 1600); } catch { toast.error('Couldn’t copy — select the link instead.'); }
  };
  const share = async () => {
    if (!link) return;
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share) await nav.share({ title: `Join ${snap.event.name} on WAYVE`, text: `You're invited to ${snap.event.name}.`, url: link.url }).catch(() => undefined);
    else void copy();
  };
  const revoke = async (inv: InviteInfo) => {
    setInvites((cur) => cur?.map((x) => (x.id === inv.id ? { ...x, status: 'revoked' } : x)) ?? null);
    if (link?.invite.id === inv.id) setLink(null);
    await InviteAPI.revoke(inv.id).catch((e) => toast.error((e as HttpError).message));
  };
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (username.trim().length < 3) return;
    setAdding(true);
    try {
      const r = await InviteAPI.addMember(eventId, { username: username.trim().toLowerCase().replace(/^@/, ''), role: addRole });
      toast.success(`${r.member.displayName} added`, { description: 'They’ll see this event in their list right away.' });
      setUsername(''); load();
    } catch (e2) { toast.error((e2 as HttpError).message); } finally { setAdding(false); }
  };

  const active = (invites ?? []).filter((i) => i.status === 'active');
  const inactive = (invites ?? []).filter((i) => i.status !== 'active').slice(0, 5);
  const teamName = (id: string | null) => snap.teams.find((t) => t.id === id)?.name ?? null;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      {/* ── invite link ── */}
      <section className={cn(card, 'p-5')}>
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-[10px] bg-[#f3f2ef]"><Link2 className="size-[18px]" strokeWidth={1.75} /></span>
          <div>
            <h3 className="text-[16px] font-semibold text-fg">Invite link</h3>
            <p className="text-[13px] text-fg-2">Anyone with the link joins in one tap after signing in.</p>
          </div>
        </div>
        <div className="mt-5 space-y-4">
          <Row label="Role"><Segmented id="role" value={role} onChange={setRole} options={[{ value: 'staff', label: 'Staff' }, { value: 'admin', label: 'Organizer' }]} /></Row>
          <Row label="Team">
            <select value={teamId} onChange={(e) => setTeamId(e.target.value)} className="h-9 min-w-[180px] rounded-[10px] border border-[rgb(23_21_15/.14)] bg-white px-3 text-[14px]">
              <option value="">They pick when they join</option>
              {snap.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Row>
          <Row label="Limit">
            <div className="flex flex-wrap items-center gap-2">
              <Segmented id="uses" value={String(uses) as '1' | '10' | '50'} onChange={(v) => setUses(Number(v))} options={[{ value: '1', label: '1 person' }, { value: '10', label: '10' }, { value: '50', label: '50' }]} />
              <Segmented id="exp" value={String(hours) as '24'} onChange={(v) => setHours(Number(v))} options={EXPIRY.map((e) => ({ value: String(e.h) as '24', label: e.label }))} />
            </div>
          </Row>
          <Button className="h-10 w-full rounded-[12px]" onClick={() => void create()} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Link2 />}Create invite link</Button>
        </div>
        <AnimatePresence>
          {link ? (
            <motion.div initial={{ opacity: 0, y: 8, height: 0 }} animate={{ opacity: 1, y: 0, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={spring.smooth} className="overflow-hidden">
              <div className="mt-5 flex gap-4 rounded-[14px] bg-[#fafaf9] p-4 shadow-[inset_0_0_0_.5px_rgb(23_21_15/.1)]">
                <div className="shrink-0 rounded-[10px] bg-white p-1.5 shadow-[0_0_0_.5px_rgb(23_21_15/.12)]"><QRCodeSVG value={link.url} size={104} level="M" /></div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-fg">{link.invite.role === 'admin' ? 'Organizer' : 'Staff'}{link.invite.teamName ? ` · ${link.invite.teamName}` : ''}</p>
                  <p className="mt-0.5 text-[12px] text-fg-3">Up to {link.invite.maxUses} {link.invite.maxUses === 1 ? 'person' : 'people'} · expires {link.invite.expiresAt ? new Date(link.invite.expiresAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'never'}</p>
                  <button type="button" onClick={() => void copy()} className="mt-2.5 flex w-full items-center gap-2 rounded-[10px] bg-white px-3 py-2 text-left shadow-[inset_0_0_0_1px_rgb(23_21_15/.1)]">
                    <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-fg-2">{link.url}</span>
                    {copied ? <Check className="size-4 text-[#376c45]" /> : <Copy className="size-4 text-fg-3" />}
                  </button>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" onClick={() => void copy()}>{copied ? <Check /> : <Copy />}{copied ? 'Copied' : 'Copy link'}</Button>
                    <Button size="sm" variant="outline" onClick={() => void share()}><Share2 />Share</Button>
                  </div>
                </div>
              </div>
              <p className="mt-2 text-[12px] text-fg-3">The link is shown once. Create another anytime.</p>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <div className="mt-6">
          <p className="text-[12px] font-semibold tracking-[.06em] text-fg-3 uppercase">Active links</p>
          {invites === null ? <div className="mt-3 h-10 animate-pulse rounded-[10px] bg-[#f3f2ef]" /> : active.length === 0 ? (
            <p className="mt-2 text-[13px] text-fg-3">No active links.</p>
          ) : (
            <ul className="mt-2 divide-y divide-[rgb(23_21_15/.06)]">
              <AnimatePresence initial={false}>
                {active.map((i) => (
                  <motion.li key={i.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring.smooth} className="flex items-center gap-3 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-medium text-fg">{i.role === 'admin' ? 'Organizer' : 'Staff'}{i.teamName ? ` · ${i.teamName}` : ''}</span>
                      <span className="block text-[12px] text-fg-3 tabular-nums">{i.uses}/{i.maxUses ?? '∞'} joined · created {ago(i.createdAt, now)}{i.createdBy ? ` by ${i.createdBy}` : ''}</span>
                    </span>
                    <Button size="xs" variant="ghost" onClick={() => void revoke(i)}><X />Revoke</Button>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
          {inactive.length ? <p className="mt-2 text-[12px] text-fg-3">{inactive.length} expired or revoked</p> : null}
        </div>
      </section>

      {/* ── members ── */}
      <section className={cn(card, 'p-5')}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-[16px] font-semibold text-fg">People <span className="font-normal text-fg-3 tabular-nums">{members?.length ?? ''}</span></h3>
            <p className="text-[13px] text-fg-2">Everyone in this event.</p>
          </div>
          <form onSubmit={add} className="flex items-center gap-2">
            <Input value={username} onChange={(e) => setUsername(e.target.value.replace(/\s/g, ''))} placeholder="Add by username" aria-label="Username to add" className="h-9 w-[170px] text-[14px]" />
            <select value={addRole} onChange={(e) => setAddRole(e.target.value as InviteRole)} aria-label="Role" className="h-9 rounded-[10px] border border-[rgb(23_21_15/.14)] bg-white px-2 text-[13px]">
              <option value="staff">Staff</option><option value="admin">Organizer</option>
            </select>
            <Button size="sm" type="submit" disabled={adding || username.trim().length < 3}>{adding ? <Loader2 className="animate-spin" /> : <UserPlus />}Add</Button>
          </form>
        </div>
        <div className="mt-4 overflow-hidden rounded-[12px] border border-[rgb(23_21_15/.08)]">
          <table className="w-full text-[13px]">
            <thead className="bg-[#fafaf9] text-left text-[12px] text-fg-3">
              <tr><th className="px-3 py-2 font-medium">Name</th><th className="px-3 py-2 font-medium">Role</th><th className="px-3 py-2 font-medium">Team</th><th className="px-3 py-2 text-right font-medium">Last seen</th></tr>
            </thead>
            <tbody>
              {members === null ? (
                <tr><td colSpan={4} className="px-3 py-6"><div className="h-6 animate-pulse rounded bg-[#f3f2ef]" /></td></tr>
              ) : members.length === 0 ? (
                <tr><td colSpan={4} className="px-3 py-8 text-center text-fg-3">No one yet — share an invite link.</td></tr>
              ) : (
                <AnimatePresence initial={false}>
                  {members.map((m) => (
                    <motion.tr key={m.participantId} layout initial={{ opacity: 0, backgroundColor: 'rgba(255,214,153,.35)' }} animate={{ opacity: 1, backgroundColor: 'rgba(255,214,153,0)' }} transition={{ duration: 1.2 }}
                      className="border-t border-[rgb(23_21_15/.06)]">
                      <td className="px-3 py-2.5">
                        <span className="flex items-center gap-2.5">
                          <span className="relative"><Monogram name={m.displayName} size={28} ink={m.role === 'admin'} />
                            <span className={cn('absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-white', m.online ? 'bg-[#58a069]' : 'bg-[#c7c6c1]')} aria-label={m.online ? 'Online' : 'Offline'} />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-fg">{m.displayName}</span>
                            {m.username ? <span className="block truncate text-[12px] text-fg-3">@{m.username}</span> : null}
                          </span>
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-fg-2">{m.role === 'admin' ? 'Organizer' : 'Staff'}</td>
                      <td className="px-3 py-2.5 text-fg-2">{m.teamName ?? teamName(m.teamId) ?? '—'}</td>
                      <td className="px-3 py-2.5 text-right text-fg-3 tabular-nums">{m.online ? <span className="text-[#376c45]">Online</span> : ago(m.lastSeenAt, now)}</td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="w-14 text-[13px] font-medium text-fg-2">{label}</span>
      {children}
    </div>
  );
}
