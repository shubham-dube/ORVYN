import 'package:flutter/physics.dart';
import 'package:material_ui/material_ui.dart';

import 'tokens.g.dart';

export 'tokens.g.dart';

/// `auto` follows the clock (and later the real sun); the others pin a light.
enum ThemePreference { auto, dawn, day, dusk, night }

OrvPhase phaseAt(DateTime t) {
  final m = t.hour * 60 + t.minute;
  final s = OrvTokens.phaseStarts;
  if (m >= s[OrvPhase.night]! || m < s[OrvPhase.dawn]!) return OrvPhase.night;
  if (m >= s[OrvPhase.dusk]!) return OrvPhase.dusk;
  if (m >= s[OrvPhase.day]!) return OrvPhase.day;
  return OrvPhase.dawn;
}

OrvPhase resolvePhase(ThemePreference p, DateTime now) => switch (p) {
  ThemePreference.auto => phaseAt(now),
  ThemePreference.dawn => OrvPhase.dawn,
  ThemePreference.day => OrvPhase.day,
  ThemePreference.dusk => OrvPhase.dusk,
  ThemePreference.night => OrvPhase.night,
};

/// Everything a widget needs to draw in the current light and module.
@immutable
class OrvLook {
  const OrvLook({required this.phase, required this.module});
  final OrvPhase phase;
  final String module;

  OrvPhaseColors get p => OrvTokens.phases[phase]!;
  OrvModeColors get c => p.colors;
  bool get dark => p.dark;
  OrvAccent get _a => OrvTokens.modules[module] ?? OrvTokens.modules['core']!;
  Color get accent => dark ? _a.dark : _a.light;
  Gradient get accentGradient =>
      LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [_a.from, _a.to]);
  Color get accentFrom => _a.from;
  Color get accentTo => _a.to;

  OrvLook withModule(String m) => OrvLook(phase: phase, module: m);

  @override
  bool operator ==(Object other) => other is OrvLook && other.phase == phase && other.module == module;
  @override
  int get hashCode => Object.hash(phase, module);
}

class OrvTheme extends InheritedWidget {
  const OrvTheme({super.key, required this.look, required super.child});
  final OrvLook look;

  static OrvLook of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<OrvTheme>()?.look ??
      const OrvLook(phase: OrvPhase.day, module: 'core');

  @override
  bool updateShouldNotify(OrvTheme old) => old.look != look;
}

/// Tints everything below with a module's accent ("you always know where you are").
class OrvModule extends StatelessWidget {
  const OrvModule({super.key, required this.module, required this.child});
  final String module;
  final Widget child;
  @override
  Widget build(BuildContext context) => OrvTheme(look: OrvTheme.of(context).withModule(module), child: child);
}

extension OrvContext on BuildContext {
  OrvLook get orv => OrvTheme.of(this);
  bool get reduceMotion => MediaQuery.maybeDisableAnimationsOf(this) ?? false;
}

const fontFamily = 'Geist';
const monoFamily = 'GeistMono';

abstract final class OrvText {
  static TextStyle display(OrvLook l) =>
      OrvTokens.display.copyWith(color: l.c.text, fontFamily: fontFamily, fontFeatures: _tab);
  static TextStyle title(OrvLook l) => OrvTokens.title.copyWith(color: l.c.text, fontFamily: fontFamily);
  static TextStyle heading(OrvLook l) => OrvTokens.heading.copyWith(color: l.c.text, fontFamily: fontFamily);
  static TextStyle body(OrvLook l) => OrvTokens.body.copyWith(color: l.c.text, fontFamily: fontFamily);
  static TextStyle muted(OrvLook l) => OrvTokens.small.copyWith(color: l.c.muted, fontFamily: fontFamily);
  static TextStyle label(OrvLook l) => OrvTokens.label.copyWith(color: l.accent, fontFamily: fontFamily);
  static const _tab = [FontFeature.tabularFigures()];
}

/// Material plumbing (text selection, scroll physics, focus) themed from the tokens.
ThemeData materialTheme(OrvLook l) {
  final scheme = ColorScheme.fromSeed(
    seedColor: l.accentFrom,
    brightness: l.dark ? Brightness.dark : Brightness.light,
  ).copyWith(primary: l.accent, surface: l.p.base, onSurface: l.c.text, error: l.c.danger);
  return ThemeData(
    colorScheme: scheme,
    fontFamily: fontFamily,
    scaffoldBackgroundColor: Colors.transparent,
    splashFactory: NoSplash.splashFactory,
    textSelectionTheme: TextSelectionThemeData(cursorColor: l.accent, selectionColor: l.accent.withValues(alpha: 0.3)),
    pageTransitionsTheme: const PageTransitionsTheme(
      builders: {TargetPlatform.android: FadeForwardsPageTransitionsBuilder()},
    ),
  );
}

/// A Curve that follows a spring from the tokens, so Flutter and the web move alike.
class SpringCurve extends Curve {
  SpringCurve(OrvSpring s)
    : _sim = SpringSimulation(SpringDescription(mass: s.mass, stiffness: s.stiffness, damping: s.damping), 0, 1, 0);
  final SpringSimulation _sim;
  // springs settle in well under a second; the animation's duration maps 0..1 onto 0..0.6s of the simulation
  @override
  double transformInternal(double t) => _sim.x(t * 0.6);
}

final springSnappy = SpringCurve(OrvTokens.springSnappy);
final springSmooth = SpringCurve(OrvTokens.springSmooth);
final springGentle = SpringCurve(OrvTokens.springGentle);
