import 'package:flutter_test/flutter_test.dart';
import 'package:orvyn/core/hlc.dart';

void main() {
  test('formats exactly like the TypeScript clock', () {
    // same vector as packages/contracts/test/hlc.test.ts
    expect(formatHlc(const HlcParts(1700000000000, 3, 'dev1')), '001700000000000:00003:dev1');
    final p = parseHlc('001700000000000:00003:dev1');
    expect([p.ms, p.counter, p.node], [1700000000000, 3, 'dev1']);
    expect(() => parseHlc('nope'), throwsFormatException);
  });

  test('tick is monotonic even when the wall clock stalls or goes back', () {
    var now = 1000;
    final c = Hlc('a', now: () => now);
    final a = c.tick();
    final b = c.tick();
    now = 900;
    final d = c.tick();
    expect(compareHlc(a, b), lessThan(0));
    expect(compareHlc(b, d), lessThan(0));
  });

  test('receive moves past a remote clock and refuses one far in the future', () {
    var now = 1000;
    final c = Hlc('a', now: () => now);
    final local = c.receive(formatHlc(const HlcParts(5000, 7, 'b')));
    expect(parseHlc(local).ms, 5000);
    expect(parseHlc(local).counter, 8);
    expect(compareHlc(c.tick(), local), greaterThan(0));
    now = 0;
    expect(() => c.receive(formatHlc(const HlcParts(61001, 0, 'b'))), throwsStateError);
  });
}
