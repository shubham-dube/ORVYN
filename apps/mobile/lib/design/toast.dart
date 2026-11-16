import 'dart:async';

import 'package:material_ui/material_ui.dart';

import 'glass.dart';
import 'theme.dart';

enum ToastTone { neutral, success, danger }

/// Quiet notifications: a soft glow runs down the screen edge and a small glass card settles at the top —
/// never a banner over content.
class Toaster extends StatefulWidget {
  const Toaster({super.key, required this.child});
  final Widget child;

  static ToasterState of(BuildContext context) => context.findAncestorStateOfType<ToasterState>()!;

  @override
  State<Toaster> createState() => ToasterState();
}

class _Toast {
  _Toast(this.id, this.title, this.body, this.tone);
  final int id;
  final String title;
  final String? body;
  final ToastTone tone;
}

class ToasterState extends State<Toaster> {
  final _items = <_Toast>[];
  final _timers = <Timer>{};
  var _next = 0;

  @override
  void dispose() {
    for (final t in _timers) {
      t.cancel();
    }
    super.dispose();
  }

  void show(String title, {String? body, ToastTone tone = ToastTone.neutral}) {
    final t = _Toast(_next++, title, body, tone);
    setState(() {
      _items.add(t);
      if (_items.length > 3) _items.removeAt(0);
    });
    late final Timer timer;
    timer = Timer(const Duration(seconds: 5), () {
      _timers.remove(timer);
      if (mounted) setState(() => _items.remove(t));
    });
    _timers.add(timer);
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return Stack(
      children: [
        widget.child,
        // toasts never block what is under them (the bell sits up there too)
        Positioned(
          top: MediaQuery.paddingOf(context).top + 8,
          left: 12,
          right: 64,
          child: IgnorePointer(
            child: Column(
              children: [
                for (final t in _items)
                  TweenAnimationBuilder<double>(
                    key: ValueKey(t.id),
                    tween: Tween(begin: 0, end: 1),
                    duration: OrvTokens.durationSlow,
                    curve: springSmooth,
                    builder: (context, v, child) => Opacity(
                      opacity: v.clamp(0, 1),
                      child: Transform.translate(offset: Offset(0, -16 * (1 - v)), child: child),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Semantics(
                        liveRegion: true,
                        child: Glass(
                          level: GlassLevel.float,
                          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                          child: SizedBox(
                            width: double.infinity,
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  t.title,
                                  style: OrvText.body(l).copyWith(
                                    fontWeight: FontWeight.w600,
                                    color: switch (t.tone) {
                                      ToastTone.danger => l.c.danger,
                                      ToastTone.success => l.c.success,
                                      ToastTone.neutral => l.c.text,
                                    },
                                  ),
                                ),
                                if (t.body != null) Text(t.body!, style: OrvText.muted(l)),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
        if (_items.isNotEmpty)
          Positioned(
            right: 0,
            top: 0,
            bottom: 0,
            width: 4,
            child: IgnorePointer(
              child: TweenAnimationBuilder<double>(
                key: ValueKey(_items.last.id),
                tween: Tween(begin: 1, end: 0),
                duration: const Duration(milliseconds: 2400),
                builder: (_, v, _) => DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      colors: [
                        l.accent.withValues(alpha: 0),
                        l.accent.withValues(alpha: v),
                        l.accent.withValues(alpha: 0),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }
}
