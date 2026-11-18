import 'package:rrule/rrule.dart';

/// A repeat as a person describes it ("every 2 weeks on Mon and Wed, 10 times") — built from and turned back into an
/// RRULE. Same rules and words as packages/today-plan/src/repeat.ts; both read packages/today-plan/fixtures/repeat.json.
const weekdays = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const _short = {'MO': 'Mon', 'TU': 'Tue', 'WE': 'Wed', 'TH': 'Thu', 'FR': 'Fri', 'SA': 'Sat', 'SU': 'Sun'};
const _long = {
  'MO': 'Monday',
  'TU': 'Tuesday',
  'WE': 'Wednesday',
  'TH': 'Thursday',
  'FR': 'Friday',
  'SA': 'Saturday',
  'SU': 'Sunday',
};
const freqs = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];

class RepeatSpec {
  RepeatSpec({
    this.freq = 'WEEKLY',
    this.interval = 1,
    List<String>? days,
    this.monthDay = 1,
    this.nth,
    this.nthDay = 'MO',
    this.endKind = 'never',
    this.until,
    this.count = 10,
  }) : days = days ?? [];

  String freq;
  int interval;

  /// weekly: which days (empty = the start day)
  List<String> days;

  /// monthly: on this date (1–31, −1 = last day), or — when [nth] is set — on "the 2nd Friday" (1–4 or −1 = last)
  int monthDay;
  int? nth;
  String nthDay;

  /// 'never' | 'until' | 'count'
  String endKind;
  String? until;
  int count;

  RepeatSpec copy() => RepeatSpec(
    freq: freq,
    interval: interval,
    days: [...days],
    monthDay: monthDay,
    nth: nth,
    nthDay: nthDay,
    endKind: endKind,
    until: until,
    count: count,
  );

  /// The spec a start date suggests (weekly → that weekday, monthly → that date).
  static RepeatSpec forStart(String freq, String startDate) {
    final d = DateTime.parse('${startDate}T00:00:00Z');
    return RepeatSpec(freq: freq, days: freq == 'WEEKLY' ? [weekdays[d.weekday - 1]] : [], monthDay: d.day);
  }
}

String buildRepeat(RepeatSpec s) {
  final p = ['FREQ=${s.freq}'];
  if (s.interval > 1) p.add('INTERVAL=${s.interval}');
  if (s.freq == 'WEEKLY' && s.days.isNotEmpty) {
    p.add('BYDAY=${weekdays.where(s.days.contains).join(',')}');
  }
  if (s.freq == 'MONTHLY') p.add(s.nth == null ? 'BYMONTHDAY=${s.monthDay}' : 'BYDAY=${s.nth}${s.nthDay}');
  if (s.endKind == 'until' && s.until != null) p.add('UNTIL=${s.until!.replaceAll('-', '')}T235959Z');
  if (s.endKind == 'count') p.add('COUNT=${s.count}');
  return p.join(';');
}

