import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import 'calendar_screen_test.dart' show tapIt;
import 'support/harness.dart';

const _rajMail = {
  'id': 'm7',
  'account': 'asha@zoho.test',
  'provider': 'zoho',
  'fromName': 'Raj',
  'fromEmail': 'raj@client.test',
  'subject': 'Re: Send the invoice by Friday',
  'snippet': 'Can you send it by Friday?',
  'at': '2026-11-16T09:00:00Z',
  'url': null,
  'category': 'needs_reply',
  'score': 86,
  'summary': 'Raj needs the invoice by Friday',
  'why': 'A client is waiting',
  'action': 'reply',
  'amountMinor': null,
  'dueDate': null,
  'pinned': false,
  'sender': null,
  'by': 'ai',
};
const _bankMail = {
  'id': 'ma',
  'account': 'asha@gmail.test',
  'provider': 'gmail',
  'fromName': 'HDFC Bank',
  'fromEmail': 'alerts@hdfc.test',
  'subject': 'Your statement is ready',
  'snippet': '',
  'at': '2026-11-15T09:00:00Z',
  'url': null,
  'category': 'bill',
  'score': 80,
  'summary': 'Your HDFC card bill: ₹18,230',
  'why': 'Money due',
  'action': 'pay',
  'amountMinor': 1823000,
  'dueDate': null,
  'pinned': false,
  'sender': null,
  'by': 'ai',
};
final _promo = {
  ..._bankMail,
  'id': 'mp',
  'fromName': 'Zomato',
  'fromEmail': 'offers@zomato.test',
  'category': 'promotion',
  'score': 4,
  'summary': '50% off tonight',
  'amountMinor': null,
};

void main() {
  testWidgets('People on the phone: switch a module for someone, invite by link (owner only)', (tester) async {
    final h = AppHarness()..signedInAs(userJson(role: 'owner'));
    final put = <dynamic>[];
    final invited = <dynamic>[];
    h.server.on(
      'GET /admin/users',
      (_) => [
        {
          'id': 'u0',
          'email': 'owner@example.test',
          'name': 'Asha',
          'role': 'owner',
          'entitlements': <String>[],
          'disabled': false,
          'createdAt': '2026-11-01T00:00:00Z',
          'lastSeenAt': null,
        },
        {
          'id': 'u1',
          'email': 'friend@example.test',
          'name': 'Ravi',
          'role': 'member',
          'entitlements': ['today'],
          'disabled': false,
          'createdAt': '2026-11-01T00:00:00Z',
          'lastSeenAt': null,
        },
      ],
    );
    h.server.on('GET /admin/invites', (_) => <dynamic>[]);
    h.server.on('PUT /admin/users/u1/entitlements', (r) {
      put.add(r.body);
      return {'ok': true};
    });
    h.server.on('POST /admin/invites', (r) {
      invited.add(r.body);
      return {
        'id': 'i1',
        'email': null,
        'entitlements': ['today'],
        'note': null,
        'expiresAt': '2026-11-26T00:00:00Z',
        'usedAt': null,
        'link': 'https://orvyn.test/join/abc',
      };
    });
    await h.pump(tester);
    tester.view.physicalSize = const Size(1170, 4000);
    addTearDown(tester.view.reset);
    await tester.tap(find.bySemanticsLabel('Settings'));
    await settle(tester);
    await tapIt(tester, find.text('People'));
    expect(find.textContaining('Today · Not signed in yet'), findsOneWidget);
    await tapIt(tester, find.text('Ravi'));
    await tapIt(tester, find.widgetWithText(SwitchListTile, 'Money'));
    expect(put.single, {
      'entitlements': ['today', 'money'],
    });
    await tester.tapAt(const Offset(20, 20)); // close the sheet
    await settle(tester);
    await tapIt(tester, find.text('Invite'));
    await tapIt(tester, find.text('Create link'));
    expect((invited.single as Map)['entitlements'], containsAll(['today', 'drop', 'money', 'library']));
    expect(find.text('https://orvyn.test/join/abc'), findsOneWidget);
    await finish(tester);
  });

  testWidgets('Mail on the phone: every mailbox triaged, the catch-up, swipe away, VIP a sender (spec 0017 B)', (
    tester,
  ) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['today']));
    h.server.on('GET /connections', (_) => <dynamic>[]);
    final acted = <dynamic>[];
    final senders = <dynamic>[];
    h.server.on(
      'GET /inbox',
      (_) => {
        'catchUp': 'Raj needs the invoice by Friday, and your HDFC bill is ready.',
        'important': acted.isEmpty ? [_rajMail, _bankMail] : [_bankMail],
        'updates': <dynamic>[],
        'rest': [_promo],
        'boxes': [
          {'connectionId': 'g1', 'account': 'asha@gmail.test', 'provider': 'gmail', 'unread': 2},
          {'connectionId': 'z1', 'account': 'asha@zoho.test', 'provider': 'zoho', 'unread': 1},
        ],
        'refreshedAt': '2026-11-16T09:00:00Z',
      },
    );
    h.server.on('POST /inbox/items/m7/act', (r) {
      acted.add(r.body);
      return {'ok': true, 'taskId': null};
    });
    h.server.on('PUT /inbox/senders', (r) {
      senders.add(r.body);
      return {'ok': true};
    });
    await h.pump(tester);
    tester.view.physicalSize = const Size(1170, 4000);
    addTearDown(tester.view.reset);
    await tester.tap(find.bySemanticsLabel('More'));
    await settle(tester);
    await tester.tap(find.bySemanticsLabel('Open Mail'));
    await settle(tester, 20);
    expect(find.text('2 need you · 3 unread'), findsOneWidget);
    expect(find.text('Raj needs the invoice by Friday, and your HDFC bill is ready.'), findsOneWidget);
    expect(find.text('Raj needs the invoice by Friday'), findsOneWidget);
    expect(find.text('₹18,230'), findsWidgets);
    // Everything else is folded away
    expect(find.text('50% off tonight'), findsNothing);
    await tapIt(tester, find.text('Everything else'));
    expect(find.text('50% off tonight'), findsOneWidget);
    // one mailbox at a time
    await tapIt(tester, find.text('asha@zoho.test'));
    expect(find.text('Your HDFC card bill: ₹18,230'), findsNothing);
    await tapIt(tester, find.text('All'));
    // swipe a mail away: it's done
    await tester.drag(find.text('Raj needs the invoice by Friday'), const Offset(-500, 0));
    await settle(tester, 20);
    expect(acted.single, {'action': 'done'});
    // a sender taught: always important
    await tapIt(tester, find.byTooltip('More for Your statement is ready').first);
    await tapIt(tester, find.text('Always important'));
    expect(senders.single, {'email': 'alerts@hdfc.test', 'rule': 'vip'});
    await finish(tester);
  });
}
