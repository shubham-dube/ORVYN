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
  testWidgets(
    'Chat that follows you: history on any phone, old sealed messages carried over, live, send, react (spec 0015 C)',
    (tester) async {
      final h = AppHarness()..signedInAs(userJson(ent: ['chat']));
      late DeviceKeys me, asha;
      late Sealed old;
      late String oldKey;
      const oldId = '0193f000-0000-7000-8000-0000000000a0';
      await tester.runAsync(() async {
        me = await newDeviceKeys();
        asha = await newDeviceKeys();
        old = await encryptMessage(
          {'t': 'text', 'text': 'From the old phone'},
          conversationId: conv,
          messageId: oldId,
          deviceId: ashaDevice,
          signSecret: asha.signSecret,
          recipients: [Recipient(deviceId, me.boxPublic)],
        );
        oldKey = b64(await openKey(old.keys.single.sealed, me.boxSecret));
      });
      // this phone once had end-to-end keys (ADR-0014): it can hand the old message's key over
      h.store.values['orvyn.chat.$deviceId'] = jsonEncode(me.toJson());
      final sent = <Map<String, dynamic>>[];
      final carried = <dynamic>[];
      final reacted = <dynamic>[];
      var isCarried = false;
      Map<String, dynamic> msg(String id, String from, String text, String at, {int v = 2}) => {
        'id': id,
        'conversationId': conv,
        'senderId': from,
        'kind': 'msg',
        'v': v,
        'text': v == 2 ? text : null,
        'attachments': <dynamic>[],
        'share': null,
        'replyTo': null,
        'reactions': <dynamic>[],
        'forwarded': false,
        'editedAt': null,
        'deletedAt': null,
        'createdAt': at,
        'senderDeviceId': v == 1 ? ashaDevice : null,
        'ciphertext': v == 1 ? old.ciphertext : null,
        'nonce': v == 1 ? old.nonce : null,
        'signature': v == 1 ? old.signature : null,
        'sealedForMe': v == 1 ? old.keys.single.sealed : null,
        'files': <String>[],
      };
      final c = {
        'id': conv,
        'kind': 'direct',
        'title': 'Asha',
        'adminId': null,
        'members': [
          {
            'id': ownerId,
            'name': 'Me',
            'email': 'me@example.test',
            'lastReadAt': null,
            'lastDeliveredAt': null,
            'online': true,
            'lastSeenAt': null,
          },
          {
            'id': ashaId,
            'name': 'Asha',
            'email': 'asha@example.test',
            'lastReadAt': null,
            'lastDeliveredAt': null,
            'online': true,
            'lastSeenAt': null,
          },
        ],
        'muted': false,
        'pinned': false,
        'unread': 1,
        'lastAt': '2026-11-19T10:00:00Z',
        'splitGroupId': null,
        'last': {
          'id': 'a1',
          'senderId': ashaId,
          'kind': 'msg',
          'text': 'Dinner at 8? 🍕',
          'attachment': null,
          'deleted': false,
          'at': '2026-11-19T10:00:00Z',
        },
        'pinnedMessage': null,
      };
      h.server.on('GET /chat/conversations', (_) => [c]);
      h.server.on('GET /chat/conversations/$conv', (_) => c);
      h.server.on('POST /chat/conversations/$conv/read', (_) => {'ok': true});
      h.server.on('POST /chat/conversations/$conv/delivered', (_) => {'ok': true});
      h.server.on(
        'GET /chat/conversations/$conv/messages',
        (_) => [
          msg('0193f000-0000-7000-8000-0000000000a1', ashaId, 'Dinner at 8? 🍕', '2026-11-19T10:00:00Z'),
          msg(oldId, ashaId, 'From the old phone', '2026-11-18T10:00:00Z', v: isCarried ? 2 : 1),
        ],
      );
      h.server.on('POST /chat/conversations/$conv/carry', (r) {
        carried.add(r.body);
        isCarried = true;
        return {'carried': 1, 'refused': 0};
      });
      h.server.on('POST /chat/conversations/$conv/messages', (r) {
        final b = Map<String, dynamic>.from(r.body as Map);
        sent.add(b);
        return msg(b['id'] as String, ownerId, b['text'] as String, '2026-11-19T10:05:00Z');
      });
      h.server.on('PUT /chat/messages/0193f000-0000-7000-8000-0000000000a1/reaction', (r) {
        reacted.add(r.body);
        return {'ok': true};
      });
      await h.pump(tester);
      tester.view.physicalSize = const Size(1170, 2532);
      addTearDown(tester.view.reset);
      await tester.tap(find.bySemanticsLabel('More'));
      await settle(tester);
      await tester.tap(find.bySemanticsLabel('Open Chat'));
      await settle(tester, 20);
      // the list says what was said last, with the unread count
      expect(find.text('Dinner at 8? 🍕'), findsOneWidget);
      await tester.runAsync(() async {
        await tester.tap(find.text('Asha'));
        await Future<void>.delayed(const Duration(milliseconds: 300));
      });
      await settle(tester, 30);
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 300)));
      await settle(tester, 10);
      expect(find.text('Dinner at 8? 🍕'), findsOneWidget);
      // the old sealed message was opened here and handed over with its key, so every device has it now
      expect(carried, hasLength(1));
      expect((carried.single as Map)['items'], [
        {'id': oldId, 'key': oldKey},
      ]);
      expect(find.text('From the old phone'), findsOneWidget);
      expect(find.text('online'), findsOneWidget);

      // live: Asha's next line arrives on the socket, whole
      h.sockets.push({
        'type': 'chat.message',
        'conversationId': conv,
        'messageId': 'live-1',
        'message': msg('0193f000-0000-7000-8000-0000000000a2', ashaId, 'Bring the speaker', '2026-11-19T10:01:00Z'),
      });
      await settle(tester, 10);
      expect(find.text('Bring the speaker'), findsOneWidget);

      // send: shown at once, then confirmed
      await tester.enterText(find.byKey(const Key('chat-text')), 'Yes!');
      await settle(tester);
      await tester.runAsync(() async {
        await tester.tap(find.bySemanticsLabel('Send'));
        await Future<void>.delayed(const Duration(milliseconds: 400));
      });
      await settle(tester, 20);
      expect(sent, hasLength(1));
      expect(sent.single, containsPair('text', 'Yes!'));
      expect(find.text('Yes!'), findsOneWidget);

      // double-tap a message: ❤️
      await tester.runAsync(() async {
        await tester.tap(find.text('Dinner at 8? 🍕'));
        await Future<void>.delayed(const Duration(milliseconds: 60));
        await tester.tap(find.text('Dinner at 8? 🍕'));
        await Future<void>.delayed(const Duration(milliseconds: 400));
      });
      await settle(tester, 10);
      expect(reacted, [
        {'emoji': '❤️'},
      ]);
      await finish(tester);
    },
  );

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
