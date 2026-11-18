import 'package:flutter_test/flutter_test.dart';
import 'package:orvyn/app/reminder_ways.dart';
import 'package:orvyn/core/alarm.dart';
import 'package:orvyn/core/push.dart';
import 'package:orvyn/app/today_settings.dart';

import 'calendar_screen_test.dart' show seed;
import 'support/fake_server.dart';
import 'support/harness.dart';

void main() {
  // the same cases as reminderPlan in packages/contracts/test/today-settings.test.ts
  final t = {'reminders': null, 'dueAt': '2026-11-20T10:00:00+05:30', 'scheduledStart': null, 'dueDate': null};
  final defaults = {
    'timed': [60, 10],
    'dateOnly': {'mode': 'none'},
    'overdueInDigest': false,
  };

  test('defaults: each lead by the default ways; a normal notification if none chosen', () {
    expect(reminderPlan(t, defaults).map((r) => '${r.minutes}:${r.via.join('+')}'), ['60:push', '10:push']);
    expect(
      reminderPlan(t, {
        ...defaults,
        'via': ['alarm', 'email'],
      }).first.via,
      ['alarm', 'email'],
    );
  });

  test('a task’s own reminders keep their own ways, else the defaults; [] means none', () {
    final own = reminderPlan(
      {
        ...t,
        'reminders': [
          {
            'kind': 'before',
            'minutes': 5,
            'via': ['urgent'],
          },
          {'kind': 'at', 'at': '2026-11-20T04:00:00Z'},
        ],
      },
      {
        ...defaults,
        'via': ['whatsapp'],
      },
    );
    expect(own.map((r) => '${r.minutes}|${r.at}|${r.via.join('+')}'), [
      '5|null|urgent',
      'null|2026-11-20T04:00:00Z|whatsapp',
    ]);
    expect(reminderPlan({...t, 'reminders': <Map<String, dynamic>>[]}, defaults), isEmpty);
    expect(reminderPlan({...t, 'dueAt': null}, defaults), isEmpty);
    expect(waysLabel(['push', 'alarm', 'email']), 'Notification, Alarm and Email');
  });

  test('alarms: only open tasks whose reminders include Alarm, in the future, ringing at the lead time', () {
    final now = DateTime(2026, 11, 16, 9, 30);
    String at(int h, int m) => DateTime(2026, 11, 16, h, m).toUtc().toIso8601String();
    final slots = planAlarms(
      [
        (
          id: 'a',
          data: {
            'title': 'Flight',
            'dueAt': at(14, 0),
            'reminders': [
              {
                'kind': 'before',
                'minutes': 60,
                'via': ['alarm'],
              },
            ],
          },
        ),
        (
          id: 'b',
          data: {
            'title': 'Plain',
            'dueAt': at(15, 0),
            'reminders': [
              {
                'kind': 'before',
                'minutes': 10,
                'via': ['push'],
              },
            ],
          },
        ),
        (
          id: 'c',
          data: {
            'title': 'Done',
            'dueAt': at(16, 0),
            'completedAt': at(9, 0),
            'reminders': [
              {
                'kind': 'before',
                'minutes': 5,
                'via': ['alarm'],
              },
            ],
          },
        ),
        (
          id: 'd',
          data: {
            'title': 'Past',
            'dueAt': at(9, 40),
            'reminders': [
              {
                'kind': 'before',
                'minutes': 30,
                'via': ['alarm'],
              },
            ],
          },
        ),
        (id: 'e', data: {'title': 'By default', 'dueAt': at(18, 0), 'reminders': null}),
      ],
      {
        'timed': [10],
        'dateOnly': {'mode': 'none'},
        'overdueInDigest': false,
        'via': ['push', 'alarm'],
      },
      now,
    );
    expect(slots.map((s) => '${s.title}|${s.at}|${s.body}'), [
      '${'Flight'}|${DateTime(2026, 11, 16, 13, 0)}|In 60 min · 2:00 pm',
      '${'By default'}|${DateTime(2026, 11, 16, 17, 50)}|In 10 min · 6:00 pm',
    ]);
    expect(slots.first.id, alarmId('a', DateTime(2026, 11, 16, 13, 0)), reason: 'stable, so re-planning replaces');
  });

  test('a pushed alarm is flagged to ring', () {
    final p = PushCommand.parse({
      'type': 'notify',
      'id': 'n1',
      'title': 'Flight',
      'alarm': 'true',
      'priority': 'urgent',
    });
    expect((p as ShowPush).alarm, isTrue);
    expect((PushCommand.parse({'type': 'notify', 'id': 'n2', 'title': 'x'}) as ShowPush).alarm, isFalse);
  });

  testWidgets('the phone keeps its alarms in step with the synced tasks and the person’s defaults', (tester) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['today']));
    final b = FakeSyncBackend()..attach(h.server);
    final soon = h.now.add(const Duration(hours: 3));
    seed(b, todaySettingsEntity, ownerId, {
      ...startingSettings('Asia/Kolkata'),
      'reminders': {
        'timed': [10],
        'dateOnly': {'mode': 'none'},
        'overdueInDigest': false,
        'via': ['alarm'],
      },
    });
    seed(b, 'today.task', 't1', {'title': 'Catch the train', 'dueAt': soon.toUtc().toIso8601String()});
    await h.pump(tester);
    await settle(tester, 30);
    expect(h.alarms.current.map((s) => s.title), ['Catch the train']);
    expect(h.alarms.current.single.at, soon.subtract(const Duration(minutes: 10)));
    await finish(tester);
  });
}
