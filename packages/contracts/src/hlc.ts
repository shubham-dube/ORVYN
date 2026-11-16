/**
 * Hybrid logical clock (Kulkarni et al.). Timestamps sort lexicographically:
 *   "<physical ms, 15 digits>:<counter, 5 digits>:<node id>"
 * Used for field-level last-writer-wins in sync (ADR-0006). The Dart client implements the same format.
 */
export interface HlcParts {
  ms: number;
  counter: number;
  node: string;
}

const MAX_DRIFT_MS = 60_000;

export function formatHlc(p: HlcParts): string {
  return `${String(p.ms).padStart(15, '0')}:${String(p.counter).padStart(5, '0')}:${p.node}`;
}

export function parseHlc(s: string): HlcParts {
  const m = /^(\d{15}):(\d{5}):([A-Za-z0-9_-]{1,40})$/.exec(s);
  if (!m) throw new Error(`invalid HLC: ${s}`);
  return { ms: Number(m[1]), counter: Number(m[2]), node: m[3]! };
}

export function compareHlc(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export class Hlc {
  private last: HlcParts;
  constructor(
    private readonly node: string,
    private readonly now: () => number = Date.now,
  ) {
    this.last = { ms: 0, counter: 0, node };
  }

  /** Timestamp for a local event. */
  tick(): string {
    const wall = this.now();
    if (wall > this.last.ms) this.last = { ms: wall, counter: 0, node: this.node };
    else this.last = { ms: this.last.ms, counter: this.last.counter + 1, node: this.node };
    return formatHlc(this.last);
  }

  /** Merge a timestamp received from elsewhere; returns the new local timestamp. */
  receive(remote: string): string {
    const r = parseHlc(remote);
    const wall = this.now();
    if (r.ms - wall > MAX_DRIFT_MS) throw new Error('remote clock too far ahead');
    const ms = Math.max(wall, this.last.ms, r.ms);
    let counter = 0;
    if (ms === this.last.ms && ms === r.ms) counter = Math.max(this.last.counter, r.counter) + 1;
    else if (ms === this.last.ms) counter = this.last.counter + 1;
    else if (ms === r.ms) counter = r.counter + 1;
    this.last = { ms, counter, node: this.node };
    return formatHlc(this.last);
  }
}
