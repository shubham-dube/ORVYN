import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:orvyn/app/today.dart';

import 'calendar_screen_test.dart' show seed, tapIt;
import 'support/fake_server.dart';
import 'support/harness.dart';

// The harness clock is Monday 16 Nov 2026, 09:30.
String iso(DateTime d) => d.toUtc().toIso8601String();

final _clickup = {
  'id': 'c1',
  'provider': 'clickup',
  'account': 'asha@work.test',
  'status': 'active',
  'capabilities': ['tasks'],
};

J task(String id, String name, String status, {bool working = true, int tracked = 0}) => {
  'id': id,
  'connectionId': 'c1',
  'teamId': '901',
  'name': name,
  'url': 'https://app.clickup.com/t/$id',
  'status': status,
  'statusColor': '#1090e0',
  'statusType': 'custom',
  'working': working,
  'list': 'Sprint 12',
  'trackedMin': tracked,
};

typedef J = Map<String, dynamic>;

Future<FakeSyncBackend> openToday(WidgetTester tester, AppHarness h, [void Function(FakeSyncBackend)? seeds]) async {
  final b = FakeSyncBackend()..attach(h.server);
  seeds?.call(b);
  await h.pump(tester);
  tester.view.physicalSize = const Size(1080, 4800);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.tap(find.bySemanticsLabel('Today'));
  await settle(tester, 20);
  return b;
}

