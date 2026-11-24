import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import 'calendar_screen_test.dart' show tapIt;
import 'support/harness.dart';

Map<String, dynamic> _issue({bool starred = false}) => {
  'id': 'i1',
  'slug': 'mega-power',
  'name': 'Mega Power Ltd',
  'type': 'mainboard',
  'status': 'open',
  'openDate': '2026-11-19',
  'closeDate': '2026-11-21',
  'allotmentDate': '2026-11-24',
  'refundDate': null,
  'listingDate': '2026-11-26',
  'priceMin': 140,
  'priceMax': 148,
  'lotSize': 101,
  'issueSizeCr': 1000,
  'gmp': 40,
  'gmpPct': 27.0,
  'gmpUpdatedAt': null,
  'estListingPrice': 188,
  'subscription': {
    'total': 3.1,
    'qib': 1.2,
    'nii': 4.4,
    'snii': null,
    'bnii': null,
    'retail': 12.5,
    'employee': null,
    'shareholder': null,
    'applications': null,
    'updatedAt': null,
  },
  'listingPrice': null,
  'minInvestment': 14948,
  'gainPerLot': 4040,
  'logo': null,
  'decision': null,
  'taskId': null,
  'source': 'IPO Guru',
  'sourceUrl': 'https://www.ipoguru.in',
  'manual': <String>[],
  'starred': starred,
  'odds': [
    {
      'category': 'retail',
      'minLots': 1,
      'minAmount': 14948,
      'lotsOnOffer': 234145,
      'chance': 0.08,
      'basis': 'estimate',
    },
    {'category': 'snii', 'minLots': 14, 'minAmount': 209272, 'lotsOnOffer': 2788, 'chance': null, 'basis': 'none'},
  ],
  'pool': {'accounts': 3, 'expectedAllotments': 0.24, 'chanceAtLeastOne': 0.22, 'expectedGain': 969, 'cardCost': 0},
  'verdict': 'GMP 27% · retail odds ~8%.',
  'history': [
    {'at': '2026-11-19T04:00:00Z', 'gmp': 32, 'retail': null, 'total': null},
    {'at': '2026-11-19T07:00:00Z', 'gmp': 40, 'retail': 12.5, 'total': 3.1},
  ],
  'roundId': 'r1',
};

