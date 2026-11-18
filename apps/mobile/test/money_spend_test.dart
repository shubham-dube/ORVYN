import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:orvyn/money/money.dart';
import 'package:orvyn/money/spend_date.dart';

/// The same typed entries as packages/money (fixtures/spend.json): both readers must agree on every one, including
/// which day it was.
void main() {
  final file = jsonDecode(File('../../packages/money/fixtures/spend.json').readAsStringSync()) as Map;
  // the reference "now" is 18 Nov 2026, 10:00 on this device
  final now = DateTime(2026, 11, 18, 10);
  for (final c in (file['cases'] as List).cast<Map<String, dynamic>>()) {
    test(c['text'] as String, () {
      final got = parseSpend(c['text'] as String, now: now);
      final expected = c['expect'] as Map<String, dynamic>;
      if (expected.isEmpty || got == null) {
        expect(got == null, expected.isEmpty || c['expect'] == null);
        return;
      }
      final json = <String, dynamic>{
        'amountMinor': got.amountMinor,
        'direction': got.direction,
        'merchant': got.merchant,
        'category': got.category,
        'note': got.note,
        'date': got.date,
        'time': got.time,
      };
      for (final e in expected.entries) {
        expect(json[e.key], e.value, reason: e.key);
      }
    });
  }

  test('a typed day without a time is noon, today without a time is right now', () {
    expect(occurredAtFor(date: '2026-11-12', now: now), DateTime(2026, 11, 12, 12));
    expect(occurredAtFor(date: '2026-11-17', time: '14:30', now: now), DateTime(2026, 11, 17, 14, 30));
    expect(occurredAtFor(now: now), now);
    expect(occurredAtFor(date: '2026-11-18', now: now), now);
  });
}
