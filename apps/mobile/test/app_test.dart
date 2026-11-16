import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:orvyn/design/orb.dart';
import 'package:orvyn/sync/db.dart';

import 'support/fake_server.dart';
import 'support/harness.dart';

void main() {
  testWidgets('signed out: email code sign-in lands on home with only the granted modules', (tester) async {
    final h = AppHarness();
    final user = userJson(ent: ['today']);
    String? sentEmail;
    h.server.on('POST /auth/email/start', (r) {
      sentEmail = r.body['email'] as String;
      return {'sent': true};
    });
    Map<String, dynamic>? verifyBody;
    h.server.on('POST /auth/email/verify', (r) {
      verifyBody = Map<String, dynamic>.from(r.body as Map);
      return sessionJson(user);
    });
    h.server.on('GET /me', (_) => user);
    await h.pump(tester);

    expect(find.text('Welcome back'), findsOneWidget);
    await tester.enterText(find.byType(TextField).first, 'Asha@Example.test ');
    await tester.tap(find.text('Email me a code'));
    await settle(tester);
    expect(sentEmail, 'asha@example.test');
    expect(find.text('CHECK YOUR INBOX'), findsOneWidget);

    await tester.enterText(find.byKey(const Key('code-field')), '123456');
    await settle(tester, 20);
    expect(verifyBody?['code'], '123456');
    expect((verifyBody?['device'] as Map?)?['platform'], 'android');

    expect(find.text('Good morning, Asha'), findsOneWidget);
    expect(find.text('Tasks and calendar on one river of time'), findsOneWidget);
    expect(find.text('IPO desk'), findsNothing);
    expect(h.store.values['refresh'], 'refresh-1', reason: 'native refresh token kept in secure storage');
    expect(h.sockets.sockets, hasLength(1), reason: 'realtime connects after sign-in');
  });

  testWidgets('a wrong code says so and lets the person try again', (tester) async {
    final h = AppHarness();
    h.server.on('POST /auth/email/start', (_) => {'sent': true});
    h.server.on(
      'POST /auth/email/verify',
      (_) => const Reply(401, {
        'error': {'code': 'invalid_code', 'message': 'x'},
      }),
    );
    await h.pump(tester);
    await tester.enterText(find.byType(TextField).first, 'asha@example.test');
    await tester.tap(find.text('Email me a code'));
    await settle(tester);
    await tester.enterText(find.byKey(const Key('code-field')), '000000');
    await settle(tester);
    expect(find.textContaining('That code isn’t right'), findsOneWidget);
  });

  testWidgets('live: a notification arrives, glows, and dismissing it clears it everywhere', (tester) async {
    final h = AppHarness()..signedInAs(userJson());
    var dismissed = '';
    h.server.on('POST /notifications/n1/dismiss', (r) {
      dismissed = 'n1';
      return {'ok': true};
    });
    await h.pump(tester);
    expect(find.bySemanticsLabel('Notifications'), findsOneWidget);

    h.sockets.push({
      'type': 'notify.new',
      'notification': notificationJson('n1', 'Hello from ORVYN', body: 'It works'),
    });
    await settle(tester);
    expect(find.bySemanticsLabel('Notifications, 1 unread'), findsOneWidget);
    expect(find.text('Hello from ORVYN'), findsWidgets, reason: 'toast + needs-you card');

    await tester.tap(find.bySemanticsLabel('Notifications, 1 unread'));
    await settle(tester);
    await tester.tap(find.bySemanticsLabel('Dismiss Hello from ORVYN'));
    await settle(tester);
    expect(dismissed, 'n1');
    expect(h.pusher.cleared, contains('n1'), reason: 'the shade copy goes too');
  });

  testWidgets('dismissed on another device: it disappears here too', (tester) async {
    final h = AppHarness()..signedInAs(userJson());
    h.server.on(
      'GET /notifications',
      (_) => {
        'items': [notificationJson('n2', 'Pay rent')],
        'unread': 1,
      },
    );
    await h.pump(tester);
    expect(find.text('Pay rent'), findsOneWidget);
    h.sockets.push({'type': 'notify.dismissed', 'id': 'n2'});
    await settle(tester);
    expect(find.text('Pay rent'), findsNothing);
    expect(h.pusher.cleared, ['n2']);
  });

  testWidgets('the owner switching a module on reaches this phone live', (tester) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['today']));
    await h.pump(tester);
    expect(find.text('Chat'), findsNothing);
    h.sockets.push({
      'type': 'entitlements.changed',
      'entitlements': ['today', 'chat'],
    });
    await settle(tester);
    expect(find.text('Chat'), findsOneWidget);
  });

  testWidgets('signed out from another device: back to sign-in, local data wiped', (tester) async {
    final h = AppHarness()..signedInAs(userJson());
    await h.pump(tester);
    await h.db
        .into(h.db.records)
        .insert(RecordsCompanion.insert(entity: 'today.task', entityId: 'x', data: '{}', updatedAt: DateTime.now()));
    h.server.on(
      'POST /auth/refresh',
      (_) => const Reply(401, {
        'error': {'code': 'session_revoked', 'message': 'x'},
      }),
    );
    h.sockets.push({'type': 'session.revoked'});
    await settle(tester);
    expect(find.text('Welcome back'), findsOneWidget);
    expect(find.text('This phone was signed out from another device.'), findsOneWidget);
    expect(h.store.values['refresh'], isNull);
    expect(await tester.runAsync(() => h.db.select(h.db.records).get()), isEmpty);
  });

  testWidgets('settings: devices, light picker and sign-out', (tester) async {
    final h = AppHarness()..signedInAs(userJson());
    await h.pump(tester);
    await tester.tap(find.bySemanticsLabel('Settings'));
    await settle(tester);
    await tester.scrollUntilVisible(find.text('Pixel 8'), 300, scrollable: find.byType(Scrollable).first);
    expect(find.text('Pixel 8'), findsOneWidget);
    expect(find.text('this phone'), findsOneWidget);

    await tester.scrollUntilVisible(find.bySemanticsLabel('Night'), -300, scrollable: find.byType(Scrollable).first);
    await tester.tap(find.bySemanticsLabel('Night'));
    await settle(tester);
    expect(h.store.values['orvyn.theme'], 'night');

    await tester.scrollUntilVisible(
      find.text('Sign out of this phone'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.text('Sign out of this phone'));
    await settle(tester);
    expect(find.text('Welcome back'), findsOneWidget);
    expect(h.server.count('POST /auth/sign-out'), 1);
  });

  testWidgets('app lock: locked at launch, unlocks with the device check', (tester) async {
    final h = AppHarness()..signedInAs(userJson());
    h.store.values['orvyn.lock'] = '1';
    h.auth.ok = false;
    await h.pump(tester);
    expect(find.text('ORVYN is locked'), findsOneWidget);
    h.auth.ok = true;
    expect(find.byType(Orb), findsOneWidget, reason: 'nothing of the app is reachable behind the lock');
    expect(find.bySemanticsLabel('Unlock ORVYN'), findsOneWidget);
    await tester.tap(find.byType(Orb));
    await settle(tester);
    expect(find.text('ORVYN is locked'), findsNothing);
    expect(h.auth.prompts, greaterThanOrEqualTo(2));
  });
}
