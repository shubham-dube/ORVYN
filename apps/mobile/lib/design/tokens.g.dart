// Generated from packages/design-tokens/tokens.json — do not edit.
// ignore_for_file: constant_identifier_names
import 'package:flutter/painting.dart';

enum OrvPhase { dawn, day, dusk, night }

class OrvModeColors {
  const OrvModeColors({
    required this.text,
    required this.muted,
    required this.faint,
    required this.glass,
    required this.glassStrong,
    required this.field,
    required this.edge,
    required this.hairline,
    required this.track,
    required this.scrim,
    required this.success,
    required this.warning,
    required this.danger,
  });
  final Color text;
  final Color muted;
  final Color faint;
  final Color glass;
  final Color glassStrong;
  final Color field;
  final Color edge;
  final Color hairline;
  final Color track;
  final Color scrim;
  final Color success;
  final Color warning;
  final Color danger;
}

class OrvPhaseColors {
  const OrvPhaseColors({
    required this.dark,
    required this.base,
    required this.aurora,
    required this.veil,
    required this.colors,
  });
  final bool dark;
  final Color base;
  final List<Color> aurora;
  final Color veil;
  final OrvModeColors colors;
}

class OrvAccent {
  const OrvAccent({required this.light, required this.dark, required this.from, required this.to});
  final Color light;
  final Color dark;
  final Color from;
  final Color to;
}

class OrvLabel {
  const OrvLabel({required this.light, required this.dark});
  final Color light;
  final Color dark;
}

class OrvSpring {
  const OrvSpring(this.stiffness, this.damping, this.mass);
  final double stiffness;
  final double damping;
  final double mass;
}

abstract final class OrvTokens {
  static const OrvModeColors light = OrvModeColors(
    text: Color(0xFF0F1B2A),
    muted: Color(0xFF475569),
    faint: Color(0xFF64748B),
    glass: Color(0x85FFFFFF),
    glassStrong: Color(0xA8FFFFFF),
    field: Color(0xB3FFFFFF),
    edge: Color(0xBFFFFFFF),
    hairline: Color(0x1A0F1B2A),
    track: Color(0x140F1B2A),
    scrim: Color(0x2E0F172A),
    success: Color(0xFF047857),
    warning: Color(0xFFB45309),
    danger: Color(0xFFB91C1C),
  );
  static const OrvModeColors dark = OrvModeColors(
    text: Color(0xFFF1F5FF),
    muted: Color(0xFFB6C0D8),
    faint: Color(0xFF94A3B8),
    glass: Color(0x6B14182C),
    glassStrong: Color(0x94161A30),
    field: Color(0x12FFFFFF),
    edge: Color(0x1FFFFFFF),
    hairline: Color(0x1AFFFFFF),
    track: Color(0x1AFFFFFF),
    scrim: Color(0x59000000),
    success: Color(0xFF6EE7B7),
    warning: Color(0xFFFCD34D),
    danger: Color(0xFFFDA4AF),
  );
  static const Map<OrvPhase, OrvPhaseColors> phases = {
    OrvPhase.dawn: OrvPhaseColors(
      dark: false,
      base: Color(0xFFFDF0EA),
      aurora: [Color(0xFFFFB59E), Color(0xFFF7A1C4), Color(0xFFFFD98A)],
      veil: Color(0x40FFF8F4),
      colors: light,
    ),
    OrvPhase.day: OrvPhaseColors(
      dark: false,
      base: Color(0xFFEAF3FB),
      aurora: [Color(0xFF9AD0FF), Color(0xFFA6F0D8), Color(0xFFC9D8FF)],
      veil: Color(0x33F5FAFF),
      colors: light,
    ),
    OrvPhase.dusk: OrvPhaseColors(
      dark: true,
      base: Color(0xFF1B1030),
      aurora: [Color(0xFFFF8A5B), Color(0xFF8E5BFF), Color(0xFFFF5E8A)],
      veil: Color(0x59140A28),
      colors: dark,
    ),
    OrvPhase.night: OrvPhaseColors(
      dark: true,
      base: Color(0xFF05070F),
      aurora: [Color(0xFF1E3A8A), Color(0xFF0E7490), Color(0xFF3B1D7A)],
      veil: Color(0x59030610),
      colors: dark,
    ),
  };
  static const Map<String, OrvAccent> modules = {
    'core': OrvAccent(
      light: Color(0xFF1A56C4),
      dark: Color(0xFF7CC4FF),
      from: Color(0xFF3B82F6),
      to: Color(0xFF06B6D4),
    ),
    'today': OrvAccent(
      light: Color(0xFF1A56C4),
      dark: Color(0xFF7CC4FF),
      from: Color(0xFF3B82F6),
      to: Color(0xFF06B6D4),
    ),
    'drop': OrvAccent(
      light: Color(0xFF334155),
      dark: Color(0xFFE2E8F0),
      from: Color(0xFF94A3B8),
      to: Color(0xFF475569),
    ),
    'money': OrvAccent(
      light: Color(0xFF046C4E),
      dark: Color(0xFF6EE7B7),
      from: Color(0xFF10B981),
      to: Color(0xFF0EA5E9),
    ),
    'library': OrvAccent(
      light: Color(0xFF92400E),
      dark: Color(0xFFFCD34D),
      from: Color(0xFFF59E0B),
      to: Color(0xFFF97316),
    ),
    'assistant': OrvAccent(
      light: Color(0xFF0D5F59),
      dark: Color(0xFF5EEAD4),
      from: Color(0xFF14B8A6),
      to: Color(0xFF6366F1),
    ),
    'vault': OrvAccent(
      light: Color(0xFF6D28D9),
      dark: Color(0xFFC4B5FD),
      from: Color(0xFF7C3AED),
      to: Color(0xFF4F46E5),
    ),
    'chat': OrvAccent(
      light: Color(0xFFBE123C),
      dark: Color(0xFFFDA4AF),
      from: Color(0xFFF43F5E),
      to: Color(0xFFFB923C),
    ),
    'ipo': OrvAccent(light: Color(0xFF854D0E), dark: Color(0xFFFDE047), from: Color(0xFFEAB308), to: Color(0xFFF59E0B)),
    'jobs': OrvAccent(
      light: Color(0xFF0B6278),
      dark: Color(0xFF67E8F9),
      from: Color(0xFF06B6D4),
      to: Color(0xFF3B82F6),
    ),
  };

