/// Hybrid logical clock — byte-for-byte the same format as `packages/contracts/src/hlc.ts`:
/// `<physical ms, 15 digits>:<counter, 5 digits>:<node id>`, so timestamps sort as strings.
class HlcParts {
  const HlcParts(this.ms, this.counter, this.node);
  final int ms;
  final int counter;
  final String node;
}

const _maxDriftMs = 60000;
final _pattern = RegExp(r'^(\d{15}):(\d{5}):([A-Za-z0-9_-]{1,40})$');

String formatHlc(HlcParts p) => '${p.ms.toString().padLeft(15, '0')}:${p.counter.toString().padLeft(5, '0')}:${p.node}';

HlcParts parseHlc(String s) {
  final m = _pattern.firstMatch(s);
  if (m == null) throw FormatException('invalid HLC: $s');
  return HlcParts(int.parse(m[1]!), int.parse(m[2]!), m[3]!);
}

int compareHlc(String a, String b) => a.compareTo(b);

class Hlc {
  Hlc(this.node, {int Function()? now})
    : _now = now ?? (() => DateTime.now().millisecondsSinceEpoch),
      _last = HlcParts(0, 0, node);

  final String node;
  final int Function() _now;
  HlcParts _last;

  /// Timestamp for a local event.
  String tick() {
    final wall = _now();
    _last = wall > _last.ms ? HlcParts(wall, 0, node) : HlcParts(_last.ms, _last.counter + 1, node);
    return formatHlc(_last);
  }

  /// Merge a timestamp from elsewhere; returns the new local timestamp.
  String receive(String remote) {
    final r = parseHlc(remote);
    final wall = _now();
    if (r.ms - wall > _maxDriftMs) throw StateError('remote clock too far ahead');
    final ms = [wall, _last.ms, r.ms].reduce((a, b) => a > b ? a : b);
    var counter = 0;
    if (ms == _last.ms && ms == r.ms) {
      counter = (_last.counter > r.counter ? _last.counter : r.counter) + 1;
    } else if (ms == _last.ms) {
      counter = _last.counter + 1;
    } else if (ms == r.ms) {
      counter = r.counter + 1;
    }
    _last = HlcParts(ms, counter, node);
    return formatHlc(_last);
  }
}
