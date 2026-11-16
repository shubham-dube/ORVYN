import 'dart:math' as math;

import 'package:material_ui/material_ui.dart';

import 'theme.dart';

/// Living light: three soft blobs drifting slowly over the phase's base colour, cross-fading when the
/// phase changes. Stops drifting when the system asks for reduced motion.
class Aurora extends StatefulWidget {
  const Aurora({super.key, required this.child});
  final Widget child;
  @override
  State<Aurora> createState() => _AuroraState();
}

class _AuroraState extends State<Aurora> with SingleTickerProviderStateMixin {
  late final AnimationController _drift = AnimationController(vsync: this, duration: const Duration(seconds: 48));

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (context.reduceMotion) {
      _drift.stop();
    } else if (!_drift.isAnimating) {
      _drift.repeat();
    }
  }

  @override
  void dispose() {
    _drift.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final p = context.orv.p;
    return TweenAnimationBuilder<_Palette>(
      tween: _PaletteTween(end: _Palette(p.base, p.aurora, p.veil)),
      duration: OrvTokens.durationTheme,
      curve: Curves.easeInOut,
      builder: (context, pal, child) => Stack(
        fit: StackFit.expand,
        children: [
          ColoredBox(color: pal.base),
          RepaintBoundary(
            child: AnimatedBuilder(
              animation: _drift,
              builder: (_, _) => CustomPaint(painter: _AuroraPainter(pal, _drift.value)),
            ),
          ),
          ColoredBox(color: pal.veil),
          child!,
        ],
      ),
      child: widget.child,
    );
  }
}

class _Palette {
  const _Palette(this.base, this.blobs, this.veil);
  final Color base;
  final List<Color> blobs;
  final Color veil;
}

class _PaletteTween extends Tween<_Palette> {
  _PaletteTween({required super.end});
  @override
  _Palette lerp(double t) {
    final a = begin ?? end!;
    final b = end!;
    return _Palette(Color.lerp(a.base, b.base, t)!, [
      for (var i = 0; i < 3; i++) Color.lerp(a.blobs[i], b.blobs[i], t)!,
    ], Color.lerp(a.veil, b.veil, t)!);
  }
}

class _AuroraPainter extends CustomPainter {
  _AuroraPainter(this.pal, this.t);
  final _Palette pal;
  final double t;

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width;
    final h = size.height;
    final r = math.max(w, h) * 0.55;
    final a = t * 2 * math.pi;
    final centers = [
      Offset(w * (0.15 + 0.10 * math.sin(a)), h * (0.12 + 0.06 * math.cos(a))),
      Offset(w * (0.90 + 0.08 * math.cos(a * 2)), h * (0.35 + 0.08 * math.sin(a))),
      Offset(w * (0.35 + 0.12 * math.cos(a)), h * (0.95 + 0.05 * math.sin(a * 2))),
    ];
    for (var i = 0; i < 3; i++) {
      final paint = Paint()
        ..shader = RadialGradient(colors: [pal.blobs[i].withValues(alpha: 0.85), pal.blobs[i].withValues(alpha: 0)])
            .createShader(Rect.fromCircle(center: centers[i], radius: r))
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 40);
      canvas.drawCircle(centers[i], r, paint);
    }
  }

  @override
  bool shouldRepaint(_AuroraPainter old) => old.t != t || old.pal != pal;
}
