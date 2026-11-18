import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import 'calendar_screen_test.dart' show tapIt;
import 'support/harness.dart';

void main() {
  testWidgets('Settings shows whether this phone can ring, each device’s delivery, and a test that explains', (
    tester,
  ) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['today']));
    h.server.on(
      'GET /notifications/delivery',
      (_) => {
        'server': {'webpush': true, 'fcm': false},
        'devices': [
          {'id': 'd-phone', 'name': 'Pixel 8', 'platform': 'android', 'live': true, 'push': []},
          {
            'id': 'd-win',
            'name': 'Chrome on Windows',
            'platform': 'web',
            'live': false,
            'push': [
              {
                'id': 't1',
                'channel': 'webpush',
                'active': true,
                'lastResult': 'failed',
                'lastError': '403 VAPID mismatch',
              },
            ],
          },
        ],
      },
    );
    h.server.on(
      'POST /notifications/test',
      (_) => {
        'id': 'n1',
        'live': ['d-phone'],
        'push': [
          {'deviceId': 'd-win', 'channel': 'webpush', 'outcome': 'failed', 'detail': '403 VAPID mismatch'},
        ],
      },
    );
    await h.pump(tester);
    tester.view.physicalSize = const Size(1080, 6000);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.tap(find.bySemanticsLabel('Settings'));
    await settle(tester, 20);
    expect(find.text('Notifications allowed'), findsOneWidget);
    expect(find.text('Needs “Alarms & reminders” for ORVYN.'), findsOneWidget);
    expect(find.text('Android push isn’t set up on the server yet (FCM).'), findsOneWidget);
    expect(find.text('Push failing: 403 VAPID mismatch'), findsOneWidget);
    expect(find.text('Open now · gets notifications only while open'), findsOneWidget);

    await tapIt(tester, find.text('Allow').first); // alarms (notifications are already allowed)
    expect(h.phone.asked, contains('exact'));
    await tapIt(tester, find.text('Test every device'));
    expect(find.text('Delivered live.'), findsOneWidget);
    expect(find.text('failed: 403 VAPID mismatch'), findsOneWidget);
    await finish(tester);
  });
}
