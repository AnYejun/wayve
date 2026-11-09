// "Join an event" dialog: 6-char code → one tap. Signed out → just a name (QR-only staff, no account); sign-in is optional.
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { API, type HttpError } from '@/lib/api';
import { spring } from '@/design/motion';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { AuthInline } from './AuthInline';
import { NameInline } from './NameInline';
import { CodeInput } from './CodeInput';
import { InviteAPI, landingFor } from './api';

export function JoinByCodeForm({ initialCode = '', onJoined }: { initialCode?: string; onJoined?: () => void }) {
  const nav = useNavigate();
  const [code, setCode] = useState(initialCode.toUpperCase());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [needsName, setNeedsName] = useState(false);

  const join = async (c = code, name: string | null = null) => {
    if (c.replace(/\s/g, '').length !== 6) return;
    setErr(null); setBusy(true);
    try {
      const r = await InviteAPI.joinByCode(c, null, name);
      toast.success('You’re in', { description: 'Welcome to the team.' });
      onJoined?.();
      nav(landingFor(r.eventId, r.role));
    } catch (e) {
      const he = e as HttpError;
      if (he.code === 'NEEDS_NAME') { setNeedsName(true); setNeedsAuth(false); }
      else if (he.code === 'NEEDS_LOGIN') setNeedsAuth(true);
      else { setErr(he.message); setNeedsName(false); }
    } finally { setBusy(false); }
  };

  return (
    <AnimatePresence mode="wait" initial={false}>
      {needsAuth ? (
        <motion.div key="auth" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={spring.smooth}>
          <p className="mb-3 text-[14px] text-fg-2">One WAYVE ID works for every event. It takes 10 seconds.</p>
          <AuthInline cta="Join" defaultMode="login" onDone={() => { setNeedsAuth(false); setNeedsName(false); void API.authMe().finally(() => void join()); }} />
          <button type="button" onClick={() => { setNeedsAuth(false); setNeedsName(true); }} className="mt-3 h-10 w-full text-[14px] font-medium text-fg-2">Join without an account</button>
        </motion.div>
      ) : needsName ? (
        <motion.div key="name" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={spring.smooth}>
          <NameInline busy={busy} onSubmit={(n) => void join(code, n)} onSignIn={() => { setNeedsName(false); setNeedsAuth(true); }} />
          <AnimatePresence>{err ? <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="alert" className="mt-2 text-center text-[13px] font-medium text-[#b91c1c]">{err}</motion.p> : null}</AnimatePresence>
        </motion.div>
      ) : (
        <motion.div key="code" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} transition={spring.smooth} className="space-y-4">
          <CodeInput value={code} onChange={(v) => { setCode(v); setErr(null); }} onComplete={(v) => void join(v)} autoFocus size="lg" />
          <AnimatePresence>{err ? <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="alert" className="text-center text-[13px] font-medium text-[#b91c1c]">{err}</motion.p> : null}</AnimatePresence>
          <Button size="lg" className="h-12 w-full rounded-[14px] text-[15px]" disabled={code.replace(/\s/g, '').length !== 6 || busy} onClick={() => void join()}>
            {busy ? <Loader2 className="animate-spin" /> : null}Join as staff{!busy ? <ArrowRight /> : null}
          </Button>
          <p className="text-center text-[12px] text-fg-3">The code is on the staff QR poster, or ask an organizer.</p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function JoinByCodeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[420px]">
        <DialogTitle>Join an event</DialogTitle>
        <DialogDescription>Enter the 6-character event code.</DialogDescription>
        <div className="mt-2"><JoinByCodeForm onJoined={() => onOpenChange(false)} /></div>
      </DialogContent>
    </Dialog>
  );
}
