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
    await tester.tap(find.bySemanticsLabel('Notification settings'));
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

  testWidgets('Notifications, set your way: each kind by module, its ways, Off, and a sample (spec 0019)', (
    tester,
  ) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['ipo']));
    final saved = <dynamic>[];
    final samples = <dynamic>[];
    h.server.on(
      'GET /notifications/delivery',
      (_) => {
        'server': {'webpush': true, 'fcm': true},
        'devices': <dynamic>[],
      },
    );
    h.server.on(
      'GET /notifications/channels',
      (_) => {
        'email': 'asha@example.test',
        'whatsapp': {'available': true, 'masked': null, 'verified': false},
      },
    );
    h.server.on(
      'GET /notifications/catalog',
      (_) => {
        'modules': {'core': 'Security', 'ipo': 'IPO', 'chat': 'Chat'},
        'types': [
          {
            'key': 'security.new_device',
            'module': 'core',
            'label': 'New sign-in',
            'when': 'A device signs in',
            'ways': ['push', 'email'],
            'locked': true,
          },
          {
            'key': 'ipo.last_day',
            'module': 'ipo',
            'label': 'Last day: not applied yet',
            'when': '10 am on the close day',
            'ways': ['push'],
            'alarm': true,
          },
          {
            'key': 'ipo.closed',
            'module': 'ipo',
            'label': 'Bids closed',
            'when': 'The round summary',
            'ways': ['push'],
          },
          {
            'key': 'chat.message',
            'module': 'chat',
            'label': 'New message',
            'when': 'A message',
            'ways': ['push'],
          },
        ],
      },
    );
    h.server.on('PUT /notifications/settings', (r) {
      saved.add(r.body);
      return r.body;
    });
    h.server.on('POST /notifications/sample', (r) {
      samples.add(r.body);
      return {'ok': true};
    });
    await h.pump(tester);
    tester.view.physicalSize = const Size(1080, 8000);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.tap(find.bySemanticsLabel('Settings'));
    await settle(tester, 20);
    await tester.tap(find.bySemanticsLabel('Notification settings'));
    await settle(tester, 20);
    expect(find.text('What reaches you, and how'), findsOneWidget);
    // only the modules I have: Security and IPO, no Chat
    expect(find.text('Security'), findsOneWidget);
    expect(find.text('Chat'), findsNothing);
    await tapIt(tester, find.text('IPO'));
    expect(find.text('Last day: not applied yet'), findsOneWidget);
    // an alarm where it fits, and not on the summary
    expect(find.byKey(const Key('way-ipo.last_day-alarm')), findsOneWidget);
    expect(find.byKey(const Key('way-ipo.closed-alarm')), findsNothing);
    await tapIt(tester, find.byKey(const Key('way-ipo.last_day-alarm')));
    expect((saved.last as Map)['rules'], {
      'ipo.last_day': {
        'on': true,
        'ways': ['push', 'alarm'],
      },
    });
    await tapIt(tester, find.text('Sample').first);
    expect(samples.single, {'type': 'ipo.last_day'});
    // one of each: every kind I have (not Chat), a few seconds apart
    samples.clear();
    await tapIt(tester, find.text('Send one of each (3)'));
    for (var i = 0; i < 4; i++) {
      await tester.pump(const Duration(seconds: 7));
    }
    expect(samples, [
      {'type': 'security.new_device'},
      {'type': 'ipo.last_day'},
      {'type': 'ipo.closed'},
    ]);
    expect(find.text('Send one of each (3)'), findsOneWidget); // done, ready again
    await finish(tester);
  });
}
