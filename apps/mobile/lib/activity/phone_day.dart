import 'dart:async';
import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';
import 'package:uuid/uuid.dart';

import '../app/state.dart';
import '../core/api.dart';
import '../core/config.dart';
import '../core/session_store.dart';

/// My Day on this phone (spec 0024): which app was in front, from Android's own usage record (UsageWatch.kt). Nothing
/// inside an app is read. Spans have ids made from the app and the moment, so sending them twice saves them once.

// android.app.usage.UsageEvents.Event
const _resumed = 1, _paused = 2, _stopped = 23;
const _screenOn = 15, _screenOff = 16, _locked = 17, _unlocked = 18, _shutdown = 26, _startup = 27;

/// The most one app stays in front without being touched again, as far as My Day is concerned.
const _longest = Duration(hours: 4);
const _ns = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

class UsageEvent {
  const UsageEvent(this.t, this.type, this.pkg);
  final int t;
  final int type;
  final String? pkg;
}

/// Events → spans of an app in front with the screen on and unlocked. [now] closes the one still open.
List<Map<String, dynamic>> phoneSpans(
  List<UsageEvent> events, {
  required Map<String, String?> labels,
  required int now,
  String? home,
  int? from,
}) {
  final out = <Map<String, dynamic>>[];
  String? app;
  int? since;
  var screen = true;
  var locked = false;
  void close(int t) {
    final a = app, s = since;
    app = null;
    since = null;
    if (a == null || s == null || t <= s) return;
    // something in front for hours with nothing happening is a phone left on a table
    final end = t - s > _longest.inMilliseconds ? s + _longest.inMilliseconds : t;
    if (from != null && end <= from) return;
    out.add({
      'id': const Uuid().v5(_ns, '$a|$s'),
      'source': 'phone',
      'start': DateTime.fromMillisecondsSinceEpoch(s, isUtc: true).toIso8601String(),
      'end': DateTime.fromMillisecondsSinceEpoch(end, isUtc: true).toIso8601String(),
      'kind': 'active',
      'app': a,
      'title': (labels[a] ?? '').characters.take(300).toString(),
    });
  }

  for (final e in [...events]..sort((a, b) => a.t.compareTo(b.t))) {
    switch (e.type) {
      case _resumed:
        if (e.pkg == app) continue;
        close(e.t);
        if (screen && !locked && e.pkg != null && e.pkg != home && !_system(e.pkg!)) {
          app = e.pkg;
          since = e.t;
        }
      case _paused || _stopped:
        if (e.pkg == app) close(e.t);
      case _screenOff || _shutdown:
        screen = false;
        close(e.t);
      case _locked:
        locked = true;
        close(e.t);
      case _screenOn || _startup:
        screen = true;
      case _unlocked:
        locked = false;
    }
  }
  close(now);
  return out;
}

/// The lock screen, the notification shade, the keyboard: not apps anyone opened.
bool _system(String pkg) =>
    pkg == 'android' || pkg.contains('systemui') || pkg.contains('inputmethod') || pkg.endsWith('.launcher');

/// The phone's own record, behind an interface so the rest is testable.
abstract interface class UsageSource {
  Future<bool> allowed();
  Future<void> openSettings();
  Future<({List<UsageEvent> events, Map<String, String?> labels, String? home})?> read(int from, int to);
  Future<void> schedule(bool on);
}

class AndroidUsage implements UsageSource {
  static const _ch = MethodChannel('orvyn/usage');
  @override
  Future<bool> allowed() async => (await _ch.invokeMethod<bool>('allowed')) ?? false;
  @override
  Future<void> openSettings() => _ch.invokeMethod<void>('openSettings');
  @override
  Future<void> schedule(bool on) => _ch.invokeMethod<void>('schedule', on);
  @override
  Future<({List<UsageEvent> events, Map<String, String?> labels, String? home})?> read(int from, int to) async {
    final r = await _ch.invokeMapMethod<String, dynamic>('events', {'from': from, 'to': to});
    if (r == null) return null;
    return (
      events: [
        for (final e in (r['events'] as List).cast<Map<dynamic, dynamic>>())
          UsageEvent((e['t'] as num).toInt(), (e['type'] as num).toInt(), e['pkg'] as String?),
      ],
      labels: (r['labels'] as Map).map((k, v) => MapEntry(k as String, v as String?)),
      home: r['home'] as String?,
    );
  }
}

final usageSourceProvider = Provider<UsageSource>((_) => AndroidUsage());

const _sinceKey = 'orvyn.activity.phoneSince';
const _onKey = 'orvyn.activity.phoneOn';

/// Android keeps about a week of events.
const _keep = Duration(days: 7);

/// Reads what is new and sends it. Returns how many spans went; null when not allowed or switched off.
Future<int?> sendPhoneDay(Api api, SessionStore store, UsageSource usage, {DateTime? now}) async {
  if (await store.read(_onKey) != 'on' || !await usage.allowed()) return null;
  final t = (now ?? DateTime.now()).millisecondsSinceEpoch;
  final last = int.tryParse(await store.read(_sinceKey) ?? '');
  // back a little: an app opened before the last look and still in front then is found again, by the same id
  final from = last == null ? t - _keep.inMilliseconds : last - const Duration(hours: 6).inMilliseconds;
  final r = await usage.read(from, t);
  if (r == null) return null;
  final spans = phoneSpans(r.events, labels: r.labels, now: t, home: r.home, from: from);
  for (var i = 0; i < spans.length; i += 300) {
    await api.post<dynamic>('/activity/spans', {'spans': spans.sublist(i, (i + 300).clamp(0, spans.length))});
  }
  await store.write(_sinceKey, '$t');
  return spans.length;
}

/// Switched on here, on this phone (the permission is Android's: Settings → Usage access).
Future<void> setPhoneDay(SessionStore store, UsageSource usage, bool on) async {
  await store.write(_onKey, on ? 'on' : null);
  if (!on) await store.write(_sinceKey, null);
  await usage.schedule(on);
}

Future<bool> phoneDayOn(SessionStore store) async => await store.read(_onKey) == 'on';

/// While ORVYN is open: on start and each time it comes back.
final phoneDaySyncProvider = Provider<void>((ref) {
  final s = ref.watch(sessionProvider);
  if (s is! SignedIn || !s.me.can('activity')) return;
  var busy = false;
  Future<void> run() async {
    if (busy) return;
    busy = true;
    try {
      await sendPhoneDay(ref.read(apiProvider), ref.read(storeProvider), ref.read(usageSourceProvider));
    } catch (_) {
      // offline: the next look starts from the same moment
    } finally {
      busy = false;
    }
  }

  final life = AppLifecycleListener(onResume: () => unawaited(run()), onPause: () => unawaited(run()));
  ref.onDispose(life.dispose);
  unawaited(run());
});

/// Started every hour by UsageWatch.kt, with ORVYN closed.
@pragma('vm:entry-point')
Future<void> phoneDayMain() async {
  WidgetsFlutterBinding.ensureInitialized();
  const done = MethodChannel('orvyn/usage_bg');
  try {
    final store = SecureSessionStore();
    await sendPhoneDay(
      Api(baseUrl: Config.apiUrl, store: store),
      store,
      AndroidUsage(),
    ).timeout(const Duration(seconds: 60));
  } catch (_) {
    // the next hour starts from the same moment
  } finally {
    await done.invokeMethod<void>('done').catchError((Object _) {});
  }
}

/// For tests.
String debugSpans(List<Map<String, dynamic>> s) => jsonEncode(s);
