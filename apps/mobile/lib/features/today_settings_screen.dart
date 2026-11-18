import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../app/platform.dart';
import '../app/state.dart';
import '../app/today.dart';
import '../app/today_settings.dart';
import '../design/controls.dart';
import '../design/glass.dart';
import '../design/theme.dart';
import '../design/toast.dart';
import 'common.dart';
import 'ways_editor.dart';

const _dayNames = {'mon': 'Mon', 'tue': 'Tue', 'wed': 'Wed', 'thu': 'Thu', 'fri': 'Fri', 'sat': 'Sat', 'sun': 'Sun'};

String _hhmm(TimeOfDay t) => '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
TimeOfDay _tod(String s) => TimeOfDay(hour: int.parse(s.substring(0, 2)), minute: int.parse(s.substring(3, 5)));
Map<String, dynamic> _copy(Map<String, dynamic> m) => jsonDecode(jsonEncode(m)) as Map<String, dynamic>;

/// Settings → Today (D15–D17): working patterns that start on a date, days that are different, reminder defaults.
class TodaySettingsScreen extends ConsumerStatefulWidget {
  const TodaySettingsScreen({super.key});
  @override
  ConsumerState<TodaySettingsScreen> createState() => _TodaySettingsScreenState();
}

class _TodaySettingsScreenState extends ConsumerState<TodaySettingsScreen> {
  Map<String, dynamic>? _draft;
  bool _dirty = false;
  bool _saved = false;

