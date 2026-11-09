// /login and /signup — WAYVE ID. Centered card on a soft canvas; ?next= returns to where you came from.
import { useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { API, HttpError } from '@/lib/api';
import { spring } from '@/design/motion';
import { Logo } from '@/design/Logo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function LoginPage() {
  const loc = useLocation();
  const signup = loc.pathname.startsWith('/signup');
  const [params] = useSearchParams();
  const next = params.get('next') || '/';
  const nav = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      if (signup) await API.signup({ username: username.trim().toLowerCase(), password, displayName: displayName.trim() || username.trim() });
      else await API.login({ username: username.trim().toLowerCase(), password });
      nav(next, { replace: true });
    } catch (e2) {
      const he = e2 as HttpError;
      setErr(he.code === 'BAD_CREDENTIALS' ? 'That username and password don’t match.' : he.message || 'Something went wrong.');
    } finally { setBusy(false); }
  };

  const valid = username.trim().length >= 3 && password.length >= (signup ? 8 : 1);
  return (
    <div className="grid min-h-dvh place-items-center bg-[radial-gradient(120%_80%_at_50%_0%,#ffffff_0%,#f5f4f2_70%)] px-5 py-12">
      <motion.div initial={{ opacity: 0, y: 14, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={spring.gentle}
        className="w-full max-w-[400px] rounded-[24px] bg-white p-8 shadow-[0_24px_64px_-24px_rgb(23_21_15/.18),0_0_0_.5px_rgb(23_21_15/.1)]">
        <Link to="/" className="inline-block"><Logo size={20} /></Link>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={signup ? 'up' : 'in'} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.18 }}>
            <h1 className="mt-6 text-[28px] leading-[1.15] font-semibold tracking-[-0.03em] text-fg">{signup ? 'Create your WAYVE ID' : 'Sign in to WAYVE'}</h1>
            <p className="mt-1.5 text-[15px] text-fg-2">{signup ? 'One ID for every event you run or staff.' : 'Run your event, or pick up your shift.'}</p>
          </motion.div>
        </AnimatePresence>
        <form className="mt-7 space-y-3" onSubmit={submit}>
          <AnimatePresence initial={false}>
            {signup ? (
              <motion.div key="name" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={spring.smooth} className="overflow-hidden">
                <Field label="Your name" hint="What your team calls you on the radio">
                  <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Jimin" autoComplete="name" className="h-11 text-[16px]" />
                </Field>
              </motion.div>
            ) : null}
          </AnimatePresence>
          <Field label="Username">
            <Input value={username} onChange={(e) => setUsername(e.target.value.replace(/\s/g, ''))} placeholder="jimin" autoComplete="username" autoCapitalize="none" autoFocus className="h-11 text-[16px]" />
          </Field>
          <Field label="Password" hint={signup ? 'At least 8 characters' : undefined}>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={signup ? 'new-password' : 'current-password'} className="h-11 text-[16px]" />
          </Field>
          <AnimatePresence>
            {err ? <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-[13px] font-medium text-[#b91c1c]" role="alert">{err}</motion.p> : null}
          </AnimatePresence>
          <Button type="submit" size="lg" className="mt-2 h-12 w-full rounded-[14px] text-[15px]" disabled={!valid || busy}>
            {busy ? <Loader2 className="animate-spin" /> : null}{signup ? 'Create account' : 'Sign in'}{!busy ? <ArrowRight /> : null}
          </Button>
        </form>
        <p className="mt-6 text-center text-[14px] text-fg-2">
          {signup ? 'Already have an ID? ' : 'New to WAYVE? '}
          <Link to={`${signup ? '/login' : '/signup'}${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-semibold text-fg underline-offset-4 hover:underline">
            {signup ? 'Sign in' : 'Create an account'}
          </Link>
        </p>
      </motion.div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between text-[13px] font-semibold text-fg">{label}{hint ? <span className="font-normal text-fg-3">{hint}</span> : null}</span>
      {children}
    </label>
  );
}
