import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import 'support/harness.dart';

Map<String, dynamic> _msg(String id, String role, String text, {List<Map<String, dynamic>> proposals = const []}) => {
  'id': id,
  'threadId': 't1',
  'role': role,
  'text': text,
  'proposals': proposals,
  'sources': role == 'assistant' ? ['Today: agenda'] : <String>[],
  'paused': false,
  'createdAt': '2026-11-16T09:30:00.000Z',
};

void main() {
  testWidgets('ask from the launcher; a proposal waits for Confirm (spec 0005)', (tester) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['assistant', 'today']));
    final asked = <dynamic>[];
    final decided = <String>[];
    final card = {
      'index': 0,
      'proposal': {
        'type': 'create_task',
        'title': 'Call mom',
        'dueDate': null,
        'dueAt': null,
        'priority': 0,
        'remindVia': ['alarm'],
      },
      'summary': 'New task “Call mom” — Mon, 16 Nov, 6:00 pm · reminds by alarm',
      'status': 'open',
      'problem': null,
    };
    h.server.on('POST /assistant/ask', (r) {
      asked.add(r.body);
      return {
        'threadId': '00000000-0000-4000-8000-000000000001',
        'messages': [
          _msg('00000000-0000-4000-8000-0000000000a1', 'user', 'Remind me to call mom at 6pm by alarm'),
          _msg('00000000-0000-4000-8000-0000000000a2', 'assistant', 'Confirm to add it.', proposals: [card]),
        ],
      };
    });
    h.server.on('POST /assistant/messages/00000000-0000-4000-8000-0000000000a2/proposals/0/confirm', (_) {
      decided.add('confirm');
      return _msg(
        '00000000-0000-4000-8000-0000000000a2',
        'assistant',
        'Confirm to add it.',
        proposals: [
          {...card, 'status': 'done'},
        ],
      );
    });
    await h.pump(tester);
    await tester.tap(find.bySemanticsLabel('More'));
    await settle(tester);
    await tester.tap(find.bySemanticsLabel('Open Assistant'));
    await settle(tester);
    expect(find.text('How can I help?'), findsNothing); // a name is known
    await tester.tap(find.text('Remind me to call mom at 6pm by alarm'));
    await settle(tester);
    expect(asked.single, {'text': 'Remind me to call mom at 6pm by alarm'});
    expect(find.textContaining('reminds by alarm'), findsOneWidget);
    expect(find.text('Today: agenda'), findsOneWidget);
    expect(decided, isEmpty, reason: 'nothing happens without a tap');
    await tester.tap(find.text('Confirm'));
    await settle(tester);
    expect(decided, ['confirm']);
    expect(find.text('done'), findsOneWidget);
    await tester.pump(const Duration(seconds: 6));
    await finish(tester);
  });
}
