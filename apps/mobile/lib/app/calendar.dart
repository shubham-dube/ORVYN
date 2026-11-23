import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:rrule/rrule.dart';
import 'package:url_launcher/url_launcher.dart';

import '../sync/sync_client.dart';
import 'state.dart';
import 'today.dart';
import 'today_settings.dart';

const todayEvent = 'today.event';
const todayCalendar = 'today.calendar';

/// An event as the app reads it from the local mirror (missing fields mean the server defaults).
class EventItem {
  EventItem(this.id, this.data);
  final String id;
  final Map<String, dynamic> data;

  String get title => (data['title'] as String?) ?? '';
  String get notes => (data['notes'] as String?) ?? '';
  String get location => (data['location'] as String?) ?? '';
  bool get allDay => data['allDay'] == true;
  DateTime? get start => _time('start');
  DateTime? get end => _time('end');
  String? get startDate => data['startDate'] as String?;
  String? get endDate => data['endDate'] as String?;
  String? get rrule => data['rrule'] as String?;
  List<String> get exdates => [for (final x in (data['exdates'] as List? ?? const [])) x as String];
  String? get recurringEventId => data['recurringEventId'] as String?;
  String? get originalStart => data['originalStart'] as String?;
  bool get cancelled => data['cancelled'] == true;
  String? get calendarId => data['calendarId'] as String?;

  DateTime? _time(String k) => data[k] == null ? null : DateTime.parse(data[k] as String).toLocal();
}

class CalendarItem {
  CalendarItem(this.id, this.data);
  final String id;
  final Map<String, dynamic> data;
  String get name => (data['name'] as String?) ?? '';
  String get colour => (data['colour'] as String?) ?? 'sky';
  bool get visible => data['visible'] != false;
  bool get writable => data['writable'] != false;
  String get provider => (data['provider'] as String?) ?? 'orvyn';
  String? get accountId => data['accountId'] as String?;

  /// Google's public-holiday calendars (one per connected account, so the same holiday shows up 4 times).
  bool get holiday =>
      RegExp(r'#holiday@group\.v\.calendar\.google\.com$').hasMatch(data['externalId'] as String? ?? '');
}

/// One thing on the river: a single event, or one occurrence of a repeating one (same rules as the web).
class Instance {
  Instance({
    required this.eventId,
    required this.seriesId,
    required this.occurrence,
    required this.title,
    required this.calendarId,
    required this.allDay,
    this.start,
    this.end,
    this.startDate,
    this.endDate,
  });
  final String eventId;
  final String? seriesId;

  /// which occurrence: its original start (UTC ISO instant, or a date for all-day)
  final String? occurrence;
  final String title;
  final String? calendarId;
  final bool allDay;
  final DateTime? start;
  final DateTime? end;
  final String? startDate;
  final String? endDate;
}

String _iso(DateTime d) => d.toUtc().toIso8601String().replaceFirst(RegExp(r'\.\d+Z$'), '.000Z');
DateTime _floating(DateTime local) => DateTime.utc(local.year, local.month, local.day, local.hour, local.minute);
DateTime _local(DateTime f) => DateTime(f.year, f.month, f.day, f.hour, f.minute);
DateTime _date(String ymd) =>
    DateTime.utc(int.parse(ymd.substring(0, 4)), int.parse(ymd.substring(5, 7)), int.parse(ymd.substring(8, 10)));
String _ymd(DateTime d) => dayKey(d);

DateTime _max(DateTime a, DateTime b) => a.isAfter(b) ? a : b;

RecurrenceRule? _rule(String rrule) {
  try {
    return RecurrenceRule.fromString(rrule.startsWith('RRULE:') ? rrule : 'RRULE:$rrule');
  } catch (_) {
    return null; // a rule this app can't read: show the first occurrence only
  }
}

