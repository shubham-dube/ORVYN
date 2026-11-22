import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'state.dart';

/// A span the server's parser understood (`packages/today-parse`), shown as a chip.
class ParsedSpan {
  ParsedSpan(this.kind, this.text, this.start, this.end);
  final String kind;
  final String text;
  final int start;
  final int end;
}

class ParsedTask {
  ParsedTask(this.raw);
  final Map<String, dynamic> raw;
  String get title => raw['title'] as String;
  String? get dueDate => raw['dueDate'] as String?;
  String? get dueAt => raw['dueAt'] as String?;
  int? get durationMin => (raw['durationMin'] as num?)?.toInt();
  String? get rrule => raw['rrule'] as String?;
  int get priority => (raw['priority'] as num?)?.toInt() ?? 0;
  List<String> get tags => [for (final t in (raw['tags'] as List? ?? const [])) t as String];
  String? get projectId => raw['projectId'] as String?;
  String? get projectName => raw['projectName'] as String?;
  String? get deadline => raw['deadline'] as String?;
  String? get notes => raw['notes'] as String?;
  List<ParsedSpan> get spans => [
    for (final s in (raw['spans'] as List? ?? const []).cast<Map<String, dynamic>>())
      ParsedSpan(s['kind'] as String, s['text'] as String, (s['start'] as num).toInt(), (s['end'] as num).toInt()),
  ];

  /// Task fields for a new task. Nothing about a day written = the Inbox (spec 0012 A5), unless [fallbackDay].
  Map<String, dynamic> fields([String? fallbackDay]) => {
    'title': title,
    'dueAt': dueAt,
    'dueDate': dueAt != null ? null : (dueDate ?? fallbackDay),
    'durationMin': durationMin,
    'rrule': rrule,
    'priority': priority,
    'tags': tags,
    'projectId': projectId,
    'deadline': ?deadline,
    'notes': ?notes,
  };
}

/// Parse on the server (same rules as web); null when offline — the app then saves the words as typed.
Future<ParsedTask?> parseOnline(WidgetRef ref, String text, List<List<int>> literal, {bool ai = false}) async {
  try {
    final r = await ref.read(apiProvider).post<Map<String, dynamic>>('/today/parse', {
      'text': text,
      if (literal.isNotEmpty) 'literal': literal,
      if (ai) 'ai': true,
    });
    return ParsedTask(r);
  } catch (_) {
    return null;
  }
}

const _days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const _codes = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

String _ordinal(int n) {
  final t = n % 100 >= 11 && n % 100 <= 13
      ? 'th'
      : const ['th', 'st', 'nd', 'rd', 'th', 'th', 'th', 'th', 'th', 'th'][n % 10];
  return '$n$t';
}

String repeatLabel(String rrule) {
  String? get(String k) => RegExp('$k=([^;]+)').firstMatch(rrule)?.group(1);
  final byday = get('BYDAY');
  final n = int.tryParse(get('INTERVAL') ?? '1') ?? 1;
  if (byday == 'MO,TU,WE,TH,FR') return 'every weekday';
  if (byday == 'SA,SU') return 'every weekend';
  if (byday != null) return 'every ${byday.split(',').map((c) => _days[_codes.indexOf(c)]).join(', ')}';
  final md = get('BYMONTHDAY');
  final freq = get('FREQ');
  if (freq == 'MONTHLY' && md != null) {
    return md == '-1' ? 'last day of every month' : 'every month on the ${_ordinal(int.parse(md))}';
  }
  final unit = const {'DAILY': 'day', 'WEEKLY': 'week', 'MONTHLY': 'month', 'YEARLY': 'year'}[freq] ?? 'day';
  return n > 1 ? 'every $n ${unit}s' : 'every $unit';
}

/// What a chip says: the meaning, not the words typed (mirrors apps/web/lib/smart-task.ts).
String chipLabel(ParsedSpan s, ParsedTask p, String Function(DateTime) day, String Function(DateTime) time) {
  switch (s.kind) {
    case 'date':
      final d = p.dueAt != null
          ? DateTime.parse(p.dueAt!).toLocal()
          : (p.dueDate != null ? DateTime.parse(p.dueDate!) : null);
      return d == null ? s.text : day(d);
    case 'time':
      return p.dueAt == null ? s.text : time(DateTime.parse(p.dueAt!).toLocal());
    case 'repeat':
      return p.rrule == null ? s.text : repeatLabel(p.rrule!);
    case 'duration':
      final m = p.durationMin ?? 0;
      return m >= 60 ? '${m ~/ 60} h${m % 60 > 0 ? ' ${m % 60} min' : ''}' : '$m min';
    case 'priority':
      return const ['No priority', 'Low', 'Medium', 'High'][p.priority.clamp(0, 3)];
    case 'project':
      return p.projectId != null ? s.text.substring(1) : '${s.text.substring(1)} (new project)';
    case 'deadline':
      return p.deadline == null ? s.text : 'by ${day(DateTime.parse(p.deadline!))}';
    case 'notes':
      final n = p.notes ?? '';
      return n.length > 24 ? '${n.substring(0, 24)}…' : n;
    default:
      return s.text;
  }
}

final _unread = RegExp(
  r'\b(\d{1,2}(:\d{2})?\s*(am|pm|baje|bje)|\d{1,2}:\d{2}|\d{1,2}(st|nd|rd|th)|\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?|'
  r'jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|'
  r'dec(ember)?|mon(day)?|tue(s(day)?)?|wed(nesday)?|thu(rs(day)?)?|fri(day)?|sat(urday)?|sun(day)?|tomorrow|tmrw|'
  r'tonight|kal|parso|subah|shaam|raat|morning|evening|afternoon|weekend|fortnight|every|har|next|after|before|end of)\b',
  caseSensitive: false,
);

/// Same rule as `looksUnread` in packages/today-parse: date/time-looking words the rules left in the title.
bool looksUnread(ParsedTask p) => !(p.dueAt != null && p.rrule != null) && _unread.hasMatch(p.title);
