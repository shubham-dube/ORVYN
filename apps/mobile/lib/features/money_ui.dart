import 'package:flutter/services.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../design/theme.dart';
import '../money/money.dart';
import 'sheets.dart';
import 'today_calendar.dart' show labelColour;

/// The pieces every money sheet is made of (spec 0014): one look, compact, made for thumbs.

/// The lucide icon a category names ("shopping-basket" → the basket).
IconData categoryIcon(String? name) => switch (name) {
  'utensils' => LucideIcons.utensils,
  'shopping-basket' => LucideIcons.shoppingBasket,
  'car' => LucideIcons.car,
  'fuel' => LucideIcons.fuel,
  'shopping-bag' => LucideIcons.shoppingBag,
  'receipt' => LucideIcons.receipt,
  'house' => LucideIcons.house,
  'heart-pulse' => LucideIcons.heartPulse,
  'clapperboard' => LucideIcons.clapperboard,
  'repeat' => LucideIcons.repeat,
  'plane' => LucideIcons.plane,
  'graduation-cap' => LucideIcons.graduationCap,
  'sparkles' => LucideIcons.sparkles,
  'gift' => LucideIcons.gift,
  'trending-up' => LucideIcons.trendingUp,
  'badge-percent' => LucideIcons.badgePercent,
  'briefcase' => LucideIcons.briefcase,
  'undo-2' => LucideIcons.undo2,
  'plus-circle' => LucideIcons.circlePlus,
  'arrow-left-right' => LucideIcons.arrowLeftRight,
  _ => LucideIcons.circleDot,
};

extension CategoryLook on CategoryItem {
  IconData get iconData => categoryIcon(data['icon'] as String?);
}

/// A small, centred title bar for a sheet: the handle, a title, and an optional action on the right.
class SheetHead extends StatelessWidget {
  const SheetHead({super.key, required this.title, this.trailing, this.subtitle});
  final String title;
  final String? subtitle;
  final Widget? trailing;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 10, 10, 6),
      child: Column(
        children: [
          Container(
            width: 36,
            height: 4,
            decoration: BoxDecoration(color: l.c.track, borderRadius: BorderRadius.circular(2)),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: OrvText.heading(l)),
                    if (subtitle != null) Text(subtitle!, style: OrvText.muted(l).copyWith(fontSize: 12)),
                  ],
                ),
              ),
              ?trailing,
            ],
          ),
        ],
      ),
    );
  }
}

