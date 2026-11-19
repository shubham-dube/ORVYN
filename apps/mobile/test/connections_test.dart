import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import 'calendar_screen_test.dart' show tapIt;
import 'support/harness.dart';

void main() {
  testWidgets('a Meet meeting from Today, with attendees as chips; ClickUp tasks close from Today (spec 0007 C2)', (
    tester,
  ) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['today']));
    final sent = <dynamic>[];
    final closed = <dynamic>[];
    h.server.on(
      'GET /connections',
      (_) => [
        {
          'id': 'g1',
          'provider': 'google',
          'account': 'asha@work.test',
          'status': 'active',
          'capabilities': ['calendar', 'meet'],
        },
        {
          'id': 'c1',
          'provider': 'clickup',
          'account': 'asha@work.test',
          'status': 'active',
          'capabilities': ['tasks'],
        },
      ],
    );
    h.server.on(
      'GET /connections/clickup/tasks',
      (_) => [
        {
          'id': 'cu1',
          'connectionId': 'c1',
          'name': 'Review the Q4 deck',
          'url': 'https://app.clickup.com/t/cu1',
          'status': 'in progress',
          'list': 'Sprint',
        },
      ],
    );
    h.server.on('POST /connections/clickup/tasks/cu1/complete', (r) {
      closed.add(r.body);
      return {'ok': true};
    });
    h.server.on('POST /calendar/meetings', (r) {
      sent.add(r.body);
      return {
        'eventId': 'e1',
        'meetUrl': 'https://meet.google.com/abc-defg-hij',
        'htmlLink': null,
        'account': 'asha@work.test',
      };
    });
    await h.pump(tester);
    tester.view.physicalSize = const Size(1170, 4000);
    await tester.tap(find.bySemanticsLabel('Today'));
    await settle(tester, 20);

    expect(find.text('Review the Q4 deck'), findsOneWidget);
    await tapIt(tester, find.byTooltip('Done: Review the Q4 deck'));
    expect(closed, [
      {'connectionId': 'c1'},
    ]);

    await tester.tap(find.byTooltip('Schedule a meeting'));
    await settle(tester);
    await tester.enterText(
      find.descendant(of: find.byType(BottomSheet), matching: find.byType(TextField)).first,
      'Design review',
    );
    await tester.enterText(find.byKey(const Key('meeting-who')), 'raj@example.test, ');
    await settle(tester);
    expect(find.widgetWithText(InputChip, 'raj@example.test'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('meeting-who')), 'mia@example.test');
    await tester.tap(find.text('Schedule'));
    await settle(tester);
    expect(sent.single, containsPair('title', 'Design review'));
    expect(sent.single, containsPair('accountId', 'g1'));
    expect(sent.single['attendees'], ['raj@example.test', 'mia@example.test']);
    expect(find.text('https://meet.google.com/abc-defg-hij'), findsOneWidget);
    await finish(tester);
  });
}
