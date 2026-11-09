// /i/:token — the invite card. Signed out → inline account step on the same card → Accept → lands where they'll work.
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, CalendarX2, Check, Link2Off, Loader2, ShieldCheck, Users } from 'lucide-react';
import type { AuthState, InvitePreview } from '@shared/contracts';
import { API, type HttpError } from '@/lib/api';
import { spring } from '@/design/motion';
import { Logo } from '@/design/Logo';
import { Button } from '@/components/ui/button';
import { Monogram } from '@/components/ops/Person';
import { AuthInline } from '@/components/invite/AuthInline';
import { NameInline } from '@/components/invite/NameInline';
import { InviteAPI, landingFor } from '@/components/invite/api';

export default function InvitePage() {
  const { token = '' } = useParams();
  const nav = useNavigate();
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);

  const load = useCallback(() => {
    InviteAPI.preview(token).then(setPreview).catch(() => setPreview({ valid: false, status: 'not_found', eventId: null, eventName: null, role: null, teamName: null, inviterName: null, expiresAt: null, alreadyMember: false }));
    API.authMe().then(setAuth).catch(() => setAuth({ user: null, events: [] }));
  }, [token]);
  useEffect(() => { load(); }, [load]);

  // Staff invites work with just a name (QR-only, no account); organizer invites need an account.
  const [withAccount, setWithAccount] = useState(false);
  const accept = async (name: string | null = null) => {
    setErr(null); setBusy(true);
    try {
      const r = await InviteAPI.accept(token, name);
      setJoined(true);
      navigator.vibrate?.(30);
      setTimeout(() => nav(landingFor(r.eventId, r.role), { replace: true }), 700);
    } catch (e) {
      const he = e as HttpError;
      if (he.code === 'NEEDS_LOGIN') { setAuth({ user: null, events: [] }); setWithAccount(true); }
      else if (he.code === 'NEEDS_NAME') setWithAccount(false);
      else { setErr(he.message); load(); }
    } finally { setBusy(false); }
  };

  const loading = !preview || !auth;
  const roleLabel = preview?.role === 'admin' ? 'Organizer' : 'Staff';
  const dead = preview && !preview.valid && !preview.alreadyMember;

  return (
    <div className="grid min-h-dvh place-items-center bg-[radial-gradient(120%_80%_at_50%_0%,#ffffff_0%,#f5f4f2_70%)] px-5 py-10" style={{ paddingTop: 'max(40px, env(safe-area-inset-top))' }}>
      <motion.div initial={{ opacity: 0, y: 14, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={spring.gentle}
        className="w-full max-w-[420px] rounded-[24px] bg-white p-7 shadow-[0_24px_64px_-24px_rgb(23_21_15/.18),0_0_0_.5px_rgb(23_21_15/.1)]">
        <Link to="/" className="inline-block"><Logo size={18} /></Link>

        {loading ? (
          <div className="mt-8 space-y-3" aria-busy="true">
            <div className="h-14 w-14 animate-pulse rounded-[16px] bg-[#f3f2ef]" />
            <div className="h-7 w-3/4 animate-pulse rounded-[8px] bg-[#f3f2ef]" />
            <div className="h-4 w-1/2 animate-pulse rounded-[6px] bg-[#f3f2ef]" />
          </div>
        ) : dead ? (
          <DeadState status={preview.status} />
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            {joined ? (
              <motion.div key="ok" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={spring.snappy} className="mt-10 mb-4 text-center">
                <motion.span initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={spring.snappy} className="mx-auto grid size-14 place-items-center rounded-full bg-[#eaf5ec] text-[#376c45]"><Check className="size-7" strokeWidth={2.5} /></motion.span>
                <h1 className="mt-4 text-[22px] font-semibold tracking-[-0.02em] text-fg">You’re in</h1>
                <p className="mt-1 text-[14px] text-fg-2">Opening {preview.eventName}…</p>
              </motion.div>
            ) : (
              <motion.div key="card" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <div className="mt-7 flex items-center gap-3">
                  {preview.inviterName ? <Monogram name={preview.inviterName} size={44} ink /> : <span className="grid size-11 place-items-center rounded-full bg-[#f3f2ef]"><Users className="size-5" /></span>}
                  <p className="text-[14px] leading-[20px] text-fg-2">
                    <span className="font-semibold text-fg">{preview.inviterName ?? 'An organizer'}</span> invited you to join
                  </p>
                </div>
                <h1 className="mt-4 text-[28px] leading-[1.15] font-semibold tracking-[-0.03em] text-balance text-fg">{preview.eventName}</h1>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-[#17150f] px-3 text-[13px] font-semibold text-white"><ShieldCheck className="size-3.5" />{roleLabel}</span>
                  {preview.teamName ? <span className="inline-flex h-7 items-center rounded-full bg-[#f3f2ef] px-3 text-[13px] font-medium text-fg">{preview.teamName} team</span> : null}
                  {preview.expiresAt ? <span className="inline-flex h-7 items-center rounded-full px-1 text-[12px] text-fg-3">Expires {new Date(preview.expiresAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span> : null}
                </div>
                <ul className="mt-5 space-y-1.5 text-[14px] text-fg-2">
                  <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-[#376c45]" />{preview.role === 'admin' ? 'Run the live dashboard, map and radio' : 'Get tasks, talk on the radio, send field reports'}</li>
                  <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-[#376c45]" />Works in your browser — nothing to install</li>
                </ul>

                <AnimatePresence mode="wait" initial={false}>
                  {auth.user ? (
                    <motion.div key="go" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring.smooth} className="mt-7">
                      <Button size="lg" className="h-12 w-full rounded-[14px] text-[15px]" onClick={() => void accept()} disabled={busy}>
                        {busy ? <Loader2 className="animate-spin" /> : null}{preview.alreadyMember ? 'Open event' : `Join as ${auth.user.displayName}`}{!busy ? <ArrowRight /> : null}
                      </Button>
                      <p className="mt-3 text-center text-[13px] text-fg-3">
                        Signed in as <span className="font-medium text-fg-2">@{auth.user.username}</span> ·{' '}
                        <button type="button" className="font-medium text-fg underline-offset-4 hover:underline" onClick={() => { void API.logout().finally(() => setAuth({ user: null, events: [] })); }}>Not you?</button>
                      </p>
                    </motion.div>
                  ) : preview.role === 'staff' && !withAccount ? (
                    <motion.div key="name" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring.smooth} className="mt-7">
                      <NameInline cta={preview.alreadyMember ? 'Open event' : 'Join'} busy={busy} onSubmit={(n) => void accept(n)} onSignIn={() => setWithAccount(true)} />
                    </motion.div>
                  ) : (
                    <motion.div key="auth" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring.smooth} className="mt-7">
                      <AuthInline cta="Join" defaultMode={preview.role === 'staff' ? 'login' : 'signup'} onDone={() => { void API.authMe().then(setAuth).then(() => accept()); }} />
                      {preview.role === 'staff' ? <button type="button" onClick={() => setWithAccount(false)} className="mt-3 h-10 w-full text-[14px] font-medium text-fg-2">Join without an account</button> : null}
                    </motion.div>
                  )}
                </AnimatePresence>
                <AnimatePresence>{err ? <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="alert" className="mt-3 text-center text-[13px] font-medium text-[#b91c1c]">{err}</motion.p> : null}</AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </motion.div>
    </div>
  );
}

function DeadState({ status }: { status: InvitePreview['status'] }) {
  const copy = {
    expired: { icon: CalendarX2, title: 'This invite has expired', body: 'Invite links last a limited time. Ask the organizer for a fresh one.' },
    used_up: { icon: Users, title: 'This invite is full', body: 'Everyone this link was meant for has joined. Ask the organizer for a new link.' },
    revoked: { icon: Link2Off, title: 'This invite was turned off', body: 'The organizer revoked this link. Ask them for a new one.' },
    not_found: { icon: Link2Off, title: 'This link doesn’t work', body: 'Check that you opened the whole link, or ask the organizer to send it again.' },
    active: { icon: Check, title: '', body: '' },
  }[status];
  const I = copy.icon;
  return (
    <div className="mt-8 text-center">
      <span className="mx-auto grid size-14 place-items-center rounded-[16px] bg-[#f3f2ef] text-fg-2"><I className="size-6" strokeWidth={1.75} /></span>
      <h1 className="mt-4 text-[22px] font-semibold tracking-[-0.02em] text-fg">{copy.title}</h1>
      <p className="mx-auto mt-1.5 max-w-[300px] text-[14px] leading-[20px] text-fg-2">{copy.body}</p>
      <Button asChild variant="outline" className="mt-6"><Link to="/">Go to WAYVE</Link></Button>
    </div>
  );
}
