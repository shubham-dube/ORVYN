import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import 'calendar_screen_test.dart' show tapIt;
import 'support/harness.dart';

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

  testWidgets('Mail on the phone: every mailbox, one at a time, and a mail into a task', (tester) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['today']));
    h.server.on('GET /connections', (_) => <dynamic>[]);
    h.server.on(
      'GET /connections/mail',
      (_) => [
        {
          'connectionId': 'g1',
          'account': 'asha@gmail.test',
          'provider': 'gmail',
          'unread': 1,
          'items': [
            {
              'id': 'a',
              'from': 'Bank <alerts@bank.test>',
              'subject': 'Statement ready',
              'snippet': '',
              'at': '2026-11-15T09:00:00Z',
              'url': null,
            },
          ],
        },
        {
          'connectionId': 'z1',
          'account': 'asha@zoho.test',
          'provider': 'zoho',
          'unread': 2,
          'items': [
            {
              'id': '7',
              'from': 'Raj <raj@client.test>',
              'subject': 'Send the invoice by Friday',
              'snippet': '',
              'at': '2026-11-16T09:00:00Z',
              'url': null,
            },
          ],
        },
      ],
    );
    h.server.on(
      'POST /connections/mail/task',
      (r) => {'title': 'Send the invoice', 'dueDate': null, 'dueAt': null, 'notes': 'From: Raj', 'smart': false},
    );
    await h.pump(tester);
    tester.view.physicalSize = const Size(1170, 4000);
    addTearDown(tester.view.reset);
    await tester.tap(find.bySemanticsLabel('More'));
    await settle(tester);
    await tester.tap(find.bySemanticsLabel('Open Mail'));
    await settle(tester, 20);
    expect(find.text('3 unread this week'), findsOneWidget);
    expect(find.text('Statement ready'), findsOneWidget);
    await tapIt(tester, find.text('asha@zoho.test · 2'));
    expect(find.text('Statement ready'), findsNothing);
    await tapIt(tester, find.byTooltip('Make a task: Send the invoice by Friday'));
    expect(find.text('Send the invoice'), findsOneWidget);
    await finish(tester);
  });
}
