import 'dart:async';

import 'package:dio/dio.dart';

import 'models.dart';
import 'session_store.dart';

class ApiError implements Exception {
  const ApiError(this.status, this.code, this.message);
  final int status;
  final String code;
  final String message;
  @override
  String toString() => 'ApiError($status, $code): $message';
}

/// Device facts sent at sign-in so the person can recognise this phone in their device list.
class DeviceInfo {
  const DeviceInfo({required this.name, required this.platform, required this.appVersion});
  final String name;
  final String platform;
  final String appVersion;
  Map<String, dynamic> toJson() => {'name': name, 'platform': platform, 'appVersion': appVersion};
}

/// HTTP client for the ORVYN API.
///
/// The access token lives only in memory. The refresh token is in secure storage and is rotated on every
/// refresh; a 401 triggers exactly one refresh however many requests hit it together (single flight), and
/// the failed requests are replayed once.
class Api {
  Api({required String baseUrl, required this.store, HttpClientAdapter? adapter})
    : dio = Dio(
        BaseOptions(
          baseUrl: baseUrl,
          connectTimeout: const Duration(seconds: 10),
          receiveTimeout: const Duration(seconds: 20),
          // errors are mapped below; let every status through
          validateStatus: (_) => true,
        ),
      ) {
    if (adapter != null) dio.httpClientAdapter = adapter;
  }

  final Dio dio;
  final SessionStore store;
  String? _access;
  Future<SessionResponse?>? _refreshing;
  final _sessions = StreamController<SessionResponse?>.broadcast();

  String? get accessToken => _access;
  String get baseUrl => dio.options.baseUrl;

  /// Emits every new session (sign-in, refresh) and `null` when the session ends.
  Stream<SessionResponse?> get sessions => _sessions.stream;

  Future<void> setSession(SessionResponse? s) async {
    _access = s?.accessToken;
    if (s == null) {
      await store.writeRefreshToken(null);
    } else if (s.refreshToken != null) {
      await store.writeRefreshToken(s.refreshToken);
    }
    _sessions.add(s);
  }

  /// One refresh at a time. Returns null (and clears the session) when the refresh token is gone or refused.
  Future<SessionResponse?> refresh() => _refreshing ??= _doRefresh().whenComplete(() => _refreshing = null);

  Future<SessionResponse?> _doRefresh() async {
    final token = await store.readRefreshToken();
    if (token == null) {
      await setSession(null);
      return null;
    }
    final Response<dynamic> r;
    try {
      r = await dio.post<dynamic>('/auth/refresh', data: {'refreshToken': token});
    } on DioException {
      return null; // offline: keep the refresh token, try again later
    }
    if (r.statusCode == 200) {
      final s = SessionResponse.fromJson(r.data as Map<String, dynamic>);
      await setSession(s);
      return s;
    }
    if (r.statusCode == 401 || r.statusCode == 403) await setSession(null);
    return null;
  }

  Future<T> call<T>(String method, String path, {Object? body, Map<String, dynamic>? query, bool auth = true}) async {
    Future<Response<dynamic>> send() => dio.request<dynamic>(
      path,
      data: body,
      queryParameters: query,
      options: Options(
        method: method,
        // only with a body: the API (Fastify) rejects an empty body declared as JSON
        contentType: body == null ? null : 'application/json',
        headers: {if (auth && _access != null) 'authorization': 'Bearer $_access'},
      ),
    );

    Response<dynamic> r;
    try {
      r = await send();
      if (auth && r.statusCode == 401 && await refresh() != null) r = await send();
    } on DioException catch (e) {
      throw ApiError(0, 'offline', e.message ?? 'Network unavailable');
    }
    final status = r.statusCode ?? 0;
    if (status >= 400) {
      final err = (r.data is Map ? (r.data as Map)['error'] : null) as Map?;
      throw ApiError(
        status,
        (err?['code'] as String?) ?? 'http_$status',
        (err?['message'] as String?) ?? 'Request failed',
      );
    }
    return r.data as T;
  }

  /// Uploads a file's bytes (files module, ADR-0011); returns `{id, name, …}`.
  Future<Map<String, dynamic>> upload(List<int> bytes, {required String name, required String mime}) async {
    Future<Response<dynamic>> send() => dio.post<dynamic>(
      '/files',
      data: Stream.fromIterable([bytes]),
      options: Options(
        contentType: mime,
        headers: {
          'content-length': bytes.length,
          'x-file-name': Uri.encodeComponent(name),
          if (_access != null) 'authorization': 'Bearer $_access',
        },
      ),
    );
    Response<dynamic> r;
    try {
      r = await send();
      if (r.statusCode == 401 && await refresh() != null) r = await send();
    } on DioException catch (e) {
      throw ApiError(0, 'offline', e.message ?? 'Network unavailable');
    }
    if ((r.statusCode ?? 0) >= 400) {
      final err = (r.data is Map ? (r.data as Map)['error'] : null) as Map?;
      throw ApiError(
        r.statusCode ?? 0,
        (err?['code'] as String?) ?? 'upload_failed',
        (err?['message'] as String?) ?? 'Upload failed',
      );
    }
    return Map<String, dynamic>.from(r.data as Map);
  }

  Future<T> get<T>(String path, {Map<String, dynamic>? query}) => call<T>('GET', path, query: query);
  Future<T> post<T>(String path, [Object? body]) => call<T>('POST', path, body: body ?? const <String, dynamic>{});
  Future<T> put<T>(String path, Object body) => call<T>('PUT', path, body: body);
  Future<T> patch<T>(String path, Object body) => call<T>('PATCH', path, body: body);
  Future<T> delete<T>(String path) => call<T>('DELETE', path);

  Future<void> dispose() => _sessions.close();
}
