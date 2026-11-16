@Tags(['live'])
library;

import 'dart:async';
import 'dart:io';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvyn/core/api.dart';
import 'package:orvyn/core/models.dart';
import 'package:orvyn/core/realtime.dart';
import 'package:orvyn/core/session_store.dart';
import 'package:orvyn/sync/db.dart';
import 'package:orvyn/sync/sync_client.dart';

/// The Dart client against the real API (dev mailbox on). Run with:
///   ORVYN_LIVE_API=http://localhost:4100 flutter test --tags live
/// CI starts the API the same way the web e2e does (apps/web/e2e/start-api.mjs).
final base = Platform.environment['ORVYN_LIVE_API'];
const owner = 'owner@example.test';
const phone = DeviceInfo(name: 'Live test phone', platform: 'android', appVersion: '0.1.0');

Future<SessionResponse> signIn(Api api, String email) async {
  await api.call<dynamic>('POST', '/auth/email/start', body: {'email': email}, auth: false);
  final mail = await api.call<Map<String, dynamic>>('GET', '/dev/mailbox', query: {'email': email}, auth: false);
  final code = RegExp(r'\d{6}').firstMatch(mail['subject'] as String)![0]!;
  final r = await api.call<Map<String, dynamic>>(
    'POST',
    '/auth/email/verify',
    body: {'email': email, 'code': code, 'device': phone.toJson()},
    auth: false,
  );
  final s = SessionResponse.fromJson(r);
  await api.setSession(s);
  return s;
}

void main() {
  if (base == null) {
    test('live API tests', () {}, skip: 'set ORVYN_LIVE_API to run');
    return;
  }

  test('native sign-in returns a refresh token for secure storage, not a cookie', () async {
    final store = MemorySessionStore();
    final api = Api(baseUrl: base!, store: store);
    final s = await signIn(api, owner);
    expect(s.refreshToken, isNotNull);
    expect(await store.readRefreshToken(), s.refreshToken);
    expect(s.user.isOwner, isTrue);
    final devices = await api.get<List<dynamic>>('/me/devices');
    final me = devices.cast<Map<String, dynamic>>().firstWhere((d) => d['current'] == true);
    expect([me['name'], me['platform']], ['Live test phone', 'android']);
  });

  test('refresh rotates; replaying the old refresh token revokes the device', () async {
    final store = MemorySessionStore();
    final api = Api(baseUrl: base!, store: store);
    final first = await signIn(api, owner);
    final rotated = await api.refresh();
    expect(rotated, isNotNull);
    expect(rotated!.refreshToken, isNot(first.refreshToken));

    // an attacker replays the stolen first token
    final thief = Api(baseUrl: base!, store: MemorySessionStore()..values['refresh'] = first.refreshToken!);
    expect(await thief.refresh(), isNull);
    // and the real device is now signed out too (token family revoked)
    expect(await api.refresh(), isNull);
    expect(await store.readRefreshToken(), isNull);
  });

  test('the socket delivers a notification sent from another device, then its dismissal', () async {
    final api = Api(baseUrl: base!, store: MemorySessionStore());
    await signIn(api, owner);
    final other = Api(baseUrl: base!, store: MemorySessionStore());
    await signIn(other, owner);

    final rt = Realtime(api);
    final got = <Map<String, dynamic>>[];
    final sub = rt.messages.listen(got.add);
    rt.start();
    await _until(() => got.any((m) => m['type'] == 'hello'));

    await other.post<dynamic>('/notifications/test');
    await _until(() => got.any((m) => m['type'] == 'notify.new'));
    final n = got.firstWhere((m) => m['type'] == 'notify.new')['notification'] as Map<String, dynamic>;
    expect(n['title'], 'Hello from ORVYN');

    // the list endpoint the app loads on start has the same notification (shape: {items, unread})
    final list = await api.get<Map<String, dynamic>>('/notifications');
    expect((list['items'] as List).any((x) => (x as Map)['id'] == n['id']), isTrue);

    await other.post<dynamic>('/notifications/${n['id']}/dismiss');
    await _until(() => got.any((m) => m['type'] == 'notify.dismissed' && m['id'] == n['id']));
    await sub.cancel();
    await rt.dispose();
  });

  test('sync: pull works and an unknown entity is rejected, not applied', () async {
    final api = Api(baseUrl: base!, store: MemorySessionStore());
    await signIn(api, owner);
    final sync = SyncClient(db: LocalDb(NativeDatabase.memory()), api: api, node: 'live1');
    final reasons = <String>[];
    sync.rejections.listen((r) => reasons.add(r.reason));
    await sync.upsert('nope.thing', {'x': 1});
    await sync.sync();
    await Future<void>.delayed(const Duration(milliseconds: 20));
    expect(await sync.pendingCount(), 0);
    expect(reasons, hasLength(1));
  });

  test('Today: a task made on the phone reaches the laptop through the real API', () async {
    final phoneApi = Api(baseUrl: base!, store: MemorySessionStore());
    await signIn(phoneApi, owner);
    final laptopApi = Api(baseUrl: base!, store: MemorySessionStore());
    await signIn(laptopApi, owner);
    final phone = SyncClient(db: LocalDb(NativeDatabase.memory()), api: phoneApi, node: 'livephone');
    final laptop = SyncClient(db: LocalDb(NativeDatabase.memory()), api: laptopApi, node: 'livelaptop');

    final id = await phone.upsert('today.task', {'title': 'Pay rent', 'dueDate': '2026-12-01', 'priority': 3});
    await phone.sync();
    expect(await phone.pendingCount(), 0, reason: 'accepted by the server');
    await laptop.sync();
    final t = (await laptop.get('today.task', id))!.data;
    expect(
      [t['title'], t['dueDate'], t['priority'], t['notes']],
      ['Pay rent', '2026-12-01', 3, ''],
      reason: 'server filled defaults',
    );

    await laptop.upsert('today.task', {'completedAt': DateTime.utc(2026, 12, 1, 9).toIso8601String()}, id: id);
    await laptop.sync();
    await phone.sync();
    expect((await phone.get('today.task', id))!.data['completedAt'], '2026-12-01T09:00:00.000Z');
  });

  test('a revoked device is cut off live (socket closes) and cannot refresh', () async {
    final api = Api(baseUrl: base!, store: MemorySessionStore());
    final s = await signIn(api, owner);
    final admin = Api(baseUrl: base!, store: MemorySessionStore());
    await signIn(admin, owner);
    final rt = Realtime(api);
    final got = <Map<String, dynamic>>[];
    rt.messages.listen(got.add);
    rt.start();
    await _until(() => got.any((m) => m['type'] == 'hello'));

    await admin.delete<dynamic>('/me/devices/${s.deviceId}');
    await _until(() => got.any((m) => m['type'] == 'session.revoked'));
    expect(await api.refresh(), isNull);
    await rt.dispose();
  });
}

Future<void> _until(bool Function() ok, {Duration timeout = const Duration(seconds: 5)}) async {
  final end = DateTime.now().add(timeout);
  while (!ok()) {
    if (DateTime.now().isAfter(end)) throw TimeoutException('condition not met');
    await Future<void>.delayed(const Duration(milliseconds: 20));
  }
}
