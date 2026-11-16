/** Minutes since local midnight in a time zone. */
function localMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/**
 * Milliseconds until quiet hours end, or 0 if it is not quiet now. Handles windows across midnight
 * (22:00–07:00). Accurate to the minute, which is all quiet hours need.
 */
export function msUntilQuietEnds(
  at: Date,
  quiet: { start: string; end: string; timeZone: string } | null,
): number {
  if (!quiet) return 0;
  const now = localMinutes(at, quiet.timeZone);
  const start = toMin(quiet.start);
  const end = toMin(quiet.end);
  if (start === end) return 0;
  const inside = start < end ? now >= start && now < end : now >= start || now < end;
  if (!inside) return 0;
  const minutes = (end - now + 1440) % 1440;
  return minutes * 60_000;
}
