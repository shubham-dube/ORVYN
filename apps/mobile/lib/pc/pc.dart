import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app/state.dart';
import '../core/session_store.dart';
import 'pc_crypto.dart';

/// The PCs this phone is paired with. Kept in Android's encrypted storage; gone when signing out. The PIN is never kept.
const pcPairingsKey = 'orvyn.pcs';

class PcPairings {
  PcPairings(this._store);
  final SessionStore _store;

  Future<List<PcPairing>> list() async {
    final raw = await _store.read(pcPairingsKey);
    if (raw == null) return [];
    return [for (final p in jsonDecode(raw) as List) PcPairing.fromJson(p as Map<String, dynamic>)];
  }

  Future<void> add(PcPairing p) async {
    final rest = (await list()).where((x) => x.id != p.id);
    await _store.write(pcPairingsKey, jsonEncode([...rest, p]));
  }

  Future<void> remove(String id) async {
    final rest = (await list()).where((x) => x.id != id).toList();
    await _store.write(pcPairingsKey, rest.isEmpty ? null : jsonEncode(rest));
  }
}

final pcPairingsProvider = Provider((ref) => PcPairings(ref.watch(storeProvider)));

class PcTerm {
  PcTerm(this.id, this.name, this.exit);
  factory PcTerm.fromJson(Map<String, dynamic> j) =>
      PcTerm(j['id'] as String, j['name'] as String, (j['exit'] as num?)?.toInt());
  final String id;
  final String name;
  final int? exit;
}

enum PcStatus { finding, offline, off, locked, pin, open, idle, removed, ended }

/// A terminal session with my PC (spec 0021 step 3), like apps/web/lib/pc.ts. Shells live on the PC: when the network
/// drops, this finds the PC again and goes on where it was.
class PcLink extends ChangeNotifier {
  PcLink(
    this.pair, {
    required this.send,
    required Stream<Map<String, dynamic>> messages,
    required this.deviceName,
    required this.output,
    required this.opened,
    required this.problem,
  }) {
    _sub = messages.listen(_heard);
  }

  final PcPairing pair;

  /// False when there is no connection now.
  final bool Function(Map<String, dynamic> frame) send;
  final String deviceName;
  final void Function(String id, String text, bool reset) output;
  final void Function(String id) opened;
  final void Function(String text) problem;

  static const findTime = Duration(seconds: 6);
  static const pingTime = Duration(seconds: 20);
  static const quietTime = Duration(seconds: 8);
  static const _paste = 8000;

  PcStatus status = PcStatus.finding;
  List<({String id, String name})> shells = [];
  List<PcTerm> terms = [];

  /// Tries left after a wrong PIN.
  int? left;

  late final StreamSubscription<Map<String, dynamic>> _sub;
  String _s = '';
  String _to = '';
  PcChannel? _chan;
  String? _pin;
  final _ends = <String, int>{};
  final _sizes = <String, (int, int)>{};
  final _timers = <Timer>[];
  int _again = 0;
  bool _stopped = false;

  void connect() {
    if (_stopped) return;
    _clear();
    _chan = null;
    _to = '';
    _s = pcNonce();
    _set(PcStatus.finding);
    send({'type': 'pc', 's': _s, 'd': 'o.${pair.id}'});
    _later(findTime, () {
      if (status == PcStatus.finding) _set(PcStatus.offline);
    });
  }

  @override
  void dispose() {
    _ask({'t': 'bye'});
    _stopped = true;
    _pin = null;
    _clear();
    unawaited(_sub.cancel());
    super.dispose();
  }

  void enterPin(String pin) {
    _pin = pin;
    _ask({'t': 'auth', 'pin': pin, 'name': deviceName});
  }

  void open(String? shell, int cols, int rows) => _ask({'t': 'new', 'shell': shell, 'cols': cols, 'rows': rows});

  void attach(String id, int cols, int rows) {
    _sizes[id] = (cols, rows);
    _ask({'t': 'attach', 'id': id, 'cols': cols, 'rows': rows, 'from': _ends[id] ?? 0});
  }

  void resize(String id, int cols, int rows) {
    _sizes[id] = (cols, rows);
    if (status == PcStatus.open) _ask({'t': 'size', 'id': id, 'cols': cols, 'rows': rows});
  }

  /// False when it did not go out: nothing typed is sent later by surprise.
  bool type(String id, String text) {
    if (status != PcStatus.open) return false;
    for (var i = 0; i < text.length;) {
      var end = min(i + _paste, text.length);
      // not between the halves of one character
      if (end < text.length && (text.codeUnitAt(end - 1) & 0xFC00) == 0xD800) end--;
      _ask({'t': 'in', 'id': id, 'd': text.substring(i, end)});
      i = end;
    }
    return true;
  }

  void close(String id) {
    _ends.remove(id);
    _sizes.remove(id);
    _ask({'t': 'close', 'id': id});
  }