/// A segmented switch with a sliding thumb; each option can have its own colour.
class Segment<T> extends StatelessWidget {
  const Segment({super.key, required this.value, required this.options, required this.onChanged, this.dense = false});
  final T value;
  final List<(T, String, IconData?, Color?)> options;
  final ValueChanged<T> onChanged;
  final bool dense;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return Container(
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(color: l.c.track, borderRadius: BorderRadius.circular(OrvTokens.radiusFull)),
      child: Row(
        children: [
          for (final (v, label, icon, tone) in options)
            Expanded(
              child: Semantics(
                container: true,
                button: true,
                selected: v == value,
                label: label,
                excludeSemantics: true,
                child: GestureDetector(
                  onTap: () {
                    HapticFeedback.selectionClick();
                    onChanged(v);
                  },
                  child: AnimatedContainer(
                    duration: OrvTokens.durationFast,
                    height: dense ? 32 : 38,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: v == value ? (tone ?? l.c.glassStrong) : Colors.transparent,
                      borderRadius: BorderRadius.circular(OrvTokens.radiusFull),
                      boxShadow: v == value
                          ? [
                              BoxShadow(
                                color: Colors.black.withValues(alpha: 0.10),
                                blurRadius: 6,
                                offset: const Offset(0, 2),
                              ),
                            ]
                          : null,
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        if (icon != null) ...[
                          Icon(
                            icon,
                            size: 14,
                            color: v == value ? (tone != null ? Colors.white : l.c.text) : l.c.muted,
                          ),
                          const SizedBox(width: 5),
                        ],
                        Text(
                          label,
                          style: OrvText.body(l).copyWith(
                            fontSize: dense ? 12.5 : 13.5,
                            fontWeight: v == value ? FontWeight.w700 : FontWeight.w500,
                            color: v == value ? (tone != null ? Colors.white : l.c.text) : l.c.muted,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// The amount, big and centred, in the colour of where it goes: ₹ prefix, digits keyboard, no box. The field is as
/// wide as what's typed, so the ₹ hugs the number.
class AmountHero extends StatefulWidget {
  const AmountHero({super.key, required this.controller, required this.tone, this.autofocus = false});
  final TextEditingController controller;
  final Color tone;
  final bool autofocus;
  @override
  State<AmountHero> createState() => _AmountHeroState();
}

class _AmountHeroState extends State<AmountHero> {
  void _changed() => setState(() {});

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_changed);
  }

  @override
  void didUpdateWidget(AmountHero old) {
    super.didUpdateWidget(old);
    if (old.controller != widget.controller) {
      old.controller.removeListener(_changed);
      widget.controller.addListener(_changed);
    }
  }

  @override
  void dispose() {
    widget.controller.removeListener(_changed);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final style = OrvText.display(l)
        .copyWith(fontSize: 44, color: widget.tone, fontFeatures: const [FontFeature.tabularFigures()]);
    final text = widget.controller.text.isEmpty ? '0' : widget.controller.text;
    final painter = TextPainter(
      text: TextSpan(text: text, style: style),
      textDirection: TextDirection.ltr,
      textScaler: MediaQuery.textScalerOf(context),
      maxLines: 1,
    )..layout();
    return LayoutBuilder(
      builder: (context, box) {
        final width = (painter.width + 8).clamp(40.0, (box.maxWidth - 40).clamp(40.0, 320.0));
        return Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text('₹', style: OrvText.title(l).copyWith(fontSize: 30, color: widget.tone.withValues(alpha: 0.7))),
            const SizedBox(width: 4),
            SizedBox(
              width: width,
              child: TextField(
                key: const Key('money-amount'),
                controller: widget.controller,
                autofocus: widget.autofocus,
                textAlign: TextAlign.center,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]'))],
                style: style,
                decoration: const InputDecoration(
                  isDense: true,
                  hintText: '0',
                  border: InputBorder.none,
                  enabledBorder: InputBorder.none,
                  focusedBorder: InputBorder.none,
                  contentPadding: EdgeInsets.zero,
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}

/// Categories as a compact grid of coloured icons; the chosen one glows. Horizontal when there are many.
class CategoryPicker extends StatelessWidget {
  const CategoryPicker({super.key, required this.cats, required this.value, required this.onChanged, this.hint});
  final List<CategoryItem> cats;
  final String? value;
  final ValueChanged<String?> onChanged;
  final String? hint;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final rows = cats.length > 8 ? 2 : 1;
    return SizedBox(
      height: rows * 74.0,
      child: GridView.count(
        scrollDirection: Axis.horizontal,
        crossAxisCount: rows,
        mainAxisSpacing: 6,
        crossAxisSpacing: 4,
        childAspectRatio: 74 / 72,
        children: [
          for (final c in cats)
            Semantics(
              container: true,
              button: true,
              selected: c.id == value,
              label: c.name,
              excludeSemantics: true,
              child: GestureDetector(
                onTap: () {
                  HapticFeedback.selectionClick();
                  onChanged(c.id == value ? null : c.id);
                },
                child: Builder(
                  builder: (context) {
                    final on = c.id == value;
                    final tone = labelColour(l, c.colour);
                    return Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        AnimatedContainer(
                          duration: OrvTokens.durationFast,
                          width: 42,
                          height: 42,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: on ? tone : tone.withValues(alpha: l.dark ? 0.2 : 0.13),
                            boxShadow: on ? [BoxShadow(color: tone.withValues(alpha: 0.45), blurRadius: 12)] : null,
                          ),
                          child: Icon(c.iconData, size: 19, color: on ? Colors.white : tone),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          c.name.split(' ').first.replaceAll(',', ''),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: OrvText.muted(l).copyWith(
                            fontSize: 11,
                            fontWeight: on ? FontWeight.w700 : FontWeight.w500,
                            color: on ? l.c.text : l.c.muted,
                          ),
                        ),
                      ],
                    );
                  },
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// One line of a sheet: an icon, what it is, its value (or a placeholder), tap to change.
class SheetRow extends StatelessWidget {
  const SheetRow({
    super.key,
    required this.icon,
    required this.label,
    this.value,
    this.onTap,
    this.trailing,
    this.tone,
  });
  final IconData icon;
  final String label;
  final String? value;
  final VoidCallback? onTap;
  final Widget? trailing;
  final Color? tone;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return InkWell(
      borderRadius: BorderRadius.circular(OrvTokens.radiusSm),
      onTap: onTap == null
          ? null
          : () {
              HapticFeedback.selectionClick();
              onTap!();
            },
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 11, horizontal: 2),
        child: Row(
          children: [
            Icon(icon, size: 18, color: tone ?? l.c.muted),
            const SizedBox(width: 12),
            Text(label, style: OrvText.body(l).copyWith(fontSize: 14.5, color: l.c.muted)),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                value ?? '',
                textAlign: TextAlign.right,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: OrvText.body(l).copyWith(fontSize: 14.5, fontWeight: FontWeight.w600, color: tone),
              ),
            ),
            if (trailing != null) ...[const SizedBox(width: 6), trailing!],
            if (onTap != null && trailing == null) ...[
              const SizedBox(width: 4),
              Icon(LucideIcons.chevronRight, size: 16, color: l.c.faint),
            ],
          ],
        ),
      ),
    );
  }
}

/// A thin divider between sheet rows.
class SheetRule extends StatelessWidget {
  const SheetRule({super.key});
  @override
  Widget build(BuildContext context) => Divider(height: 1, thickness: 1, color: context.orv.c.hairline);
}

/// A field with no box of its own, for inside a sheet's card ("What for", notes).
class InlineField extends StatelessWidget {
  const InlineField({
    super.key,
    required this.controller,
    required this.hint,
    required this.icon,
    this.fieldKey,
    this.maxLines = 1,
    this.size = 15,
    this.bold = false,
  });
  final TextEditingController controller;
  final String hint;
  final IconData icon;
  final Key? fieldKey;
  final int maxLines;
  final double size;
  final bool bold;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return Row(
      crossAxisAlignment: maxLines > 1 ? CrossAxisAlignment.start : CrossAxisAlignment.center,
      children: [
        Padding(
          padding: EdgeInsets.only(top: maxLines > 1 ? 13 : 0),
          child: Icon(icon, size: 18, color: l.c.muted),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: TextField(
            key: fieldKey,
            controller: controller,
            minLines: 1,
            maxLines: maxLines,
            textCapitalization: TextCapitalization.sentences,
            style: OrvText.body(l).copyWith(fontSize: size, fontWeight: bold ? FontWeight.w600 : FontWeight.w500),
            decoration: InputDecoration(
              isDense: true,
              hintText: hint,
              hintStyle: OrvText.body(l).copyWith(fontSize: size, color: l.c.faint),
              border: InputBorder.none,
              enabledBorder: InputBorder.none,
              focusedBorder: InputBorder.none,
              contentPadding: const EdgeInsets.symmetric(vertical: 12),
            ),
          ),
        ),
      ],
    );
  }
}

/// A rounded card inside a sheet that holds rows.
class SheetCard extends StatelessWidget {
  const SheetCard({super.key, required this.children, this.padding});
  final List<Widget> children;
  final EdgeInsetsGeometry? padding;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return Container(
      padding: padding ?? const EdgeInsets.symmetric(horizontal: 12),
      decoration: BoxDecoration(
        color: l.c.field,
        borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
        border: Border.all(color: l.c.edge),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
    );
  }
}

/// ‹ November 2026 › — round buttons, the month in the middle; tap it for any month.
class MonthSwitcher extends StatelessWidget {
  const MonthSwitcher({super.key, required this.month, required this.thisMonth, required this.onChanged});
  final String month;
  final String thisMonth;
  final ValueChanged<String> onChanged;

  static String shift(String m, int n) {
    final d = DateTime(int.parse(m.substring(0, 4)), int.parse(m.substring(5, 7)) + n);
    return monthKey(d);
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final loc = MaterialLocalizations.of(context);
    final atNow = month == thisMonth;
    Widget arrow(IconData i, String tip, VoidCallback? tap) => Semantics(
      container: true,
      button: true,
      enabled: tap != null,
      label: tip,
      excludeSemantics: true,
      child: GestureDetector(
        onTap: tap == null
            ? null
            : () {
                HapticFeedback.selectionClick();
                tap();
              },
        child: AnimatedOpacity(
          duration: OrvTokens.durationFast,
          opacity: tap == null ? 0.3 : 1,
          child: Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: l.c.glassStrong,
              border: Border.all(color: l.c.edge),
            ),
            child: Icon(i, size: 17, color: l.c.text),
          ),
        ),
      ),
    );
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        arrow(LucideIcons.chevronLeft, 'Previous month', () => onChanged(shift(month, -1))),
        Semantics(
          container: true,
          button: true,
          label: 'Pick a month',
          child: GestureDetector(
            onTap: () async {
              final v = await showGlassSheet<String>(context, (_) => _MonthGrid(month: month, thisMonth: thisMonth));
              if (v != null) onChanged(v);
            },
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              margin: const EdgeInsets.symmetric(horizontal: 6),
              decoration: BoxDecoration(
                color: atNow ? Colors.transparent : l.accent.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(OrvTokens.radiusFull),
              ),
              child: Column(
                children: [
                  Text(
                    loc.formatMonthYear(DateTime.parse('$month-01')).split(' ').first,
                    style: OrvText.body(l)
                        .copyWith(fontWeight: FontWeight.w700, fontSize: 14.5, color: atNow ? null : l.accent),
                  ),
                  Text(month.substring(0, 4), style: OrvText.muted(l).copyWith(fontSize: 10.5)),
                ],
              ),
            ),
          ),
        ),
        arrow(LucideIcons.chevronRight, 'Next month', atNow ? null : () => onChanged(shift(month, 1))),
      ],
    );
  }
}

class _MonthGrid extends StatefulWidget {
  const _MonthGrid({required this.month, required this.thisMonth});
  final String month;
  final String thisMonth;
  @override
  State<_MonthGrid> createState() => _MonthGridState();
}

class _MonthGridState extends State<_MonthGrid> {
  late int _year = int.parse(widget.month.substring(0, 4));
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final loc = MaterialLocalizations.of(context);
    final maxYear = int.parse(widget.thisMonth.substring(0, 4));
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              IconButton(
                tooltip: 'Previous year',
                onPressed: () => setState(() => _year--),
                icon: Icon(LucideIcons.chevronLeft, color: l.c.text),
              ),
              Expanded(
                child: Center(child: Text('$_year', style: OrvText.heading(l))),
              ),
              IconButton(
                tooltip: 'Next year',
                onPressed: _year >= maxYear ? null : () => setState(() => _year++),
                icon: Icon(LucideIcons.chevronRight, color: l.c.text),
              ),
            ],
          ),
          const SizedBox(height: 6),
          GridView.count(
            shrinkWrap: true,
            crossAxisCount: 4,
            mainAxisSpacing: 8,
            crossAxisSpacing: 8,
            childAspectRatio: 1.9,
            physics: const NeverScrollableScrollPhysics(),
            children: [
              for (var m = 1; m <= 12; m++)
                Builder(
                  builder: (context) {
                    final key = '$_year-${m.toString().padLeft(2, '0')}';
                    final future = key.compareTo(widget.thisMonth) > 0;
                    final on = key == widget.month;
                    return GestureDetector(
                      onTap: future ? null : () => Navigator.of(context).pop(key),
                      child: AnimatedContainer(
                        duration: OrvTokens.durationFast,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          gradient: on ? l.accentGradient : null,
                          color: on ? null : l.c.field,
                          borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
                          border: Border.all(color: key == widget.thisMonth && !on ? l.accent : Colors.transparent),
                        ),
                        child: Text(
                          loc.formatMonthYear(DateTime(_year, m)).substring(0, 3),
                          style: OrvText.body(l).copyWith(
                            fontWeight: FontWeight.w600,
                            color: on ? Colors.white : (future ? l.c.faint : l.c.text),
                          ),
                        ),
                      ),
                    );
                  },
                ),
            ],
          ),
        ],
      ),
    );
  }
}