void main() {
  testWidgets('IPO desk: GMP, odds and what my accounts can expect; the round says who needs money (spec 0010)', (
    tester,
  ) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['ipo']));
    final updates = <dynamic>[];
    h.server.on(
      'GET /ipo/issues',
      (_) => {
        'issues': [_issue()],
        'feed': {'name': 'IPO Guru', 'ready': true, 'credit': 'https://www.ipoguru.in', 'subscription': false},
      },
    );
    h.server.on('GET /ipo/issues/i1', (_) => _issue());
    h.server.on('GET /ipo/pool/partners', (_) => <dynamic>[]);
    h.server.on('GET /ipo/pool/sources', (_) => <dynamic>[]);
    h.server.on(
      'GET /ipo/pool/rounds/r1',
      (_) => {
        'id': 'r1',
        'issue': {
          'id': 'i1',
          'name': 'Mega Power Ltd',
          'status': 'open',
          'closeDate': '2026-11-21',
          'listingDate': '2026-11-26',
          'priceMax': 148,
          'lotSize': 101,
          'gmp': 40,
          'listingPrice': null,
        },
        'accounts': 2,
        'applied': 0,
        'allotted': 0,
        'gainMinor': 0,
        'costsMinor': 0,
        'sharesMinor': 0,
        'netMinor': 0,
        'toSendMinor': 1494800,
        'feesIfCheapestMinor': 37370,
        'closed': false,
        'closesAt': '5 pm, Fri 21 Nov',
        'board': {
          'stages': {'not_asked': 0, 'asked': 0, 'will_apply': 2, 'applied': 0, 'mandate': 0, 'out': 0},
          'applied': 0,
          'mandates': 0,
          'missed': <dynamic>[],
          'noReply': <dynamic>[],
          'mandatePending': <dynamic>[],
        },
        'roster': [
          {
            'partner': {'id': 'p1', 'name': 'Ravi', 'upi': '', 'phone': '', 'relation': ''},
            'applicationId': 'a1',
            'status': 'planned',
            'stage': 'will_apply',
            'record': {'applied': 3, 'of': 4, 'missed': 1, 'lastMissed': 'Tiny Foods', 'missedLast': true},
          },
          {
            'partner': {'id': 'p2', 'name': 'Amit', 'upi': '', 'phone': '', 'relation': ''},
            'applicationId': 'a2',
            'status': 'planned',
            'stage': 'will_apply',
            'record': {'applied': 0, 'of': 0, 'missed': 0, 'lastMissed': null, 'missedLast': false},
          },
          {
            'partner': {'id': 'p3', 'name': 'Neha', 'upi': '', 'phone': '9876543210', 'relation': ''},
            'applicationId': null,
            'status': null,
            'stage': null,
            'record': {'applied': 0, 'of': 0, 'missed': 0, 'lastMissed': null, 'missedLast': false},
          },
        ],
        'applications': [
          {
            'id': 'a1',
            'partner': {'id': 'p1', 'name': 'Ravi', 'upi': '', 'phone': ''},
            'category': 'retail',
            'lots': 1,
            'amountMinor': 1494800,
            'status': 'planned',
            'reportedBy': 'owner',
            'allottedLots': null,
            'soldPrice': null,
            'holdsMinor': 1500000,
            'fundedMinor': 0,
            'needMinor': 0,
            'suggestion': null,
            'gainMinor': null,
            'shareMinor': null,
            'backMinor': null,
          },
          {
            'id': 'a2',
            'partner': {'id': 'p2', 'name': 'Amit', 'upi': '', 'phone': ''},
            'category': 'retail',
            'lots': 1,
            'amountMinor': 1494800,
            'status': 'planned',
            'reportedBy': 'owner',
            'allottedLots': null,
            'soldPrice': null,
            'holdsMinor': 0,
            'fundedMinor': 0,
            'needMinor': 1494800,
            'suggestion': {'sourceId': 's1', 'source': 'HDFC card cash', 'feeMinor': 37370},
            'gainMinor': null,
            'shareMinor': null,
            'backMinor': null,
          },
        ],
      },
    );
    final decided = <dynamic>[];
    h.server.on('PUT /ipo/issues/i1/decision', (r) {
      decided.add(r.body);
      return {'decision': 'applying', 'taskId': 't1'};
    });
    h.server.on('PUT /ipo/pool/applications/a1', (r) {
      updates.add(r.body);
      return {'ok': true};
    });
    final moved = <dynamic>[];
    h.server.on('PUT /ipo/pool/rounds/r1/partners', (r) {
      moved.add(r.body);
      return {'ok': true};
    });
    await h.pump(tester);
    tester.view.physicalSize = const Size(1170, 4000);
    addTearDown(tester.view.reset);
    await tester.tap(find.bySemanticsLabel('More'));
    await settle(tester);
    await tester.tap(find.bySemanticsLabel('Open IPO'));
    await settle(tester, 20);
    expect(find.text('Mega Power Ltd'), findsOneWidget);
    // the four numbers that decide it (spec 0016 A3)
    expect(find.text('₹1,000 cr'), findsOneWidget);
    expect(find.text('+₹40'), findsOneWidget);
    expect(find.text('₹14,948'), findsOneWidget);
    expect(find.text('+₹4,040 a lot'), findsOneWidget);
    // will you apply? — straight from the card
    await tapIt(tester, find.byKey(const Key('ipo-apply-i1')));
    expect(decided.single, {'decision': 'applying'});
    expect(find.text('Added to Today'), findsOneWidget);

    await tester.tap(find.text('Mega Power Ltd'));
    await settle(tester, 20);
    expect(find.text('With your 3 accounts'), findsOneWidget);
    expect(find.text('22%'), findsOneWidget);
    expect(find.text('+₹969'), findsOneWidget);
    expect(find.text('GREY-MARKET PREMIUM'), findsOneWidget);
    expect(find.text('HOW HOT IS IT'), findsOneWidget);

    await tester.scrollUntilVisible(find.text('Open your round'), 300, scrollable: find.byType(Scrollable).first);
    await tapIt(tester, find.text('Open your round'));
    expect(find.text('Already holds enough — nothing to send.'), findsOneWidget);
    expect(find.text('Needs ₹14,948 — cheapest: HDFC card cash'), findsOneWidget);
    // the board: who missed last time, who isn't in yet (spec 0018)
    expect(find.text('0 of 2 applied · 0 mandates'), findsOneWidget);
    expect(find.text('missed Tiny Foods last time'), findsOneWidget);
    expect(find.text('Not in this round'), findsOneWidget);
    await tapIt(tester, find.byKey(const Key('act-a1-applied')));
    expect(moved.single, {
      'partnerIds': ['p1'],
      'status': 'applied',
    });
    // someone added later starts at To ask
    await tapIt(tester, find.byKey(const Key('act-p3-to_ask')));
    expect(moved.last, {
      'partnerIds': ['p3'],
      'status': 'to_ask',
    });
    await finish(tester);
  });

  testWidgets('My Pool: where the profit went, partners’ float and what I owe', (tester) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['ipo']));
    h.server.on(
      'GET /ipo/issues',
      (_) => {
        'issues': <dynamic>[],
        'feed': {'name': 'manual', 'ready': false, 'credit': null, 'subscription': false},
      },
    );
    h.server.on(
      'GET /ipo/pool/partners',
      (_) => [
        {
          'id': 'p1',
          'name': 'Priya',
          'phone': '',
          'upi': '',
          'relation': '',
          'categories': ['retail'],
          'share': {'kind': 'fixed', 'value': 500},
          'active': true,
          'notes': '',
        },
      ],
    );
    h.server.on(
      'GET /ipo/pool/sources',
      (_) => [
        {'id': 's1', 'name': 'Brother', 'kind': 'family', 'feePct': 0, 'repay': true, 'active': true},
      ],
    );
    h.server.on(
      'GET /ipo/pool/summary',
      (_) => {
        'gainMinor': 642400,
        'costsMinor': 37370,
        'sharesMinor': 130300,
        'netMinor': 474730,
        'withPartnersMinor': 2989600,
        'inSharesMinor': 0,
        'sharesDueMinor': 0,
        'owedMinor': 500000,
        'fromMeMinor': 0,
        'backHomeMinor': 0,
        'rounds': <dynamic>[],
        'partners': [
          {
            'partnerId': 'p1',
            'name': 'Priya',
            'cash': 1494800,
            'blocked': 0,
            'available': 1494800,
            'inShares': 0,
            'shareDue': 0,
          },
        ],
        'sources': [
          {
            'sourceId': 's1',
            'name': 'Brother',
            'kind': 'family',
            'given': 1000000,
            'back': 500000,
            'fees': 0,
            'owed': 500000,
          },
        ],
      },
    );
    await h.pump(tester);
    tester.view.physicalSize = const Size(1170, 4000);
    addTearDown(tester.view.reset);
    await tester.tap(find.bySemanticsLabel('More'));
    await settle(tester);
    await tester.tap(find.bySemanticsLabel('Open IPO'));
    await settle(tester, 20);
    await tester.tap(find.text('My Pool'));
    await settle(tester, 20);
    expect(find.text('₹4,747.30'), findsWidgets); // net to you
    expect(find.text('−₹1,303'), findsOneWidget); // partners' shares
    expect(find.text('₹500 per allotment'), findsOneWidget);
    expect(find.text('₹14,948'), findsOneWidget); // Priya's float
    expect(find.text('you owe ₹5,000'), findsOneWidget);
    await finish(tester);
  });
}