  /// Colours people pick for projects and calendars (readable as text on glass in both modes).
  static const Map<String, OrvLabel> labels = {
    'sky': OrvLabel(light: Color(0xFF0B5CAD), dark: Color(0xFF7CC4FF)),
    'emerald': OrvLabel(light: Color(0xFF046C4E), dark: Color(0xFF6EE7B7)),
    'amber': OrvLabel(light: Color(0xFF8A4B00), dark: Color(0xFFFCD34D)),
    'violet': OrvLabel(light: Color(0xFF6D28D9), dark: Color(0xFFC4B5FD)),
    'coral': OrvLabel(light: Color(0xFFB4232C), dark: Color(0xFFFDA4AF)),
    'gold': OrvLabel(light: Color(0xFF7A5A00), dark: Color(0xFFFDE047)),
    'cyan': OrvLabel(light: Color(0xFF0B6278), dark: Color(0xFF67E8F9)),
    'slate': OrvLabel(light: Color(0xFF334155), dark: Color(0xFFCBD5E1)),
  };

  /// Minutes after midnight at which each phase begins (clock fallback when sunrise is unknown).
  static const Map<OrvPhase, int> phaseStarts = {
    OrvPhase.dawn: 300,
    OrvPhase.day: 480,
    OrvPhase.dusk: 1020,
    OrvPhase.night: 1200,
  };
  static const double radiusXs = 6;
  static const double radiusSm = 10;
  static const double radiusMd = 14;
  static const double radiusLg = 20;
  static const double radiusXl = 28;
  static const double radiusFull = 999;
  static const double glassPaneBlur = 16;
  static const double glassFloatBlur = 26;
  static const double glassHaloBlur = 30;
  static const OrvSpring springSnappy = OrvSpring(520, 34, 1);
  static const OrvSpring springSmooth = OrvSpring(300, 30, 1);
  static const OrvSpring springGentle = OrvSpring(160, 22, 1);
  static const Duration durationFast = Duration(milliseconds: 120);
  static const Duration durationBase = Duration(milliseconds: 200);
  static const Duration durationSlow = Duration(milliseconds: 320);
  static const Duration durationTheme = Duration(milliseconds: 1200);
  static const TextStyle display = TextStyle(
    fontSize: 44,
    fontWeight: FontWeight.w700,
    letterSpacing: -1.54,
    height: 1,
  );
  static const TextStyle title = TextStyle(
    fontSize: 26,
    fontWeight: FontWeight.w600,
    letterSpacing: -0.52,
    height: 1.15,
  );
  static const TextStyle heading = TextStyle(
    fontSize: 18,
    fontWeight: FontWeight.w600,
    letterSpacing: -0.18,
    height: 1.3,
  );
  static const TextStyle body = TextStyle(fontSize: 15, fontWeight: FontWeight.w500, letterSpacing: 0.00, height: 1.5);
  static const TextStyle small = TextStyle(
    fontSize: 13,
    fontWeight: FontWeight.w500,
    letterSpacing: 0.00,
    height: 1.45,
  );
  static const TextStyle label = TextStyle(fontSize: 11, fontWeight: FontWeight.w600, letterSpacing: 1.54, height: 1.2);
}
