import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:orvyn/app/calendar.dart';
import 'package:orvyn/app/home_widget.dart';
import 'package:orvyn/app/today.dart';

import 'calendar_screen_test.dart' show seed;
import 'support/fake_server.dart';
import 'support/harness.dart';

String iso(DateTime d) => d.toUtc().toIso8601String();

void main() {
  final now = DateTime(2026, 11, 16, 9, 30);

  test('the widget shows what is still ahead today, in time order, then what is waiting', () {
    final s = widgetSnapshot(
      [
        TaskItem('call', {'title': 'Call the bank', 'dueAt': iso(DateTime(2026, 11, 16, 15))}),
        TaskItem('rent', {'title': 'Pay rent', 'dueDate': '2026-11-14'}),
        TaskItem('slides', {'title': 'Slides', 'dueDate': '2026-11-16'}),
        TaskItem('done', {'title': 'Done one', 'dueDate': '2026-11-16', 'completedAt': iso(now)}),
        TaskItem('later', {'title': 'Next week', 'dueDate': '2026-11-23'}),
      ],
      [
        EventItem('gone', {
          'title': 'Early gym',
          'start': iso(DateTime(2026, 11, 16, 7)),
          'end': iso(DateTime(2026, 11, 16, 8)),
        }),
        EventItem('standup', {
          'title': 'Standup',
          'start': iso(DateTime(2026, 11, 2, 10)),
          'end': iso(DateTime(2026, 11, 2, 10, 15)),
          'rrule': 'FREQ=DAILY',
        }),
        EventItem('trip', {'title': 'Offsite', 'allDay': true, 'startDate': '2026-11-16', 'endDate': '2026-11-17'}),
      ],
      const [],
      now,
      max: 4,
    );
    expect(
      [for (final l in s.lines) '${l.when} ${l.title}'],
      ['All day Offsite', '10:00 am Standup', '3:00 pm Call the bank', 'Overdue Pay rent'],
    );
    expect(s.lines[3].late, isTrue);
    expect(s.more, 1, reason: 'Slides');
    expect(s.open, 3);
  });

  test('taps on the widget become routes', () {
    expect(routeForWidgetUri(Uri.parse('orvyn://today')), '/today');
    expect(routeForWidgetUri(Uri.parse('orvyn://add')), '/today?add=1');
    expect(routeForWidgetUri(Uri.parse('https://evil.test/today')), isNull);
    expect(routeForWidgetUri(null), isNull);
  });

  testWidgets('the app keeps the widget current, and its + opens Today ready to type', (tester) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['today']));
    final b = FakeSyncBackend()..attach(h.server);
    seed(b, 'today.task', 't1', {'title': 'Water the plants', 'dueDate': '2026-11-16'});
    await h.pump(tester);
    await settle(tester, 20);
    expect(h.widget.last?['signedIn'], true);
    expect((h.widget.last?['lines'] as List).map((l) => (l as Map)['title']), ['Water the plants']);

    // a task added in the app reaches the widget
    await tester.tap(find.bySemanticsLabel('Today'));
    await settle(tester);
    await tester.enterText(find.byKey(const Key('quick-add')), 'Buy milk');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await settle(tester, 20);
    expect(
      (h.widget.last?['lines'] as List).map((l) => (l as Map)['title']),
      containsAll(['Buy milk', 'Water the plants']),
    );

    // "+" on the widget
    await tester.tap(find.bySemanticsLabel('Home'));
    await settle(tester);
    h.widgetClicks.add(Uri.parse('orvyn://add'));
    await settle(tester);
    final field = tester.widget<TextField>(find.byKey(const Key('quick-add')));
    expect(field.autofocus, isTrue);
    await finish(tester);
  });

  testWidgets('signed out, the widget says so instead of showing anything', (tester) async {
    final h = AppHarness();
    await h.pump(tester);
    expect(h.widget.last, {'signedIn': false});
    await finish(tester);
  });
}
