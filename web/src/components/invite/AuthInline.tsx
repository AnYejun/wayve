// Inline sign-in / create-account (no page hop). Calls onDone() once a session exists.
import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { API, type HttpError } from '@/lib/api';
import { spring } from '@/design/motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export function AuthInline({ onDone, cta = 'Continue', defaultMode = 'signup' }: { onDone: () => void; cta?: string; defaultMode?: 'signup' | 'login' }) {
  const [mode, setMode] = useState<'signup' | 'login'>(defaultMode);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signup = mode === 'signup';
  const valid = username.trim().length >= 3 && password.length >= (signup ? 8 : 1) && (!signup || displayName.trim().length >= 1);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      if (signup) await API.signup({ username: username.trim().toLowerCase(), password, displayName: displayName.trim() });
      else await API.login({ username: username.trim().toLowerCase(), password });
      onDone();
    } catch (e2) {
      const he = e2 as HttpError;
      setErr(he.code === 'BAD_CREDENTIALS' ? 'That username and password don’t match.' : he.code === 'USERNAME_TAKEN' ? 'That username is taken — try signing in instead.' : he.message || 'Something went wrong.');
    } finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-2 rounded-[12px] bg-[#f3f2ef] p-[3px]" role="tablist" aria-label="Account">
        {(['signup', 'login'] as const).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setErr(null); }}
            className={cn('relative h-9 rounded-[9px] text-[14px] font-medium transition-colors', mode === m ? 'text-fg' : 'text-fg-2')}>
            {mode === m ? <motion.span layoutId="auth-inline-pill" transition={spring.snappy} className="absolute inset-0 rounded-[9px] bg-white shadow-[0_1px_2px_rgb(23_21_15/.08),0_0_0_.5px_rgb(23_21_15/.08)]" /> : null}
            <span className="relative">{m === 'signup' ? 'New here' : 'I have an ID'}</span>
          </button>
        ))}
      </div>
      <AnimatePresence initial={false}>
        {signup ? (
          <motion.div key="n" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={spring.smooth} className="overflow-hidden">
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name — what the team calls you" autoComplete="name" aria-label="Your name" className="h-11 text-[16px]" />
          </motion.div>
        ) : null}
      </AnimatePresence>
      <Input value={username} onChange={(e) => setUsername(e.target.value.replace(/\s/g, ''))} placeholder="Username" autoComplete="username" autoCapitalize="none" aria-label="Username" className="h-11 text-[16px]" />
      <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={signup ? 'Password (8+ characters)' : 'Password'}
        autoComplete={signup ? 'new-password' : 'current-password'} aria-label="Password" className="h-11 text-[16px]" />
      <AnimatePresence>{err ? <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="alert" className="text-[13px] font-medium text-[#b91c1c]">{err}</motion.p> : null}</AnimatePresence>
      <Button type="submit" size="lg" className="h-12 w-full rounded-[14px] text-[15px]" disabled={!valid || busy}>
        {busy ? <Loader2 className="animate-spin" /> : null}{signup ? `Create ID & ${cta.toLowerCase()}` : `Sign in & ${cta.toLowerCase()}`}{!busy ? <ArrowRight /> : null}
      </Button>
    </form>
  );
}
