import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:web_socket_channel/web_socket_channel.dart';

import 'api.dart';

typedef SocketConnector = WebSocketChannel Function(Uri uri);

/// The live socket: one per app. Authenticates with its first message, reconnects with jittered backoff,
/// refreshes the session once when the server closes with 4401 (expired token).
class Realtime {
  Realtime(this.api, {SocketConnector? connect, Random? random})
    : _connect = connect ?? WebSocketChannel.connect,
      _random = random ?? Random();

  final Api api;
  final SocketConnector _connect;
  final Random _random;
  final _messages = StreamController<Map<String, dynamic>>.broadcast();
  final _connected = StreamController<bool>.broadcast();
  WebSocketChannel? _ch;
  StreamSubscription<dynamic>? _sub;
  Timer? _timer;
  int _attempt = 0;
  bool _stopped = true;
  bool _live = false;

  Stream<Map<String, dynamic>> get messages => _messages.stream;
  Stream<bool> get connected => _connected.stream;

  void start() {
    if (!_stopped) return;
    _stopped = false;
    _open();
  }

  void stop() {
    _stopped = true;
    _timer?.cancel();
    _sub?.cancel();
    _ch?.sink.close();
    _ch = null;
    _live = false;
    _connected.add(false);
  }

  /// False when there is no connection now. Only `pc` frames go this way; everything else is HTTP.
  bool send(Map<String, dynamic> frame) {
    if (!_live || _ch == null) return false;
    _ch!.sink.add(jsonEncode(frame));
    return true;
  }

  /// Reconnect now (app resumed, network came back).
  void kick() {
    if (_stopped) return;
    _timer?.cancel();
    _attempt = 0;
    if (_ch == null) _open();
  }

  void _open() {
    final token = api.accessToken;
    if (token == null || _stopped) return;
    final uri = Uri.parse('${api.baseUrl.replaceFirst(RegExp('^http'), 'ws')}/ws');
    final ch = _connect(uri);
    _ch = ch;
    // a refused upgrade (server restarting, captive wifi) also ends the stream, which retries; seen here
    // too, it is not an unhandled error
    ch.ready.then<void>((_) {}, onError: (Object _) {});
    ch.sink.add(jsonEncode({'type': 'auth', 'token': token}));
    _sub = ch.stream.listen(
      (data) {
        final msg = jsonDecode(data as String) as Map<String, dynamic>;
        if (msg['type'] == 'hello') {
          _attempt = 0;
          _live = true;
          _connected.add(true);
        }
        _messages.add(msg);
      },
      onDone: () => _closed(ch, ch.closeCode),
      onError: (_) => _closed(ch, null),
      cancelOnError: true,
    );
  }

  Future<void> _closed(WebSocketChannel ch, int? code) async {
    if (_stopped || !identical(_ch, ch)) return;
    _ch = null;
    _live = false;
    _connected.add(false);
    if (code == 4401) {
      final s = await api.refresh();
      if (s == null) return stop();
    }
    if (code == 4403) return stop(); // device revoked
    final base = min(30000, 1000 * pow(2, _attempt++).toInt());
    final delay = (base * (0.7 + _random.nextDouble() * 0.6)).round();
    _timer = Timer(Duration(milliseconds: delay), _open);
  }

  Future<void> dispose() async {
    stop();
    await _messages.close();
    await _connected.close();
  }
}
