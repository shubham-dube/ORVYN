import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:orvyn/design/controls.dart';
import 'package:orvyn/drop/drop.dart';

import 'calendar_screen_test.dart' show sem, tapIt;
import 'support/fake_server.dart';
import 'support/harness.dart';

var _n = 0;

/// The server's clock right now (pushAsServer stamps with it): later than what the device wrote so far.
String serverNow() => '${DateTime.now().millisecondsSinceEpoch.toString().padLeft(15, '0')}:00000:server';

/// What the server's worker writes.
void propose(FakeSyncBackend b, String id, Map<String, dynamic> proposal) => b.apply({
  'mutationId': 'srv-${_n++}',
  'entity': 'drop.item',
  'entityId': id,
  'op': 'upsert',
  'fields': {'status': 'proposed', 'proposal': proposal},
  'hlc': serverNow(),
});

String dropId(FakeSyncBackend b) => b.rows.keys.where((k) => k.startsWith('drop.item/')).last.split('/').last;

Future<FakeSyncBackend> openDrop(WidgetTester tester, AppHarness h) async {
  final b = FakeSyncBackend()..attach(h.server);
  h.server.on('POST /money/setup', (_) => {'created': 0});
  await h.pump(tester);
  h.server.on(
    'POST /files',
    (r) => {'id': '0193f000-0000-7000-8000-000000000001', 'name': 'receipt.jpg', 'mime': 'image/jpeg', 'size': 4},
  );
  return b;
}

/// The server tells this phone something changed (as the socket does after the worker writes).
Future<void> nudge(WidgetTester tester, AppHarness h) async {
  h.sockets.push({'type': 'sync.changed'});
  await settle(tester, 20);
}

Future<void> goDrop(WidgetTester tester) async {
  await tester.tap(find.bySemanticsLabel('Ask or do anything'));
  await settle(tester);
  await tester.tap(find.text('Open Drop'));
  await settle(tester);
}

void main() {
  testWidgets(
    'drop text; the suggestion can be changed; confirming adds the task and keeps the change as a correction',
    (tester) async {
      final h = AppHarness()..signedInAs(userJson(ent: ['drop', 'today']));
      final b = await openDrop(tester, h);
      await goDrop(tester);
      await tester.enterText(find.byKey(const Key('drop-text')), 'call the bank tomorrow 5pm');
      await tester.testTextInput.receiveAction(TextInputAction.send);
      await settle(tester);
      final id = dropId(b);
      expect(b.rows['drop.item/$id'], containsPair('status', 'new'));
      expect(find.text('Reading it…'), findsOneWidget);

      propose(b, id, {
        'kind': 'task',
        'title': 'Call the bank',
        'dueDate': null,
        'dueAt': DateTime(2026, 11, 17, 17).toUtc().toIso8601String(),
        'durationMin': null,
        'priority': 0,
        'notes': '',
        'why': 'Something to do by a time',
      });
      await nudge(tester, h);
      expect(find.text('READY FOR YOU  1'), findsOneWidget);
      expect(find.textContaining('Task · '), findsOneWidget);
      await tapIt(tester, find.byTooltip('Edit: call the bank tomorrow 5pm'));
      expect(find.text('Why: Something to do by a time'), findsOneWidget);
      expect(b.rows.keys.where((k) => k.startsWith('today.task/')), isEmpty, reason: 'nothing before the tap');
      await tester.enterText(find.widgetWithText(TextField, 'Call the bank'), 'Call HDFC about the card');
      await tapIt(tester, find.text('Add to Today'));
      final task = b.rows.entries.firstWhere((e) => e.key.startsWith('today.task/')).value;
      expect(task, containsPair('title', 'Call HDFC about the card'));
      expect(task, containsPair('source', 'drop'));
      final item = b.rows['drop.item/$id']!;
      expect(item['status'], 'done');
      expect(item['resultRef'], startsWith('today.task:'));
      expect((item['correction'] as Map)['title'], 'Call HDFC about the card');
      await finish(tester);
    },
  );

  testWidgets('a photo is uploaded and dropped; a receipt becomes an expense in Money with the photo kept', (
    tester,
  ) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['drop', 'money']));
    h.photo = (bytes: Uint8List.fromList([1, 2, 3, 4]), name: 'receipt.jpg', mime: 'image/jpeg');
    final b = await openDrop(tester, h);
    await goDrop(tester);
    await tapIt(tester, find.byTooltip('Take a photo'));
    expect(h.server.count('POST /files'), 1);
    final id = dropId(b);
    expect(b.rows['drop.item/$id'], containsPair('kind', 'photo'));
    propose(b, id, {
      'kind': 'expense',
      'amount': 499,
      'currency': 'INR',
      'direction': 'debit',
      'merchant': 'Cafe Aroma',
      'category': 'Food & dining',
      'occurredAt': null,
      'note': '',
      'why': 'A receipt',
    });
    await nudge(tester, h);
    await tapIt(tester, find.text('Add'));
    final tx = b.rows.entries.firstWhere((e) => e.key.startsWith('money.transaction/')).value;
    expect(tx, containsPair('amountMinor', 49900));
    expect(tx, containsPair('source', 'receipt'));
    expect(tx, containsPair('receiptFileId', '0193f000-0000-7000-8000-000000000001'));
    expect(find.text('Added to Money · ₹499'), findsOneWidget);
    await finish(tester);
  });

  testWidgets('speaking fills the words (marked as voice); a waiting item explains itself and can become a task', (
    tester,
  ) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['drop', 'today']));
    h.spoken = 'pick up the dry cleaning';
    final b = await openDrop(tester, h);
    await goDrop(tester);
    await tapIt(tester, find.byTooltip('Speak'));
    expect(find.text('pick up the dry cleaning'), findsOneWidget);
    await tapIt(tester, find.descendant(of: find.byType(OrvButton), matching: find.text('Drop')));
    final id = dropId(b);
    expect(b.rows['drop.item/$id'], containsPair('kind', 'voice'));
    b.apply({
      'mutationId': 'srv-wait',
      'entity': 'drop.item',
      'entityId': id,
      'op': 'upsert',
      'fields': {
        'status': 'waiting',
        'problem': 'AI is paused for today (the \$1 daily limit). It continues tomorrow.',
      },
      'hlc': serverNow(),
    });
    await nudge(tester, h);
    expect(find.textContaining('AI is paused for today'), findsOneWidget);
    await tapIt(tester, find.text('Make it a task'));
    expect(b.rows.values.where((r) => r['title'] == 'pick up the dry cleaning'), hasLength(1));
    await finish(tester);
  });

  testWidgets('shared from another app, or typed into the Orb: it lands in Drop', (tester) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['drop']));
    final b = await openDrop(tester, h);
    h.share.deliver(const Shared(text: 'https://example.test/article'));
    await settle(tester, 20);
    final shared = b.rows.values.firstWhere((r) => r['source'] == 'share');
    expect(shared, containsPair('kind', 'link'));
    expect(shared, containsPair('url', 'https://example.test/article'));
    expect(sem(RegExp(r'^Dropped: https://example.test/article')), findsOneWidget);

    await tester.tap(find.bySemanticsLabel('Ask or do anything'));
    await settle(tester);
    await tester.enterText(find.byType(TextField).last, 'read the dune sequel');
    await settle(tester);
    await tester.tap(find.text('Drop “read the dune sequel”'));
    await settle(tester);
    expect(b.rows.values.where((r) => r['text'] == 'read the dune sequel'), hasLength(1));
    await finish(tester);
  });
}
