import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:orvyn/features/payment_sheet.dart';

import 'calendar_screen_test.dart' show tapIt;
import 'money_screen_test.dart' show openMoney, only;
import 'support/harness.dart';

// The harness clock is Monday 16 Nov 2026, 09:30.
Finder inSheet(Finder f) => find.descendant(of: find.byType(PaymentSheet), matching: f);

void main() {
  testWidgets('typing a day files the entry on that day', (tester) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['money']));
    final b = await openMoney(tester, h);
    await tester.enterText(find.byKey(const Key('money-add')), 'spent 240 on lunch yesterday');
    await settle(tester);
    expect(find.textContaining('yesterday'), findsWidgets);
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await settle(tester);
    final tx = only(b, 'money.transaction');
    expect(tx['amountMinor'], 24000);
    final at = DateTime.parse(tx['occurredAt'] as String).toLocal();
    expect((at.year, at.month, at.day), (2026, 11, 15));
    expect(at.hour, 12, reason: 'another day with no time is noon');
    await finish(tester);
  });

  testWidgets('the full form adds an expense for another day, and can schedule one that repeats', (tester) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['money']));
    final b = await openMoney(tester, h);
    await tapIt(tester, find.byKey(const Key('money-open-add')));
    await tester.enterText(find.byKey(const Key('money-amount')), '640');
    await tester.enterText(find.byKey(const Key('money-merchant')), 'Zorba dinner');
    await tapIt(tester, inSheet(find.text('When')));
    await tapIt(tester, find.text('Yesterday'));
    await tapIt(tester, find.byKey(const Key('money-save')));
    final tx = only(b, 'money.transaction');
    expect(tx['merchant'], 'Zorba dinner');
    expect(tx['amountMinor'], 64000);
    expect(DateTime.parse(tx['occurredAt'] as String).toLocal().day, 15);

    // a repeating one: rent on the 1st, every month, added for me
    await tapIt(tester, find.byKey(const Key('money-open-add')));
    await tester.enterText(find.byKey(const Key('money-amount')), '22000');
    await tester.enterText(find.byKey(const Key('money-merchant')), 'Rent');
    await tapIt(tester, inSheet(find.byType(Switch)).last);
    expect(find.text('Every month on the 16th'), findsOneWidget);
    await tapIt(tester, find.text('Daily'));
    expect(find.text('Every day'), findsOneWidget);
    expect(find.textContaining('Next: 2026-11-16 · 2026-11-17'), findsOneWidget);
    await tapIt(tester, find.text('Save schedule'));
    final r = only(b, 'money.recurring');
    expect(r['rrule'], 'FREQ=DAILY');
    expect(r['startDate'], '2026-11-16');
    expect(r['mode'], 'add');
    expect(r['amountMinor'], 2200000);
    expect(r['title'], 'Rent');
    await finish(tester);
  });

  testWidgets('search and filters narrow the list; accounts, categories and schedules are managed in one place', (
    tester,
  ) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['money']));
    final b = await openMoney(tester, h);
    // a tall phone, so the whole list is built
    tester.view.physicalSize = const Size(1080, 4800);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await settle(tester);
    for (final t in ['uber 180', 'spent 240 on lunch at swiggy']) {
      await tester.enterText(find.byKey(const Key('money-add')), t);
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await settle(tester);
    }
    expect(find.text('Uber'), findsWidgets);
    await tapIt(tester, find.bySemanticsLabel('Search transactions'));
    await tester.enterText(find.byKey(const Key('money-search')), 'swig');
    await settle(tester);
    expect(find.textContaining('1 found · ₹240 spent'), findsOneWidget);
    expect(find.text('Uber'), findsNothing);
    await tester.enterText(find.byKey(const Key('money-search')), 'nothing like this');
    await settle(tester);
    expect(find.text('Nothing matches. Clear a filter to see more.'), findsOneWidget);
    await tapIt(tester, find.text('Clear'));
    expect(find.text('Uber'), findsWidgets);

    await tapIt(tester, find.byTooltip('More'));
    await tapIt(tester, find.text('Categories, repeating, learned'));
    expect(
      find.text('Nothing repeats yet. Add rent, a subscription or your salary once and it shows up on its day.'),
      findsOneWidget,
    );
    await tapIt(tester, find.text('Accounts'));
    await tester.enterText(find.widgetWithText(TextField, 'HDFC savings, Cash…').first, 'Cash wallet');
    await tapIt(tester, find.text('Add account'));
    expect(only(b, 'money.account'), containsPair('name', 'Cash wallet'));
    await tapIt(tester, find.text('Categories'));
    await tester.enterText(find.widgetWithText(TextField, 'Pets, Hobbies…').first, 'Pets');
    await tapIt(tester, find.text('Add category'));
    expect(b.rows.values.where((r) => r['name'] == 'Pets'), hasLength(1));
    await finish(tester);
  });
}
