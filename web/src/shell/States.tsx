// Designed full-page states: centred card with a glyph, title, body and one action.
import type { ComponentType, ReactNode, SVGProps } from 'react';
import { Link } from 'react-router';
import { Logo } from '@/design/Logo';
import { Button } from '@/components/ui/button';

type Icon = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string; strokeWidth?: number | string }>;

export function CenteredState({ icon: I, tone = 'neutral', title, body, action, secondary }: {
  icon: Icon; tone?: 'neutral' | 'danger'; title: string; body?: ReactNode;
  action?: { label: string; to: string }; secondary?: { label: string; to: string };
}) {
  return (
    <div className="grid min-h-dvh place-items-center bg-canvas px-6 py-16">
      <div className="w-full max-w-[400px]">
        <Link to="/" className="mb-8 inline-flex"><Logo size={24} /></Link>
        <div className="rounded-[16px] border border-[rgb(23_21_15/.09)] bg-white p-7">
          <span className={tone === 'danger'
            ? 'inline-grid size-10 place-items-center rounded-[12px] bg-[#fee4e1] text-[#b91c1c]'
            : 'inline-grid size-10 place-items-center rounded-[12px] bg-[#f5f4f2] text-fg'}>
            <I size={20} strokeWidth={1.75} />
          </span>
          <h1 className="mt-5 text-[22px] leading-7 font-semibold tracking-[-0.02em] text-fg">{title}</h1>
          {body && <div className="mt-2 text-[15px] leading-[1.6] text-fg-2">{body}</div>}
          {(action || secondary) && (
            <div className="mt-6 flex flex-wrap gap-2">
              {action && <Button asChild shape="pill" size="lg"><Link to={action.to}>{action.label}</Link></Button>}
              {secondary && <Button asChild variant="secondary" shape="pill" size="lg"><Link to={secondary.to}>{secondary.label}</Link></Button>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
