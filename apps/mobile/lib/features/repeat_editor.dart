import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../app/repeat.dart';
import '../design/theme.dart';

/// One repeat editor for everything that repeats (scheduled money now, tasks and events next): never / every day / week
/// / month / year, every N, which weekdays, which day of the month, when it ends — with a plain summary and the next
/// dates, so a rule is never a surprise. [value] is an RRULE ('' = doesn't repeat).
class RepeatEditor extends StatelessWidget {
  const RepeatEditor({
    super.key,
    required this.value,
    required this.onChanged,
    required this.startDate,
    this.allowNone = true,
  });
  final String value;
  final ValueChanged<String> onChanged;
  final String startDate;
  final bool allowNone;

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final spec = value.isEmpty ? null : parseRepeat(value);
    final custom = value.isNotEmpty && spec == null; // a rule the editor can't show: kept as it is
    void set(RepeatSpec s) => onChanged(buildRepeat(s));
    ChoiceChip chip(String label, bool on, VoidCallback tap) => ChoiceChip(
      label: Text(label),
      selected: on,
      showCheckmark: false,
      onSelected: (_) {
        HapticFeedback.selectionClick();
        tap();
      },
      selectedColor: l.accent.withValues(alpha: 0.16),
      side: BorderSide(color: on ? l.accent : l.c.edge),
      backgroundColor: Colors.transparent,
    );
    final preview = value.isEmpty ? const <String>[] : nextDates(value, startDate, 5);
    final names = {'DAILY': 'day', 'WEEKLY': 'week', 'MONTHLY': 'month', 'YEARLY': 'year'};

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            if (allowNone) chip('Never', value.isEmpty, () => onChanged('')),
            for (final f in freqs)
              chip(
                {'DAILY': 'Daily', 'WEEKLY': 'Weekly', 'MONTHLY': 'Monthly', 'YEARLY': 'Yearly'}[f]!,
                spec?.freq == f,
                () => set(RepeatSpec.forStart(f, startDate)),
              ),
            if (custom) chip('Custom', true, () {}),
          ],
        ),
        if (spec != null) ...[
          const SizedBox(height: 10),
          Row(
            children: [
              Text('Every', style: OrvText.body(l)),
              IconButton(
                tooltip: 'Fewer',
                onPressed: spec.interval > 1 ? () => set(spec.copy()..interval = spec.interval - 1) : null,
                icon: const Icon(Icons.remove_circle_outline),
              ),
              Text('${spec.interval}', style: OrvText.heading(l)),
              IconButton(
                tooltip: 'More',
                onPressed: spec.interval < 99 ? () => set(spec.copy()..interval = spec.interval + 1) : null,
                icon: const Icon(Icons.add_circle_outline),
              ),
              Text('${names[spec.freq]}${spec.interval > 1 ? 's' : ''}', style: OrvText.body(l)),
            ],
          ),
          if (spec.freq == 'WEEKLY')
            Wrap(
              spacing: 6,
              children: [
                for (final d in weekdays)
                  Semantics(
                    label: {
                      'MO': 'Monday',
                      'TU': 'Tuesday',
                      'WE': 'Wednesday',
                      'TH': 'Thursday',
                      'FR': 'Friday',
                      'SA': 'Saturday',
                      'SU': 'Sunday',
                    }[d],
                    selected: spec.days.contains(d),
                    button: true,
                    excludeSemantics: true,
                    child: GestureDetector(
                      onTap: () {
                        final next = spec.days.contains(d)
                            ? (spec.days.where((x) => x != d).toList())
                            : [...spec.days, d];
                        if (next.isNotEmpty) set(spec.copy()..days = next);
                      },
                      child: Container(
                        width: 40,
                        height: 40,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: spec.days.contains(d) ? l.accent : Colors.transparent,
                          border: Border.all(color: spec.days.contains(d) ? l.accent : l.c.edge),
                        ),
                        child: Text(
                          d[0],
                          style: OrvText.body(l).copyWith(
                            color: spec.days.contains(d) ? Colors.white : l.c.muted,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          if (spec.freq == 'MONTHLY') ...[
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                chip('On a date', spec.nth == null, () => set(spec.copy()..nth = null)),
                chip('On a weekday', spec.nth != null, () => set(spec.copy()..nth = 1)),
              ],
            ),
            const SizedBox(height: 6),
            if (spec.nth == null)
              DropdownButton<int>(
                value: spec.monthDay,
                isExpanded: true,
                items: [
                  for (var d = 1; d <= 31; d++) DropdownMenuItem(value: d, child: Text('Day $d')),
                  const DropdownMenuItem(value: -1, child: Text('Last day')),
                ],
                onChanged: (v) => v == null ? null : set(spec.copy()..monthDay = v),
              )
            else
              Row(
                children: [
                  Expanded(
                    child: DropdownButton<int>(
                      value: spec.nth,
                      isExpanded: true,
                      items: [
                        for (final n in [1, 2, 3, 4, -1])
                          DropdownMenuItem(
                            value: n,
                            child: Text(n == -1 ? 'Last' : ['', '1st', '2nd', '3rd', '4th'][n]),
                          ),
                      ],
                      onChanged: (v) => v == null ? null : set(spec.copy()..nth = v),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: DropdownButton<String>(
                      value: spec.nthDay,
                      isExpanded: true,
                      items: [
                        for (final d in weekdays)
                          DropdownMenuItem(
                            value: d,
                            child: Text(
                              {
                                'MO': 'Monday',
                                'TU': 'Tuesday',
                                'WE': 'Wednesday',
                                'TH': 'Thursday',
                                'FR': 'Friday',
                                'SA': 'Saturday',
                                'SU': 'Sunday',
                              }[d]!,
                            ),
                          ),
                      ],
                      onChanged: (v) => v == null ? null : set(spec.copy()..nthDay = v),
                    ),
                  ),
                ],
              ),
          ],
          const SizedBox(height: 8),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text('Ends', style: OrvText.muted(l)),
              chip('Never', spec.endKind == 'never', () => set(spec.copy()..endKind = 'never')),
              chip(spec.endKind == 'until' && spec.until != null ? 'On ${spec.until}' : 'On a date', spec.endKind == 'until', () async {
                final start = DateTime.parse(startDate);
                final picked = await showDatePicker(
                  context: context,
                  initialDate: spec.until == null ? DateTime(start.year, 12, 31) : DateTime.parse(spec.until!),
                  firstDate: start,
                  lastDate: DateTime(start.year + 30),
                );
                if (picked != null) {
                  set(
                    spec.copy()
                      ..endKind = 'until'
                      ..until =
                          '${picked.year}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}',
                  );
                }
              }),
              chip(
                spec.endKind == 'count' ? 'After ${spec.count} times' : 'After some times',
                spec.endKind == 'count',
                () => set(spec.copy()..endKind = 'count'),
              ),
              if (spec.endKind == 'count') ...[
                IconButton(
                  tooltip: 'Fewer times',
                  onPressed: spec.count > 1 ? () => set(spec.copy()..count = spec.count - 1) : null,
                  icon: const Icon(Icons.remove_circle_outline),
                ),
                IconButton(
                  tooltip: 'More times',
                  onPressed: spec.count < 999 ? () => set(spec.copy()..count = spec.count + 1) : null,
                  icon: const Icon(Icons.add_circle_outline),
                ),
              ],
            ],
          ),
        ],
        if (value.isNotEmpty) ...[
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(color: l.c.track, borderRadius: BorderRadius.circular(12)),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  spec == null ? 'Custom repeat (set elsewhere)' : describeSpec(spec),
                  style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600),
                ),
                Text(
                  preview.isEmpty ? 'No dates yet from $startDate.' : 'Next: ${preview.join(' · ')}',
                  style: OrvText.muted(l),
                ),
              ],
            ),
          ),
        ],
      ],
    );
  }
}
