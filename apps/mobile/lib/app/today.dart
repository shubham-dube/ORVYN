import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../sync/sync_client.dart';
import 'state.dart';

const todayTask = 'today.task';
const todayProject = 'today.project';
const todayFilter = 'today.filter';

/// A task as the app reads it from the local mirror (fields may be missing until the server fills defaults).
class TaskItem {
  TaskItem(this.id, this.data);
  final String id;
  final Map<String, dynamic> data;

  String get title => (data['title'] as String?) ?? '';
  String get notes => (data['notes'] as String?) ?? '';
  int get priority => (data['priority'] as num?)?.toInt() ?? 0;
  String? get dueDate => data['dueDate'] as String?;
  DateTime? get dueAt => _time('dueAt');
  DateTime? get scheduledStart => _time('scheduledStart');
  DateTime? get completedAt => _time('completedAt');
  String? get projectId => data['projectId'] as String?;

  /// the last day it may be done (spec 0012 A2); separate from [day], the day I plan to do it
  String? get deadline => data['deadline'] as String?;

  /// 'todo' or 'doing'; done is [completedAt]
  String get status => (data['status'] as String?) == 'doing' ? 'doing' : 'todo';
  bool get done => completedAt != null;
  bool get repeats => data['rrule'] != null;
  String? get rrule => data['rrule'] as String?;
  int? get durationMin => (data['durationMin'] as num?)?.toInt();
  List<String> get tags => [for (final t in (data['tags'] as List?) ?? const []) t as String];
  List<({String id, String text, bool done})> get checklist => [
    for (final c in (data['checklist'] as List?) ?? const [])
      (id: ((c as Map)['id'] as String?) ?? '', text: (c['text'] as String?) ?? '', done: c['done'] == true),
  ];

  DateTime? _time(String k) => data[k] == null ? null : DateTime.parse(data[k] as String).toLocal();

  /// The day it belongs to: time block, else due moment, else due date; null = Inbox. Same rule as the web.
  String? get day {
    final m = scheduledStart ?? dueAt;
    return m != null ? dayKey(m) : dueDate;
  }

  DateTime? get moment => scheduledStart ?? dueAt;
}

