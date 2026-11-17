import 'package:flutter_test/flutter_test.dart';
import 'package:orvyn/app/today_settings.dart';

Map<String, dynamic> week(List<Map<String, String>> r, [List<Map<String, String>> weekend = const []]) => {
  'mon': r, 'tue': r, 'wed': r, 'thu': r, 'fri': r, 'sat': weekend, 'sun': weekend, //
};

void main() {
  // the same cases as packages/contracts/test/today-settings.test.ts
  final s = {
    'patterns': [
      {
        'validFrom': '2026-01-01',
        'week': week([
          {'start': '10:00', 'end': '19:00'},
        ]),
      },
      {
        'validFrom': '2026-12-01',
        'week': week(
          [
            {'start': '09:00', 'end': '13:00'},
            {'start': '14:00', 'end': '17:00'},
          ],
          [
            {'start': '10:00', 'end': '12:00'},
          ],
        ),
      },
    ],
    'dayOverrides': [
      {'date': '2026-12-25', 'ranges': <Map<String, String>>[]},
      {
        'date': '2026-11-21',
        'ranges': [
          {'start': '11:00', 'end': '14:00'},
        ],
      },
    ],
  };

  test('the pattern that has started by that date applies', () {
    expect(workingRangesOn(s, '2026-11-17'), [
      {'start': '10:00', 'end': '19:00'},
    ]);
    expect(workingRangesOn(s, '2026-12-01'), hasLength(2));
    expect(workingRangesOn(s, '2026-12-06'), [
      {'start': '10:00', 'end': '12:00'},
    ]);
    expect(workingRangesOn(s, '2026-11-22'), isEmpty);
    expect(workingRangesOn(s, '2025-06-01'), isEmpty);
  });

  test('a day override beats the pattern', () {
    expect(workingRangesOn(s, '2026-12-25'), isEmpty);
    expect(workingRangesOn(s, '2026-11-21'), [
      {'start': '11:00', 'end': '14:00'},
    ]);
  });

  test('problems are explained before saving', () {
    expect(settingsProblem(startingSettings('Asia/Kolkata')), isNull);
    final overlap = startingSettings('UTC');
    ((overlap['patterns'] as List).first['week'] as Map)['mon'] = [
      {'start': '09:00', 'end': '13:00'},
      {'start': '12:00', 'end': '17:00'},
    ];
    expect(settingsProblem(overlap), contains('overlap'));
    final dup = startingSettings('UTC');
    (dup['patterns'] as List).add((dup['patterns'] as List).first);
    expect(settingsProblem(dup), contains('same day'));
  });

  test('lead time labels', () {
    expect(
      [leadLabel(0), leadLabel(10), leadLabel(120), leadLabel(1440), leadLabel(2880)],
      ['at the time', '10 min before', '2 h before', '1 day before', '2 days before'],
    );
  });
}
