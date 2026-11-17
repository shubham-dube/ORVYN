import 'package:flutter_test/flutter_test.dart';
import 'package:orvyn/app/calendar.dart';

String iso(DateTime d) => d.toUtc().toIso8601String();
EventItem ev(String id, Map<String, dynamic> f) => EventItem(id, {'title': id, ...f});

void main() {
  final from = DateTime(2026, 11, 16);
  final to = DateTime(2026, 11, 23);

  test('a weekday standup with one cancelled and one moved, plus single and all-day events', () {
    final standup = ev('standup', {
      'start': iso(DateTime(2026, 11, 2, 10)),
      'end': iso(DateTime(2026, 11, 2, 10, 15)),
      'rrule': 'FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR',
      'exdates': [iso(DateTime(2026, 11, 17, 10))],
    });
    final moved = ev('moved', {
      'title': 'standup',
      'start': iso(DateTime(2026, 11, 18, 11)),
      'end': iso(DateTime(2026, 11, 18, 11, 15)),
      'recurringEventId': 'standup',
      'originalStart': iso(DateTime(2026, 11, 18, 10)),
    });
    final trip = ev('trip', {'allDay': true, 'startDate': '2026-11-21', 'endDate': '2026-11-23'});
    final out = expandEvents([standup, moved, trip], from, to);
    String label(Instance i) => i.allDay ? '${i.title} ${i.startDate}' : '${i.title} ${i.start!.day} ${i.start!.hour}';
    expect(out.map(label).toList(), [
      'standup 16 10',
      'standup 18 11',
      'standup 19 10',
      'standup 20 10',
      'trip 2026-11-21',
    ]);
    expect(out[1].eventId, 'moved');
    expect(out[0].occurrence, iso(DateTime(2026, 11, 16, 10)));
  });

  test('a yearly birthday, hidden calendars, and an event running into the window', () {
    final bday = ev('bday', {
      'allDay': true,
      'startDate': '2020-11-20',
      'endDate': '2020-11-21',
      'rrule': 'FREQ=YEARLY',
      'calendarId': 'c1',
    });
    expect(expandEvents([bday], from, to).map((i) => i.startDate), ['2026-11-20']);
    expect(expandEvents([bday], from, to, hidden: {'c1'}), isEmpty);
    final late = ev('late', {'start': iso(DateTime(2026, 11, 15, 23)), 'end': iso(DateTime(2026, 11, 16, 1))});
    final i = expandEvents([late], from, to).single;
    expect(spanOn(i, '2026-11-16'), (start: 0, end: 60));
  });

  test('free time is working hours minus busy, from now on', () {
    final working = [(start: 600, end: 780), (start: 840, end: 1140)];
    expect(freeRanges(working, [(start: 600, end: 630), (start: 640, end: 700), (start: 840, end: 1140)]), [
      (start: 700, end: 780),
    ]);
    expect(freeRanges(working, const [], from: 750), [(start: 750, end: 780), (start: 840, end: 1140)]);
  });

  test('a repeat that starts inside the window (made today) still shows today', () {
    final e = ev('new', {
      'start': iso(DateTime(2026, 11, 16, 10)),
      'end': iso(DateTime(2026, 11, 16, 11)),
      'rrule': 'FREQ=MONTHLY',
    });
    expect(expandEvents([e], from, DateTime(2026, 11, 17)).single.start, DateTime(2026, 11, 16, 10));
  });
}
