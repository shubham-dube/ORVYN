import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:orvyn/app/today_settings.dart';
import 'package:orvyn/design/controls.dart';

import 'support/fake_server.dart';
import 'support/harness.dart';

String iso(DateTime d) => d.toUtc().toIso8601String();
var _n = 0;
void seed(FakeSyncBackend b, String entity, String id, Map<String, dynamic> fields) => b.apply({
  'mutationId': 'seed-${_n++}',
  'entity': entity,
  'entityId': id,
  'op': 'upsert',
  'fields': fields,
  'hlc': '000000000000001:00000:seed',
});

/// By the label a widget gives itself (the river scrolls, so offscreen blocks aren't in the semantics tree).
Finder sem(Pattern p) => find.byWidgetPredicate((w) => w is Semantics && (w.properties.label ?? '').contains(p));

/// Brings it to the middle of the screen (clear of the top bar and the dock), then taps it.
Future<void> tapIt(WidgetTester tester, Finder f) async {
  await Scrollable.ensureVisible(f.evaluate().single, alignment: 0.5);
  await settle(tester);
  await tester.tap(f);
  await settle(tester);
}

Future<FakeSyncBackend> openCalendar(WidgetTester tester, AppHarness h, {bool settings = true}) async {
  final b = FakeSyncBackend()..attach(h.server);
  if (settings) seed(b, todaySettingsEntity, ownerId, startingSettings('Asia/Kolkata'));
  seed(b, 'today.event', 'standup', {
    'title': 'Team standup',
    'start': iso(DateTime(2026, 11, 2, 7)),
    'end': iso(DateTime(2026, 11, 2, 7, 30)),
    'rrule': 'FREQ=DAILY',
  });
  seed(b, 'today.task', 'news', {'title': 'Draft the newsletter', 'dueDate': '2026-11-16', 'durationMin': 45});
  await h.pump(tester);
  await tester.tap(find.bySemanticsLabel('Today'));
  await settle(tester);
  await tester.tap(find.text('Calendar'));
  await settle(tester);
  return b;
}