  @override
  Widget build(BuildContext context) {
    final saved = ref.watch(todaySettingsProvider);
    final current = saved.value;
    _saved = current != null;
    if (_draft == null || (!_dirty && current != null)) {
      final base = current ?? startingSettings('Asia/Kolkata');
      _draft = _copy(base);
      if (current == null) {
        localTimeZone().then((z) => mounted && !_dirty ? setState(() => _draft!['timeZone'] = z) : null);
      }
    }
    final d = _draft!;
    final l = context.orv;
    final problem = settingsProblem(d);
    void edit(VoidCallback f) => setState(() {
      f();
      _dirty = true;
    });
    final today = dayKey(ref.watch(clockProvider)());
    final patterns = (d['patterns'] as List).cast<Map<String, dynamic>>()
      ..sort((a, b) => (a['validFrom'] as String).compareTo(b['validFrom'] as String));
    final nowFrom = patterns.lastWhere(
      (p) => (p['validFrom'] as String).compareTo(today) <= 0,
      orElse: () => patterns.first,
    )['validFrom'];
    final loc = MaterialLocalizations.of(context);
    String fmt(String day) => loc.formatMediumDate(DateTime.parse(day));

    return OrvModule(
      module: 'today',
      child: Scaffold(
        body: SafeArea(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 40),
            children: [
              Row(
                children: [
                  IconButton(
                    onPressed: () => context.pop(),
                    icon: Icon(LucideIcons.arrowLeft, color: l.c.text),
                    tooltip: 'Back',
                  ),
                  const Expanded(child: PageTitle('Working hours & reminders')),
                ],
              ),
              if (!_saved)
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Glass(
                    padding: const EdgeInsets.all(14),
                    child: Text(
                      'Not set up yet. These are suggestions only — nothing is used until you save.',
                      style: OrvText.body(l),
                    ),
                  ),
                ),
              const SectionLabel('Working hours'),
              const SizedBox(height: 8),
              for (final p in patterns)
                _PatternCard(
                  key: ValueKey(p['validFrom']),
                  pattern: p,
                  badge: p['validFrom'] == nowFrom
                      ? 'Now'
                      : (p['validFrom'] as String).compareTo(today) > 0
                      ? 'From ${fmt(p['validFrom'] as String)}'
                      : 'Earlier',
                  onChanged: () => edit(() {}),
                  onRemove: patterns.length > 1 ? () => edit(() => (d['patterns'] as List).remove(p)) : null,
                ),
              OrvButton(
                label: 'Hours change from a date…',
                icon: LucideIcons.calendarClock,
                onPressed: () async {
                  final now = ref.read(clockProvider)();
                  final picked = await showDatePicker(
                    context: context,
                    initialDate: now.add(const Duration(days: 7)),
                    firstDate: now,
                    lastDate: now.add(const Duration(days: 365 * 3)),
                  );
                  if (picked == null) return;
                  final key = dayKey(picked);
                  if (patterns.any((p) => p['validFrom'] == key)) return;
                  final from = patterns.firstWhere((p) => p['validFrom'] == nowFrom);
                  edit(
                    () => (d['patterns'] as List).add({
                      'validFrom': key,
                      'week': _copy(from['week'] as Map<String, dynamic>),
                    }),
                  );
                },
              ),
              const SizedBox(height: 18),
              const SectionLabel('Days that are different'),
              const SizedBox(height: 8),
              for (final o
                  in (d['dayOverrides'] as List)
                      .cast<Map<String, dynamic>>()
                      .where((o) => (o['date'] as String).compareTo(today) >= 0)
                      .toList()
                    ..sort((a, b) => (a['date'] as String).compareTo(b['date'] as String)))
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Glass(
                    blur: false,
                    padding: const EdgeInsets.all(10),
                    child: Row(
                      children: [
                        SizedBox(
                          width: 96,
                          child: Text(
                            fmt(o['date'] as String),
                            style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600),
                          ),
                        ),
                        Expanded(
                          child: _RangesEditor(
                            ranges: o['ranges'] as List,
                            label: fmt(o['date'] as String),
                            onChanged: () => edit(() {}),
                          ),
                        ),
                        IconButton(
                          tooltip: 'Remove ${fmt(o['date'] as String)}',
                          icon: Icon(LucideIcons.x, size: 18, color: l.c.muted),
                          onPressed: () => edit(() => (d['dayOverrides'] as List).remove(o)),
                        ),
                      ],
                    ),
                  ),
                ),
              Wrap(
                spacing: 8,
                children: [
                  for (final (label, ranges) in const [
                    ('Day off…', <Map<String, String>>[]),
                    (
                      'Different hours…',
                      [
                        {'start': '10:00', 'end': '14:00'},
                      ],
                    ),
                  ])
                    OrvButton(
                      small: true,
                      label: label,
                      onPressed: () async {
                        final now = ref.read(clockProvider)();
                        final picked = await showDatePicker(
                          context: context,
                          initialDate: now,
                          firstDate: now,
                          lastDate: now.add(const Duration(days: 365 * 2)),
                        );
                        if (picked == null) return;
                        final key = dayKey(picked);
                        final list = d['dayOverrides'] as List;
                        if (list.any((o) => (o as Map)['date'] == key)) return;
                        edit(
                          () => list.add({
                            'date': key,
                            'ranges': [for (final r in ranges) Map<String, String>.from(r)],
                          }),
                        );
                      },
                    ),
                ],
              ),
              const SizedBox(height: 18),
              const SectionLabel('Planning'),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(child: Text('Gap between planned items', style: OrvText.body(l))),
                  _Stepper(value: d['bufferMin'] as int, onChanged: (v) => edit(() => d['bufferMin'] = v)),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(child: Text('Don’t plan after', style: OrvText.body(l))),
                  OrvButton(
                    small: true,
                    label: d['noPlanAfter'] as String,
                    onPressed: () async {
                      final t = await showTimePicker(context: context, initialTime: _tod(d['noPlanAfter'] as String));
                      if (t != null) edit(() => d['noPlanAfter'] = _hhmm(t));
                    },
                  ),
                ],
              ),
              const SizedBox(height: 4),
              Text('Time zone: ${d['timeZone']}', style: OrvText.muted(l)),
              const SizedBox(height: 18),
              const SectionLabel('Reminders'),
              const SizedBox(height: 8),
              LeadTimesEditor(
                label: 'For things with a time',
                value: ((d['reminders'] as Map)['timed'] as List).cast<int>(),
                onChanged: (v) => edit(() => (d['reminders'] as Map)['timed'] = v),
              ),
              const SizedBox(height: 10),
              WaysEditor(
                label: 'Remind me by',
                value: ((d['reminders'] as Map)['via'] as List?)?.cast<String>(),
                onChanged: (v) => edit(() => (d['reminders'] as Map)['via'] = v),
              ),
              const SizedBox(height: 12),
              Text('For things with only a date', style: OrvText.muted(l).copyWith(fontWeight: FontWeight.w600)),
              const SizedBox(height: 6),
              Builder(
                builder: (context) {
                  final dateOnly = (d['reminders'] as Map)['dateOnly'] as Map;
                  return Wrap(
                    spacing: 6,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      for (final (mode, name) in const [
                        ('digest', 'One summary'),
                        ('ping', 'Each task'),
                        ('none', 'Nothing'),
                      ])
                        ChoiceChip(
                          label: Text(name),
                          selected: dateOnly['mode'] == mode,
                          showCheckmark: false,
                          onSelected: (_) => edit(
                            () => (d['reminders'] as Map)['dateOnly'] = mode == 'none'
                                ? {'mode': 'none'}
                                : {'mode': mode, 'at': dateOnly['at'] ?? '09:00'},
                          ),
                        ),
                      if (dateOnly['mode'] != 'none')
                        OrvButton(
                          small: true,
                          label: 'at ${dateOnly['at']}',
                          onPressed: () async {
                            final t = await showTimePicker(
                              context: context,
                              initialTime: _tod(dateOnly['at'] as String),
                            );
                            if (t != null) edit(() => dateOnly['at'] = _hhmm(t));
                          },
                        ),
                    ],
                  );
                },
              ),
              if ((d['reminders'] as Map)['dateOnly']['mode'] != 'none') ...[
                const SizedBox(height: 10),
                WaysEditor(
                  label: 'Send the summary by',
                  value: ((d['reminders'] as Map)['dateOnlyVia'] as List?)?.cast<String>(),
                  onChanged: (v) => edit(() => (d['reminders'] as Map)['dateOnlyVia'] = v),
                ),
              ],
              const SizedBox(height: 8),
              OrvSwitchRow(
                label: 'Include overdue tasks in the summary',
                value: (d['reminders'] as Map)['overdueInDigest'] as bool,
                onChanged: (v) => edit(() => (d['reminders'] as Map)['overdueInDigest'] = v),
              ),
              const SizedBox(height: 20),
              if (problem != null) Text(problem, style: OrvText.muted(l).copyWith(color: l.c.danger)),
              const SizedBox(height: 8),
              OrvButton(
                label: _saved ? 'Save' : 'Use these settings',
                variant: ButtonVariant.primary,
                expand: true,
                onPressed: problem != null || (_saved && !_dirty)
                    ? null
                    : () async {
                        final toaster = Toaster.of(context);
                        await saveTodaySettings(ref, d);
                        setState(() => _dirty = false);
                        toaster.show('Saved', body: 'Used on all your devices.', tone: ToastTone.success);
                      },
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PatternCard extends StatelessWidget {
  const _PatternCard({super.key, required this.pattern, required this.badge, required this.onChanged, this.onRemove});
  final Map<String, dynamic> pattern;
  final String badge;
  final VoidCallback onChanged;
  final VoidCallback? onRemove;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final week = pattern['week'] as Map;
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Glass(
        padding: const EdgeInsets.fromLTRB(12, 10, 6, 10),
        child: Semantics(
          container: true,
          label: 'Working pattern $badge',
          explicitChildNodes: true,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  OrvBadge(badge, tone: badge == 'Now' ? l.accent : null),
                  const Spacer(),
                  if (onRemove != null)
                    OrvButton(label: 'Remove', small: true, variant: ButtonVariant.ghost, onPressed: onRemove),
                ],
              ),
              for (final day in weekdays)
                Row(
                  children: [
                    SizedBox(
                      width: 44,
                      child: Text(_dayNames[day]!, style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600)),
                    ),
                    Expanded(
                      child: _RangesEditor(
                        ranges: week[day] as List,
                        label: '$badge ${_dayNames[day]}',
                        onChanged: onChanged,
                      ),
                    ),
                  ],
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _RangesEditor extends StatelessWidget {
  const _RangesEditor({required this.ranges, required this.label, required this.onChanged});
  final List<dynamic> ranges;
  final String label;
  final VoidCallback onChanged;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    Future<void> pick(Map<dynamic, dynamic> r, String key) async {
      final t = await showTimePicker(context: context, initialTime: _tod(r[key] as String));
      if (t != null) {
        r[key] = _hhmm(t);
        onChanged();
      }
    }

    return Wrap(
      spacing: 4,
      runSpacing: 4,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        if (ranges.isEmpty) Text('Off', style: OrvText.muted(l)),
        for (var i = 0; i < ranges.length; i++)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 4),
            decoration: BoxDecoration(
              border: Border.all(color: l.c.edge),
              borderRadius: BorderRadius.circular(OrvTokens.radiusSm),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextButton(
                  onPressed: () => pick(ranges[i] as Map, 'start'),
                  child: Text((ranges[i] as Map)['start'] as String),
                ),
                const Text('–'),
                TextButton(
                  onPressed: () => pick(ranges[i] as Map, 'end'),
                  child: Text((ranges[i] as Map)['end'] as String),
                ),
                IconButton(
                  visualDensity: VisualDensity.compact,
                  tooltip: 'Remove $label range ${i + 1}',
                  icon: Icon(LucideIcons.x, size: 14, color: l.c.muted),
                  onPressed: () {
                    ranges.removeAt(i);
                    onChanged();
                  },
                ),
              ],
            ),
          ),
        IconButton(
          visualDensity: VisualDensity.compact,
          tooltip: 'Add $label range',
          icon: Icon(LucideIcons.plus, size: 18, color: l.accent),
          onPressed: () {
            final start = ranges.isEmpty ? '09:00' : (ranges.last as Map)['end'] as String;
            final h = (int.parse(start.substring(0, 2)) + 1).clamp(0, 23);
            ranges.add({
              'start': start,
              'end': '${h.toString().padLeft(2, '0')}:${h == 23 ? '59' : start.substring(3)}',
            });
            onChanged();
          },
        ),
      ],
    );
  }
}

