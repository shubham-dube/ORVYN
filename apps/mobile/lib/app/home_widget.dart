import 'dart:async';
import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:home_widget/home_widget.dart';

import 'calendar.dart';
import 'state.dart';
import 'today.dart';

/// One line on the home-screen widget.
class WidgetLine {
  const WidgetLine(this.when, this.title, {this.late = false, this.until});
  final String when;
  final String title;
  final bool late;

  /// when it stops being "ahead" — the widget hides it after this without waiting for the app
  final DateTime? until;
  Map<String, dynamic> toJson() => {
    'when': when,
    'title': title,
    'late': late,
    if (until != null) 'until': until!.millisecondsSinceEpoch,
  };
}

String _hm(DateTime d) {
  final h = d.hour % 12 == 0 ? 12 : d.hour % 12;
  return '$h:${d.minute.toString().padLeft(2, '0')} ${d.hour < 12 ? 'am' : 'pm'}';
}

/// What the widget shows (same rules as the Today screen): what's still ahead today — events and timed tasks in
/// time order — then overdue and anytime-today tasks. At most [max] lines, plus how many more.
({List<WidgetLine> lines, int more, int open}) widgetSnapshot(
  List<TaskItem> tasks,
  List<EventItem> events,
  List<CalendarItem> calendars,
  DateTime now, {
  int max = 5,
}) {
  final today = dayKey(now);
  final hidden = {
    for (final c in calendars)
      if (!c.visible) c.id,
  };
  final timed = <(DateTime, WidgetLine)>[
    for (final i in expandEvents(
      events,
      DateTime(now.year, now.month, now.day),
      DateTime(now.year, now.month, now.day + 1),
      hidden: hidden,
    ))
      if (i.allDay)
        (DateTime(now.year, now.month, now.day), WidgetLine('All day', i.title))
      else if (i.end!.isAfter(now))
        (i.start!, WidgetLine(_hm(i.start!), i.title, until: i.end)),
    for (final t in tasks)
      if (t.completedAt == null &&
          t.moment != null &&
          dayKey(t.moment!) == today &&
          !t.moment!.isBefore(now.subtract(const Duration(minutes: 30))))
        (t.moment!, WidgetLine(_hm(t.moment!), t.title, until: t.moment!.add(const Duration(minutes: 30)))),
  ]..sort((a, b) => a.$1.compareTo(b.$1));
  final g = groupTasks(tasks, now);
  final anytime = [
    for (final t in g.overdue)
      if (t.moment == null || dayKey(t.moment!) != today) WidgetLine('Overdue', t.title, late: true),
    for (final t in g.today)
      if (t.moment == null) WidgetLine('Today', t.title),
  ];
  final all = [for (final x in timed) x.$2, ...anytime];
  final open = g.overdue.length + g.today.length;
  return (lines: all.take(max).toList(), more: all.length > max ? all.length - max : 0, open: open);
}

/// Where the snapshot goes: the real widget on a phone, a recorder in tests.
abstract class WidgetPublisher {
  Future<void> publish(Map<String, dynamic> snapshot);
}

class HomeWidgetPublisher implements WidgetPublisher {
  @override
  Future<void> publish(Map<String, dynamic> snapshot) async {
    try {
      await HomeWidget.saveWidgetData<String>('today', jsonEncode(snapshot));
      await HomeWidget.updateWidget(qualifiedAndroidName: 'app.dubey.orvyn.TodayWidget');
    } catch (_) {
      // no widget support (tests, other platforms): nothing to update
    }
  }
}

final widgetPublisherProvider = Provider<WidgetPublisher>((_) => HomeWidgetPublisher());

/// Keeps the widget current while the app runs: whenever tasks, events or calendars change. (Lines carry their
/// end time, so the widget drops what's past on its own between updates.)
final homeWidgetSyncProvider = Provider<void>((ref) {
  final session = ref.watch(sessionProvider);
  final publisher = ref.watch(widgetPublisherProvider);
  if (session is! SignedIn || !session.me.can('today')) {
    unawaited(publisher.publish({'signedIn': false}));
    return;
  }
  Timer? debounce;
  void push() {
    debounce?.cancel();
    debounce = Timer(const Duration(milliseconds: 400), () {
      final now = ref.read(clockProvider)();
      final s = widgetSnapshot(
        ref.read(tasksProvider).value ?? const [],
        ref.read(eventsProvider).value ?? const [],
        ref.read(calendarsProvider).value ?? const [],
        now,
      );
      unawaited(
        publisher.publish({
          'signedIn': true,
          'date': dayKey(now),
          'lines': [for (final l in s.lines) l.toJson()],
          'more': s.more,
          'open': s.open,
        }),
      );
    });
  }

  ref.listen(tasksProvider, (_, _) => push());
  ref.listen(eventsProvider, (_, _) => push());
  ref.listen(calendarsProvider, (_, _) => push());
  ref.onDispose(() => debounce?.cancel());
  push();
});

/// A tap on the widget, as a route in the app: the list opens Today, "+" opens Today ready to type.
String? routeForWidgetUri(Uri? u) {
  if (u == null || u.scheme != 'orvyn') return null;
  return switch (u.host) {
    'add' => '/today?add=1',
    'today' => '/today',
    _ => null,
  };
}

/// Taps on the widget (while the app runs, or the one that launched it); replaced in tests.
final widgetClicksProvider = Provider<Stream<Uri?>>((_) async* {
  try {
    yield await HomeWidget.initiallyLaunchedFromHomeWidget();
  } catch (_) {
    // not on a phone
  }
  yield* HomeWidget.widgetClicked.handleError((Object _) {});
});