void main() {
  testWidgets('the river shows repeats, free time from my hours, and Place gives a task the first free time', (
    tester,
  ) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['today']));
    final b = await openCalendar(tester, h);
    expect(sem(RegExp(r'^Team standup, 7:00\sAM to 7:30\sAM$')), findsOneWidget);
    expect(sem(RegExp(r'^Free, 9 h$')), findsOneWidget, reason: '10:00–19:00, from 9:30 now');
    expect(find.text('To place · 1'), findsOneWidget);

    await tapIt(tester, sem('Place Draft the newsletter'));
    expect(b.rows['today.task/news']!['scheduledStart'], iso(DateTime(2026, 11, 16, 10)));
    expect(b.rows['today.task/news']!['durationMin'], 45);
    expect(find.text('Everything for this day has a time.'), findsOneWidget);
    expect(sem(RegExp(r'^Draft the newsletter, 10:00\sAM to 10:45\sAM, task$')), findsOneWidget);
    await finish(tester);
  });

  testWidgets('cancel only tomorrow’s standup; the series carries on', (tester) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['today']));
    final b = await openCalendar(tester, h);
    await tester.tap(find.byTooltip('Next'));
    await settle(tester);
    await tapIt(tester, sem(RegExp(r'^Team standup, 7:00')));
    expect(find.text('Only this one'), findsOneWidget);
    await tapIt(tester, find.text('Delete'));
    expect(b.rows['today.event/standup']!['exdates'], [iso(DateTime(2026, 11, 17, 7))]);
    expect(sem(RegExp(r'^Team standup')), findsNothing);
    await tapIt(tester, find.byTooltip('Next'));
    expect(sem(RegExp(r'^Team standup, 7:00')), findsOneWidget);
    await finish(tester);
  });

  testWidgets('a new event from the sheet', (tester) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['today']));
    final b = await openCalendar(tester, h);
    await tester.tap(find.text('Event'));
    await settle(tester);
    await tester.enterText(
      find.descendant(of: find.widgetWithText(OrvField, 'Title'), matching: find.byType(TextField)),
      'Dentist',
    );
    await tapIt(tester, find.text('Every month'));
    await tapIt(tester, find.text('Save'));
    final row = b.rows.entries.firstWhere((e) => e.value['title'] == 'Dentist').value;
    expect(row['start'], iso(DateTime(2026, 11, 16, 10)));
    expect(row['end'], iso(DateTime(2026, 11, 16, 11)));
    expect(row['rrule'], 'FREQ=MONTHLY');
    await finish(tester);
  });

  testWidgets('plan my day: a preview with reasons, accepted into time blocks', (tester) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['today']));
    h.server.on(
      'POST /today/plan',
      (r) => {
        'date': r.body['date'],
        'hours': [
          {'start': '10:00', 'end': '19:00'},
        ],
        'placed': [
          {
            'taskId': 'news',
            'title': 'Draft the newsletter',
            'start': iso(DateTime(2026, 11, 16, 10)),
            'end': iso(DateTime(2026, 11, 16, 10, 45)),
            'reason': 'due today · 45 min · first free time from 10:00 am',
          },
        ],
        'unplaced': [
          {'taskId': 'x', 'title': 'Big thing', 'reason': 'needs 600 min; the longest free stretch left is 495 min'},
        ],
      },
    );
    final b = await openCalendar(tester, h);
    await tester.tap(find.text('Plan my day'));
    await settle(tester);
    expect(find.text('due today · 45 min · first free time from 10:00 am'), findsOneWidget);
    expect(find.textContaining('Big thing — needs 600 min'), findsOneWidget);
    await tapIt(tester, find.text('Accept plan'));
    expect(b.rows['today.task/news']!['scheduledStart'], iso(DateTime(2026, 11, 16, 10)));
    expect(find.text('Planned 1 task'), findsOneWidget);
    await finish(tester);
  });

  testWidgets('without working hours, planning says so instead of guessing (D16)', (tester) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['today']));
    h.server.on(
      'POST /today/plan',
      (_) => const Reply(409, {
        'error': {'code': 'no_working_hours', 'message': 'x'},
      }),
    );
    await openCalendar(tester, h, settings: false);
    expect(find.text('Set your working hours in Settings to see your free time here.'), findsOneWidget);
    await tester.tap(find.text('Plan my day'));
    await settle(tester);
    expect(find.text('Set your working hours first'), findsOneWidget);
    await finish(tester);
  });

  testWidgets('Settings → Calendars: accounts, show a calendar, connect another, disconnect', (tester) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['today']));
    final b = FakeSyncBackend()..attach(h.server);
    var accounts = [
      {'id': 'a1', 'provider': 'google', 'email': 'asha@gmail.test', 'status': 'active', 'lastSyncedAt': null},
      {'id': 'a2', 'provider': 'google', 'email': 'asha@work.test', 'status': 'needs_reconnect', 'lastSyncedAt': null},
    ];
    h.server.on('GET /calendar/accounts', (_) => accounts);
    h.server.on('POST /calendar/google/start', (r) => {'url': 'https://accounts.google.test/auth?x=1'});
    h.server.on('DELETE /calendar/accounts/a1', (_) {
      accounts = accounts.where((a) => a['id'] != 'a1').toList();
      return {'ok': true};
    });
    seed(b, 'today.calendar', 'c1', {'name': 'Asha', 'provider': 'google', 'accountId': 'a1', 'visible': true});
    seed(b, 'today.calendar', 'c2', {
      'name': 'Holidays in India',
      'provider': 'google',
      'accountId': 'a1',
      'visible': false,
      'writable': false,
    });
    await h.pump(tester);
    await tester.tap(find.bySemanticsLabel('Settings'));
    await settle(tester);
    await tester.scrollUntilVisible(find.text('asha@gmail.test'), 300, scrollable: find.byType(Scrollable).first);
    expect(find.text('Holidays in India'), findsOneWidget);
    expect(find.text('View only'), findsOneWidget);
    expect(find.text('Google stopped accepting this connection.'), findsOneWidget);

    await tapIt(
      tester,
      find.descendant(of: find.widgetWithText(OrvSwitchRow, 'Holidays in India'), matching: find.byType(Switch)),
    );
    expect(b.rows['today.calendar/c2']!['visible'], true);

    await tapIt(tester, find.text('Connect another Google account'));
    expect(h.opened.single.host, 'accounts.google.test');

    await tapIt(tester, find.byTooltip('Disconnect asha@gmail.test'));
    await tester.tap(find.text('Disconnect'));
    await settle(tester);
    expect(find.text('asha@gmail.test'), findsNothing);
    expect(find.text('asha@work.test'), findsOneWidget);
    await finish(tester);
  });
}
