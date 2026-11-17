import 'package:flutter_test/flutter_test.dart';
import 'package:orvyn/core/actions.dart';
import 'package:orvyn/core/api.dart';
import 'package:orvyn/core/session_store.dart';

import 'support/fake_server.dart';
import 'support/harness.dart';

void main() {
  group('a shade button pressed while the app is closed', () {
    test('signs in with the stored session, then presses the button', () async {
      final server = FakeServer();
      final store = MemorySessionStore()..values['refresh'] = 'r0';
      server.on('POST /auth/refresh', (_) => sessionJson(userJson(), access: 'fresh', refresh: 'r1'));
      String? auth;
      server.on('POST /notifications/n1/actions/done', (r) {
        auth = r.bearer;
        return {'ok': true};
      });
      final ok = await runNotificationAction(
        Api(baseUrl: 'http://api.test', store: store, adapter: server),
        'n1',
        'done',
      );
      expect(ok, isTrue);
      expect(auth, 'fresh');
      expect(store.values['refresh'], 'r1', reason: 'the rotated token is saved for the app');
    });

    test('offline or signed out: nothing happens and nothing is lost', () async {
      final server = FakeServer()..on('POST /auth/refresh', (_) => const Reply(401));
      final store = MemorySessionStore()..values['refresh'] = 'gone';
      expect(
        await runNotificationAction(Api(baseUrl: 'http://api.test', store: store, adapter: server), 'n1', 'done'),
        isFalse,
      );
      expect(
        await runNotificationAction(
          Api(baseUrl: 'http://api.test', store: MemorySessionStore(), adapter: FakeServer()),
          'n1',
          'done',
        ),
        isFalse,
      );
    });
  });

  testWidgets('reminder buttons in the app, and taps on the phone’s own notifications', (tester) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['today']));
    final pressed = <String>[];
    h.server.on('POST /notifications/r1/actions/done', (_) {
      pressed.add('r1:done');
      return {'ok': true};
    });
    h.server.on('POST /notifications/r2/actions/snooze_10m', (_) {
      pressed.add('r2:snooze_10m');
      return {'ok': true};
    });
    await h.pump(tester);
    Map<String, dynamic> reminder(String id, String title) => {
      ...notificationJson(id, title, body: 'In 10 min · 6:00 pm', module: 'today'),
      'kind': 'reminder',
      'actions': [
        {'id': 'done', 'label': 'Done'},
        {'id': 'snooze_10m', 'label': 'Snooze 10 min'},
        {'id': 'later_today', 'label': 'Later today'},
        {'id': 'tomorrow', 'label': 'Tomorrow'},
      ],
    };
    h.sockets.push({'type': 'notify.new', 'notification': reminder('r1', 'Call the bank')});
    await settle(tester);
    await tester.tap(find.bySemanticsLabel(RegExp('Notifications, 1 unread')));
    await settle(tester);
    expect(find.text('Snooze 10 min'), findsOneWidget);
    expect(find.text('Tomorrow'), findsOneWidget);
    await tester.tap(find.text('Done').last);
    await settle(tester);
    expect(pressed, ['r1:done']);
    expect(h.pusher.cleared, contains('r1'));
    await tester.tapAt(const Offset(10, 10)); // close the sheet
    await settle(tester);

    // a button pressed in the shade while ORVYN is open
    h.pusher.tapController.add({'id': 'r2', 'url': '/today', 'action': 'snooze_10m'});
    await settle(tester);
    expect(pressed, ['r1:done', 'r2:snooze_10m']);

    // a tap on the body opens where it points
    h.pusher.tapController.add({'id': 'r3', 'url': '/settings', 'action': null});
    h.server.on('POST /notifications/r3/read', (_) => {'ok': true});
    await settle(tester);
    expect(find.text('Settings'), findsWidgets);
    await tester.pump(const Duration(seconds: 6));
    await finish(tester);
  });
}
