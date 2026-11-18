import 'today.dart';

/// A search and filter over tasks: words, a project ('none' = no project), a tag, a minimum priority and when it is due.
/// Same rules as packages/today-plan/src/tasks.ts; both read packages/today-plan/fixtures/task-query.json.
class TaskQuery {
  const TaskQuery({this.text = '', this.projectId, this.tag, this.minPriority = 0, this.when = 'any'});
  final String text;
  final String? projectId;
  final String? tag;
  final int minPriority;

  /// any · overdue · today · week · later · none
  final String when;

  static const empty = TaskQuery();
  bool get isEmpty => text.trim().isEmpty && projectId == null && tag == null && minPriority == 0 && when == 'any';

  TaskQuery copy({String? text, Object? projectId = _keep, Object? tag = _keep, int? minPriority, String? when}) =>
      TaskQuery(
        text: text ?? this.text,
        projectId: projectId == _keep ? this.projectId : projectId as String?,
        tag: tag == _keep ? this.tag : tag as String?,
        minPriority: minPriority ?? this.minPriority,
        when: when ?? this.when,
      );

  factory TaskQuery.fromJson(Map<String, dynamic> j) => TaskQuery(
    text: (j['text'] as String?) ?? '',
    projectId: j['projectId'] as String?,
    tag: j['tag'] as String?,
    minPriority: (j['minPriority'] as num?)?.toInt() ?? 0,
    when: (j['when'] as String?) ?? 'any',
  );

  Map<String, dynamic> toJson() => {
    'text': text,
    'projectId': projectId,
    'tag': tag,
    'minPriority': minPriority,
    'when': when,
  };

  @override
  bool operator ==(Object other) =>
      other is TaskQuery &&
      other.text == text &&
      other.projectId == projectId &&
      other.tag == tag &&
      other.minPriority == minPriority &&
      other.when == when;
  @override
  int get hashCode => Object.hash(text, projectId, tag, minPriority, when);
}

const Object _keep = Object();

String _addDays(String date, int n) => dayKey(DateTime.parse('${date}T00:00:00Z').add(Duration(days: n)));

bool taskMatches(TaskItem t, TaskQuery q, DateTime now) {
  if (q.projectId != null && (q.projectId == 'none' ? t.projectId != null : t.projectId != q.projectId)) return false;
  if (q.tag != null && !t.tags.any((x) => x.toLowerCase() == q.tag!.toLowerCase())) return false;
  if (t.priority < q.minPriority) return false;
  if (q.when != 'any') {
    final today = dayKey(now);
    final day = t.day;
    final ok = switch (q.when) {
      'none' => day == null,
      _ when day == null => false,
      'overdue' => day.compareTo(today) < 0,
      'today' => day == today,
      'week' => day.compareTo(today) >= 0 && day.compareTo(_addDays(today, 6)) <= 0,
      'later' => day.compareTo(_addDays(today, 6)) > 0,
      _ => true,
    };
    if (!ok) return false;
  }
  final words = q.text.trim().toLowerCase().split(RegExp(r'\s+')).where((w) => w.isNotEmpty);
  if (words.isEmpty) return true;
  final hay = [t.title, t.notes, ...t.tags, ...t.checklist.map((c) => c.text)].join('\n').toLowerCase();
  return words.every(hay.contains);
}

({int done, int total}) checklistProgress(TaskItem t) {
  final c = t.checklist;
  return (done: c.where((x) => x.done).length, total: c.length);
}

/// Every tag in use, most used first.
List<String> allTags(Iterable<TaskItem> tasks) {
  final n = <String, ({String label, int count})>{};
  for (final t in tasks) {
    for (final tag in t.tags) {
      final k = tag.toLowerCase();
      final e = n[k];
      n[k] = (label: e?.label ?? tag, count: (e?.count ?? 0) + 1);
    }
  }
  final list = n.values.toList()
    ..sort((a, b) => a.count != b.count ? b.count.compareTo(a.count) : a.label.compareTo(b.label));
  return [for (final e in list) e.label];
}

/// A short line for a query ("work · #urgent · high priority · next 7 days"), shown on saved filters.
String describeQuery(TaskQuery q, {String? Function(String id)? projectName}) {
  final bits = <String>[];
  if (q.text.trim().isNotEmpty) bits.add('“${q.text.trim()}”');
  if (q.projectId == 'none') {
    bits.add('no project');
  } else if (q.projectId != null) {
    bits.add(projectName?.call(q.projectId!) ?? 'project');
  }
  if (q.tag != null) bits.add('#${q.tag}');
  if (q.minPriority > 0) bits.add('${['', 'low+', 'medium+', 'high'][q.minPriority]} priority');
  if (q.when != 'any') {
    bits.add(
      const {
        'overdue': 'overdue',
        'today': 'today',
        'week': 'next 7 days',
        'later': 'later',
        'none': 'no date',
      }[q.when]!,
    );
  }
  return bits.isEmpty ? 'Everything' : bits.join(' · ');
}