/// Everything overlapping [from, to) in the phone's local time. Repeats are expanded in local wall time.
List<Instance> expandEvents(List<EventItem> events, DateTime from, DateTime to, {Set<String> hidden = const {}}) {
  final overrides = {
    for (final e in events)
      if (e.recurringEventId != null && e.originalStart != null) '${e.recurringEventId}|${e.originalStart}',
  };
  final out = <Instance>[];
  final fromDay = _ymd(from);
  final toDay = _ymd(to);
  bool overlapsDays(String s, String e) => s.compareTo(toDay) < 0 && e.compareTo(fromDay) > 0;
  bool overlaps(DateTime s, DateTime e) => s.isBefore(to) && e.isAfter(from);

  for (final e in events) {
    if (e.cancelled || (e.calendarId != null && hidden.contains(e.calendarId))) continue;
    final rule = e.rrule == null ? null : _rule(e.rrule!);
    if (e.allDay) {
      final s = e.startDate;
      final en = e.endDate;
      if (s == null || en == null) continue;
      if (rule == null) {
        if (overlapsDays(s, en)) {
          out.add(
            Instance(
              eventId: e.id,
              seriesId: e.recurringEventId,
              occurrence: e.originalStart,
              title: e.title,
              calendarId: e.calendarId,
              allDay: true,
              startDate: s,
              endDate: en,
            ),
          );
        }
        continue;
      }
      final span = _date(en).difference(_date(s)).inDays;
      final skip = e.exdates.toSet();
      for (final o in rule.getInstances(
        start: _date(s),
        after: _max(_date(fromDay).subtract(Duration(days: span)), _date(s)),
        includeAfter: true,
        before: _date(toDay),
      )) {
        final d = _ymd(o);
        if (skip.contains(d) || overrides.contains('${e.id}|$d')) continue;
        final endD = _ymd(o.add(Duration(days: span)));
        if (overlapsDays(d, endD)) {
          out.add(
            Instance(
              eventId: e.id,
              seriesId: e.id,
              occurrence: d,
              title: e.title,
              calendarId: e.calendarId,
              allDay: true,
              startDate: d,
              endDate: endD,
            ),
          );
        }
      }
      continue;
    }
    final s = e.start;
    final en = e.end;
    if (s == null || en == null) continue;
    if (rule == null) {
      if (overlaps(s, en)) {
        out.add(
          Instance(
            eventId: e.id,
            seriesId: e.recurringEventId,
            occurrence: e.originalStart,
            title: e.title,
            calendarId: e.calendarId,
            allDay: false,
            start: s,
            end: en,
          ),
        );
      }
      continue;
    }
    final len = en.difference(s);
    final skip = {for (final x in e.exdates) x.length > 10 ? DateTime.parse(x).millisecondsSinceEpoch : x};
    for (final o in rule.getInstances(
      start: _floating(s),
      after: _max(_floating(from.subtract(len)), _floating(s)),
      includeAfter: true,
      before: _floating(to),
    )) {
      final at = _local(o);
      final key = _iso(at);
      if (skip.contains(at.millisecondsSinceEpoch) || overrides.contains('${e.id}|$key')) continue;
      if (overlaps(at, at.add(len))) {
        out.add(
          Instance(
            eventId: e.id,
            seriesId: e.id,
            occurrence: key,
            title: e.title,
            calendarId: e.calendarId,
            allDay: false,
            start: at,
            end: at.add(len),
          ),
        );
      }
    }
  }
  int key(Instance i) => i.allDay ? _date(i.startDate!).millisecondsSinceEpoch - 1 : i.start!.millisecondsSinceEpoch;
  // the same event on several calendars (a holiday each Google account adds, one meeting seen from two accounts)
  // shows once (spec 0014) — same rule as the web
  final seen = <String>{};
  out.retainWhere(
    (i) => seen.add(
      '${i.title.trim().toLowerCase()}|${i.allDay ? '${i.startDate}|${i.endDate}' : '${i.start?.toUtc()}|${i.end?.toUtc()}'}',
    ),
  );
  out.sort((a, b) {
    final c = key(a).compareTo(key(b));
    return c != 0 ? c : a.title.compareTo(b.title);
  });
  return out;
}

