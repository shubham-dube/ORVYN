import 'calendar.dart';
import 'today.dart';

/// One thing in "what's next": an event or a task with a time, in order.
class NextItem {
  const NextItem({required this.kind, required this.id, required this.title, this.at, required this.allDay});
  final String kind; // 'event' | 'task'
  final String id;
  final String title;
  final DateTime? at;
  final bool allDay;
}

class DayShape {
  const DayShape({
    required this.open,
    required this.doneToday,
    required this.overdue,
    required this.progress,
    required this.next,
    required this.line,
  });
  final int open;
  final int doneToday;
  final int overdue;
  final double progress;
  final List<NextItem> next;
  final String line;
}

/// The shape of the day for the dashboard, from local data only. Same rules as packages/today-plan/src/dashboard.ts:
/// a task belongs to its time block, else its due moment, else its due date.
DayShape dayShape(List<TaskItem> tasks, List<Instance> events, DateTime now, {String Function(DateTime)? hhmm}) {
  final today = dayKey(now);
  String fmt(DateTime d) =>
      hhmm != null ? hhmm(d) : '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
  var open = 0, done = 0, overdue = 0;
  final next = <NextItem>[];
  for (final t in tasks) {
    final c = t.completedAt;
    if (c != null) {
      if (dayKey(c) == today) {
        done++;
      }
      continue;
    }
    final day = t.day;
    if (day == null) continue;
    if (day.compareTo(today) < 0) {
      overdue++;
      open++;
    } else if (day == today) {
      open++;
      final m = t.moment;
      if (m == null || !m.isBefore(now)) {
        next.add(NextItem(kind: 'task', id: t.id, title: t.title, at: m, allDay: false));
      }
    }
  }
  for (final e in events) {
    if (e.allDay) {
      if (e.startDate!.compareTo(today) <= 0 && e.endDate!.compareTo(today) > 0) {
        next.add(NextItem(kind: 'event', id: e.eventId, title: e.title, allDay: true));
      }
    } else if (e.end!.isAfter(now) && dayKey(e.start!.toLocal()) == today) {
      next.add(
        NextItem(
          kind: 'event',
          id: '${e.eventId}${e.occurrence ?? ''}',
          title: e.title,
          at: e.start!.toLocal(),
          allDay: false,
        ),
      );
    }
  }
  next.sort((a, b) {
    if (a.allDay != b.allDay) return a.allDay ? -1 : 1;
    final am = a.at?.millisecondsSinceEpoch ?? 1 << 62;
    final bm = b.at?.millisecondsSinceEpoch ?? 1 << 62;
    return am != bm ? am.compareTo(bm) : a.title.compareTo(b.title);
  });
  final total = open + done;
  final first = next.where((n) => n.at != null).firstOrNull;
  final bits = <String>[
    if (open > 0) '$open to do' else if (done > 0) 'all done' else 'a clear day',
    if (first != null) 'next: ${first.title} at ${fmt(first.at!)}',
  ];
  return DayShape(
    open: open,
    doneToday: done,
    overdue: overdue,
    progress: total == 0 ? 1 : done / total,
    next: next,
    line: bits.join(' · '),
  );
}

/// Open tasks due on each of the next [days] days (starting today), for the week-ahead bars.
List<({String date, int count})> weekAhead(List<TaskItem> tasks, DateTime now, {int days = 7}) {
  final start = DateTime.utc(now.year, now.month, now.day);
  final dates = [for (var i = 0; i < days; i++) dayKey(start.add(Duration(days: i)))];
  final counts = {for (final d in dates) d: 0};
  for (final t in tasks) {
    if (t.completedAt != null) continue;
    final d = t.day;
    if (d != null && counts.containsKey(d)) counts[d] = counts[d]! + 1;
  }
  return [for (final d in dates) (date: d, count: counts[d]!)];
}
