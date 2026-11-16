import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/api.dart';
import '../core/config.dart';
import '../core/models.dart';
import '../core/push.dart';
import '../core/realtime.dart';
import '../core/session_store.dart';
import '../design/theme.dart';
import '../sync/db.dart';
import '../sync/sync_client.dart';

// ------------------------------------------------------------------ wiring (overridden in tests)

final storeProvider = Provider<SessionStore>((_) => SecureSessionStore());
final apiProvider = Provider<Api>((ref) {
  final api = Api(baseUrl: Config.apiUrl, store: ref.watch(storeProvider));
  ref.onDispose(api.dispose);
  return api;
});
final socketConnectorProvider = Provider<SocketConnector?>((_) => null);
final realtimeProvider = Provider<Realtime>((ref) {
  final rt = Realtime(ref.watch(apiProvider), connect: ref.watch(socketConnectorProvider));
  ref.onDispose(rt.dispose);
  return rt;
});
final dbProvider = Provider<LocalDb>((_) => throw UnimplementedError('opened in main()'));
final pusherProvider = Provider<Pusher>((_) => const NoPush());
final deviceInfoProvider = Provider<DeviceInfo>(
  (_) => const DeviceInfo(name: 'Android phone', platform: 'android', appVersion: Config.appVersion),
);
final clockProvider = Provider<DateTime Function()>((_) => DateTime.now);

// ------------------------------------------------------------------ session

sealed class SessionState {
  const SessionState();
}

class SessionLoading extends SessionState {
  const SessionLoading();
}

class SignedOut extends SessionState {
  const SignedOut({this.reason});

  /// e.g. `revoked` when another device signed this one out.
  final String? reason;
}

class SignedIn extends SessionState {
  const SignedIn(this.me, this.deviceId);
  final Me me;
  final String deviceId;
}

final sessionProvider = NotifierProvider<SessionController, SessionState>(SessionController.new);

class SessionController extends Notifier<SessionState> {
  StreamSubscription<Map<String, dynamic>>? _msgs;
  StreamSubscription<SessionResponse?>? _sessions;
  StreamSubscription<String>? _tokens;
  String? _pushTargetId;
  bool _ending = false;

  Api get _api => ref.read(apiProvider);

  @override
  SessionState build() {
    ref.onDispose(() {
      _msgs?.cancel();
      _sessions?.cancel();
      _tokens?.cancel();
    });
    _sessions = _api.sessions.listen((s) {
      if (s == null && state is SignedIn && !_ending) unawaited(_ended('expired'));
    });
    unawaited(_restore());
    return const SessionLoading();
  }

  Future<void> _restore() async {
    final s = await _api.refresh();
    if (s == null) {
      // offline with a stored token: let the person in to their local data; we retry on reconnect
      final hasToken = await ref.read(storeProvider).readRefreshToken() != null;
      final cached = await ref.read(storeProvider).read('orvyn.me');
      if (hasToken && cached != null) {
        state = SignedIn(Me.fromJson(_decode(cached)), await ref.read(storeProvider).read('orvyn.device') ?? '');
        return;
      }
      state = const SignedOut();
      return;
    }
    await _signedIn(s);
  }

  Future<void> startEmail(String email, {String? invite}) =>
      _api.call<dynamic>('POST', '/auth/email/start', body: {'email': email, 'invite': ?invite}, auth: false);

  Future<void> verifyEmail(String email, String code, {String? invite}) async {
    final r = await _api.call<Map<String, dynamic>>(
      'POST',
      '/auth/email/verify',
      body: {'email': email, 'code': code, 'device': ref.read(deviceInfoProvider).toJson(), 'invite': ?invite},
      auth: false,
    );
    final s = SessionResponse.fromJson(r);
    await _api.setSession(s);
    await _signedIn(s);
  }

  Future<void> _signedIn(SessionResponse s) async {
    final store = ref.read(storeProvider);
    await store.write('orvyn.me', _encode(s.user));
    await store.write('orvyn.device', s.deviceId);
    state = SignedIn(s.user, s.deviceId);
    final rt = ref.read(realtimeProvider);
    await _msgs?.cancel();
    _msgs = rt.messages.listen(_onMessage);
    rt.start();
    unawaited(_registerPush());
    unawaited(ref.read(syncProvider).sync().catchError((_) {}));
  }

