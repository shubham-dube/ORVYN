import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:orvyn/app/calendar.dart';
import 'package:orvyn/app/dashboard.dart';
import 'package:orvyn/app/today.dart';
import 'package:orvyn/money/money.dart';

import 'calendar_screen_test.dart' show seed, tapIt;
import 'support/fake_server.dart';
import 'support/harness.dart';

TaskItem task(String id, Map<String, dynamic> f) => TaskItem(id, {'title': id, ...f});
Instance ev(String id, {DateTime? start, DateTime? end, bool allDay = false, String? sd, String? ed}) => Instance(
  eventId: id,
  seriesId: null,
  occurrence: null,
  title: id,
  calendarId: null,
  allDay: allDay,
  start: start,
  end: end,
  startDate: sd,
  endDate: ed,
);

void main() {
  // the same day and cases as packages/today-plan/test/dashboard.test.ts, on this device's clock
  final now = DateTime(2026, 11, 18, 10);
  String iso(int d, int h, [int m = 0]) => DateTime(2026, 11, d, h, m).toUtc().toIso8601String();

  group('the shape of the day', () {
    final tasks = [
      task('overdue', {'dueDate': '2026-11-17'}),
      task('late-call', {'dueAt': iso(18, 16)}),
      task('already-past', {'dueAt': iso(18, 8)}),
      task('anytime', {'dueDate': '2026-11-18'}),
      task('done', {'dueDate': '2026-11-18', 'completedAt': iso(18, 7)}),
      task('done-yesterday', {'completedAt': iso(17, 7)}),
      task('tomorrow', {'dueDate': '2026-11-19'}),
      task('inbox', {}),
    ];
    final events = [
      ev('standup', start: DateTime(2026, 11, 18, 10, 30), end: DateTime(2026, 11, 18, 11)),
      ev('over', start: DateTime(2026, 11, 18, 8), end: DateTime(2026, 11, 18, 9)),
      ev('holiday', allDay: true, sd: '2026-11-18', ed: '2026-11-19'),
      ev('tomorrow', start: DateTime(2026, 11, 19, 10), end: DateTime(2026, 11, 19, 11)),
    ];
    final s = dayShape(tasks, events, now);

    test('counts what is open, done today and overdue', () {
      expect((s.open, s.overdue, s.doneToday), (4, 1, 1));
      expect(s.progress, closeTo(1 / 5, 0.0001));
    });
    test('lists what is next in order; past things drop out', () {
      expect([for (final n in s.next) n.title], ['holiday', 'standup', 'late-call', 'anytime']);
    });
    test('says it in a line', () {
      expect(s.line, '4 to do · next: standup at 10:30');
      expect(dayShape([], [], now).line, 'a clear day');
      expect(dayShape([tasks[4]], [], now).line, 'all done');
    });
  });

  test('week ahead counts open tasks per day', () {
    final w = weekAhead([
      task('a', {'dueDate': '2026-11-18'}),
      task('b', {'dueAt': iso(18, 22)}),
      task('c', {'dueDate': '2026-11-20'}),
      task('d', {'dueDate': '2026-11-20', 'completedAt': iso(18, 7)}),
      task('e', {'dueDate': '2026-11-30'}),
      task('f', {'dueDate': '2026-11-17'}),
    ], now);
    expect(w, hasLength(7));
    expect(w[0], (date: '2026-11-18', count: 2));
    expect(w[2], (date: '2026-11-20', count: 1));
  });

  test('daily spend: one number per day, no transfers or income, up to today', () {
    TxItem tx(String id, DateTime at, int amount, [Map<String, dynamic> extra = const {}]) =>
        TxItem(id, {'amountMinor': amount, 'direction': 'debit', 'occurredAt': at.toUtc().toIso8601String(), ...extra});
    final d = dailySpend(
      [
        tx('a', DateTime(2026, 11, 2, 10), 24000),
        tx('b', DateTime(2026, 11, 2, 20), 1000),
        tx('c', DateTime(2026, 11, 5, 10), 5000, {'transfer': true}),
        tx('d', DateTime(2026, 11, 5, 11), 7000, {'direction': 'credit'}),
        tx('e', DateTime(2026, 10, 31, 23), 9000),
        tx('f', DateTime(2026, 11, 4, 0, 30), 300),
      ],
      '2026-11',
      upTo: 5,
    );
    expect(d, [0, 25000, 0, 300, 0]);
  });

  testWidgets('the dashboard shows the day, and quick add puts a task into Today', (tester) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['today', 'money']));
    final b = FakeSyncBackend()..attach(h.server);
    seed(b, 'today.task', 'a', {'title': 'Pay rent', 'dueDate': '2026-11-16'});
    seed(b, 'today.task', 'b', {'title': 'Buy milk', 'dueDate': '2026-11-16'});
    await h.pump(tester);
    await settle(tester, 20);
    expect(find.text('2 to do'), findsOneWidget);
    expect(find.text('Pay rent'), findsOneWidget);
    expect(find.bySemanticsLabel(RegExp(r'^0/2, done\. 0 percent done')), findsOneWidget);
    expect(find.text('Set a monthly budget in Money to see it here.'), findsOneWidget);

    await tester.enterText(find.byKey(const Key('dash-add')), 'Call the bank');
    await settle(tester);
    await tapIt(tester, find.widgetWithText(GestureDetector, 'Add').first);
    final added = b.rows.values.where((r) => r['title'] == 'Call the bank');
    expect(added, hasLength(1));
    expect(added.single['dueDate'], '2026-11-16');
    await finish(tester);
  });
}
