import 'package:flutter_test/flutter_test.dart';
import 'package:orvyn/design/theme.dart';
import 'package:orvyn/features/common.dart';

void main() {
  test('the light follows the same clock as the web (tokens.json phase starts)', () {
    OrvPhase at(int h, [int m = 0]) => phaseAt(DateTime(2026, 11, 16, h, m));
    expect(
      [at(4, 59), at(5), at(7, 59), at(8), at(16, 59), at(17), at(19, 59), at(20), at(0)],
      [
        OrvPhase.night,
        OrvPhase.dawn,
        OrvPhase.dawn,
        OrvPhase.day,
        OrvPhase.day,
        OrvPhase.dusk,
        OrvPhase.dusk,
        OrvPhase.night,
        OrvPhase.night,
      ],
    );
  });

  test('a pinned light ignores the clock', () {
    expect(resolvePhase(ThemePreference.night, DateTime(2026, 1, 1, 12)), OrvPhase.night);
    expect(resolvePhase(ThemePreference.auto, DateTime(2026, 1, 1, 12)), OrvPhase.day);
  });

  test('greeting follows the clock, not the pinned light', () {
    expect(greetingAt(DateTime(2026, 1, 1, 14)), 'Good afternoon');
    expect(greetingAt(DateTime(2026, 1, 1, 6)), 'Good morning');
    expect(greetingAt(DateTime(2026, 1, 1, 23)), 'Good night');
  });

  test('every module has an accent and dark phases use the dark accent', () {
    const night = OrvLook(phase: OrvPhase.night, module: 'money');
    const day = OrvLook(phase: OrvPhase.day, module: 'money');
    expect(night.accent, OrvTokens.modules['money']!.dark);
    expect(day.accent, OrvTokens.modules['money']!.light);
    for (final k in ['today', 'drop', 'money', 'library', 'vault', 'assistant', 'chat', 'ipo', 'jobs']) {
      expect(OrvTokens.modules.containsKey(k), isTrue, reason: k);
    }
  });
}