/// Minutes from midnight a timed instance covers on [day] (null when it doesn't touch it).
({int start, int end})? spanOn(Instance i, String day) {
  if (i.allDay) return null;
  final d0 = DateTime.parse(day);
  final d1 = DateTime(d0.year, d0.month, d0.day + 1);
  if (!i.end!.isAfter(d0) || !i.start!.isBefore(d1)) return null;
  final s = i.start!.isAfter(d0) ? i.start!.hour * 60 + i.start!.minute : 0;
  final e = i.end!.isBefore(d1) ? i.end!.hour * 60 + i.end!.minute : 24 * 60;
  return (start: s, end: e < s + 15 ? s + 15 : e);
}

bool allDayOn(Instance i, String day) => i.allDay && i.startDate!.compareTo(day) <= 0 && i.endDate!.compareTo(day) > 0;

/// Working ranges minus busy spans (and before [from], e.g. now), at least [min] minutes.
List<({int start, int end})> freeRanges(
  List<({int start, int end})> working,
  List<({int start, int end})> busy, {
  int from = 0,
  int min = 15,
}) {
  var free = [
    for (final r in working)
      if (r.end > (r.start > from ? r.start : from)) (start: r.start > from ? r.start : from, end: r.end),
  ];
  for (final b in busy) {
    free = [
      for (final f in free)
        if (b.end <= f.start || b.start >= f.end)
          f
        else ...[
          if (b.start > f.start) (start: f.start, end: b.start),
          if (f.end > b.end) (start: b.end, end: f.end),
        ],
    ];
  }
  return [
    for (final f in free)
      if (f.end - f.start >= min) f,
  ];
}

int _min(String hhmm) => int.parse(hhmm.substring(0, 2)) * 60 + int.parse(hhmm.substring(3, 5));

/// The person's working ranges on [day] (D16), from their saved settings; empty when not set or a day off.
List<({int start, int end})> workingOn(Map<String, dynamic>? s, String day) => s == null
    ? const []
    : [for (final r in workingRangesOn(s, day)) (start: _min(r['start'] as String), end: _min(r['end'] as String))];

final eventsProvider = StreamProvider<List<EventItem>>((ref) {
  return ref.watch(syncProvider).watch(todayEvent).map((rows) => [for (final r in rows) EventItem(r.id, r.data)]);
});

final calendarsProvider = StreamProvider<List<CalendarItem>>((ref) {
  return ref.watch(syncProvider).watch(todayCalendar).map((rows) => [for (final r in rows) CalendarItem(r.id, r.data)]);
});

// ------------------------------------------------------------------ plan my day (server preview, AC6)

class Placement {
  Placement(this.raw);
  final Map<String, dynamic> raw;
  String get taskId => raw['taskId'] as String;
  String get title => raw['title'] as String;
  DateTime get start => DateTime.parse(raw['start'] as String).toLocal();
  DateTime get end => DateTime.parse(raw['end'] as String).toLocal();
  String get reason => raw['reason'] as String;
}

class DayPlan {
  DayPlan(this.raw);
  final Map<String, dynamic> raw;
  List<Placement> get placed => [for (final p in (raw['placed'] as List).cast<Map<String, dynamic>>()) Placement(p)];
  List<({String title, String reason})> get unplaced => [
    for (final u in (raw['unplaced'] as List).cast<Map<String, dynamic>>())
      (title: u['title'] as String, reason: u['reason'] as String),
  ];
}

final calendarActionsProvider = Provider<CalendarActions>((ref) => CalendarActions(ref.watch(syncProvider), ref));

class CalendarActions {
  CalendarActions(this.sync, this.ref);
  final SyncClient sync;
  final Ref ref;

  Future<String> addEvent(Map<String, dynamic> fields) => _then(sync.upsert(todayEvent, fields));
  Future<void> updateEvent(String id, Map<String, dynamic> fields) => _then(sync.upsert(todayEvent, fields, id: id));
  Future<void> removeEvent(String id) => _then(sync.remove(todayEvent, id));