String dayKey(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

class TaskGroups {
  final overdue = <TaskItem>[];
  final today = <TaskItem>[];
  final upcoming = <TaskItem>[];
  final inbox = <TaskItem>[];
  final doneToday = <TaskItem>[];
}

TaskGroups groupTasks(List<TaskItem> tasks, DateTime now) {
  final today = dayKey(now);
  final g = TaskGroups();
  for (final t in tasks) {
    final done = t.completedAt;
    if (done != null) {
      if (dayKey(done) == today) g.doneToday.add(t);
      continue;
    }
    // no plan day but the deadline has come: it belongs to today (or is overdue), not the Inbox
    final dl = t.deadline;
    final d = t.day ?? (dl != null && dl.compareTo(today) <= 0 ? dl : null);
    if (d == null) {
      g.inbox.add(t);
    } else if (d.compareTo(today) < 0) {
      g.overdue.add(t);
    } else if (d == today) {
      g.today.add(t);
    } else {
      g.upcoming.add(t);
    }
  }
  int byTime(TaskItem a, TaskItem b) {
    final am = a.moment?.millisecondsSinceEpoch ?? 1 << 62;
    final bm = b.moment?.millisecondsSinceEpoch ?? 1 << 62;
    if (am != bm) return am.compareTo(bm);
    if (a.priority != b.priority) return b.priority.compareTo(a.priority);
    return a.title.compareTo(b.title);
  }

  g.overdue.sort(byTime);
  g.today.sort(byTime);
  g.upcoming.sort((a, b) {
    final c = (a.day ?? '').compareTo(b.day ?? '');
    return c != 0 ? c : byTime(a, b);
  });
  g.inbox.sort((a, b) => a.priority != b.priority ? b.priority.compareTo(a.priority) : a.title.compareTo(b.title));
  g.doneToday.sort((a, b) => b.completedAt!.compareTo(a.completedAt!));
  return g;
}

final tasksProvider = StreamProvider<List<TaskItem>>((ref) {
  return ref.watch(syncProvider).watch(todayTask).map((rows) => [for (final r in rows) TaskItem(r.id, r.data)]);
});

class ProjectItem {
  ProjectItem(this.id, this.data);
  final String id;
  final Map<String, dynamic> data;
  String get name => (data['name'] as String?) ?? '';
  String get colour => (data['colour'] as String?) ?? 'sky';
  bool get archived => data['archived'] == true;
}

final projectsProvider = StreamProvider<List<ProjectItem>>(
  (ref) => ref
      .watch(syncProvider)
      .watch(todayProject)
      .map((rows) => [for (final r in rows) ProjectItem(r.id, r.data)].where((p) => !p.archived).toList()),
);

/// A saved search ("Urgent work"), the same on every device.
class SavedFilterItem {
  SavedFilterItem(this.id, this.data);
  final String id;
  final Map<String, dynamic> data;
  String get name => (data['name'] as String?) ?? '';
  int get order => (data['order'] as num?)?.toInt() ?? 0;
}

final savedFiltersProvider = StreamProvider<List<SavedFilterItem>>(
  (ref) => ref
      .watch(syncProvider)
      .watch(todayFilter)
      .map((rows) => [for (final r in rows) SavedFilterItem(r.id, r.data)]..sort((a, b) => a.order.compareTo(b.order))),
);

final projectNamesProvider = StreamProvider<Map<String, String>>((ref) {
  return ref
      .watch(syncProvider)
      .watch(todayProject)
      .map((rows) => {for (final r in rows) r.id: (r.data['name'] as String?) ?? ''});
});

final todayActionsProvider = Provider<TodayActions>(
  (ref) => TodayActions(ref.watch(syncProvider), ref.watch(clockProvider)),
);

/// Writes land locally at once (offline-first) and sync in the background.
class TodayActions {
  TodayActions(this.sync, this.now);
  final SyncClient sync;
  final DateTime Function() now;

  Future<String> add(String title, {String? dueDate, String source = 'typed'}) =>
      _then(sync.upsert(todayTask, {'title': title, 'dueDate': dueDate, 'source': source}));

  /// A task from a parse; an unknown @project is created on the way.
  Future<String> addParsed(Map<String, dynamic> fields, {String? newProject, String source = 'typed'}) async {
    final f = {...fields, 'source': source};
    if (newProject != null) f['projectId'] = await sync.upsert(todayProject, {'name': newProject});
    return _then(sync.upsert(todayTask, f));
  }

  Future<void> complete(String id, bool done) =>
      _then(sync.upsert(todayTask, {'completedAt': done ? now().toUtc().toIso8601String() : null}, id: id));

  Future<void> update(String id, Map<String, dynamic> fields) => _then(sync.upsert(todayTask, fields, id: id));

  Future<void> remove(String id) => _then(sync.remove(todayTask, id));

  Future<String> addProject(String name, {String? colour}) =>
      _then(sync.upsert(todayProject, {'name': name, 'colour': ?colour}));
  Future<String> saveFilter(String? id, Map<String, dynamic> fields) => _then(sync.upsert(todayFilter, fields, id: id));
  Future<void> removeFilter(String id) => _then(sync.remove(todayFilter, id));

  Future<T> _then<T>(Future<T> f) async {
    final r = await f;
    unawaited(sync.sync().catchError((Object _) {})); // offline: the outbox waits for the next sync
    return r;
  }
}

// ------------------------------------------------------------------ when it was done (spec 0012 A1)

const _wd = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const _mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

String clock12(DateTime t) {
  final h = t.hour % 12 == 0 ? 12 : t.hour % 12;
  return '$h:${t.minute.toString().padLeft(2, '0')} ${t.hour < 12 ? 'am' : 'pm'}';
}

int _daysBetween(DateTime a, DateTime b) =>
    DateTime.utc(b.year, b.month, b.day).difference(DateTime.utc(a.year, a.month, a.day)).inDays;

/// "Done 3:40 pm", "Done yesterday, 6:10 pm", "Done Mon, 6:10 pm", "Done 18 Nov", "Done 18 Nov 2025" — same words as
/// `doneLabel` in packages/contracts. [long]: "Done on Mon 18 Nov, 6:10 pm" for the task sheet.
String doneLabel(DateTime at, DateTime now, {bool long = false}) {
  final sameYear = at.year == now.year;
  final date = '${at.day} ${_mo[at.month - 1]}${sameYear ? '' : ' ${at.year}'}';
  if (long) return 'Done on ${_wd[at.weekday - 1]} $date, ${clock12(at)}';
  final days = _daysBetween(at, now);
  if (days <= 0) return 'Done ${clock12(at)}';
  if (days == 1) return 'Done yesterday, ${clock12(at)}';
  if (days < 7) return 'Done ${_wd[at.weekday - 1]}, ${clock12(at)}';
  return 'Done $date';
}

/// The header a done task sits under: "Today", "Yesterday", "Mon 18 Nov", "Tue 18 Nov 2025".
String doneDayHeader(DateTime at, DateTime now) {
  final days = _daysBetween(at, now);
  if (days <= 0) return 'Today';
  if (days == 1) return 'Yesterday';
  return '${_wd[at.weekday - 1]} ${at.day} ${_mo[at.month - 1]}${at.year == now.year ? '' : ' ${at.year}'}';
}

/// "Fri 20 Nov" for a YYYY-MM-DD, "Today"/"Tomorrow"/"Yesterday" when near.
String dayWords(String day, DateTime now) {
  final d = DateTime.parse(day);
  final n = _daysBetween(now, d);
  if (n == 0) return 'Today';
  if (n == 1) return 'Tomorrow';
  if (n == -1) return 'Yesterday';
  if (n > 1 && n < 7) return _wd[d.weekday - 1];
  return '${_wd[d.weekday - 1]} ${d.day} ${_mo[d.month - 1]}${d.year == now.year ? '' : ' ${d.year}'}';
}

/// How close a deadline is: 'past', 'near' (today … 2 days), or null.
String? deadlineTone(String? deadline, DateTime now) {
  if (deadline == null) return null;
  final n = _daysBetween(now, DateTime.parse(deadline));
  if (n < 0) return 'past';
  if (n <= 2) return 'near';
  return null;
}

String durationWords(int min) {
  if (min < 60) return '${min}m';
  final h = min ~/ 60;
  final m = min % 60;
  return m == 0 ? '${h}h' : '${h}h ${m}m';
}
