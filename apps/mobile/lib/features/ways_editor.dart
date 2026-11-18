import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../app/reminder_ways.dart';
import '../design/theme.dart';

const _icons = {
  'push': LucideIcons.bell,
  'urgent': LucideIcons.bellRing,
  'alarm': LucideIcons.alarmClock,
  'email': LucideIcons.mail,
  'whatsapp': LucideIcons.messageCircle,
};

/// Choose any mix of ways a reminder reaches the person (D22); nothing chosen counts as a normal notification.
class WaysEditor extends StatelessWidget {
  const WaysEditor({super.key, required this.label, required this.value, required this.onChanged});
  final String label;
  final List<String>? value;
  final ValueChanged<List<String>> onChanged;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final on = waysOf(value);
    void toggle(String w) {
      final next = {...on};
      next.contains(w) ? next.remove(w) : next.add(w);
      if (next.isEmpty) next.add('push');
      onChanged([
        for (final x in reminderWays)
          if (next.contains(x)) x,
      ]);
    }

    return Semantics(
      container: true,
      label: label,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: OrvText.muted(l).copyWith(fontWeight: FontWeight.w600)),
          const SizedBox(height: 6),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final w in reminderWays)
                FilterChip(
                  avatar: Icon(_icons[w], size: 16, color: on.contains(w) ? l.accent : l.c.muted),
                  label: Text(wayLabels[w]!),
                  selected: on.contains(w),
                  showCheckmark: false,
                  onSelected: (_) => toggle(w),
                  selectedColor: l.accent.withValues(alpha: 0.16),
                  side: BorderSide(color: on.contains(w) ? l.accent : l.c.edge),
                  backgroundColor: Colors.transparent,
                ),
            ],
          ),
          const SizedBox(height: 4),
          Text(on.map((w) => wayHelp[w]!).join(' '), style: OrvText.muted(l).copyWith(fontSize: 12)),
        ],
      ),
    );
  }
}