  /// Only this occurrence: a cancelled one goes into the series' exceptions (and a changed copy is removed).
  Future<void> removeOccurrence(EventItem series, String occurrence, {EventItem? override}) async {
    await updateEvent(series.id, {
      'exdates': [...series.exdates, occurrence],
    });
    if (override != null) await removeEvent(override.id);
  }

  /// The whole series, with its changed occurrences.
  Future<void> removeSeries(String seriesId, List<EventItem> all) async {
    for (final e in all.where((e) => e.recurringEventId == seriesId)) {
      await removeEvent(e.id);
    }
    await removeEvent(seriesId);
  }

  /// The server's preview; throws [ApiError] `no_working_hours` when the person hasn't set any (D16).
  Future<DayPlan> preview(String day) async =>
      DayPlan(await ref.read(apiProvider).post<Map<String, dynamic>>('/today/plan', {'date': day}));

  Future<void> accept(DayPlan p) async {
    for (final x in p.placed) {
      await sync.upsert(todayTask, {
        'scheduledStart': x.start.toUtc().toIso8601String(),
        'durationMin': x.end.difference(x.start).inMinutes,
      }, id: x.taskId);
    }
    unawaited(sync.sync().catchError((Object _) {}));
  }

  Future<T> _then<T>(Future<T> f) async {
    final r = await f;
    unawaited(sync.sync().catchError((Object _) {}));
    return r;
  }
}

// ------------------------------------------------------------------ connected accounts (D15)

class CalendarAccount {
  CalendarAccount(this.raw);
  final Map<String, dynamic> raw;
  String get id => raw['id'] as String;
  String get email => raw['email'] as String;
  bool get needsReconnect => raw['status'] == 'needs_reconnect';
  DateTime? get lastSyncedAt =>
      raw['lastSyncedAt'] == null ? null : DateTime.parse(raw['lastSyncedAt'] as String).toLocal();
}

final calendarAccountsProvider = FutureProvider.autoDispose<List<CalendarAccount>>(
  (ref) async {
    final rows = await ref.watch(apiProvider).get<List<dynamic>>('/calendar/accounts');
    return [for (final r in rows.cast<Map<String, dynamic>>()) CalendarAccount(r)];
  },
  retry: (_, _) => null, // offline or refused: say so; the person can pull to refresh
);

/// Opens a page outside the app (Google's consent screen); replaced in tests.
final urlOpenerProvider = Provider<Future<bool> Function(Uri)>(
  (_) =>
      (u) => launchUrl(u, mode: LaunchMode.externalApplication),
);

extension CalendarAccountActions on CalendarActions {
  /// Starts connecting a Google account in the browser; Google sends the person back to ORVYN's settings page.
  Future<void> connectGoogle({String? hint}) async {
    final r = await ref
        .read(apiProvider)
        .post<Map<String, dynamic>>(
          '/calendar/google/start${hint == null ? '' : '?hint=${Uri.encodeQueryComponent(hint)}'}',
        );
    await ref.read(urlOpenerProvider)(Uri.parse(r['url'] as String));
  }

  Future<void> disconnect(String accountId) async {
    await ref.read(apiProvider).delete<Map<String, dynamic>>('/calendar/accounts/$accountId');
    ref.invalidate(calendarAccountsProvider);
    unawaited(sync.sync().catchError((Object _) {}));
  }

  Future<void> syncNow(String accountId) async {
    await ref.read(apiProvider).post<Map<String, dynamic>>('/calendar/accounts/$accountId/sync');
    ref.invalidate(calendarAccountsProvider);
    unawaited(sync.sync().catchError((Object _) {}));
  }

  Future<void> setCalendar(String id, Map<String, dynamic> fields) => _then(sync.upsert(todayCalendar, fields, id: id));

  /// Hide every public-holiday calendar at once; returns how many were hidden.
  Future<int> hideHolidays(List<CalendarItem> calendars) async {
    final hol = calendars.where((c) => c.holiday && c.visible).toList();
    for (final c in hol) {
      await _then(sync.upsert(todayCalendar, {'visible': false}, id: c.id));
    }
    return hol.length;
  }
}
