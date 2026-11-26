import 'package:flutter_test/flutter_test.dart';
import 'package:orvyn/activity/phone_day.dart';
import 'package:orvyn/core/api.dart';
import 'package:orvyn/core/session_store.dart';

const m = 60000;
final t0 = DateTime.utc(2026, 11, 26, 4).millisecondsSinceEpoch;
UsageEvent ev(int min, int type, [String? pkg]) => UsageEvent(t0 + min * m, type, pkg);
const labels = {'com.whatsapp': 'WhatsApp', 'com.google.android.youtube': 'YouTube', 'x.y': null};

class FakeUsage implements UsageSource {
  FakeUsage(this.events);
  final List<UsageEvent> events;
  bool ok = true;
  final asked = <(int, int)>[];
  bool? scheduled;
  @override
  Future<bool> allowed() async => ok;
  @override
  Future<void> openSettings() async {}
  @override
  Future<void> schedule(bool on) async => scheduled = on;
  @override
  Future<({List<UsageEvent> events, Map<String, String?> labels, String? home})?> read(int from, int to) async {
    asked.add((from, to));
    return (events: events.where((e) => e.t >= from && e.t <= to).toList(), labels: labels, home: 'com.launcher.home');
  }
}

void main() {
  test('apps in front, with the screen on and unlocked; the home screen and the lock screen are not apps', () {
    final s = phoneSpans(
      [
        ev(0, 1, 'com.whatsapp'),
        ev(5, 1, 'com.google.android.youtube'), // switched without a pause
        ev(20, 2, 'com.google.android.youtube'),
        ev(20, 1, 'com.launcher.home'),
        ev(21, 1, 'com.android.systemui'),
        ev(22, 16), // screen off
        ev(30, 1, 'com.whatsapp'), // a notification on a dark screen
        ev(31, 15),
        ev(31, 17), // still locked
        ev(32, 1, 'com.whatsapp'),
        ev(33, 18),
        ev(34, 1, 'x.y'),
      ],
      labels: labels,
      now: t0 + 40 * m,
      home: 'com.launcher.home',
    );
    expect(
      [
        for (final x in s)
          (
            x['app'],
            x['title'],
            (DateTime.parse(x['end'] as String).millisecondsSinceEpoch -
                    DateTime.parse(x['start'] as String).millisecondsSinceEpoch) ~/
                m,
          ),
      ],
      [
        ('com.whatsapp', 'WhatsApp', 5),
        ('com.google.android.youtube', 'YouTube', 15),
        ('x.y', '', 6), // still in front: up to now
      ],
    );
    expect(s.every((x) => x['source'] == 'phone' && x['kind'] == 'active'), isTrue);
    // the same moment always gets the same id: sending twice saves once
    final again = phoneSpans([ev(0, 1, 'com.whatsapp'), ev(5, 2, 'com.whatsapp')], labels: labels, now: t0 + 9 * m);
    expect(again.single['id'], s.first['id']);
  });

  test('a phone left on a table counts four hours at most', () {
    final s = phoneSpans([ev(0, 1, 'com.whatsapp'), ev(600, 2, 'com.whatsapp')], labels: labels, now: t0 + 700 * m);
    expect(
      DateTime.parse(s.single['end'] as String).difference(DateTime.parse(s.single['start'] as String)).inHours,
      4,
    );
  });

  test('sends only when switched on and allowed, from where it left off; off forgets', () async {
    final store = MemorySessionStore();
    final usage = FakeUsage([ev(0, 1, 'com.whatsapp'), ev(10, 2, 'com.whatsapp')]);
    final sent = <Object?>[];
    final api = FakeApi(sent);
    expect(await sendPhoneDay(api, store, usage, now: DateTime.fromMillisecondsSinceEpoch(t0 + 60 * m)), isNull);
    await setPhoneDay(store, usage, true);
    expect(usage.scheduled, isTrue);
    usage.ok = false;
    expect(await sendPhoneDay(api, store, usage, now: DateTime.fromMillisecondsSinceEpoch(t0 + 60 * m)), isNull);
    usage.ok = true;
    expect(await sendPhoneDay(api, store, usage, now: DateTime.fromMillisecondsSinceEpoch(t0 + 60 * m)), 1);
    expect(sent.length, 1);
    await sendPhoneDay(api, store, usage, now: DateTime.fromMillisecondsSinceEpoch(t0 + 120 * m));
    expect(usage.asked.last.$1, t0 + 60 * m - 6 * 60 * m); // a little back from the last look
    await setPhoneDay(store, usage, false);
    expect((usage.scheduled, await store.read('orvyn.activity.phoneSince')), (false, null));
  });
}

class FakeApi implements Api {
  FakeApi(this.sent);
  final List<Object?> sent;
  @override
  Future<T> post<T>(String path, [Object? body]) async {
    sent.add(body);
    return {} as T;
  }

  @override
  dynamic noSuchMethod(Invocation i) => throw UnimplementedError('${i.memberName}');
}
