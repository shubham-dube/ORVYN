import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:orvyn/money/brain.dart';
import 'package:orvyn/money/money.dart';

import 'calendar_screen_test.dart' show seed, tapIt;
import 'support/fake_server.dart';
import 'support/harness.dart';

var _n = 0;
TxItem tx(String merchant, int rupees, DateTime at, {String? cat, String? acct}) => TxItem('t${++_n}', {
  'amountMinor': rupees * 100,
  'direction': 'debit',
  'occurredAt': at.toUtc().toIso8601String(),
  'merchant': merchant,
  'categoryId': ?cat,
  'accountId': ?acct,
});

/// The same cases as packages/money/test/brain.test.ts.
final _history = [
  tx('Swiggy', 320, DateTime(2026, 9, 3, 20), cat: 'c-food', acct: 'hdfc'),
  tx('Swiggy', 410, DateTime(2026, 9, 18, 21), cat: 'c-food', acct: 'hdfc'),
  tx('SWIGGY', 280, DateTime(2026, 10, 2, 13), cat: 'c-food', acct: 'hdfc'),
  tx('Swiggy', 350, DateTime(2026, 10, 20, 20), cat: 'c-food', acct: 'icici'),
  tx('Swiggy', 390, DateTime(2026, 11, 5, 20), cat: 'c-food', acct: 'hdfc'),
  tx('Netflix', 499, DateTime(2026, 10, 10, 9), cat: 'c-subs'),
  tx('Chai Point', 45, DateTime(2026, 11, 2, 8)),
  tx('Chai Point', 45, DateTime(2026, 11, 3, 8)),
  tx('Chai Point', 45, DateTime(2026, 11, 4, 8)),
];

void main() {
  group('merchant profiles (spec 0013, same as the TypeScript)', () {
    final p = merchantProfiles(_history);
    test('groups spellings; the usual category, account and amount', () {
      final s = p['swiggy']!;
      expect(
        [s.count, s.merchant, s.categoryId, s.categoryShare, s.accountId, s.medianMinor],
        [5, 'Swiggy', 'c-food', 1.0, 'hdfc', 35000],
      );
      expect(s.confident, isTrue);
      expect(p['chai point']!.confident, isFalse);
      expect(p['chai point']!.amounts, [4500]);
    });
    test('suggestions as you type, and for an amount', () {
      final now = DateTime(2026, 11, 20);
      expect(suggestMerchants(p, 'sw', now).map((x) => x.merchant), ['Swiggy']);
      expect(suggestMerchants(p, 'point', now).map((x) => x.merchant), ['Chai Point']);
      expect(suggestMerchants(p, '', now).first.merchant, 'Swiggy');
      expect(merchantsForAmount(p, 4500).map((x) => x.merchant), ['Chai Point']);
      expect(merchantsForAmount(p, 77700), isEmpty);
    });
  });

  Future<FakeSyncBackend> openMoney(WidgetTester tester, AppHarness h) async {
    final b = FakeSyncBackend()..attach(h.server);
    h.server.on('POST /money/setup', (_) {
      for (final (id, name, slug) in const [
        ('c-food', 'Food & dining', 'food'),
        ('c-transport', 'Transport', 'transport'),
      ]) {
        seed(b, 'money.category', id, {'name': name, 'slug': slug, 'kind': 'expense', 'colour': 'amber'});
      }
      return {'created': 2};
    });
    for (final (i, d) in const [(1, 3), (2, 9), (3, 14)].indexed) {
      seed(b, 'money.transaction', 'h$i', {
        'amountMinor': 31000,
        'direction': 'debit',
        'occurredAt': DateTime(2026, 11, d.$2, 9).toUtc().toIso8601String(),
        'merchant': 'Blue Tokai',
        'categoryId': 'c-food',
        'source': 'manual',
      });
    }
    seed(b, 'money.transaction', 'loose', {
      'amountMinor': 18000,
      'direction': 'debit',
      'occurredAt': DateTime(2026, 11, 15, 9).toUtc().toIso8601String(),
      'merchant': 'Uber',
      'source': 'manual',
    });
    await h.pump(tester);
    tester.view.physicalSize = const Size(1080, 4800);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.tap(find.bySemanticsLabel('Money'));
    await settle(tester, 20);
    return b;
  }

  testWidgets('smart fill: type a few letters, pick the merchant — category and usual amount come with it', (
    tester,
  ) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['money']));
    h.server.on('GET /money/insights', (_) => const Reply(404));
    final b = await openMoney(tester, h);
    await tapIt(tester, find.byTooltip('Add with details'));
    await tester.enterText(find.widgetWithText(TextField, '').at(1), 'blu');
    await settle(tester);
    expect(find.byKey(const Key('smart-blue tokai')), findsOneWidget);
    await tapIt(tester, find.byKey(const Key('smart-blue tokai')));
    expect(find.text('Like your last 3 at Blue Tokai'), findsOneWidget);
    await tapIt(tester, find.text('Add'));
    final added = b.rows.entries
        .where((e) => e.key.startsWith('money.transaction/') && !e.key.contains('/h') && !e.key.endsWith('loose'))
        .single
        .value;
    expect(added, containsPair('merchant', 'Blue Tokai'));
    expect(added, containsPair('categoryId', 'c-food'));
    expect(added, containsPair('amountMinor', 31000));
    await tester.pump(const Duration(seconds: 5));
    await finish(tester);
  });

  testWidgets('the month read for you: pace, cards that do something — file what has no category', (tester) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['money']));
    h.server.on(
      'GET /money/insights',
      (_) => {
        'pace': {
          'month': '2026-11',
          'day': 16,
          'daysInMonth': 30,
          'spentMinor': 111000,
          'lastMonthSameDayMinor': 90000,
          'lastMonthMinor': 200000,
          'projectedMinor': 260000,
          'upcomingMinor': 0,
          'budgetMinor': 300000,
          'safePerDayMinor': 13500,
        },
        'cards': [
          {
            'id': 'pace',
            'kind': 'pace',
            'tone': 'good',
            'title': 'On track: about ₹2,600 by month end',
            'body': '₹1,110 so far.',
          },
          {'id': 'safe', 'kind': 'safe', 'tone': 'info', 'title': '₹135 a day is safe to spend', 'body': ''},
          {
            'id': 'uncategorised',
            'kind': 'uncategorised',
            'tone': 'info',
            'title': '1 payment has no category',
            'body': 'File it in a minute.',
            'action': {'kind': 'categorise'},
          },
        ],
      },
    );
    final b = await openMoney(tester, h);
    expect(find.text('On track: about ₹2,600 by month end'), findsOneWidget);
    expect(find.text('₹135 a day is safe to spend'), findsOneWidget);
    await tapIt(tester, find.text('1 payment has no category'));
    expect(find.text('File 1'), findsOneWidget);
    await tapIt(tester, find.widgetWithText(ActionChip, 'Transport'));
    expect(b.rows['money.transaction/loose'], containsPair('categoryId', 'c-transport'));
    expect(find.text('All filed'), findsOneWidget);
    await finish(tester);
  });
}