class _Stepper extends StatelessWidget {
  const _Stepper({required this.value, required this.onChanged});
  final int value;
  final ValueChanged<int> onChanged;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        IconButton(
          tooltip: 'Less',
          onPressed: value <= 0 ? null : () => onChanged((value - 5).clamp(0, 120)),
          icon: Icon(LucideIcons.minus, size: 16, color: l.c.text),
        ),
        Text('$value min', style: OrvText.body(l)),
        IconButton(
          tooltip: 'More',
          onPressed: value >= 120 ? null : () => onChanged((value + 5).clamp(0, 120)),
          icon: Icon(LucideIcons.plus, size: 16, color: l.c.text),
        ),
      ],
    );
  }
}

/// Reminder lead times as chips; used by settings and by a task's own reminders.
class LeadTimesEditor extends StatelessWidget {
  const LeadTimesEditor({super.key, required this.label, required this.value, required this.onChanged});
  final String label;
  final List<int> value;
  final ValueChanged<List<int>> onChanged;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: OrvText.muted(l).copyWith(fontWeight: FontWeight.w600)),
        const SizedBox(height: 6),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            if (value.isEmpty) Text('No reminder', style: OrvText.muted(l)),
            for (final m in value)
              InputChip(
                label: Text(leadLabel(m)),
                onDeleted: () => onChanged([...value]..remove(m)),
                deleteButtonTooltipMessage: 'Remove ${leadLabel(m)}',
              ),
            if (value.length < 5)
              PopupMenuButton<int>(
                tooltip: 'Add a reminder',
                onSelected: (m) => onChanged(([...value, m]..sort((a, b) => b.compareTo(a)))),
                itemBuilder: (_) => [
                  for (final m in leadChoices.where((m) => !value.contains(m)))
                    PopupMenuItem(value: m, child: Text(leadLabel(m))),
                ],
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(LucideIcons.plus, size: 16, color: l.accent),
                      Text(' add', style: OrvText.body(l).copyWith(color: l.accent)),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ],
    );
  }
}
