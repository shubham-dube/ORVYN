import 'package:flutter_test/flutter_test.dart';
import 'package:orvyn/core/api.dart';
import 'package:orvyn/core/session_store.dart';

import 'support/fake_server.dart';

Map<String, dynamic> session(String access, String refresh) => {
  'accessToken': access,
  'expiresIn': 900,
  'refreshToken': refresh,
  'deviceId': '00000000-0000-4000-8000-000000000001',
  'user': {
    'id': '00000000-0000-4000-8000-000000000002',
    'email': 'a@example.test',
    'name': 'A',
    'avatarUrl': null,
    'role': 'owner',
    'entitlements': <String>[],
    'hasPasskey': false,
  },
};

void main() {
  late FakeServer server;
  late MemorySessionStore store;
  late Api api;

  setUp(() {
    server = FakeServer();
    store = MemorySessionStore();
    api = Api(baseUrl: 'http://api.test', store: store, adapter: server);
  });

  test('many requests hitting 401 together cause one refresh, then all replay with the new token', () async {
    await store.writeRefreshToken('r1');
    final valid = 'new';
    server.on(
      'GET /me',
      (r) => r.bearer == valid
          ? {'ok': true}
          : const Reply(401, {
              'error': {'code': 'unauthorized', 'message': 'x'},
            }),
    );
    server.on('POST /auth/refresh', (r) {
      expect(r.body['refreshToken'], 'r1');
      return session(valid, 'r2');
    });
    final results = await Future.wait([for (var i = 0; i < 5; i++) api.get<Map<String, dynamic>>('/me')]);
    expect(results.every((r) => r['ok'] == true), isTrue);
    expect(server.count('POST /auth/refresh'), 1);
    expect(await store.readRefreshToken(), 'r2', reason: 'refresh tokens rotate');
  });

  test('a refused refresh ends the session and forgets the token', () async {
    await store.writeRefreshToken('stolen-and-reused');
    server.on('GET /me', (_) => const Reply(401));
    server.on(
      'POST /auth/refresh',
      (_) => const Reply(401, {
        'error': {'code': 'refresh_reused', 'message': 'x'},
      }),
    );
    final ended = expectLater(api.sessions, emits(isNull));
    await expectLater(api.get<dynamic>('/me'), throwsA(isA<ApiError>().having((e) => e.status, 'status', 401)));
    await ended;
    expect(await store.readRefreshToken(), isNull);
  });

  test('server errors keep their code', () async {
    server.on(
      'POST /auth/email/start',
      (_) => const Reply(429, {
        'error': {'code': 'rate_limited', 'message': 'Slow down'},
      }),
    );
    await expectLater(
      api.call<dynamic>('POST', '/auth/email/start', body: {'email': 'x@example.test'}, auth: false),
      throwsA(isA<ApiError>().having((e) => e.code, 'code', 'rate_limited')),
    );
  });

  test('DELETE without a body sends no JSON content type', () async {
    server.on('DELETE /me/devices/x', (r) => {'ok': r.headers['content-type'] == null});
    final r = await api.delete<Map<String, dynamic>>('/me/devices/x');
    expect(r['ok'], isTrue);
  });
}
