// QR-only staff: just a name (remembered on this phone) → join. No account, no password. "Have an account?" switches to
// sign-in for people who want their tasks to follow them across devices.
import { useState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const NAME_KEY = 'wayve:name';
const readName = () => { try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; } };

export function NameInline({ onSubmit, onSignIn, cta = 'Join', busy = false }: {
  onSubmit: (name: string) => void; onSignIn?: () => void; cta?: string; busy?: boolean;
}) {
  const [name, setName] = useState(readName);
  const ok = name.trim().length > 0;
  return (
    <form className="space-y-3" onSubmit={(e) => {
      e.preventDefault();
      if (!ok || busy) return;
      const n = name.trim().slice(0, 20);
      try { localStorage.setItem(NAME_KEY, n); } catch { /* private mode */ }
      onSubmit(n);
    }}>
      <label htmlFor="wv-inline-name" className="block px-0.5 text-[13px] font-semibold text-fg-2">What do people call you?</label>
      <Input id="wv-inline-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} autoFocus autoComplete="given-name"
        placeholder="e.g. Jimin" className="h-12 rounded-[14px] text-[16px]" enterKeyHint="go" />
      <Button type="submit" size="lg" className="h-12 w-full rounded-[14px] text-[15px]" disabled={!ok || busy}>
        {busy ? <Loader2 className="animate-spin" /> : null}{cta}{!busy ? <ArrowRight /> : null}
      </Button>
      <p className="text-center text-[13px] text-fg-3">
        No account needed{onSignIn ? <> · <button type="button" onClick={onSignIn} className="font-medium text-fg underline-offset-4 hover:underline">Have an account? Sign in</button></> : null}
      </p>
    </form>
  );
}
