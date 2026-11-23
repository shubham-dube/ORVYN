import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:orvyn/features/money_screen.dart' show quickTitle;

import 'calendar_screen_test.dart' show seed, sem, tapIt;
import 'money_screen_test.dart' show openMoney;
import 'support/fake_server.dart';
import 'support/harness.dart';

// spec 0014: what's in your hand, who owes whom, money that only moves. Harness clock: Mon 16 Nov 2026, 09:30.
Future<FakeSyncBackend> _open(WidgetTester tester, AppHarness h) async {
  tester.view.physicalSize = const Size(1080, 4800);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  return openMoney(tester, h);
}

Iterable<Map<String, dynamic>> _rows(FakeSyncBackend b, String entity) =>
    b.rows.entries.where((e) => e.key.startsWith('$entity/')).map((e) => e.value);

void main() {
  test('a typed entry is titled by what it was for, never by the merchant again', () {
    expect(quickTitle('lunch', 'Swiggy'), 'Lunch');
    expect(quickTitle('uber', 'Uber'), '');
    expect(quickTitle('  ', 'Uber'), '');
  });

  testWidgets('in your hand: a bank balance minus a card due is what is really yours', (tester) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['money']));
    final b = await _open(tester, h);
    await tapIt(tester, find.byKey(const Key('hand-setup')));
    await tapIt(tester, find.byTooltip('Add an account'));
    await tester.enterText(find.byKey(const Key('account-name')), 'HDFC savings');
    await tester.enterText(find.byKey(const Key('money-amount')), '200000');
    await tapIt(tester, find.byKey(const Key('account-save')));
    await tapIt(tester, find.byTooltip('Add an account'));
    await tapIt(tester, find.text('Credit card'));
    await tester.enterText(find.byKey(const Key('account-name')), 'ICICI card');
    await tester.enterText(find.byKey(const Key('money-amount')), '150000');
    await tapIt(tester, find.byKey(const Key('account-save')));

    final card = _rows(b, 'money.account').firstWhere((a) => a['name'] == 'ICICI card');
    expect(card['kind'], 'card');
    expect(card['balanceMinor'], 15000000);
    expect(card['balanceAt'], isNotNull);
    await tester.tapAt(const Offset(10, 10)); // close the balances sheet
    await settle(tester);
    expect(sem('In your hand: ₹50,000'), findsOneWidget);
    await finish(tester);
  });

  testWidgets('lending from the payment sheet makes a debt, not spending', (tester) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['money']));
    final b = await _open(tester, h);
    await tapIt(tester, find.byKey(const Key('money-open-add')));
    await tester.enterText(find.byKey(const Key('money-amount')), '2000');
    await tester.enterText(find.byKey(const Key('money-title')), 'Cash for his rent');
    await tapIt(tester, find.text('With someone'));
    await tapIt(tester, find.text('I lent it / paid for someone'));
    await tester.enterText(find.byKey(const Key('money-person')), 'Rahul');
    await tapIt(tester, find.byKey(const Key('money-save')));

    final iou = _rows(b, 'money.iou').single;
    expect(iou, containsPair('person', 'Rahul'));
    expect(iou, containsPair('direction', 'owed_to_me'));
    expect(iou, containsPair('amountMinor', 200000));
    final tx = _rows(b, 'money.transaction').single;
    expect(tx, containsPair('counted', false));
    expect(
      tx,
      containsPair('iouId', b.rows.entries.firstWhere((e) => e.key.startsWith('money.iou/')).key.split('/')[1]),
    );
    expect(tx, containsPair('title', 'Cash for his rent'));
    expect(sem('Spent this month: ₹0'), findsOneWidget, reason: 'lending is not spending');
    expect(find.text('Rahul'), findsWidgets, reason: 'the people card shows him');
    await finish(tester);
  });

  testWidgets('who owes whom: what I owe someone, with a reminder in Today', (tester) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['money', 'today']));
    final b = await _open(tester, h);
    seed(b, 'money.iou', 'old', {
      'person': 'Asha',
      'direction': 'owed_to_me',
      'amountMinor': 50000,
      'paidMinor': 0,
      'currency': 'INR',
      'sure': true,
    });
    await settle(tester);
    await tapIt(tester, find.byKey(const Key('iou-add')));
    await tapIt(tester, find.text('I owe them'));
    await tester.enterText(find.byKey(const Key('money-amount')), '1200');
    await tester.enterText(find.byKey(const Key('iou-person')), 'Asha');
    await tapIt(tester, find.byKey(const Key('iou-save')));
    final mine = _rows(b, 'money.iou').firstWhere((d) => d['direction'] == 'i_owe');
    expect(mine, containsPair('person', 'Asha'));
    expect(mine, containsPair('amountMinor', 120000));
    await finish(tester);
  });
}
