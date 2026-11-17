import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../sync/sync_client.dart';
import 'state.dart';

const todayTask = 'today.task';
const todayProject = 'today.project';

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
  bool get repeats => data['rrule'] != null;

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
    final d = t.day;
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

  Future<void> complete(String id, bool done) =>
      _then(sync.upsert(todayTask, {'completedAt': done ? now().toUtc().toIso8601String() : null}, id: id));

  Future<void> update(String id, Map<String, dynamic> fields) => _then(sync.upsert(todayTask, fields, id: id));

  Future<void> remove(String id) => _then(sync.remove(todayTask, id));

  Future<T> _then<T>(Future<T> f) async {
    final r = await f;
    unawaited(sync.sync().catchError((Object _) {})); // offline: the outbox waits for the next sync
    return r;
  }
}
