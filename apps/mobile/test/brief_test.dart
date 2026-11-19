import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

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
        'sections': [
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
        'sections': ['agenda', 'money', 'drop', 'library', 'work', 'mail'],
        'nudges': {
          'enabled': true,
          'kinds': ['slipped', 'budget', 'payments', 'drop'],
          'max': 2,
        },
      },
    );
    h.server.on('PUT /brief/settings', (r) {
      saved.add(r.body);
      return r.body;
    });
    await h.pump(tester);
    tester.view.physicalSize = const Size(1170, 4000);
    addTearDown(tester.view.reset);
    await settle(tester, 20);
    expect(find.text('2 meetings, 2 tasks · first at 11:00'), findsOneWidget); // the Home card
    await tester.tap(find.bySemanticsLabel('Open your Brief'));
    await settle(tester, 20);
    expect(find.text('Standup'), findsOneWidget);
    expect(find.text('Ship release notes'), findsOneWidget);
    expect(find.text('90% of ₹10,000'), findsOneWidget);

    await tapIt(tester, find.text('Turn it on'));
    await tapIt(tester, find.widgetWithText(SwitchListTile, 'Morning Brief'));
    await tapIt(tester, find.widgetWithText(CheckboxListTile, 'Payments waiting'));
    await tapIt(tester, find.text('Save'));
    expect(saved.single, containsPair('enabled', true));
    expect((saved.single as Map)['nudges'], {
      'enabled': true,
      'kinds': ['slipped', 'budget', 'drop'],
      'max': 2,
    });
    expect(find.text('Your Brief comes at 07:30'), findsOneWidget);
    await finish(tester);
  });
}
