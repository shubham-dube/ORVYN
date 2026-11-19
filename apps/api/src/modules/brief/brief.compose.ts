import { formatMoney, type BriefSection } from '@orvyn/contracts';

const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

/**
 * The words on top of the Brief, from its facts only (D-0009-2): "3 meetings, 5 tasks · first at 10:00".
 * `line` is the notification body: the next thing, then money and anything waiting.
 */
export function wordsFor(
  sections: BriefSection[],
  hhmm: (iso: string) => string,
): { headline: string; line: string } {
  const agenda = sections.find((s) => s.kind === 'agenda');
  const money = sections.find((s) => s.kind === 'money');
  const head: string[] = [];
  const line: string[] = [];
  if (agenda) {
    const timed = agenda.events.filter((e) => !e.allDay && e.at);
    if (agenda.events.length) head.push(n(agenda.events.length, 'meeting'));
    if (agenda.dueToday) head.push(n(agenda.dueToday, 'task'));
    if (agenda.overdue) head.push(`${agenda.overdue} overdue`);
    const first = timed[0];
    if (first?.at) {
      head.push(`first at ${hhmm(first.at)}`);
      line.push(`${first.title} ${hhmm(first.at)}`);
    } else if (agenda.top[0]) line.push(agenda.top[0].title);
  }
  if (money?.yesterdayMinor) line.push(`${formatMoney(money.yesterdayMinor)} yesterday`);
  if (money?.budgets.length) line.push(n(money.budgets.length, 'budget') + ' near the limit');
  for (const s of sections) {
    if (s.kind === 'drop' && s.waiting) line.push(`${s.waiting} in Drop`);
    if (s.kind === 'library' && s.expiring.length) line.push(n(s.expiring.length, 'document') + ' expiring');
    if (s.kind === 'work' && s.reviews) line.push(n(s.reviews, 'review') + ' waiting');
    if (s.kind === 'mail' && s.unread) line.push(`${s.unread} unread`);
  }
  return {
    headline: head.length ? head.join(', ').replace(/, (first at)/, ' · $1') : 'A clear day',
    line: line.slice(0, 4).join(' · ') || 'Nothing pressing. Enjoy it.',
  };
}
