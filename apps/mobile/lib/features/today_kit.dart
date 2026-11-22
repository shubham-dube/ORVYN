import 'package:flutter/services.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../design/glass.dart';
import '../design/theme.dart';
import 'sheets.dart';

/// Small shared pieces for Today, the task sheet and the ClickUp screens (spec 0012).

/// ClickUp's "#a875ff" as a colour; a soft grey when missing or odd.
Color hexColour(String? hex, OrvLook l) {
  final h = (hex ?? '').replaceFirst('#', '');
  final v = int.tryParse(h.length == 3 ? h.split('').map((c) => '$c$c').join() : h, radix: 16);
  if (v == null || (h.length != 6 && h.length != 3)) return l.c.faint;
  return Color(0xFF000000 | v);
}

/// A fact about a task, as a pill: set ones glow in their colour; unset ones are quiet with a "+" (spec 0012 A3).
class FactPill extends StatelessWidget {
  const FactPill({
    super.key,
    required this.icon,
    required this.label,
    required this.onTap,
    this.set = true,
    this.tone,
    this.onClear,
    this.semanticLabel,
  });
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool set;
  final Color? tone;
  final VoidCallback? onClear;
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final c = tone ?? l.accent;
    return Semantics(
      container: true,
      button: true,
      label: semanticLabel ?? label,
      excludeSemantics: true,
      child: GestureDetector(
        onTap: () {
          HapticFeedback.selectionClick();
          onTap();
        },
        child: AnimatedContainer(
          duration: OrvTokens.durationFast,
          height: 34,
          padding: EdgeInsets.only(left: 10, right: onClear != null && set ? 4 : 12),
          decoration: BoxDecoration(
            color: set ? c.withValues(alpha: l.dark ? 0.18 : 0.11) : Colors.transparent,
            borderRadius: BorderRadius.circular(OrvTokens.radiusFull),
            border: Border.all(color: set ? c.withValues(alpha: 0.45) : l.c.edge),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(set ? icon : LucideIcons.plus, size: 15, color: set ? c : l.c.muted),
              const SizedBox(width: 6),
              Text(
                label,
                style: OrvText.muted(l).copyWith(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: set ? (l.dark ? Colors.white : c) : l.c.muted,
                ),
              ),
              if (onClear != null && set)
                GestureDetector(
                  onTap: onClear,
                  child: Padding(
                    padding: const EdgeInsets.all(5),
                    child: Icon(LucideIcons.x, size: 13, color: c.withValues(alpha: 0.8)),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A row that breathes while its data is on its way — never an empty state before the data is in (spec 0012 B6).
class SkeletonRows extends StatefulWidget {
  const SkeletonRows({super.key, this.count = 2, this.dense = false});
  final int count;
  final bool dense;
  @override
  State<SkeletonRows> createState() => _SkeletonRowsState();
}

class _SkeletonRowsState extends State<SkeletonRows> with SingleTickerProviderStateMixin {
  late final _a = AnimationController(vsync: this, duration: const Duration(milliseconds: 1100))..repeat(reverse: true);
  @override
  void dispose() {
    _a.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    Widget bar(double w, double h) => Container(
      width: w,
      height: h,
      decoration: BoxDecoration(color: l.c.track, borderRadius: BorderRadius.circular(6)),
    );
    return Semantics(
      container: true,
      label: 'Loading',
      child: FadeTransition(
        opacity: Tween(begin: 0.45, end: 1.0).animate(_a),
        child: Column(
          children: [
            for (var i = 0; i < widget.count; i++)
              Padding(
                padding: EdgeInsets.symmetric(vertical: widget.dense ? 6 : 9, horizontal: 4),
                child: Row(
                  children: [
                    Container(
                      width: 22,
                      height: 22,
                      decoration: BoxDecoration(shape: BoxShape.circle, color: l.c.track),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          bar(i.isEven ? 190 : 140, 11),
                          const SizedBox(height: 7),
                          bar(i.isEven ? 110 : 150, 8),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// One choice from a short list, as a glass sheet with big rows (When, Priority, Project, Status …).
class PickOption<T> {
  const PickOption(this.value, this.label, {this.icon, this.colour, this.sub, this.selected = false});
  final T value;
  final String label;
  final String? sub;
  final IconData? icon;
  final Color? colour;
  final bool selected;
}

Future<T?> pickOne<T>(BuildContext context, String title, List<PickOption<T>> options, {Widget? footer}) =>
    showGlassSheet<T>(context, (ctx) {
      final l = ctx.orv;
      return ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(ctx).height * 0.7),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const SizedBox(height: 10),
            Center(
              child: Container(
                width: 36,
                height: 4,
                decoration: BoxDecoration(color: l.c.track, borderRadius: BorderRadius.circular(2)),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 6),
              child: Text(title, style: OrvText.heading(l)),
            ),
            Flexible(
              child: ListView(
                shrinkWrap: true,
                padding: const EdgeInsets.fromLTRB(10, 0, 10, 12),
                children: [
                  for (final o in options)
                    InkWell(
                      borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
                      onTap: () {
                        HapticFeedback.selectionClick();
                        Navigator.of(ctx).pop(o.value);
                      },
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                        decoration: BoxDecoration(
                          color: o.selected ? l.accent.withValues(alpha: 0.10) : null,
                          borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
                        ),
                        child: Row(
                          children: [
                            if (o.colour != null)
                              Container(
                                width: 12,
                                height: 12,
                                margin: const EdgeInsets.only(right: 12),
                                decoration: BoxDecoration(color: o.colour, shape: BoxShape.circle),
                              )
                            else if (o.icon != null)
                              Padding(
                                padding: const EdgeInsets.only(right: 12),
                                child: Icon(o.icon, size: 18, color: o.selected ? l.accent : l.c.muted),
                              ),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    o.label,
                                    style: OrvText.body(l)
                                        .copyWith(fontWeight: o.selected ? FontWeight.w700 : FontWeight.w500),
                                  ),
                                  if (o.sub != null) Text(o.sub!, style: OrvText.muted(l).copyWith(fontSize: 12)),
                                ],
                              ),
                            ),
                            if (o.selected) Icon(LucideIcons.check, size: 18, color: l.accent),
                          ],
                        ),
                      ),
                    ),
                  ?footer,
                ],
              ),
            ),
          ],
        ),
      );
    });

/// A section card's header: a small caps title, a count, an optional action on the right.
class GroupHeader extends StatelessWidget {
  const GroupHeader({super.key, required this.title, this.count, this.tone, this.icon, this.trailing, this.hint});
  final String title;
  final int? count;
  final Color? tone;
  final IconData? icon;
  final Widget? trailing;
  final String? hint;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final c = tone ?? l.accent;
    return Padding(
      padding: const EdgeInsets.fromLTRB(6, 0, 6, 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              if (icon != null) ...[Icon(icon, size: 14, color: c), const SizedBox(width: 6)],
              Semantics(
                header: true,
                child: Text(title.toUpperCase(), style: OrvText.label(l).copyWith(color: c)),
              ),
              const SizedBox(width: 8),
              if (count != null && count! > 0)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 1),
                  decoration: BoxDecoration(
                    color: c.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(OrvTokens.radiusFull),
                  ),
                  child: Text(
                    '$count',
                    style: OrvText.muted(l).copyWith(fontSize: 11, fontWeight: FontWeight.w700, color: c),
                  ),
                ),
              const Spacer(),
              ?trailing,
            ],
          ),
          if (hint != null)
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Text(hint!, style: OrvText.muted(l).copyWith(fontSize: 12)),
            ),
        ],
      ),
    );
  }
}

/// A glass card for one group of rows.
class GroupCard extends StatelessWidget {
  const GroupCard({super.key, required this.children, this.padding});
  final List<Widget> children;
  final EdgeInsetsGeometry? padding;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 14),
    child: Glass(
      blur: false,
      padding: padding ?? const EdgeInsets.fromLTRB(10, 14, 10, 8),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
    ),
  );
}

