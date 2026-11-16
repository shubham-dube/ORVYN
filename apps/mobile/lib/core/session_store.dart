import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Where the refresh token lives between launches. Android: Keystore-backed encrypted storage.
abstract interface class SessionStore {
  Future<String?> readRefreshToken();
  Future<void> writeRefreshToken(String? token);
  Future<String?> read(String key);
  Future<void> write(String key, String? value);
}

class SecureSessionStore implements SessionStore {
  SecureSessionStore([FlutterSecureStorage? storage]) : _s = storage ?? const FlutterSecureStorage();
  final FlutterSecureStorage _s;
  static const _refresh = 'orvyn.refresh';

  @override
  Future<String?> readRefreshToken() => _s.read(key: _refresh);
  @override
  Future<void> writeRefreshToken(String? token) =>
      token == null ? _s.delete(key: _refresh) : _s.write(key: _refresh, value: token);
  @override
  Future<String?> read(String key) => _s.read(key: key);
  @override
  Future<void> write(String key, String? value) =>
      value == null ? _s.delete(key: key) : _s.write(key: key, value: value);
}

/// Tests and previews.
class MemorySessionStore implements SessionStore {
  final Map<String, String> values = {};
  @override
  Future<String?> readRefreshToken() async => values['refresh'];
  @override
  Future<void> writeRefreshToken(String? token) async =>
      token == null ? values.remove('refresh') : values['refresh'] = token;
  @override
  Future<String?> read(String key) async => values[key];
  @override
  Future<void> write(String key, String? value) async => value == null ? values.remove(key) : values[key] = value;
}