  // ------------------------------------------------------------------ inside
  void _set(PcStatus s) {
    status = s;
    if (!_stopped) notifyListeners();
  }

  void _later(Duration d, void Function() f) => _timers.add(Timer(d, f));
  void _clear() {
    for (final t in _timers) {
      t.cancel();
    }
    _timers.clear();
  }

  void _ask(Map<String, dynamic> m) {
    final chan = _chan;
    if (chan == null) return;
    final (s, to) = (_s, _to);
    unawaited(
      chan.seal(jsonEncode(m), (d) {
        if (!identical(chan, _chan) && m['t'] != 'bye') return;
        if (!send({'type': 'pc', 'to': to, 's': s, 'd': d}) && identical(chan, _chan)) _chan = null;
      }),
    );
  }

  void _heard(Map<String, dynamic> m) {
    if (_stopped) return;
    if (m['type'] == 'hello') {
      if (const {PcStatus.finding, PcStatus.offline, PcStatus.open, PcStatus.pin}.contains(status)) connect();
      return;
    }
    if (m['type'] != 'pc' || m['s'] != _s || _s.isEmpty) return;
    final from = m['from'] as String;
    final d = m['d'] as String;
    if (_chan == null && _to.isEmpty && d.startsWith('r.')) {
      _to = from;
      _chan = PcChannel(pair.key, '$_s.${d.substring(2)}');
      _clear();
      if (_pin != null) {
        enterPin(_pin!);
        _later(findTime * 2, () {
          if (status == PcStatus.finding) _set(PcStatus.offline);
        });
      } else {
        _set(PcStatus.pin);
      }
      return;
    }
    if (_to.isNotEmpty && from != _to) return;
    final chan = _chan;
    if (d.startsWith('x.')) {
      // what came before it is still being opened
      final s = _s;
      unawaited(
        (chan?.idle ?? Future.value()).then((_) {
          if (s == _s && !_stopped) _ended(d.substring(2));
        }),
      );
      return;
    }
    if (chan == null) return;
    unawaited(
      chan.open(
        d,
        (plain) {
          if (identical(chan, _chan) && !_stopped) _told(jsonDecode(plain) as Map<String, dynamic>);
        },
        () {
          if (identical(chan, _chan) && !_stopped) _ended('gone');
        },
      ),
    );
  }

  void _ended(String why) {
    _chan = null;
    _s = '';
    _clear();
    if (why == 'gone') {
      // a message went missing on the way: start again, slower each time
      _set(PcStatus.finding);
      final wait = min(10000, 300 * pow(2, min(_again++, 6)).toInt());
      return _later(Duration(milliseconds: wait), connect);
    }
    _pin = null;
    left = null;
    _set(switch (why) {
      'off' => PcStatus.off,
      'locked' => PcStatus.locked,
      'idle' => PcStatus.idle,
      'removed' => PcStatus.removed,
      _ => PcStatus.ended,
    });
  }

  void _beat() {
    _clear();
    _later(pingTime, () {
      _ask({'t': 'ping'});
      _later(quietTime, connect);
    });
  }

  List<PcTerm> _terms(dynamic x) => [for (final t in x as List) PcTerm.fromJson(t as Map<String, dynamic>)];

  void _told(Map<String, dynamic> m) {
    if (status == PcStatus.open) _beat();
    switch (m['t']) {
      case 'hello':
        shells = [
          for (final s in (m['shells'] as List).cast<Map<String, dynamic>>())
            (id: s['id'] as String, name: s['name'] as String),
        ];
        terms = _terms(m['terms']);
        left = null;
        _again = 0;
        _set(PcStatus.open);
        _beat();
        for (final e in _sizes.entries.toList()) {
          if (terms.any((t) => t.id == e.key)) {
            attach(e.key, e.value.$1, e.value.$2);
          } else {
            _ends.remove(e.key);
          }
        }
      case 'badpin':
        _pin = null;
        left = (m['left'] as num).toInt();
        _set(PcStatus.pin);
      case 'opened':
        final id = m['id'] as String;
        terms = _terms(m['terms']);
        _ends[id] = 0;
        opened(id);
        notifyListeners();
      case 'terms':
        terms = _terms(m['terms']);
        notifyListeners();
      case 'out':
        final id = m['id'] as String;
        final end = (m['end'] as num).toInt();
        _ends[id] = end;
        output(id, m['d'] as String, m['reset'] == true);
        _ask({'t': 'ack', 'id': id, 'end': end});
      case 'exit':
        terms = [for (final t in terms) t.id == m['id'] ? PcTerm(t.id, t.name, (m['code'] as num).toInt()) : t];
        notifyListeners();
      case 'error':
        problem(m['text'] as String);
      case 'end':
        _ended(m['why'] as String);
    }
  }
}