/// "3h 20m" from minutes; "0m" for nothing.
String hm(int minutes) {
  if (minutes < 60) return '${minutes}m';
  final h = minutes ~/ 60;
  final m = minutes % 60;
  return m == 0 ? '${h}h' : '${h}h ${m}m';
}

/// "1:02:09" for a running timer.
String clockOf(Duration d) {
  final h = d.inHours;
  final m = d.inMinutes % 60;
  final s = d.inSeconds % 60;
  return '$h:${m.toString().padLeft(2, '0')}:${s.toString().padLeft(2, '0')}';
}

/// A link to join a call, found in an event's place or notes (Meet, Zoom, Teams, Webex).
String? joinLinkIn(String place, String notes) {
  final m = RegExp(
    r'https://(?:meet\.google\.com|[\w.-]*zoom\.us|teams\.microsoft\.com|teams\.live\.com|[\w.-]*webex\.com)/[^\s<>")]+',
  ).firstMatch('$place\n$notes');
  return m?.group(0);
}

/// Gives its child the height left between where it starts (with the page scrolled to the top) and the bottom nav,
/// so a board or a day river with its own scrolling never sits under the nav (spec 0012 follow-up). Inside the
/// shell, `MediaQuery.padding.bottom` already includes the nav (the scaffold extends its body behind it).
class FitAboveNav extends StatefulWidget {
  const FitAboveNav({super.key, required this.builder, this.min = 320, this.max = 900});
  final Widget Function(double height) builder;
  final double min;
  final double max;
  @override
  State<FitAboveNav> createState() => _FitAboveNavState();
}

class _FitAboveNavState extends State<FitAboveNav> {
  double? _h;

  void _measure() {
    if (!mounted) return;
    final box = context.findRenderObject() as RenderBox?;
    if (box == null || !box.hasSize || !box.attached) return;
    final scrolled = Scrollable.maybeOf(context)?.position.pixels ?? 0;
    final top = box.localToGlobal(Offset.zero).dy + scrolled;
    final mq = MediaQuery.of(context);
    final h = (mq.size.height - mq.padding.bottom - top - 12).clamp(widget.min, widget.max);
    if (_h == null || (h - _h!).abs() > 1) setState(() => _h = h);
  }

  @override
  Widget build(BuildContext context) {
    WidgetsBinding.instance.addPostFrameCallback((_) => _measure());
    return widget.builder(_h ?? widget.min);
  }
}
