import 'dart:ui';

import 'package:material_ui/material_ui.dart';

import 'theme.dart';

enum GlassLevel { pane, float, halo }

/// Frosted glass with a fixed recipe per elevation (never ad hoc): blur, tint, hairline edge, and a 1px
/// edge-light along the top where the glass catches the light.
class Glass extends StatelessWidget {
  const Glass({super.key, this.level = GlassLevel.pane, this.padding, this.child, this.radius, this.blur = true});
  final GlassLevel level;
  final EdgeInsetsGeometry? padding;
  final Widget? child;
  final double? radius;

  /// Lists of many panes pass false: glass stays tinted but only the surrounding layer blurs (perf budget).
  final bool blur;

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final r =
        radius ??
        switch (level) {
          GlassLevel.pane => OrvTokens.radiusMd,
          GlassLevel.float => OrvTokens.radiusLg,
          GlassLevel.halo => OrvTokens.radiusXl,
        };
    final sigma = switch (level) {
      GlassLevel.pane => OrvTokens.glassPaneBlur,
      GlassLevel.float => OrvTokens.glassFloatBlur,
      GlassLevel.halo => OrvTokens.glassHaloBlur,
    };
    final tint = level == GlassLevel.pane ? l.c.glass : l.c.glassStrong;
    final radius_ = BorderRadius.circular(r);
    Widget body = DecoratedBox(
      decoration: BoxDecoration(
        color: tint,
        borderRadius: radius_,
        border: Border.all(color: l.c.edge),
        boxShadow: level == GlassLevel.pane
            ? null
            : [
                BoxShadow(
                  color: Colors.black.withValues(alpha: l.dark ? 0.35 : 0.10),
                  blurRadius: 40,
                  offset: const Offset(0, 18),
                ),
              ],
      ),
      child: Stack(
        children: [
          Positioned(
            left: r,
            right: r,
            top: 0,
            height: 1,
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [
                    Colors.white.withValues(alpha: 0),
                    Colors.white.withValues(alpha: l.dark ? 0.35 : 0.9),
                    Colors.white.withValues(alpha: 0),
                  ],
                ),
              ),
            ),
          ),
          Padding(padding: padding ?? EdgeInsets.zero, child: child),
        ],
      ),
    );
    if (blur) {
      body = BackdropFilter(
        filter: ImageFilter.blur(sigmaX: sigma / 2, sigmaY: sigma / 2),
        child: body,
      );
    }
    return ClipRRect(borderRadius: radius_, child: body);
  }
}
