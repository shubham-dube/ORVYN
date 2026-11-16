import 'dart:math' as math;

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import 'theme.dart';

enum OrbState { idle, thinking, needsYou }

/// ORVYN's signature: a small glowing glass orb, always within thumb reach. Its light is its state —
/// a slow breath when idle, a fast shimmer when thinking, a quick pulse when it needs you.
class Orb extends StatefulWidget {
  const Orb({super.key, this.size = 64, this.state = OrbState.idle, this.onTap, this.label = 'Ask or do anything'});
  final double size;
  final OrbState state;
  final VoidCallback? onTap;
  final String label;
  @override
  State<Orb> createState() => _OrbState();
}

class _OrbState extends State<Orb> with TickerProviderStateMixin {
  late final AnimationController _spin = AnimationController(vsync: this, duration: const Duration(seconds: 6));
  late final AnimationController _pulse = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 3200),
  );
  bool _down = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _sync();
  }

  @override
  void didUpdateWidget(Orb old) {
    super.didUpdateWidget(old);
    if (old.state != widget.state) _sync();
  }

  void _sync() {
    if (context.reduceMotion) {
      _spin.stop();
      _pulse.stop();
      return;
    }
    _spin.duration = Duration(milliseconds: widget.state == OrbState.thinking ? 1400 : 6000);
    _pulse.duration = Duration(milliseconds: widget.state == OrbState.needsYou ? 1200 : 3200);
    _spin.repeat();
    _pulse.repeat(reverse: true);
  }

  @override
  void dispose() {
    _spin.dispose();
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final s = widget.size;
    return Semantics(
      container: true,
      button: true,
      label: widget.label,
      child: GestureDetector(
        onTapDown: (_) => setState(() => _down = true),
        onTapCancel: () => setState(() => _down = false),
        onTapUp: (_) => setState(() => _down = false),
        onTap: widget.onTap == null
            ? null
            : () {
                HapticFeedback.lightImpact();
                widget.onTap!();
              },
        child: AnimatedScale(
          scale: _down ? 0.92 : 1,
          duration: OrvTokens.durationBase,
          curve: springSnappy,
          child: AnimatedBuilder(
            animation: Listenable.merge([_spin, _pulse]),
            builder: (context, _) {
              final glow = 0.35 + 0.25 * _pulse.value;
              return Container(
                width: s,
                height: s,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  border: Border.all(color: Colors.white.withValues(alpha: 0.55)),
                  gradient: RadialGradient(
                    center: const Alignment(-0.3, -0.4),
                    colors: [Color.lerp(Colors.white, l.accentFrom, 0.3)!, l.accentFrom, l.accentTo],
                    stops: const [0, 0.45, 1],
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: l.accentFrom.withValues(alpha: glow),
                      blurRadius: s * 0.5,
                      spreadRadius: s * 0.04,
                    ),
                  ],
                ),
                child: ClipOval(
                  child: Stack(
                    alignment: Alignment.center,
                    children: [
                      Transform.rotate(
                        angle: _spin.value * 2 * math.pi,
                        child: Container(
                          decoration: BoxDecoration(
                            gradient: SweepGradient(
                              colors: [
                                Colors.white.withValues(alpha: 0),
                                Colors.white.withValues(alpha: 0.4),
                                Colors.white.withValues(alpha: 0),
                                Colors.white.withValues(alpha: 0),
                              ],
                              stops: const [0, 0.12, 0.4, 1],
                            ),
                          ),
                        ),
                      ),
                      Positioned(
                        top: s * 0.14,
                        left: s * 0.24,
                        child: Container(
                          width: s * 0.38,
                          height: s * 0.18,
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: 0.55),
                            borderRadius: BorderRadius.circular(s),
                          ),
                        ),
                      ),
                      Icon(Icons.add_rounded, color: Colors.white, size: s * 0.4),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
      ),
    );
  }
}