/// Back to a spec; null when the rule uses something the builder can't show (it is then kept as written).
RepeatSpec? parseRepeat(String rrule) {
  final parts = <String, String>{};
  for (final kv in rrule.replaceFirst(RegExp('^RRULE:', caseSensitive: false), '').split(';')) {
    final i = kv.indexOf('=');
    if (i < 1) return null;
    parts[kv.substring(0, i).toUpperCase()] = kv.substring(i + 1).toUpperCase();
  }
  const allowed = {'FREQ', 'INTERVAL', 'BYDAY', 'BYMONTHDAY', 'UNTIL', 'COUNT', 'WKST'};
  if (parts.keys.any((k) => !allowed.contains(k))) return null;
  final freq = parts['FREQ'];
  if (!freqs.contains(freq)) return null;
  final s = RepeatSpec(freq: freq!);
  if (parts.containsKey('INTERVAL')) {
    final n = int.tryParse(parts['INTERVAL']!);
    if (n == null || n < 1 || n > 99) return null;
    s.interval = n;
  }
  final by = parts['BYDAY'];
  if (freq == 'WEEKLY' && by != null) {
    final ds = by.split(',');
    if (!ds.every(weekdays.contains)) return null;
    s.days = ds;
  } else if (freq == 'MONTHLY') {
    final nth = by == null ? null : RegExp(r'^(-1|[1-4])(MO|TU|WE|TH|FR|SA|SU)$').firstMatch(by);
    if (by != null && nth == null) return null;
    if (nth != null) {
      s.nth = int.parse(nth.group(1)!);
      s.nthDay = nth.group(2)!;
    } else if (parts.containsKey('BYMONTHDAY')) {
      final d = int.tryParse(parts['BYMONTHDAY']!);
      if (d == null || !((d >= 1 && d <= 31) || d == -1)) return null;
      s.monthDay = d;
    }
  } else if (by != null || parts.containsKey('BYMONTHDAY')) {
    return null;
  }
  final until = parts['UNTIL'];
  if (until != null) {
    final m = RegExp(r'^(\d{4})(\d{2})(\d{2})(T\d{6}Z?)?$').firstMatch(until);
    if (m == null) return null;
    s.endKind = 'until';
    s.until = '${m.group(1)}-${m.group(2)}-${m.group(3)}';
  } else if (parts.containsKey('COUNT')) {
    final c = int.tryParse(parts['COUNT']!);
    if (c == null || c < 1) return null;
    s.endKind = 'count';
    s.count = c;
  }
  return s;
}

String _ordinal(int n) {
  if (n == -1) return 'last';
  final t = n % 100;
  final sfx = t >= 11 && t <= 13 ? 'th' : (const {1: 'st', 2: 'nd', 3: 'rd'}[n % 10] ?? 'th');
  return '$n$sfx';
}

const _monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/// "Every 2 weeks on Mon, Wed · until 31 Dec 2026"
String describeSpec(RepeatSpec s) {
  final n = s.interval;
  final unit = {'DAILY': 'day', 'WEEKLY': 'week', 'MONTHLY': 'month', 'YEARLY': 'year'}[s.freq]!;
  var t = n > 1 ? 'Every $n ${unit}s' : 'Every $unit';
  if (s.freq == 'WEEKLY' && s.days.isNotEmpty) {
    final w = weekdays.where(s.days.contains).toList();
    if (n == 1 && w.join(',') == 'MO,TU,WE,TH,FR') {
      t = 'Every weekday';
    } else if (n == 1 && w.length == 7) {
      t = 'Every day';
    } else {
      t += ' on ${w.map((d) => _short[d]).join(', ')}';
    }
  }
  if (s.freq == 'MONTHLY') {
    t += s.nth != null
        ? ' on the ${_ordinal(s.nth!)} ${_long[s.nthDay]}'
        : s.monthDay == -1
        ? ' on the last day'
        : ' on the ${_ordinal(s.monthDay)}';
  }
  if (s.endKind == 'until' && s.until != null) {
    final d = DateTime.parse('${s.until}T00:00:00Z');
    t += ' · until ${d.day} ${_monthNames[d.month - 1]} ${d.year}';
  }
  if (s.endKind == 'count') t += ' · ${s.count} time${s.count == 1 ? '' : 's'}';
  return t;
}

/// The first [n] dates a rule gives from a start date (shown as a preview, so a rule is never a surprise).
List<String> nextDates(String rrule, String startDate, int n, {String? from}) {
  try {
    final s = DateTime.parse('${startDate}T00:00:00Z');
    final f = DateTime.parse('${from ?? startDate}T00:00:00Z');
    final rule = RecurrenceRule.fromString(rrule.startsWith('RRULE:') ? rrule : 'RRULE:$rrule');
    final out = <String>[];
    final end = DateTime.utc(f.year + 6, f.month, f.day);
    for (final d in rule.getInstances(start: s, before: end)) {
      if (d.isBefore(f)) continue;
      out.add(
        '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}',
      );
      if (out.length >= n) break;
    }
    return out;
  } catch (_) {
    return [];
  }
}
