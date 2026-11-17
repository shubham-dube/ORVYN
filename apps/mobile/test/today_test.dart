import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:orvyn/app/today.dart';

import 'support/fake_server.dart';
import 'support/harness.dart';

TaskItem t(String id, Map<String, dynamic> f) => TaskItem(id, {'title': id, ...f});

void main() {
  group('grouping (same rules as the web)', () {
    final now = DateTime(2026, 11, 16, 9);
    test('time block wins over due moment, which wins over due date', () {
      expect(
        t('a', {
          'dueDate': '2026-11-20',
          'dueAt': DateTime(2026, 11, 18, 9).toUtc().toIso8601String(),
          'scheduledStart': DateTime(2026, 11, 17, 9).toUtc().toIso8601String(),
        }).day,
        '2026-11-17',
      );
      expect(t('b', {'dueDate': '2026-11-20'}).day, '2026-11-20');
      expect(t('c', {}).day, isNull);
    });

    test('sections and order', () {
      final g = groupTasks([
        t('late', {'dueDate': '2026-11-15'}),
        t('at-14', {'dueAt': DateTime(2026, 11, 16, 14).toUtc().toIso8601String()}),
        t('at-10', {'dueAt': DateTime(2026, 11, 16, 10).toUtc().toIso8601String()}),
        t('anytime-high', {'dueDate': '2026-11-16', 'priority': 3}),
        t('anytime-low', {'dueDate': '2026-11-16'}),
        t('tomorrow', {'dueDate': '2026-11-17'}),
        t('someday', {}),
        t('done-now', {'completedAt': DateTime(2026, 11, 16, 8).toUtc().toIso8601String()}),
        t('done-yesterday', {'completedAt': DateTime(2026, 11, 15, 8).toUtc().toIso8601String()}),
      ], now);
      List<String> ids(List<TaskItem> l) => [for (final x in l) x.id];
      expect(ids(g.overdue), ['late']);
      expect(ids(g.today), ['at-10', 'at-14', 'anytime-high', 'anytime-low']);
      expect(ids(g.upcoming), ['tomorrow']);
      expect(ids(g.inbox), ['someday']);
      expect(ids(g.doneToday), ['done-now']);
    });
  });

  testWidgets('add, complete and sync — and it keeps working offline', (tester) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['today']));
    final backend = FakeSyncBackend()..attach(h.server);
    await h.pump(tester);

    await tester.tap(find.bySemanticsLabel('Today'));
    await settle(tester);
    expect(find.text('Nothing planned for today. Add something above, or enjoy it.'), findsOneWidget);

    await tester.enterText(find.byKey(const Key('quick-add')), 'Pay electricity bill');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await settle(tester);
    expect(find.text('Pay electricity bill'), findsOneWidget);
    expect(backend.rows.values.single['title'], 'Pay electricity bill', reason: 'pushed to the server');
    expect(backend.rows.values.single['dueDate'], '2026-11-16');

    // offline: the server can't be reached, the app keeps going
    final push = h.server.routes['POST /sync/push']!;
    h.server.on('POST /sync/push', (_) => const Reply(503));
    await tester.tap(find.text('Someday'));
    await tester.enterText(find.byKey(const Key('quick-add')), 'Call the plumber');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await settle(tester);
    expect(find.text('Call the plumber'), findsOneWidget);
    expect(backend.rows.values.where((r) => r['title'] == 'Call the plumber'), isEmpty);

    // complete → it settles into "Done today"
    await tester.tap(find.bySemanticsLabel('Complete Pay electricity bill'));
    await settle(tester, 20);
    expect(find.text('DONE TODAY'), findsOneWidget);

    // back online: everything waiting goes up, merged
    h.server.on('POST /sync/push', push);
    await tester.drag(find.byType(Scrollable).first, const Offset(0, 400));
    await settle(tester, 20);
    expect(backend.rows.values.any((r) => r['title'] == 'Call the plumber' && r['dueDate'] == null), isTrue);
    expect(backend.rows.values.firstWhere((r) => r['title'] == 'Pay electricity bill')['completedAt'], isNotNull);
    await tester.pump(const Duration(seconds: 2)); // let the pull-to-refresh animation finish
    await finish(tester);
  });

  testWidgets('the Orb turns anything typed into a task for today', (tester) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['today']));
    final backend = FakeSyncBackend()..attach(h.server);
    await h.pump(tester);
    await tester.tap(find.bySemanticsLabel('Ask or do anything'));
    await settle(tester);
    await tester.enterText(find.byType(TextField).last, 'Renew passport');
    await settle(tester);
    await tester.tap(find.text('Add “Renew passport” to Today'));
    await settle(tester, 20);
    expect(backend.rows.values.single, containsPair('title', 'Renew passport'));
    expect(backend.rows.values.single, containsPair('source', 'orb'));
    expect(find.text('Added to Today'), findsOneWidget);
    await tester.pump(const Duration(seconds: 6));
    await finish(tester);
  });

  testWidgets('working hours and reminders: nothing assumed until saved, then mine to change', (tester) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['today']));
    final backend = FakeSyncBackend()..attach(h.server);
    await h.pump(tester);
    await tester.tap(find.bySemanticsLabel('Settings'));
    await settle(tester);
    await tester.scrollUntilVisible(find.text('Not set up yet'), 300, scrollable: find.byType(Scrollable).first);
    await tester.tap(find.bySemanticsLabel('Working hours and reminders'));
    await settle(tester);
    expect(find.textContaining('nothing is used until you save'), findsOneWidget);
    expect(backend.rows, isEmpty);

    await tester.scrollUntilVisible(find.text('Use these settings'), 400, scrollable: find.byType(Scrollable).first);
    await tester.tap(find.text('Use these settings'));
    await settle(tester, 20);
    final saved = backend.rows['today.settings/$ownerId']!;
    expect(saved['bufferMin'], 15);
    expect((saved['patterns'] as List), hasLength(1));
    expect(saved['reminders'], containsPair('timed', [10]));

    // change a default: no reminder for timed things
    await tester.scrollUntilVisible(
      find.byTooltip('Remove 10 min before'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.byTooltip('Remove 10 min before'));
    await settle(tester);
    await tester.scrollUntilVisible(find.text('Save'), 400, scrollable: find.byType(Scrollable).first);
    await tester.tap(find.text('Save'));
    await settle(tester, 20);
    expect((backend.rows['today.settings/$ownerId']!['reminders'] as Map)['timed'], isEmpty);
    await tester.pump(const Duration(seconds: 6));
    await finish(tester);
  });

  testWidgets('no Today switch, no Today tab', (tester) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['chat']));
    await h.pump(tester);
    expect(find.bySemanticsLabel('Today'), findsNothing);
    await finish(tester);
  });
}
