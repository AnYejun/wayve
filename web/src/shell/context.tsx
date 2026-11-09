// Shell context: ONE live connection per event, shared by every section of the app shell.
import { createContext, useContext } from 'react';
import type { useLive } from '@/lib/live';

export type Live = ReturnType<typeof useLive>;
export interface ShellCtx extends Live { eventId: string }

export const ShellContext = createContext<ShellCtx | null>(null);

export function useShell(): ShellCtx {
  const v = useContext(ShellContext);
  if (!v) throw new Error('useShell outside AppShell');
  return v;
}

export const SECTIONS = ['dashboard', 'map', 'radio', 'assistant', 'crew', 'database', 'devices', 'reports', 'people', 'settings'] as const;
export type Section = (typeof SECTIONS)[number];
export const sectionPath = (eventId: string, s: Section) => `/e/${eventId}/${s}`;
