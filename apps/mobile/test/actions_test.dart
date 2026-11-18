import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
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

  testWidgets('a payment question answered by typing, in the app and from the shade (spec 0007 C1)', (tester) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['money']));
    final sent = <Object?>[];
    for (final id in ['m1', 'm2']) {
      h.server.on('POST /notifications/$id/actions/reply', (r) {
        sent.add(r.body);
        return {'ok': true};
      });
    }
    await h.pump(tester);
    h.sockets.push({
      'type': 'notify.new',
      'notification': {
        ...notificationJson('m1', '₹240 at Swiggy', body: 'What was it?', module: 'money'),
        'kind': 'review',
        'actions': [
          {'id': 'c.food', 'label': 'Food & dining'},
          {'id': 'reply', 'label': 'Reply', 'reply': {'placeholder': 'food · split 3 · not mine'}},
          {'id': 'ignore', 'label': 'Not mine'},
        ],
      },
    });
    await settle(tester);
    await tester.tap(find.bySemanticsLabel(RegExp('Notifications, 1 unread')));
    await settle(tester);
    expect(find.text('Food & dining'), findsOneWidget);
    expect(find.text('Not mine'), findsOneWidget);
    expect(find.text('Reply'), findsNothing, reason: 'a reply is a box, not a button');
    await tester.enterText(find.byKey(const Key('reply-Reply to ₹240 at Swiggy')), 'split 3 food');
    await tester.testTextInput.receiveAction(TextInputAction.send);
    await settle(tester);
    expect(sent, [
      {'text': 'split 3 food'},
    ]);
    await tester.tapAt(const Offset(10, 10));
    await settle(tester);

    // typed into the reply box in the shade while ORVYN is open
    h.pusher.tapController.add({'id': 'm2', 'url': '/money', 'action': 'reply', 'input': ' always groceries '});
    await settle(tester);
    expect(sent.last, {'text': 'always groceries'});
    await tester.pump(const Duration(seconds: 6));
    await finish(tester);
  });
}
