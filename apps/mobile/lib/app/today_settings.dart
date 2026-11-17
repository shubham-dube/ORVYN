import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'state.dart';

const todaySettingsEntity = 'today.settings';
const weekdays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/// Mirrors `TodaySettingsFields` in packages/contracts (D15–D17). Plain JSON maps keep the wire format exact.
typedef Ranges = List<Map<String, String>>; // [{start: "09:00", end: "13:00"}]

Map<String, dynamic> startingSettings(String timeZone) {
  Ranges work() => [
    {'start': '10:00', 'end': '19:00'},
  ];
  return {
    'patterns': [
      {
        'validFrom': '2000-01-01',
        'week': {
          'mon': work(),
          'tue': work(),
          'wed': work(),
          'thu': work(),
          'fri': work(),
          'sat': <Map<String, String>>[],
          'sun': <Map<String, String>>[],
        },
      },
    ],
    'dayOverrides': <Map<String, dynamic>>[],
    'bufferMin': 15,
    'noPlanAfter': '22:00',
    'timeZone': timeZone,
    'reminders': {
      'timed': [10],
      'dateOnly': {'mode': 'digest', 'at': '09:00'},
      'overdueInDigest': true,
    },
  };
}

int _min(String t) => int.parse(t.substring(0, 2)) * 60 + int.parse(t.substring(3, 5));

/// Same rule as `workingRangesOn` in TypeScript: a day override wins; else the latest pattern started by then.
List<Map<String, dynamic>> workingRangesOn(Map<String, dynamic> s, String date) {
  for (final o in (s['dayOverrides'] as List).cast<Map<String, dynamic>>()) {
    if (o['date'] == date) return (o['ranges'] as List).cast<Map<String, dynamic>>();
  }
  final started =
      (s['patterns'] as List)
          .cast<Map<String, dynamic>>()
          .where((p) => (p['validFrom'] as String).compareTo(date) <= 0)
          .toList()
        ..sort((a, b) => (b['validFrom'] as String).compareTo(a['validFrom'] as String));
  if (started.isEmpty) return const [];
  final weekday = DateTime.parse(date).weekday; // 1 = Monday
  return ((started.first['week'] as Map)[weekdays[weekday - 1]] as List).cast<Map<String, dynamic>>();
}

/// What the server would refuse, said plainly (the server checks again).
String? settingsProblem(Map<String, dynamic> s) {
  bool badDay(List<dynamic> ranges) {
    var last = -1;
    for (final r in ranges.cast<Map<String, dynamic>>()) {
      final a = _min(r['start'] as String), b = _min(r['end'] as String);
      if (a >= b) return true;
      if (a < last) return true;
      last = b;
    }
    return false;
  }

  final patterns = (s['patterns'] as List).cast<Map<String, dynamic>>();
  if (patterns.isEmpty) return 'Keep at least one working pattern.';
  if (patterns.map((p) => p['validFrom']).toSet().length != patterns.length) {
    return 'Two patterns start on the same day.';
  }
  for (final p in patterns) {
    for (final d in weekdays) {
      if (badDay((p['week'] as Map)[d] as List)) return 'A time range ends before it starts, or two ranges overlap.';
    }
  }
  for (final o in (s['dayOverrides'] as List).cast<Map<String, dynamic>>()) {
    if (badDay(o['ranges'] as List)) return 'A time range ends before it starts, or two ranges overlap.';
  }
  return null;
}

/// The person's settings, or null until they save their own.
final todaySettingsProvider = StreamProvider<Map<String, dynamic>?>((ref) {
  final s = ref.watch(sessionProvider);
  if (s is! SignedIn) return Stream.value(null);
  return ref
      .watch(syncProvider)
      .watch(todaySettingsEntity)
      .map((rows) => rows.where((r) => r.id == s.me.id).map((r) => r.data).firstOrNull);
});

Future<void> saveTodaySettings(WidgetRef ref, Map<String, dynamic> fields) async {
  final s = ref.read(sessionProvider);
  if (s is! SignedIn) return;
  final sync = ref.read(syncProvider);
  final clean = Map<String, dynamic>.from(fields)..remove('id');
  await sync.upsert(todaySettingsEntity, clean, id: s.me.id);
  unawaited(sync.sync().catchError((Object _) {}));
}

String leadLabel(int min) {
  if (min == 0) return 'at the time';
  if (min % 1440 == 0) return '${min ~/ 1440} day${min == 1440 ? '' : 's'} before';
  if (min % 60 == 0) return '${min ~/ 60} h before';
  return '$min min before';
}

const leadChoices = [0, 5, 10, 15, 30, 60, 120, 1440, 2880];
