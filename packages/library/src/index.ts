/**
 * Searching and sorting the Library on the device (offline), and how soon a document runs out. Same rules in Dart
 * (apps/mobile/lib/library/library.dart); both read fixtures/search.json.
 */
export interface DocLike {
  id: string;
  title: string;
  category: string;
  tags: string[];
  summary: string;
  text: string;
  fileName: string;
  expiresOn: string | null;
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

/**
 * Plain-words search over what the person kept. Every word must appear somewhere; where it appears decides the order
 * (title ≫ tags and category ≫ file name ≫ summary ≫ the document's own words). "pan card" finds a PAN card in one go.
 */
export function searchDocs<T extends DocLike>(docs: T[], query: string): T[] {
  const words = norm(query)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  if (!words.length) return docs;
  const scored: { d: T; score: number }[] = [];
  for (const d of docs) {
    const title = norm(d.title);
    const tags = norm(`${d.tags.join(' ')} ${d.category}`);
    const file = norm(d.fileName);
    const summary = norm(d.summary);
    const text = norm(d.text);
    let score = 0;
    let all = true;
    for (const w of words) {
      const s = title.includes(w)
        ? 100
        : tags.includes(w)
          ? 40
          : file.includes(w)
            ? 25
            : summary.includes(w)
              ? 10
              : text.includes(w)
                ? 3
                : 0;
      if (!s) {
        all = false;
        break;
      }
      score += s;
    }
    if (all) scored.push({ d, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.d.title.localeCompare(b.d.title)).map((x) => x.d);
}

export type Urgency = 'expired' | 'soon' | 'later' | 'none';

/** How long until it runs out, from the person's today (YYYY-MM-DD). `soon` = within 30 days. */
export function expiry(expiresOn: string | null, today: string): { days: number | null; urgency: Urgency } {
  if (!expiresOn) return { days: null, urgency: 'none' };
  const days = Math.round(
    (Date.parse(`${expiresOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
  return { days, urgency: days < 0 ? 'expired' : days <= 30 ? 'soon' : 'later' };
}

/** "Expires in 12 days", "Expired 3 days ago", "Expires today". */
export function expiryLabel(days: number | null): string {
  if (days === null) return '';
  if (days === 0) return 'Expires today';
  if (days === 1) return 'Expires tomorrow';
  if (days === -1) return 'Expired yesterday';
  return days > 0 ? `Expires in ${days} days` : `Expired ${-days} days ago`;
}

/** Documents that run out first (or already have), for the dashboard and the top of the Library. */
export function expiringSoon<T extends Pick<DocLike, 'expiresOn'>>(
  docs: T[],
  today: string,
  withinDays = 60,
): T[] {
  return docs
    .filter((d) => d.expiresOn && expiry(d.expiresOn, today).days! <= withinDays)
    .sort((a, b) => a.expiresOn!.localeCompare(b.expiresOn!));
}

export const formatBytes = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1024 * 1024
      ? `${(n / 1024).toFixed(n < 10_240 ? 1 : 0)} KB`
      : `${(n / 1024 / 1024).toFixed(1)} MB`;
