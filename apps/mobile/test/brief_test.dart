import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:orvyn/design/controls.dart';

import 'calendar_screen_test.dart' show tapIt;
import 'support/harness.dart';

void main() {
  testWidgets('the Brief on Home and in its screen; turned on from its settings (spec 0009)', (tester) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['today', 'brief', 'money']));
    final saved = <dynamic>[];
    h.server.on(
      'GET /brief/today',
      (_) => {
        'day': '2026-11-21',
        'generatedAt': '2026-11-21T04:00:00Z',
        'headline': '2 meetings, 2 tasks · first at 11:00',
        'line': 'Standup 11:00 · ₹9,000 yesterday',
        'greeting': 'Good morning, Asha',
        'story': 'Two meetings today, and the release notes come first.',
        'tip': 'Use 11:15 to 12:15 for them.',
        'sections': [
          {
            'kind': 'weather',
            'place': 'Bengaluru',
            'now': 24,
            'feels': 25,
            'high': 29,
            'low': 19,
            'rain': 70,
            'code': 61,
            'sky': 'Light rain',
            'sunrise': '06:21',
            'sunset': '17:49',
            'advice': 'Rain likely from 4 pm — carry an umbrella.',
          },
          {
            'kind': 'focus',
            'items': [
              {
                'id': 't1',
                'title': 'Ship release notes',
                'priority': 3,
                'overdue': false,
                'due': '2026-11-21',
                'minutes': 60,
                'slot': {'start': '2026-11-21T05:45:00Z', 'end': '2026-11-21T06:45:00Z'},
                'planned': false,
              },
            ],
            'free': [
              {'start': '2026-11-21T05:45:00Z', 'end': '2026-11-21T09:30:00Z'},
            ],
          },
          {
            'kind': 'agenda',
            'events': [
              {
                'title': 'Standup',
                'at': '2026-11-21T05:30:00Z',
                'until': '2026-11-21T05:45:00Z',
                'allDay': false,
                'location': null,
              },
            ],
            'dueToday': 2,
            'overdue': 1,
            'top': [
              {'id': 't1', 'title': 'Ship release notes', 'priority': 3, 'overdue': false},
            ],
          },
          {
            'kind': 'money',
            'yesterdayMinor': 900000,
            'monthMinor': 900000,
            'budgets': [
              {'name': 'Food', 'spentMinor': 900000, 'amountMinor': 1000000},
            ],
            'toReview': 0,
          },
        ],
      },
    );
    h.server.on(
      'GET /brief/settings',
      (_) => {
        'enabled': false,
        'at': '07:30',
        'ai': true,
        'place': {'name': 'Bengaluru, Karnataka, India', 'lat': 12.97, 'lon': 77.59},
        'sections': ['weather', 'focus', 'agenda', 'money', 'drop', 'library', 'work', 'mail'],
        'nudges': {
          'enabled': true,
          'kinds': ['slipped', 'budget', 'payments', 'drop'],
          'max': 2,
        },
      },
    );
    final planned = <dynamic>[];
    h.server.on('POST /brief/plan', (r) {
      planned.add(r.body);
      return {'ok': true};
    });
    h.server.on('POST /brief/today/refresh', (_) => {'ok': true});
    h.server.on('PUT /brief/settings', (r) {
      saved.add(r.body);
      return r.body;
    });
    await h.pump(tester);
    tester.view.physicalSize = const Size(1170, 4000);
    addTearDown(tester.view.reset);
    await settle(tester, 20);
    // the Home card: the greeting with the weather, and the AI's opening
    expect(find.text('Good morning, Asha · 24°'), findsOneWidget);
    await tester.tap(find.bySemanticsLabel('Open your Brief'));
    await settle(tester, 20);
    expect(find.text('Good morning, Asha'), findsOneWidget);
    expect(find.text('Two meetings today, and the release notes come first.'), findsOneWidget);
    expect(find.text('Use 11:15 to 12:15 for them.'), findsOneWidget);
    expect(find.text('Rain likely from 4 pm — carry an umbrella.'), findsOneWidget);
    expect(find.text('Standup'), findsOneWidget);
    expect(find.text('Ship release notes'), findsOneWidget);
    expect(find.text('90% of ₹10,000'), findsOneWidget);

    // Plan it: the task goes into its free slot
    await tapIt(tester, find.byKey(const Key('plan-t1')));
    expect(planned.single, {'taskId': 't1', 'start': '2026-11-21T05:45:00Z', 'minutes': 60});

    await tapIt(tester, find.text('Turn it on'));
    await tapIt(
      tester,
      find.descendant(of: find.widgetWithText(OrvSwitchRow, 'Morning Brief at 07:30'), matching: find.byType(Switch)),
    );
    await tapIt(tester, find.text('Payments waiting'));
    await tapIt(tester, find.text('Save'));
    expect(saved.single, containsPair('enabled', true));
    expect(saved.single, containsPair('ai', true));
    expect((saved.single as Map)['place'], containsPair('name', 'Bengaluru, Karnataka, India'));
    expect((saved.single as Map)['nudges'], {
      'enabled': true,
      'kinds': ['slipped', 'budget', 'drop'],
      'max': 2,
    });
    expect(find.text('Your Brief comes at 07:30'), findsOneWidget);
    await finish(tester);
  });
}
