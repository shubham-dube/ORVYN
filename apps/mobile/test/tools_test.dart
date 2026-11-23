import 'dart:convert';

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
  'snippet': '',
  'at': '2026-11-16T09:00:00Z',
  'url': 'https://mail.zoho.in',
  'category': 'needs_reply',
  'score': 86,
  'summary': 'Raj needs the invoice by Friday',
  'why': '',
  'action': 'reply',
  'amountMinor': null,
  'dueDate': null,
  'pinned': false,
  'sender': null,
  'by': 'ai',
};

void main() {
  testWidgets('GitHub work in Today: close an issue; reviews open on GitHub (spec 0008 B)', (tester) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['today']));
    final closed = <dynamic>[];
    h.server.on(
      'GET /connections',
      (_) => [
        {
          'id': 'gh1',
          'provider': 'github',
          'account': 'asha',
          'status': 'active',
          'capabilities': ['issues', 'reviews'],
        },
      ],
    );
    h.server.on(
      'GET /connections/github/work',
      (_) => [
        {
          'id': 'asha/app#40',
          'connectionId': 'gh1',
          'kind': 'review',
          'repo': 'asha/app',
          'number': 40,
          'title': 'Add dark mode',
          'url': 'https://github.com/asha/app/pull/40',
        },
        {
          'id': 'asha/app#12',
          'connectionId': 'gh1',
          'kind': 'issue',
          'repo': 'asha/app',
          'number': 12,
          'title': 'Login breaks on Safari',
          'url': 'https://github.com/asha/app/issues/12',
        },
      ],
    );
    h.server.on(
      'GET /connections/github/prs',
      (_) => [
        {
          'id': 'asha/app#50',
          'connectionId': 'gh1',
          'repo': 'asha/app',
          'number': 50,
          'title': 'Ship the new nav',
          'url': 'https://github.com/asha/app/pull/50',
          'state': 'open',
          'draft': false,
          'review': 'approved',
          'checks': 'passing',
          'updatedAt': '2026-11-16T08:00:00Z',
        },
      ],
    );
    h.server.on('POST /connections/github/issues/close', (r) {
      closed.add(r.body);
      return {'ok': true};
    });
    await h.pump(tester);
    tester.view.physicalSize = const Size(1170, 4000);
    await tester.tap(find.bySemanticsLabel('Today'));
    await settle(tester, 20);
    expect(find.text('GITHUB'), findsOneWidget);
    // my PRs as one line that opens Pull requests (spec 0012 G)
    expect(find.text('1 open · 1 approved'), findsOneWidget);
    // a review waiting for me, marked as mine to review
    expect(find.text('Add dark mode'), findsOneWidget);
    expect(find.text('Your review'), findsOneWidget);
    expect(find.byTooltip('Close issue: Add dark mode'), findsNothing, reason: 'reviews are not closed from here');
    await tapIt(tester, find.byTooltip('Close issue: Login breaks on Safari'));
    expect(closed, [
      {'connectionId': 'gh1', 'repo': 'asha/app', 'number': 12},
    ]);
    await finish(tester);
  });

  testWidgets('Mail that matters on Home; a mail becomes a task only after Save (spec 0017)', (tester) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['today']));
    h.server.on('GET /connections', (_) => <dynamic>[]);
    h.server.on(
      'GET /home',
      (_) => {
        'needsYou': [
          {
            'id': 'mail:m7',
            'kind': 'mail',
            'title': 'Raj needs a reply',
            'line': 'Raj needs the invoice by Friday',
            'urgency': 1,
            'href': '/mail',
            'url': null,
            'act': {'label': 'Done', 'kind': 'done'},
          },
        ],
        'more': 0,
        'brief': null,
        'inbox': {
          'important': 1,
          'top': [_rajMail],
          'catchUp': 'Raj is waiting on the invoice.',
        },
        'ipos': <dynamic>[],
        'markets': <dynamic>[],
      },
    );
    final asked = <dynamic>[];
    h.server.on('POST /connections/mail/task', (r) {
      asked.add(r.body);
      return {
        'title': 'Send the invoice',
        'dueDate': '2026-11-20',
        'dueAt': null,
        'notes': 'From: Raj <raj@client.test>\nhttps://mail.zoho.in',
        'smart': false,
      };
    });
    await h.pump(tester);
    tester.view.physicalSize = const Size(1170, 4000);
    await settle(tester, 20);
    // needs you, across modules; and the mail that matters, with its catch-up
    expect(find.text('Raj needs a reply'), findsOneWidget);
    expect(find.text('Raj is waiting on the invoice.'), findsOneWidget);
    expect(find.text('Raj needs the invoice by Friday'), findsWidgets);
    await tapIt(tester, find.byTooltip('More for Re: Send the invoice by Friday'));
    await tapIt(tester, find.text('Make a task'));
    expect(asked.single, containsPair('smart', false));
    expect(find.text('Send the invoice'), findsOneWidget);
    expect(find.text('Due 20 Nov'), findsOneWidget);
    Future<List<Map<String, dynamic>>> tasks() async => [
      for (final r in (await tester.runAsync(() => h.db.select(h.db.records).get()))!)
        if (r.entity == 'today.task') jsonDecode(r.data) as Map<String, dynamic>,
    ];
    expect(await tasks(), isEmpty, reason: 'nothing is made before Save');
    await tester.tap(find.text('Save task'));
    await settle(tester);
    final made = await tasks();
    expect(made.single, containsPair('title', 'Send the invoice'));
    expect(made.single, containsPair('dueDate', '2026-11-20'));
    expect(made.single, containsPair('source', 'email'));
    await finish(tester);
  });
}
