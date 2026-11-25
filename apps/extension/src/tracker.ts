import { place } from '@orvyn/activity';
import type { ActivitySpan } from '@orvyn/contracts';

/**
 * My Day, the browser's half (spec 0020, ADR-0018): which page is in front, and whether anyone is there. A span is
 * open while beats keep coming; a missing beat (sleep, closed lid) ends it where it was last seen. Pure.
 */

/** Beats come every 15 s from the page and every 30 s from an alarm; silence longer than this means nobody was here. */
export const SILENCE_MS = 90_000;
/** Away is one long beat-less stretch; after this it is simply "not at the browser". */
export const AWAY_MAX_MS = 3 * 3_600_000;

export interface Beat {
  t: number;
  /** null = Chrome isn't in front */
  url: string | null;
  title?: string;
  kind: 'active' | 'media' | 'away';
  keys?: number;
  clicks?: number;
  scrolls?: number;
}
export interface TrackState {
  open: ActivitySpan | null;
}

const tidy = (t: string) =>
  t
    .replace(/^\(\d+\+?\)\s*/, '')
    .slice(0, 300)
    .trim();

/** The next state, and a span that just ended (if one did). */
export function step(
  s: TrackState,
  b: Beat,
  o: { id(): string; app: string },
): { state: TrackState; closed: ActivitySpan | null } {
  const iso = new Date(b.t).toISOString();
  const open = s.open;
  const where = b.kind === 'away' ? { host: '', path: '', q: '' } : b.url ? place(b.url) : null;
  const title = b.kind === 'away' ? '' : tidy(b.title ?? '');
  let ended = open;
  if (open) {
    const gap = b.t - Date.parse(open.end);
    const limit = open.kind === 'away' ? AWAY_MAX_MS : SILENCE_MS;
    // the time up to this moment belongs to what was open, unless there was silence or the clock went backwards
    if (gap >= 0 && gap <= limit) ended = { ...open, end: iso };
    const same =
      where &&
      ended !== open &&
      open.kind === b.kind &&
      open.host === where.host &&
      open.path === where.path &&
      open.q === where.q &&
      (open.title === title || !title);
    if (same && ended) {
      return {
        state: {
          open: {
            ...ended,
            keys: ended.keys + (b.keys ?? 0),
            clicks: ended.clicks + (b.clicks ?? 0),
            scrolls: ended.scrolls + (b.scrolls ?? 0),
          },
        },
        closed: null,
      };
    }
  }
  const closed = ended && Date.parse(ended.end) - Date.parse(ended.start) >= 1000 ? ended : null;
  if (!where) return { state: { open: null }, closed };
  return {
    state: {
      open: {
        id: o.id(),
        source: 'web',
        start: iso,
        end: iso,
        kind: b.kind,
        app: o.app,
        ...where,
        title,
        keys: b.keys ?? 0,
        clicks: b.clicks ?? 0,
        scrolls: b.scrolls ?? 0,
      },
    },
    closed,
  };
}

/** Chrome says "idle" a minute late: that minute wasn't used, so give it back before going away. */
export function rewind(s: TrackState, t: number, ms: number): TrackState {
  if (!s.open) return s;
  const end = Math.max(Date.parse(s.open.start), Math.min(Date.parse(s.open.end), t - ms));
  return { open: { ...s.open, end: new Date(end).toISOString() } };
}
