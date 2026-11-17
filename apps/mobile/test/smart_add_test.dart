import 'package:flutter_test/flutter_test.dart';
import 'package:orvyn/app/smart_add.dart';

void main() {
  test('repeat labels match the web', () {
    expect(repeatLabel('FREQ=MONTHLY;BYMONTHDAY=1'), 'every month on the 1st');
    expect(repeatLabel('FREQ=MONTHLY;BYMONTHDAY=22'), 'every month on the 22nd');
    expect(repeatLabel('FREQ=MONTHLY;BYMONTHDAY=-1'), 'last day of every month');
    expect(repeatLabel('FREQ=WEEKLY;BYDAY=MO,WE,FR'), 'every Mon, Wed, Fri');
    expect(repeatLabel('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'), 'every weekday');
    expect(repeatLabel('FREQ=WEEKLY;INTERVAL=2'), 'every 2 weeks');
    expect(repeatLabel('FREQ=DAILY'), 'every day');
  });

  test('fields fall back to the chosen day only when the text named none', () {
    final p = ParsedTask({
      'title': 'Call mom',
      'dueDate': null,
      'dueAt': null,
      'priority': 0,
      'tags': <String>[],
      'spans': <dynamic>[],
    });
    expect(p.fields('2026-11-17')['dueDate'], '2026-11-17');
    final timed = ParsedTask({
      'title': 'Call mom',
      'dueAt': '2026-11-17T12:30:00.000Z',
      'priority': 2,
      'tags': <String>[],
      'spans': <dynamic>[],
    });
    expect(timed.fields('2026-11-20'), containsPair('dueDate', null));
    expect(timed.fields('2026-11-20'), containsPair('priority', 2));
  });
}
