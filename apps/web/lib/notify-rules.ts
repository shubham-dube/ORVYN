import {
  NOTIFY_CATALOG,
  NOTIFY_MODULES,
  type NotifyRule,
  type NotifyTypeInfo,
  type NotifyWay,
} from '@orvyn/contracts';

/** Which module each catalog group needs (Mail rides on Today; Security is everyone's). */
const NEEDS: Record<string, string | null> = { core: null, inbox: 'today' };

/** The catalog, grouped by module, keeping only what this person has (spec 0019). */
export function groups(can: (module: string) => boolean) {
  const out: { module: string; name: string; types: NotifyTypeInfo[] }[] = [];
  for (const t of NOTIFY_CATALOG) {
    const need = t.module in NEEDS ? NEEDS[t.module] : t.module;
    if (need && !can(need)) continue;
    let g = out.find((x) => x.module === t.module);
    if (!g) out.push((g = { module: t.module, name: NOTIFY_MODULES[t.module] ?? t.module, types: [] }));
    g.types.push(t);
  }
  return out;
}

/** The rule in force: the person's, or the type's default. */
export function ruleOf(t: NotifyTypeInfo, rules: Record<string, NotifyRule>): NotifyRule {
  return rules[t.key] ?? { on: true, ways: [...t.ways] };
}

/** Toggle one way. Urgent and Alarm both imply a push; an alarm is urgent already. */
export function toggle(r: NotifyRule, w: NotifyWay): NotifyRule {
  const has = r.ways.includes(w);
  let ways = has ? r.ways.filter((x) => x !== w) : [...r.ways, w];
  if (!has && (w === 'urgent' || w === 'alarm') && !ways.includes('push')) ways = ['push', ...ways];
  if (!has && w === 'alarm') ways = ways.filter((x) => x !== 'urgent');
  if (!has && w === 'urgent') ways = ways.filter((x) => x !== 'alarm');
  if (has && w === 'push') ways = ways.filter((x) => x !== 'urgent' && x !== 'alarm');
  return { on: true, ways };
}

/** "Push · Email", "In-app only", "Off". */
export function summary(r: NotifyRule) {
  if (!r.on) return 'Off';
  if (!r.ways.length) return 'In-app only';
  const word: Record<NotifyWay, string> = {
    push: 'Push',
    urgent: 'Urgent',
    alarm: 'Alarm',
    email: 'Email',
    whatsapp: 'WhatsApp',
  };
  const shown =
    r.ways.includes('alarm') || r.ways.includes('urgent') ? r.ways.filter((w) => w !== 'push') : r.ways;
  return shown.map((w) => word[w]).join(' · ');
}