  void _onMessage(Map<String, dynamic> m) {
    final s = state;
    switch (m['type']) {
      case 'entitlements.changed' when s is SignedIn:
        state = SignedIn(
          s.me.copyWith(entitlements: [for (final e in m['entitlements'] as List) e as String]),
          s.deviceId,
        );
      case 'session.revoked':
        unawaited(_ended('revoked'));
      case 'sync.changed':
        unawaited(ref.read(syncProvider).sync().catchError((_) {}));
    }
  }

  Future<void> _registerPush() async {
    final pusher = ref.read(pusherProvider);
    if (!pusher.ready) return;
    Future<void> register(String token) async {
      final r = await _api.post<Map<String, dynamic>>('/notifications/targets', {'channel': 'fcm', 'token': token});
      _pushTargetId = r['id'] as String?;
    }

    final token = await pusher.token();
    if (token != null) await register(token).catchError((_) {});
    await _tokens?.cancel();
    _tokens = pusher.tokenRefresh.listen((t) => register(t).catchError((_) {}));
  }

  Future<void> refreshMe() async {
    final s = state;
    if (s is! SignedIn) return;
    final me = Me.fromJson(await _api.get<Map<String, dynamic>>('/me'));
    state = SignedIn(me, s.deviceId);
    await ref.read(storeProvider).write('orvyn.me', _encode(me));
  }

  Future<void> updateName(String name) async {
    await _api.patch<dynamic>('/me', {'name': name});
    await refreshMe();
  }

  Future<void> signOut() async {
    try {
      if (_pushTargetId != null) await _api.delete<dynamic>('/notifications/targets/$_pushTargetId');
      await _api.post<dynamic>('/auth/sign-out');
    } catch (_) {
      // offline: the server forgets this device when its refresh token expires; local data goes now
    }
    await _ended(null);
  }

  /// This device's session is over: forget the token, the cached profile and every local row.
  Future<void> _ended(String? reason) async {
    if (_ending) return;
    _ending = true;
    ref.read(realtimeProvider).stop();
    await _msgs?.cancel();
    await _tokens?.cancel();
    final store = ref.read(storeProvider);
    await store.write('orvyn.me', null);
    await store.write('orvyn.device', null);
    if (_api.accessToken != null) await _api.setSession(null);
    await store.writeRefreshToken(null);
    await ref.read(dbProvider).wipe();
    state = SignedOut(reason: reason);
    _ending = false;
  }
}

// ------------------------------------------------------------------ sync

final syncProvider = Provider<SyncClient>((ref) {
  final c = SyncClient(
    db: ref.watch(dbProvider),
    api: ref.watch(apiProvider),
    node: 'm${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}',
  );
  ref.onDispose(c.dispose);
  return c;
});

// ------------------------------------------------------------------ theme

final themePreferenceProvider = NotifierProvider<ThemePreferenceController, ThemePreference>(
  ThemePreferenceController.new,
);

class ThemePreferenceController extends Notifier<ThemePreference> {
  static const _key = 'orvyn.theme';
  @override
  ThemePreference build() {
    unawaited(
      ref.read(storeProvider).read(_key).then((v) {
        final p = ThemePreference.values.where((e) => e.name == v).firstOrNull;
        if (p != null) state = p;
      }),
    );
    return ThemePreference.auto;
  }

  Future<void> set(ThemePreference p) async {
    state = p;
    await ref.read(storeProvider).write(_key, p.name);
  }
}

/// The light right now; re-evaluated every minute so "auto" crosses into dusk on its own.
final phaseProvider = Provider<OrvPhase>((ref) {
  final pref = ref.watch(themePreferenceProvider);
  final now = ref.watch(clockProvider);
  final t = Timer(Duration(seconds: 60 - now().second), ref.invalidateSelf);
  ref.onDispose(t.cancel);
  return resolvePhase(pref, now());
});

// ------------------------------------------------------------------ helpers

String _encode(Me m) => jsonEncodeMe(m);
Map<String, dynamic> _decode(String s) => jsonDecodeMap(s);
