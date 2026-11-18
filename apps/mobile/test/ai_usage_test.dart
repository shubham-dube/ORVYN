import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import 'support/fake_server.dart';
import 'support/harness.dart';

void main() {
  testWidgets('Settings shows what AI has cost today and by job, and the limit', (tester) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['today']));
    h.server.on(
      'GET /ai/usage',
      (_) => {
        'days': 14,
        'totalUsd': 0.042,
        'byDay': [
          {'day': '2026-11-16', 'costUsd': 0.03, 'calls': 12, 'failed': 0},
          {'day': '2026-11-15', 'costUsd': 0.012, 'calls': 4, 'failed': 1},
        ],
        'byTask': [
          {'task': 'drop.understand', 'model': 'm', 'costUsd': 0.04, 'calls': 14},
          {'task': 'today.parse', 'model': 'm', 'costUsd': 0.002, 'calls': 2},
        ],
        'status': {'available': true, 'paused': false, 'capUsd': 1, 'spentTodayUsd': 0.03},
      },
    );
    await h.pump(tester);
    await tester.tap(find.bySemanticsLabel('Settings'));
    await settle(tester, 20);
    await tester.scrollUntilVisible(
      find.textContaining('Today, everyone together'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.textContaining(r'$0.030 of $1.00'), findsOneWidget);
    expect(find.text('Sorting what you drop'), findsOneWidget);
    expect(find.text('14 calls · \$0.040'), findsOneWidget);
    await finish(tester);
  });
}
