'use client';

import { type Phase } from '@orvyn/design-tokens';
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { applyPhase, readPreference, resolvePhase, savePreference, type ThemePreference } from '@/lib/theme';

const Ctx = createContext<{
  preference: ThemePreference;
  phase: Phase;
  setPreference(p: ThemePreference): void;
} | null>(null);

/** Follows the day (re-evaluated every minute) unless a phase is pinned. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPref] = useState<ThemePreference>('auto');
  const [phase, setPhase] = useState<Phase>('day');

  useEffect(() => setPref(readPreference()), []);
  useEffect(() => {
    const tick = () => {
      const p = resolvePhase(preference);
      setPhase(p);
      applyPhase(p);
    };
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, [preference]);

  const setPreference = (p: ThemePreference) => {
    savePreference(p);
    setPref(p);
  };
  return <Ctx.Provider value={{ preference, phase, setPreference }}>{children}</Ctx.Provider>;
}

export function useTheme() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useTheme outside ThemeProvider');
  return c;
}
