/** The Pool round as a roster (spec 0018): stages, words, and what each person's row offers. */

export type Stage = 'not_asked' | 'asked' | 'will_apply' | 'applied' | 'mandate' | 'out';

export const STAGES: { key: Stage; label: string; hint: string }[] = [
  { key: 'not_asked', label: 'Not asked', hint: 'in this IPO, not asked yet' },
  { key: 'asked', label: 'Asked', hint: 'waiting for an answer' },
  { key: 'will_apply', label: 'Will apply', hint: 'said yes · money to sort' },
  { key: 'applied', label: 'Applied', hint: 'bid in · mandate to approve' },
  { key: 'mandate', label: 'Mandate done', hint: 'all set' },
  { key: 'out', label: 'Not applying', hint: 'can’t, no reply or missed' },
];

export const STATUS_WORD: Record<string, string> = {
  to_ask: 'To ask',
  asked: 'Asked',
  planned: 'Will apply',
  funded: 'Money sent',
  applied: 'Applied',
  mandate: 'Mandate done',
  allotted: 'Allotted',
  not_allotted: 'Not allotted',
  sold: 'Sold',
  settled: 'Settled',
  declined: 'Can’t this time',
  no_reply: 'No reply',
  missed: 'Missed',
};

/** What can be picked from a person's status menu (a sale and a settlement have their own sheets). */
export const MENU_STATUSES = [
  'to_ask',
  'asked',
  'planned',
  'funded',
  'applied',
  'mandate',
  'allotted',
  'not_allotted',
  'declined',
  'no_reply',
  'missed',
] as const;

export type MessageKind = 'ask' | 'apply' | 'mandate' | 'allotment' | 'settle';
export const MESSAGE_WORD: Record<MessageKind, string> = {
  ask: 'Will you apply?',
  apply: 'Apply now',
  mandate: 'Approve the mandate',
  allotment: 'Did you get it?',
  settle: 'Send back',
};

export interface Action {
  label: string;
  /** a status to move to, or a message to send */
  status?: string;
  message?: MessageKind;
  primary?: boolean;
}

/** The one or two things that move a person along from where they are. */
export function nextActions(status: string | null, hasPhone: boolean): Action[] {
  const wa = (message: MessageKind, label: string, primary = false): Action[] =>
    hasPhone ? [{ label, message, primary }] : [];
  switch (status) {
    case null:
      return [{ label: 'Add', status: 'to_ask', primary: true }];
    case 'to_ask':
      return [
        ...wa('ask', 'Ask on WhatsApp', true),
        { label: 'Will apply', status: 'planned', primary: !hasPhone },
        { label: 'Can’t', status: 'declined' },
      ];
    case 'asked':
      return [
        { label: 'Will apply', status: 'planned', primary: true },
        { label: 'Can’t', status: 'declined' },
        ...wa('ask', 'Ask again'),
      ];
    case 'planned':
    case 'funded':
      return [{ label: 'Applied', status: 'applied', primary: true }, ...wa('apply', 'Send apply details')];
    case 'applied':
      return [
        { label: 'Mandate done', status: 'mandate', primary: true },
        ...wa('mandate', 'Remind: mandate'),
      ];
    case 'mandate':
      return [
        { label: '🎉 Allotted', status: 'allotted' },
        { label: 'Not allotted', status: 'not_allotted' },
        ...wa('allotment', 'Ask: got it?'),
      ];
    case 'sold':
      return wa('settle', 'Ask to send back');
    case 'declined':
    case 'no_reply':
    case 'missed':
      return [{ label: 'Will apply after all', status: 'planned' }];
    default:
      return [];
  }
}

/** The preview in the template editor: the server renders the real one, with the same placeholders. */
export function preview(template: string, v: Record<string, string>) {
  return template
    .replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? v[k]! : m))
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** "applied 7 of 9" — and a warning when they missed the last one. */
export function trackRecord(r: { applied: number; of: number; missed: number }) {
  if (!r.of) return 'new to the Pool';
  return `applied ${r.applied} of ${r.of}${r.missed ? ` · missed ${r.missed}` : ''}`;
}
