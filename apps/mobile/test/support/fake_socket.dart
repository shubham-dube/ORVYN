import 'dart:async';
import 'dart:convert';

import 'package:web_socket_channel/web_socket_channel.dart';

/// The server end of the realtime socket, for tests: sees what the app sends, pushes messages, closes.
class FakeSocketServer {
  final sockets = <FakeSocket>[];
  FakeSocket get last => sockets.last;

  WebSocketChannel connect(Uri uri) {
    final s = FakeSocket(uri);
    sockets.add(s);
    // answer the auth message with hello, like apps/api/src/modules/realtime
    s.sent.stream.first.then((m) {
      final auth = jsonDecode(m as String) as Map<String, dynamic>;
      if (auth['type'] == 'auth') s.push({'type': 'hello', 'userId': 'u', 'deviceId': 'd'});
    });
    return s;
  }

  void push(Map<String, dynamic> m) => last.push(m);
}

class FakeSocket implements WebSocketChannel {
  FakeSocket(this.uri);
  final Uri uri;
  final _incoming = StreamController<dynamic>();
  final sent = StreamController<dynamic>.broadcast(sync: true);
  int? _closeCode;

  void push(Map<String, dynamic> m) => _incoming.add(jsonEncode(m));

  /// Server-initiated close (e.g. 4401 when the session is revoked).
  Future<void> serverClose(int code) async {
    _closeCode = code;
    await _incoming.close();
  }

  @override
  Stream<dynamic> get stream => _incoming.stream;
  @override
  late final WebSocketSink sink = _Sink(this);
  @override
  int? get closeCode => _closeCode;
  @override
  String? get closeReason => null;
  @override
  String? get protocol => null;
  @override
  Future<void> get ready => Future.value();

  // the StreamChannel helpers (pipe, transform, …) are unused by the app
  @override
  dynamic noSuchMethod(Invocation i) => throw UnimplementedError('${i.memberName}');
}

class _Sink implements WebSocketSink {
  _Sink(this.s);
  final FakeSocket s;
  @override
  void add(dynamic data) => s.sent.add(data);
  @override
  void addError(Object error, [StackTrace? st]) {}
  @override
  Future<void> addStream(Stream<dynamic> stream) => stream.forEach(add);
  @override
  Future<void> close([int? code, String? reason]) async {
    if (!s._incoming.isClosed) await s._incoming.close();
  }

  @override
  Future<void> get done => Future.value();
}
