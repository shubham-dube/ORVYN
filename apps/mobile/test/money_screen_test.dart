import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:orvyn/money/capture.dart';

import 'calendar_screen_test.dart' show seed, sem, tapIt;
import 'support/fake_server.dart';
import 'support/harness.dart';

const _cats = [
  ('c-food', 'Food & dining', 'food', 'expense'),
  ('c-transport', 'Transport', 'transport', 'expense'),
  ('c-salary', 'Salary', 'salary', 'income'),
];

Future<FakeSyncBackend> openMoney(WidgetTester tester, AppHarness h) async {
  final b = FakeSyncBackend()..attach(h.server);
  h.server.on('POST /money/setup', (_) {
    for (final (id, name, slug, kind) in _cats) {
      seed(b, 'money.category', id, {'name': name, 'slug': slug, 'kind': kind, 'colour': 'amber'});
    }
    return {'created': _cats.length};
  });
  await h.pump(tester);
  await tester.tap(find.bySemanticsLabel('Money'));
  await settle(tester, 20);
  return b;
}

Map<String, dynamic> only(FakeSyncBackend b, String entity) =>
    b.rows.entries.where((e) => e.key.startsWith('$entity/')).single.value;

void main() {
  testWidgets('typed entries are understood, filed and counted', (tester) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['money']));
    final b = await openMoney(tester, h);
    expect(h.server.count('POST /money/setup'), 1);
    await tester.enterText(find.byKey(const Key('money-add')), 'spent 240 on lunch at swiggy');
    await settle(tester);
    expect(find.text('₹240 · Swiggy · Food & dining'), findsOneWidget);
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await settle(tester);
    expect(only(b, 'money.transaction'), containsPair('categoryId', 'c-food'));
    expect(only(b, 'money.transaction'), containsPair('amountMinor', 24000));
    expect(sem('Spent this month: ₹240'), findsOneWidget);
    await finish(tester);
  });

  testWidgets('payment messages read on the phone: one payment seen twice is one entry; OTPs are ignored (AC2, AC5)', (
    tester,
  ) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['money']));
    h.capture.on = true;
    final at = DateTime(2026, 11, 16, 9, 10);
    h.capture.items.addAll([
      Captured(
        source: 'sms',
        title: 'HDFCBK',
        text: 'Sent Rs.240.00\nFrom HDFC Bank A/C *1234\nTo SWIGGY\nOn 16/11/26\nRef 432112345678\nNot You?',
        at: at,
      ),
      Captured(
        source: 'notification',
        app: 'gpay',
        title: 'Payment successful',
        text: 'You paid ₹240.00 to Swiggy',
        at: at.add(const Duration(seconds: 40)),
      ),
      Captured(
        source: 'sms',
        title: 'HDFCBK',
        text: '482913 is the OTP for txn of INR 999.00 at AMAZON. Do not share.',
        at: at,
      ),
    ]);
    final b = await openMoney(tester, h);
    final tx = only(b, 'money.transaction');
    expect(tx, containsPair('merchant', 'Swiggy'));
    expect(tx, containsPair('dedupeKey', 'ref:432112345678'));
    expect(tx, containsPair('reviewed', false));
    expect(tx, containsPair('source', 'sms'));
    expect(only(b, 'money.account'), containsPair('name', 'HDFC ··1234'));
    expect(h.capture.items, isEmpty, reason: 'the queue is cleared once saved');
    expect(
      b.rows.values.any((r) => r.values.any((v) => '$v'.contains('Not You'))),
      isFalse,
      reason: 'the raw message never leaves the phone',
    );
    expect(find.text('New · 1'), findsOneWidget);

    // later, while open: arrives and is added right away
    h.capture.deliver(
      Captured(
        source: 'notification',
        app: 'phonepe',
        title: 'PhonePe',
        text: 'Paid ₹180 to Uber',
        at: at.add(const Duration(hours: 1)),
      ),
    );
    await settle(tester, 20);
    expect(b.rows.values.where((r) => r['merchant'] == 'Uber'), hasLength(1));
    await tapIt(tester, find.byTooltip('Looks right: Uber'));
    expect(b.rows.values.firstWhere((r) => r['merchant'] == 'Uber')['reviewed'], true);
    await finish(tester);
  });

  testWidgets('without notification access it offers to turn it on; edit and delete a transaction', (tester) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['money']));
    final b = await openMoney(tester, h);
    await tapIt(tester, find.text('Turn on'));
    expect(h.capture.settingsOpened, 1);

    await tester.enterText(find.byKey(const Key('money-add')), 'uber 180');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await settle(tester);
    await tapIt(tester, find.text('Uber').last);
    await tester.enterText(find.widgetWithText(TextField, 'Uber'), 'Uber to airport');
    await tapIt(tester, find.text('Save'));
    expect(only(b, 'money.transaction'), containsPair('merchant', 'Uber to airport'));
    await tapIt(tester, find.text('Uber to airport').last);
    await tapIt(tester, find.text('Delete'));
    expect(b.deleted.where((k) => k.startsWith('money.transaction/')), hasLength(1));
    await finish(tester);
  });
}
