import { modeOf, phaseAt, type Phase } from '@orvyn/design-tokens';

export type ThemePreference = 'auto' | Phase;
export const THEME_KEY = 'orvyn.theme';

export function resolvePhase(pref: ThemePreference, now = new Date()): Phase {
  return pref === 'auto' ? phaseAt(now) : pref;
}

export function applyPhase(phase: Phase): void {
  const el = document.documentElement;
  el.dataset.phase = phase;
  el.style.colorScheme = modeOf(phase);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', getComputedStyle(el).getPropertyValue('--orv-base').trim());
}

export function readPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'auto' || v === 'dawn' || v === 'day' || v === 'dusk' || v === 'night') return v;
  } catch {
    /* private mode */
  }
  return 'auto';
}

export function savePreference(p: ThemePreference): void {
  try {
    localStorage.setItem(THEME_KEY, p);
  } catch {
    /* private mode */
  }
}

/**
 * Runs before first paint (inline, with the CSP nonce) so the page never flashes the wrong light.
 * Mirrors phaseAt(): dawn 05–08, day 08–17, dusk 17–20, night otherwise.
 */
export const themeBootScript = `(function(){try{var p=localStorage.getItem('${THEME_KEY}')||'auto';if(p==='auto'){var d=new Date(),m=d.getHours()*60+d.getMinutes();p=m>=1200||m<300?'night':m>=1020?'dusk':m>=480?'day':'dawn';}document.documentElement.dataset.phase=p;document.documentElement.style.colorScheme=(p==='dusk'||p==='night')?'dark':'light';}catch(e){}})();`;
