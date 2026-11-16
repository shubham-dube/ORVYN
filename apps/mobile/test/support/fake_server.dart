import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';

typedef Handler = Object? Function(FakeRequest req);

class FakeRequest {
  FakeRequest(this.method, this.path, this.query, this.body, this.headers);
  final String method;
  final String path;
  final Map<String, dynamic> query;
  final dynamic body;
  final Map<String, dynamic> headers;
  String? get bearer => (headers['authorization'] as String?)?.replaceFirst('Bearer ', '');
}

/// A reply with a status other than 200.
class Reply {
  const Reply(this.status, [this.body]);
  final int status;
  final Object? body;
}

/// In-process HTTP for tests: routes `METHOD /path` to handlers, records every call.
class FakeServer implements HttpClientAdapter {
  final Map<String, Handler> routes = {};
  final List<FakeRequest> calls = [];

  void on(String route, Handler h) => routes[route] = h;

  int count(String route) => calls.where((c) => '${c.method} ${c.path}' == route).length;

  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    dynamic body = o.data;
    if (body is String && body.isNotEmpty) body = jsonDecode(body);
    final req = FakeRequest(o.method, o.uri.path, o.uri.queryParameters, body, o.headers);
    calls.add(req);
    final h = routes['${o.method} ${o.uri.path}'];
    if (h == null) {
      return _json(404, {
        'error': {'code': 'not_found', 'message': 'no route ${o.method} ${o.uri.path}'},
      });
    }
    await Future<void>.delayed(Duration.zero);
    final out = h(req);
    if (out is Reply) return _json(out.status, out.body);
    return _json(200, out);
  }

  ResponseBody _json(int status, Object? body) => ResponseBody.fromString(
    body == null ? '' : jsonEncode(body),
    status,
    headers: {
      Headers.contentTypeHeader: ['application/json'],
    },
  );

  @override
  void close({bool force = false}) {}
}

/// Field-level last-writer-wins, as `apps/api/src/modules/sync` does it, kept small for tests.
class FakeSyncBackend {
  final rows = <String, Map<String, dynamic>>{}; // key entity/id
  final clocks = <String, Map<String, String>>{}; // key → field → hlc
  final deleted = <String>{};
  final log = <Map<String, dynamic>>[]; // seq-ordered changes
  final seen = <String>{};
  final Set<String> refusedEntities = {};
  String serverHlc = '000000000000000:00000:server';

  void attach(FakeServer s) {
    s.on('POST /sync/push', (r) {
      final applied = <Map<String, dynamic>>[];
      final rejected = <Map<String, dynamic>>[];
      for (final m in (r.body['mutations'] as List).cast<Map<String, dynamic>>()) {
        final id = m['mutationId'] as String;
        if (refusedEntities.contains(m['entity'])) {
          rejected.add({'mutationId': id, 'reason': 'forbidden'});
          continue;
        }
        if (seen.add(id)) apply(m);
        applied.add({'mutationId': id, 'seq': '${log.length}'});
        if ((m['hlc'] as String).compareTo(serverHlc) > 0) serverHlc = m['hlc'] as String;
      }
      return {'applied': applied, 'rejected': rejected, 'hlc': serverHlc};
    });
    s.on('GET /sync/pull', (r) {
      final from = int.tryParse(r.query['cursor'] as String? ?? '0') ?? 0;
      final page = log.skip(from).take(2).toList(); // small pages exercise hasMore
      return {'changes': page, 'cursor': '${from + page.length}', 'hasMore': from + page.length < log.length};
    });
  }

  void apply(Map<String, dynamic> m) {
    final key = '${m['entity']}/${m['entityId']}';
    if (m['op'] == 'delete') {
      deleted.add(key);
      log.add({
        'seq': '${log.length + 1}',
        'entity': m['entity'],
        'entityId': m['entityId'],
        'op': 'delete',
        'data': null,
      });
      return;
    }
    final row = rows.putIfAbsent(key, () => {'id': m['entityId']});
    final c = clocks.putIfAbsent(key, () => {});
    (m['fields'] as Map<String, dynamic>).forEach((f, v) {
      if ((c[f] ?? '').compareTo(m['hlc'] as String) < 0) {
        row[f] = v;
        c[f] = m['hlc'] as String;
      }
    });
    log.add({
      'seq': '${log.length + 1}',
      'entity': m['entity'],
      'entityId': m['entityId'],
      'op': 'upsert',
      'data': {...row},
    });
  }
}
