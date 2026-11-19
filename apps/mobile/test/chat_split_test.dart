import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:orvyn/chat/chat_crypto.dart';

import 'calendar_screen_test.dart' show tapIt;
import 'support/harness.dart';

const conv = '0193f000-0000-7000-8000-00000000c0c0';
const ashaId = '00000000-0000-4000-8000-0000000000a5';
const ashaDevice = '00000000-0000-4000-8000-0000000000d5';

void main() {
  testWidgets('Chat on the phone: it opens what Asha sealed for it, and what it sends opens with her key (AC1, AC2)', (
    tester,
  ) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['chat']));
    late DeviceKeys me, asha;
    late Sealed fromAsha;
    await tester.runAsync(() async {
      me = await newDeviceKeys();
      asha = await newDeviceKeys();
      fromAsha = await encryptMessage(
        {'t': 'text', 'text': 'Dinner at 8? 🍕'},
        conversationId: conv,
        messageId: '0193f000-0000-7000-8000-0000000000a1',
        deviceId: ashaDevice,
        signSecret: asha.signSecret,
        recipients: [Recipient(deviceId, me.boxPublic)],
      );
    });
    h.store.values['orvyn.chat.$deviceId'] = jsonEncode(me.toJson());
    final registered = <dynamic>[];
    final sent = <dynamic>[];
    final c = {
      'id': conv,
      'kind': 'direct',
      'title': 'Asha',
      'adminId': null,
      'members': [
        {'id': ownerId, 'name': 'Asha Rao', 'email': 'me@example.test', 'lastReadAt': null},
        {'id': ashaId, 'name': 'Asha', 'email': 'asha@example.test', 'lastReadAt': '2030-01-01T00:00:00Z'},
      ],
      'muted': false,
      'unread': 1,
      'lastAt': '2026-11-19T10:00:00Z',
      'splitGroupId': null,
    };
    h.server.on('PUT /chat/devices', (r) {
      registered.add(r.body);
      return {'ok': true, 'changed': false};
    });
    h.server.on('GET /chat/conversations', (_) => [c]);
    h.server.on('GET /chat/conversations/$conv', (_) => c);
    h.server.on('POST /chat/conversations/$conv/read', (_) => {'ok': true});
    h.server.on(
      'GET /chat/keys',
      (_) => [
        {
          'userId': ownerId,
          'deviceId': deviceId,
          'boxPublic': me.boxPublic,
          'signPublic': me.signPublic,
          'active': true,
        },
        {
          'userId': ashaId,
          'deviceId': ashaDevice,
          'boxPublic': asha.boxPublic,
          'signPublic': asha.signPublic,
          'active': true,
        },
      ],
    );
    h.server.on(
      'GET /chat/conversations/$conv/messages',
      (_) => [
        {
          'id': '0193f000-0000-7000-8000-0000000000a1',
          'conversationId': conv,
          'senderId': ashaId,
          'senderDeviceId': ashaDevice,
          'kind': 'msg',
          'ciphertext': fromAsha.ciphertext,
          'nonce': fromAsha.nonce,
          'signature': fromAsha.signature,
          'sealedForMe': fromAsha.keys.single.sealed,
          'text': null,
          'files': <String>[],
          'deletedAt': null,
          'createdAt': '2026-11-19T10:00:00Z',
        },
      ],
    );
    h.server.on('POST /chat/conversations/$conv/messages', (r) {
      sent.add(r.body);
      return {'id': (r.body as Map)['id']};
    });
    await h.pump(tester);
    tester.view.physicalSize = const Size(1170, 2532);
    addTearDown(tester.view.reset);
    await tester.tap(find.bySemanticsLabel('More'));
    await settle(tester);
    await tester.tap(find.bySemanticsLabel('Open Chat'));
    await settle(tester, 20);
    expect(registered, isNotEmpty);
    expect((registered.first as Map)['boxPublic'], me.boxPublic, reason: 'this phone’s keys, kept on it');
    await tester.runAsync(() async {
      await tester.tap(find.text('Asha'));
      await Future<void>.delayed(const Duration(milliseconds: 300));
    });
    await settle(tester, 30);
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 300)));
    await settle(tester, 10);
    expect(find.text('Dinner at 8? 🍕'), findsOneWidget);

    await tester.enterText(find.byKey(const Key('chat-text')), 'Yes!');
    await settle(tester);
    await tester.runAsync(() async {
      await tester.tap(find.byTooltip('Send'));
      await Future<void>.delayed(const Duration(milliseconds: 500));
    });
    await settle(tester, 20);
    expect(sent, hasLength(1));
    final body = sent.single as Map;
    expect((body['keys'] as List).map((k) => (k as Map)['deviceId']).toSet(), {deviceId, ashaDevice});
    expect(jsonEncode(body), isNot(contains('Yes!')));
    final forAsha =
        (body['keys'] as List).cast<Map<String, dynamic>>().firstWhere((k) => k['deviceId'] == ashaDevice)['sealed']
            as String;
    final opened = await tester.runAsync(
      () => decryptMessage(
        conversationId: conv,
        id: body['id'] as String,
        senderDeviceId: deviceId,
        ciphertext: body['ciphertext'] as String,
        nonce: body['nonce'] as String,
        signature: body['signature'] as String,
        sealedForMe: forAsha,
        myBoxSecret: asha.boxSecret,
        senderSignPublic: me.signPublic,
      ),
    );
    expect(opened, {'t': 'text', 'text': 'Yes!', 'replyTo': null});
    await finish(tester);
  });

  testWidgets('Split on the phone: who owes whom, and a new expense split equally', (tester) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['split']));
    const gid = '0193f000-0000-7000-8000-0000000000g1';
    final added = <dynamic>[];
    final group = {
      'id': gid,
      'name': 'Goa',
      'kind': 'trip',
      'adminId': ownerId,
      'conversationId': null,
      'archived': false,
      'members': [
        {
          'id': 'm1',
          'userId': ownerId,
          'name': 'Asha',
          'phone': '',
          'upi': 'asha@upi',
          'guest': false,
          'balance': 200000,
          'paid': 300000,
          'consumed': 100000,
        },
        {
          'id': 'm2',
          'userId': null,
          'name': 'Mia',
          'phone': '9876543210',
          'upi': '',
          'guest': true,
          'balance': -100000,
          'paid': 0,
          'consumed': 100000,
        },
        {
          'id': 'm3',
          'userId': null,
          'name': 'Dev',
          'phone': '',
          'upi': '',
          'guest': true,
          'balance': -100000,
          'paid': 0,
          'consumed': 100000,
        },
      ],
      'expenses': [
        {
          'id': 'e1',
          'title': 'Hotel',
          'amount': 300000,
          'date': '2026-11-20',
          'category': 'stay',
          'note': '',
          'receiptFileId': null,
          'addedBy': ownerId,
          'paid': [
            {'memberId': 'm1', 'amount': 300000},
          ],
          'shares': [
            {'memberId': 'm1', 'amount': 100000},
            {'memberId': 'm2', 'amount': 100000},
            {'memberId': 'm3', 'amount': 100000},
          ],
          'method': 'equal',
          'among': [
            {'memberId': 'm1', 'value': 0},
            {'memberId': 'm2', 'value': 0},
            {'memberId': 'm3', 'value': 0},
          ],
          'createdAt': '2026-11-20T10:00:00Z',
        },
      ],
      'settlements': <dynamic>[],
      'plan': [
        {'from': 'm2', 'to': 'm1', 'amount': 100000, 'fromName': 'Mia', 'toName': 'Asha', 'toUpi': 'asha@upi'},
        {'from': 'm3', 'to': 'm1', 'amount': 100000, 'fromName': 'Dev', 'toName': 'Asha', 'toUpi': 'asha@upi'},
      ],
      'totalMinor': 300000,
      'byCategory': [
        {'category': 'stay', 'amount': 300000},
      ],
      'activity': <dynamic>[],
    };
    h.server.on(
      'GET /split/groups',
      (_) => [
        {
          'id': gid,
          'name': 'Goa',
          'kind': 'trip',
          'members': 3,
          'totalMinor': 300000,
          'myBalance': 200000,
          'lastAt': '2026-11-20T10:00:00Z',
          'archived': false,
        },
      ],
    );
    h.server.on('GET /split/groups/$gid', (_) => group);
    h.server.on('POST /split/groups/$gid/expenses', (r) {
      added.add(r.body);
      return group;
    });
    await h.pump(tester);
    tester.view.physicalSize = const Size(1170, 4000);
    addTearDown(tester.view.reset);
    await tester.tap(find.bySemanticsLabel('More'));
    await settle(tester);
    await tester.tap(find.bySemanticsLabel('Open Split'));
    await settle(tester, 20);
    expect(find.text('gets ₹2,000'), findsOneWidget);
    await tester.tap(find.text('Goa'));
    await settle(tester, 20);
    expect(find.text('Mia → Asha'), findsOneWidget);
    expect(find.text('Dev → Asha'), findsOneWidget);
    expect(find.text('owes ₹1,000'), findsNWidgets(2));

    await tapIt(tester, find.text('Add expense'));
    final fields = find.descendant(of: find.byType(BottomSheet), matching: find.byType(TextField));
    await tester.enterText(fields.at(0), 'Dinner'); // What for
    await tester.enterText(fields.at(1), '900'); // Amount (₹)
    await settle(tester);
    await tapIt(tester, find.text('Save'));
    expect(added, hasLength(1));
    expect(added.single, containsPair('title', 'Dinner'));
    expect((added.single as Map)['paid'], [
      {'memberId': 'm1', 'amount': 900},
    ]);
    expect(((added.single as Map)['split'] as Map)['method'], 'equal');
    expect((((added.single as Map)['split'] as Map)['among'] as List).map((a) => (a as Map)['memberId']), [
      'm1',
      'm2',
      'm3',
    ]);
    await finish(tester);
  });
}
