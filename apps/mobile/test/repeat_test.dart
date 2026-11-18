import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:orvyn/app/repeat.dart';

/// The same repeats as packages/today-plan (fixtures/repeat.json): same words, same dates, in both.
void main() {
  final f = jsonDecode(File('../../packages/today-plan/fixtures/repeat.json').readAsStringSync()) as Map;
  for (final c in (f['summaries'] as List).cast<Map<String, dynamic>>()) {
    test('${c['rrule']} → ${c['text']}', () {
      final s = parseRepeat(c['rrule'] as String)!;
      expect(describeSpec(s), c['text']);
      expect(buildRepeat(s), c['rrule']);
    });
  }
  for (final r in (f['unreadable'] as List).cast<String>()) {
    test('$r is left as it is', () => expect(parseRepeat(r), isNull));
  }
  for (final c in (f['previews'] as List).cast<Map<String, dynamic>>()) {
    test('${c['rrule']} from ${c['start']}', () {
      expect(nextDates(c['rrule'] as String, c['start'] as String, c['n'] as int), (c['dates'] as List).cast<String>());
    });
  }

  test('a start date suggests the repeat', () {
    expect(RepeatSpec.forStart('WEEKLY', '2026-11-18').days, ['WE']);
    expect(RepeatSpec.forStart('MONTHLY', '2026-11-18').monthDay, 18);
    expect(buildRepeat(RepeatSpec.forStart('MONTHLY', '2026-11-18')), 'FREQ=MONTHLY;BYMONTHDAY=18');
  });
}
