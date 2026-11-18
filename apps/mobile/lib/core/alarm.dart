import '../app/reminder_ways.dart';

/// One alarm that should be ringing on this phone at [at] (D22: scheduled on the phone, so it works offline).
class AlarmSlot {
  const AlarmSlot({required this.id, required this.at, required this.title, required this.body, required this.taskId});
  final int id;
  final DateTime at;
  final String title;
  final String body;
  final String taskId;

  @override
  bool operator ==(Object other) => other is AlarmSlot && other.id == id && other.at == at && other.title == title;
  @override
  int get hashCode => Object.hash(id, at, title);
}

/// Stable 31-bit id for one task's alarm at one moment (FNV-1a), so re-planning replaces instead of duplicating.
int alarmId(String taskId, DateTime at) {
  var h = 0x811c9dc5;
  for (final c in 'alarm:$taskId:${at.millisecondsSinceEpoch ~/ 60000}'.codeUnits) {
    h ^= c;
    h = (h * 0x01000193) & 0xffffffff;
  }
  return h & 0x7fffffff;
}

String _hm(DateTime d) {
  final h = d.hour % 12 == 0 ? 12 : d.hour % 12;
  return '$h:${d.minute.toString().padLeft(2, '0')} ${d.hour < 12 ? 'am' : 'pm'}';
}

/// Which alarms this phone should hold: every open task whose reminders (its own, else the person's defaults) include
/// the Alarm way, from [now] to [horizon] ahead. Pure and testable; the scheduler turns it into real alarms.
List<AlarmSlot> planAlarms(
  List<({String id, Map<String, dynamic> data})> tasks,
  Map<String, dynamic>? defaults,
  DateTime now, {
  Duration horizon = const Duration(days: 14),
  int max = 60,
}) {
  final out = <AlarmSlot>[];
  for (final t in tasks) {
    final d = t.data;
    if (d['completedAt'] != null) continue;
    final momentIso = (d['dueAt'] ?? d['scheduledStart']) as String?;
    final moment = momentIso == null ? null : DateTime.parse(momentIso).toLocal();
    for (final r in reminderPlan(d, defaults)) {
      if (!waysOf(r.via).contains('alarm')) continue;
      final DateTime? at = r.at != null
          ? DateTime.parse(r.at!).toLocal()
          : moment?.subtract(Duration(minutes: r.minutes!));
      if (at == null || !at.isAfter(now) || at.isAfter(now.add(horizon))) continue;
      final lead = r.minutes ?? 0;
      out.add(
        AlarmSlot(
          id: alarmId(t.id, at),
          at: at,
          title: (d['title'] as String?) ?? 'Reminder',
          body: moment == null
              ? 'Reminder'
              : lead > 1
              ? 'In ${lead >= 120 ? '${lead ~/ 60} h' : '$lead min'} · ${_hm(moment)}'
              : 'Now · ${_hm(moment)}',
          taskId: t.id,
        ),
      );
    }
  }
  out.sort((a, b) => a.at.compareTo(b.at));
  return out.take(max).toList();
}

/// Turns the plan into real alarms (Android's alarm clock scheduling); a fake in tests.
abstract interface class AlarmScheduler {
  /// Make these, and only these, the pending alarms.
  Future<void> replaceAll(List<AlarmSlot> wanted);
}