void main() {
  group('when it was done (spec 0012 A1)', () {
    final now = DateTime(2026, 11, 22, 12); // a Sunday
    test('the row says when, the way you would', () {
      expect(doneLabel(DateTime(2026, 11, 22, 15, 40), now), 'Done 3:40 pm');
      expect(doneLabel(DateTime(2026, 11, 22, 0, 5), now), 'Done 12:05 am');
      expect(doneLabel(DateTime(2026, 11, 21, 18, 10), now), 'Done yesterday, 6:10 pm');
      expect(doneLabel(DateTime(2026, 11, 16, 9), now), 'Done Mon, 9:00 am');
      expect(doneLabel(DateTime(2026, 11, 12, 9), now), 'Done 12 Nov');
      expect(doneLabel(DateTime(2025, 11, 18, 9), now), 'Done 18 Nov 2025');
      expect(doneLabel(DateTime(2026, 11, 16, 18, 10), now, long: true), 'Done on Mon 16 Nov, 6:10 pm');
    });
    test('and groups the Done tab by day', () {
      expect(doneDayHeader(DateTime(2026, 11, 22, 8), now), 'Today');
      expect(doneDayHeader(DateTime(2026, 11, 21, 23), now), 'Yesterday');
      expect(doneDayHeader(DateTime(2026, 11, 16, 8), now), 'Mon 16 Nov');
    });
    test('a task with only a deadline that has come is in Today, not the Inbox', () {
      final n = DateTime(2026, 11, 16, 9, 30);
      final g = groupTasks([
        TaskItem('dl', {'title': 'Tax', 'deadline': '2026-11-16'}),
        TaskItem('later', {'title': 'Visa', 'deadline': '2026-12-01'}),
      ], n);
      expect(g.today.map((t) => t.id), ['dl']);
      expect(g.inbox.map((t) => t.id), ['later']);
    });
  });

  testWidgets('the Done tab shows each day with when every task was done', (tester) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['today']));
    await openToday(tester, h, (b) {
      seed(b, 'today.task', 'a', {'title': 'Send invoice', 'completedAt': iso(DateTime(2026, 11, 16, 8, 15))});
      seed(b, 'today.task', 'b', {'title': 'Fix the tap', 'completedAt': iso(DateTime(2026, 11, 15, 18, 10))});
      seed(b, 'today.task', 'c', {'title': 'Book flights', 'completedAt': iso(DateTime(2026, 11, 11, 10))});
    });
    await tapIt(tester, find.text('Done'));
    expect(find.text('TODAY'), findsOneWidget);
    expect(find.text('YESTERDAY'), findsOneWidget);
    expect(find.text('WED 11 NOV'), findsOneWidget);
    expect(find.text('Done 8:15 am'), findsOneWidget);
    expect(find.text('Done yesterday, 6:10 pm'), findsOneWidget);
    expect(find.text('Done Wed, 10:00 am'), findsOneWidget);
    await finish(tester);
  });

  testWidgets('ClickUp in Today: a breathing placeholder while it loads, never "nothing assigned" (spec 0012 B6)', (
    tester,
  ) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['today']));
    final answer = Completer<Object?>();
    h.server.on('GET /connections', (_) => [_clickup]);
    h.server.on('GET /connections/clickup/tasks', (_) => answer.future);
    h.server.on('GET /connections/clickup/timer', (_) => {'timer': null});
    await openToday(tester, h);
    expect(find.text('WORKING ON'), findsOneWidget);
    expect(find.bySemanticsLabel('Loading'), findsWidgets);
    expect(find.textContaining('Nothing open is assigned'), findsNothing);
    answer.complete([task('a1', 'Login page', 'design'), task('a3', 'Footer', 'fixed', working: false)]);
    await settle(tester, 20);
    expect(find.text('Login page'), findsOneWidget);
    expect(find.text('Footer'), findsNothing);
    expect(find.text('1 more in other statuses'), findsOneWidget);
    await finish(tester);
  });

  testWidgets('a ClickUp task without opening ClickUp: timer, time by duration, a comment (spec 0012 B3)', (
    tester,
  ) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['today']));
    final posts = <String, dynamic>{};
    J? running;
    h.server.on('GET /connections', (_) => [_clickup]);
    h.server.on('GET /connections/clickup/tasks', (_) => [task('a1', 'Login page', 'design', tracked: 90)]);
    h.server.on('GET /connections/clickup/timer', (_) => {'timer': running});
    h.server.on(
      'GET /connections/clickup/tasks/a1',
      (_) => {
        'task': {
          ...task('a1', 'Login page', 'design', tracked: 90),
          'description': 'Mobile first',
          'assignees': <dynamic>[],
          'subtasks': <dynamic>[],
        },
        'statuses': [
          {'name': 'design', 'color': '#a875ff', 'type': 'custom'},
          {'name': 'in development', 'color': '#1090e0', 'type': 'custom'},
        ],
        'comments': [
          {
            'id': 'c1',
            'text': 'Use the new tokens',
            'by': {'name': 'Ravi', 'initials': 'R'},
            'at': '2026-11-16T03:00:00.000Z',
            'mine': false,
          },
        ],
        'time': <dynamic>[],
      },
    );
    h.server.on('POST /connections/clickup/timer/start', (r) {
      posts['start'] = r.body;
      running = {
        'connectionId': 'c1',
        'teamId': '901',
        'entryId': 'run1',
        'taskId': 'a1',
        'taskName': 'Login page',
        'startedAt': '2026-11-16T04:00:00.000Z',
      };
      return {'timer': running};
    });
    h.server.on('POST /connections/clickup/tasks/a1/time', (r) {
      posts['time'] = r.body;
      return {'id': 't2', 'minutes': 90};
    });
    h.server.on('POST /connections/clickup/tasks/a1/comments', (r) {
      posts['comment'] = r.body;
      return {'id': 'c2', 'at': '2026-11-16T04:00:00.000Z'};
    });
    await openToday(tester, h);

    await tapIt(tester, find.text('Login page'));
    expect(find.text('Mobile first'), findsOneWidget);
    expect(find.text('Use the new tokens'), findsOneWidget);
    Finder inSheet(Finder f) => find.descendant(of: find.byType(BottomSheet), matching: f);
    expect(inSheet(find.text('1h 30m')), findsOneWidget, reason: 'tracked by everyone');

    await tapIt(tester, find.bySemanticsLabel('Start the timer'));
    expect(posts['start'], containsPair('taskId', 'a1'));
    expect(posts['start'], containsPair('teamId', '901'));

    await tapIt(tester, find.text('Add time'));
    await tapIt(tester, inSheet(find.text('1h 30m')).last);
    await tapIt(tester, find.text('Log 1h 30m'));
    expect(posts['time'], containsPair('durationMin', 90));
    expect(posts['time'], containsPair('teamId', '901'));
    expect(DateTime.parse(posts['time']['start'] as String).isBefore(DateTime.now()), isTrue);

    await tester.enterText(find.byKey(const Key('clickup-comment')), 'Done on mobile');
    await settle(tester);
    await tapIt(tester, find.bySemanticsLabel('Send comment'));
    expect(posts['comment'], {'connectionId': 'c1', 'text': 'Done on mobile'});
    await tester.pump(const Duration(seconds: 5));
    await finish(tester);
  });

  testWidgets('meetings in the list: time, length and Join; ended ones fold away by themselves (spec 0012 M)', (
    tester,
  ) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['today']));
    await openToday(tester, h, (b) {
      seed(b, 'today.calendar', 'cal', {'name': 'Work', 'colour': 'violet', 'visible': true});
      seed(b, 'today.event', 'stand', {
        'title': 'Standup',
        'start': iso(DateTime(2026, 11, 16, 9)),
        'end': iso(DateTime(2026, 11, 16, 9, 15)),
        'calendarId': 'cal',
      });
      seed(b, 'today.event', 'design', {
        'title': 'Design review',
        'start': iso(DateTime(2026, 11, 16, 9, 35)),
        'end': iso(DateTime(2026, 11, 16, 10, 20)),
        'location': 'https://meet.google.com/abc-defg-hij',
        'calendarId': 'cal',
      });
    });
    expect(find.text('SCHEDULE'), findsOneWidget);
    expect(find.text('Design review'), findsOneWidget);
    expect(find.text('45m'), findsOneWidget);
    expect(find.text('In 5 min'), findsOneWidget, reason: 'starting soon');
    expect(find.text('Join'), findsOneWidget);
    // the standup ended at 9:15: folded under "Earlier today"
    expect(find.text('Standup'), findsNothing);
    await tapIt(tester, find.text('Earlier today (1)'));
    expect(find.text('Standup'), findsOneWidget);
    expect(find.text('Ended'), findsOneWidget);
    await finish(tester);
  });

  testWidgets('public holidays from four Google accounts show once, and one tap hides them all (spec 0014)', (
    tester,
  ) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['today']));
    final b = await openToday(tester, h, (b) {
      for (final n in [1, 2, 3, 4]) {
        seed(b, 'today.calendar', 'hol$n', {
          'name': 'Holidays in India',
          'colour': 'amber',
          'visible': true,
          'externalId': 'en.indian#holiday@group.v.calendar.google.com',
        });
        seed(b, 'today.event', 'gn$n', {
          'title': 'Guru Nanak Jayanti',
          'allDay': true,
          'startDate': '2026-11-16',
          'endDate': '2026-11-17',
          'calendarId': 'hol$n',
        });
      }
      seed(b, 'today.calendar', 'cal', {'name': 'Work', 'colour': 'violet', 'visible': true});
    });
    expect(find.text('Guru Nanak Jayanti'), findsOneWidget, reason: 'the same holiday from four calendars is one');
    await tapIt(tester, find.byKey(const Key('hide-holidays')));
    await settle(tester, 30);
    for (final n in [1, 2, 3, 4]) {
      expect(b.rows['today.calendar/hol$n']!['visible'], false);
    }
    expect(b.rows['today.calendar/cal']!['visible'], true, reason: 'only holiday calendars');
    expect(find.text('Guru Nanak Jayanti'), findsNothing);
    await finish(tester);
  });

  testWidgets('quick add: no day written → the Inbox chip; ⤢ opens the full form with what was typed', (tester) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['today']));
    h.server.on(
      'POST /today/parse',
      (_) => {
        'title': 'Review PR', 'dueDate': null, 'dueAt': null, 'priority': 2, 'tags': <String>[], //
        'deadline': '2026-11-20', 'notes': 'check the nav',
        'spans': [
          {'kind': 'priority', 'text': '!!', 'start': 10, 'end': 12},
          {'kind': 'deadline', 'text': 'by fri', 'start': 13, 'end': 19},
          {'kind': 'notes', 'text': '// check the nav', 'start': 20, 'end': 36},
        ],
      },
    );
    final b = await openToday(tester, h);
    await tester.enterText(find.byKey(const Key('quick-add')), 'review PR !! by fri // check the nav');
    await tester.pump(const Duration(milliseconds: 300));
    await settle(tester);
    expect(find.text('Inbox · pick a day'), findsOneWidget);
    expect(find.text('by Fri'), findsOneWidget);
    expect(find.text('Medium'), findsOneWidget);
    await tapIt(tester, find.byKey(const Key('quick-add-expand')));
    expect(find.text('New task'), findsOneWidget);
    expect(
      find.descendant(of: find.byType(BottomSheet), matching: find.text('by Fri')),
      findsOneWidget,
      reason: 'the deadline came along',
    );
    await tapIt(tester, find.byKey(const Key('task-save')));
    final row = b.rows.values.single;
    expect(row, containsPair('title', 'Review PR'));
    expect(row, containsPair('deadline', '2026-11-20'));
    expect(row, containsPair('notes', 'check the nav'));
    expect(row, containsPair('priority', 2));
    expect(row['dueDate'], isNull);
    await tester.pump(const Duration(seconds: 5));
    await finish(tester);
  });
}
