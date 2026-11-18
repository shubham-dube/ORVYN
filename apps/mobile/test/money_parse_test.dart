import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:orvyn/money/parse.dart';

/// The same fixtures as packages/money (spec 0003 AC1): both readers must agree on every message.
void main() {
  final cases =
      (jsonDecode(File('../../packages/money/fixtures/messages.json').readAsStringSync()) as Map)['cases'] as List;
  for (final c in cases.cast<Map<String, dynamic>>()) {
    test(c['id'] as String, () {
      final got = parseMessage(
        source: c['source'] as String,
        app: c['app'] as String?,
        title: c['title'] as String?,
        text: c['text'] as String,
      );
      expect(got?.toJson(), c['expect']);
    });
  }

  test('one payment seen twice is one transaction (AC2)', () {
    final sms = Sighting(
      id: 'a',
      amountMinor: 24000,
      direction: 'debit',
      occurredAt: DateTime.utc(2026, 11, 17, 8),
      dedupeKey: 'ref:432112345678',
      source: 'sms',
    );
    Sighting gpay(DateTime at, [String? key]) =>
        Sighting(amountMinor: 24000, direction: 'debit', occurredAt: at, dedupeKey: key, source: 'notification');
    expect(findDuplicate(gpay(DateTime.utc(2026, 11, 17, 8, 1)), [sms])?.id, 'a');
    expect(findDuplicate(gpay(DateTime.utc(2026, 11, 17, 9)), [sms]), isNull);
    expect(findDuplicate(gpay(DateTime.utc(2026, 11, 17, 8, 1), 'ref:432112349999'), [sms]), isNull);
  });
}
