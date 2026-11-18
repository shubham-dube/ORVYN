/// Dates and times in a typed expense ("yesterday", "on 12 nov", "last friday", "3 days ago", "5th", "at 3pm").
/// Same rules, in the same order, as packages/money/src/dates.ts; both read packages/money/fixtures/spend.json.
/// Spending is in the past: a day name means the latest such day, "12 nov" the latest 12 November not in the future.
typedef Ymd = ({int y, int m, int d});

String ymdString(Ymd a) =>
    '${a.y.toString().padLeft(4, '0')}-${a.m.toString().padLeft(2, '0')}-${a.d.toString().padLeft(2, '0')}';

DateTime _utc(Ymd a) => DateTime.utc(a.y, a.m, a.d);
Ymd _from(DateTime t) => (y: t.year, m: t.month, d: t.day);
Ymd addDays(Ymd a, int n) => _from(_utc(a).add(Duration(days: n)));
int _weekday(Ymd a) => _utc(a).weekday % 7; // 0 = Sunday
int _daysIn(int y, int m) => DateTime.utc(y, m + 1, 0).day;
bool _before(Ymd a, Ymd b) => _utc(a).isBefore(_utc(b));

/// Today's date on this device.
Ymd todayOn(DateTime now) => (y: now.year, m: now.month, d: now.day);

const _months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const _days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const _mon =
    '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const _day = '(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs(?:day)?)?|fri(?:day)?|sat(?:urday)?)';

const _words = {'a': 1, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7};
int _num(String s) => _words[s.toLowerCase()] ?? int.parse(s);

Ymd? _latest(Ymd today, int m, int d, [int? y]) {
  if (d < 1 || m < 1 || m > 12) return null;
  final year = y ?? today.y;
  if (d > _daysIn(year, m)) return null;
  final c = (y: year, m: m, d: d);
  if (y == null && _before(today, c)) return d > _daysIn(year - 1, m) ? null : (y: year - 1, m: m, d: d);
  return c;
}

class FoundDate {
  const FoundDate(this.date, this.start, this.end);
  final Ymd date;
  final int start;
  final int end;
}

/// First date phrase in the text, or null.
FoundDate? findDate(String text, Ymd today) {
  final rules = <(RegExp, Ymd? Function(RegExpMatch))>[
    (RegExp(r'\b(?:the\s+)?day before yesterday\b|\bparso\b', caseSensitive: false), (_) => addDays(today, -2)),
    (RegExp(r'\byesterday\b|\bkal\b', caseSensitive: false), (_) => addDays(today, -1)),
    (RegExp(r'\btoday\b|\baaj\b', caseSensitive: false), (_) => today),
    (
      RegExp(r'\b(\d{1,3}|a|one|two|three|four|five|six|seven)\s+days?\s+ago\b', caseSensitive: false),
      (m) => addDays(today, -_num(m[1]!)),
    ),
    (
      RegExp(r'\b(\d{1,2}|a|one|two|three|four)\s+weeks?\s+ago\b', caseSensitive: false),
      (m) => addDays(today, -7 * _num(m[1]!)),
    ),
    (RegExp(r'\blast\s+week\b', caseSensitive: false), (_) => addDays(today, -7)),
    (
      RegExp('\\b(?:last\\s+|on\\s+|this\\s+past\\s+)?$_day\\b', caseSensitive: false),
      (m) {
        final target = _days.indexOf(m[1]!.substring(0, 3).toLowerCase());
        var back = (_weekday(today) - target + 7) % 7;
        if (back == 0 && RegExp(r'^last\b', caseSensitive: false).hasMatch(m[0]!)) back = 7;
        return addDays(today, -back);
      },
    ),
    (
      RegExp(
        '\\b(?:on\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?$_mon(?:\\s*,?\\s*(\\d{4}))?\\b',
        caseSensitive: false,
      ),
      (m) => _latest(
        today,
        _months.indexOf(m[2]!.substring(0, 3).toLowerCase()) + 1,
        int.parse(m[1]!),
        m[3] == null ? null : int.parse(m[3]!),
      ),
    ),
    (
      RegExp('\\b(?:on\\s+)?$_mon\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,?\\s*(\\d{4}))?\\b', caseSensitive: false),
      (m) => _latest(
        today,
        _months.indexOf(m[1]!.substring(0, 3).toLowerCase()) + 1,
        int.parse(m[2]!),
        m[3] == null ? null : int.parse(m[3]!),
      ),
    ),
    // 12/11 · 12-11-26 · 12.11.2026 (day first, as in India). A dot only counts in the full form, so 1.2k stays money.
    (
      RegExp(
        r'\b(?:on\s+)?(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2}|\d{4}))?(?![\d/-])|\b(?:on\s+)?(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})(?![\d])',
      ),
      (m) {
        final d = int.parse((m[1] ?? m[4])!);
        final mo = int.parse((m[2] ?? m[5])!);
        final yy = m[3] ?? m[6];
        final y = yy == null ? null : (yy.length == 2 ? 2000 + int.parse(yy) : int.parse(yy));
        return _latest(today, mo, d, y);
      },
    ),
    (
      RegExp(r'\b(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b', caseSensitive: false),
      (m) {
        final d = int.parse(m[1]!);
        if (d < 1 || d > 31) return null;
        final here = (y: today.y, m: today.m, d: d);
        if (d <= _daysIn(today.y, today.m) && !_before(today, here)) return here;
        final py = today.m == 1 ? today.y - 1 : today.y;
        final pm = today.m == 1 ? 12 : today.m - 1;
        return d <= _daysIn(py, pm) ? (y: py, m: pm, d: d) : null;
      },
    ),
  ];
  for (final (re, fn) in rules) {
    final m = re.firstMatch(text);
    if (m == null) continue;
    final date = fn(m);
    if (date != null) return FoundDate(date, m.start, m.end);
  }
  return null;
}

/// "at 3pm" · "3:30 pm" · "15:30" → "HH:MM"
({String time, int start, int end})? findTime(String text) {
  final m =
      RegExp(r'\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b', caseSensitive: false).firstMatch(text) ??
      RegExp(r'\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b').firstMatch(text);
  if (m == null) return null;
  var h = int.parse(m[1]!);
  final mi = int.parse(m[2] ?? '0');
  final ap = m.groupCount >= 3 ? m[3]?.toLowerCase() : null;
  if (ap == 'pm' && h < 12) h += 12;
  if (ap == 'am' && h == 12) h = 0;
  if (h > 23) return null;
  return (time: '${h.toString().padLeft(2, '0')}:${mi.toString().padLeft(2, '0')}', start: m.start, end: m.end);
}

/// When an entry happened on this device: its day and time if given; today with no time = right now; another day with
/// no time = noon.
DateTime occurredAtFor({String? date, String? time, required DateTime now}) {
  final t = todayOn(now);
  final p = date?.split('-').map(int.parse).toList();
  final y = p?[0] ?? t.y, m = p?[1] ?? t.m, d = p?[2] ?? t.d;
  final isToday = y == t.y && m == t.m && d == t.d;
  if (time == null) return isToday ? now : DateTime(y, m, d, 12);
  final hm = time.split(':').map(int.parse).toList();
  return DateTime(y, m, d, hm[0], hm[1]);
}
