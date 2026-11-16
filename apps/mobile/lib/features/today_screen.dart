import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../app/state.dart';
import '../app/today.dart';
import '../design/controls.dart';
import '../design/glass.dart';
import '../design/theme.dart';
import 'common.dart';
import 'sheets.dart';

/// Today (spec 0002, M1): quick add, overdue / today / upcoming / inbox / done, settle on complete, task sheet.
class TodayScreen extends ConsumerStatefulWidget {
  const TodayScreen({super.key});
  @override
  ConsumerState<TodayScreen> createState() => _TodayScreenState();
}

class _TodayScreenState extends ConsumerState<TodayScreen> {
  @override
  Widget build(BuildContext context) {
    final now = ref.watch(clockProvider)();
    final tasks = ref.watch(tasksProvider);
    final loc = MaterialLocalizations.of(context);
    return OrvModule(
      module: 'today',
      child: Builder(
        builder: (context) {
          final l = context.orv;
          return RefreshIndicator(
            color: l.accent,
            onRefresh: () => ref.read(syncProvider).sync().catchError((Object _) {}),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 56, 16, 120),
              children: [
                PageTitle('Today', overline: loc.formatFullDate(now)),
                const _QuickAdd(),
                const SizedBox(height: 14),
                switch (tasks) {
                  AsyncData(:final value) => _Sections(groups: groupTasks(value, now), now: now),
                  AsyncError() => Text('Couldn’t read your tasks.', style: OrvText.muted(l)),
                  _ => const SizedBox(height: 120),
                },
              ],
            ),
          );
        },
      ),
    );
  }
}

class _QuickAdd extends ConsumerStatefulWidget {
  const _QuickAdd();
  @override
  ConsumerState<_QuickAdd> createState() => _QuickAddState();
}

enum _When { today, tomorrow, someday }

class _QuickAddState extends ConsumerState<_QuickAdd> {
  final _c = TextEditingController();
  _When _when = _When.today;

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  Future<void> _add() async {
    final title = _c.text.trim();
    if (title.isEmpty) return;
    final now = ref.read(clockProvider)();
    final due = switch (_when) {
      _When.today => dayKey(now),
      _When.tomorrow => dayKey(now.add(const Duration(days: 1))),
      _When.someday => null,
    };
    unawaited(HapticFeedback.lightImpact());
    await ref.read(todayActionsProvider).add(title, dueDate: due);
    _c.clear();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return Glass(
      level: GlassLevel.float,
      padding: const EdgeInsets.fromLTRB(14, 6, 8, 10),
      child: Column(
        children: [
          Row(
            children: [
              Icon(LucideIcons.plus, color: l.accent, size: 20),
              const SizedBox(width: 8),
              Expanded(
                child: TextField(
                  key: const Key('quick-add'),
                  controller: _c,
                  textInputAction: TextInputAction.done,
                  onSubmitted: (_) => _add(),
                  style: OrvText.body(l).copyWith(fontSize: 16),
                  decoration: InputDecoration(
                    hintText: 'Add a task…',
                    hintStyle: OrvText.body(l).copyWith(color: l.c.faint, fontSize: 16),
                    border: InputBorder.none,
                  ),
                ),
              ),
            ],
          ),
          Row(
            children: [
              for (final w in _When.values)
                Padding(
                  padding: const EdgeInsets.only(right: 6),
                  child: ChoiceChip(
                    label: Text(switch (w) {
                      _When.today => 'Today',
                      _When.tomorrow => 'Tomorrow',
                      _When.someday => 'Someday',
                    }),
                    selected: _when == w,
                    onSelected: (_) => setState(() => _when = w),
                    showCheckmark: false,
                    selectedColor: l.accent.withValues(alpha: 0.16),
                    side: BorderSide(color: _when == w ? l.accent : l.c.edge),
                    labelStyle: OrvText.muted(l)
                        .copyWith(color: _when == w ? l.accent : l.c.muted, fontWeight: FontWeight.w600),
                    backgroundColor: Colors.transparent,
                  ),
                ),
              const Spacer(),
              OrvButton(label: 'Add', small: true, variant: ButtonVariant.primary, onPressed: _add),
            ],
          ),
        ],
      ),
    );
  }
}

class _Sections extends StatelessWidget {
  const _Sections({required this.groups, required this.now});
  final TaskGroups groups;
  final DateTime now;
  @override
  Widget build(BuildContext context) {
    final g = groups;
    return Column(
      children: [
        if (g.overdue.isNotEmpty) _Section('Overdue', g.overdue, now: now, danger: true),
        _Section('Today', g.today, now: now, empty: 'Nothing planned for today. Add something above, or enjoy it.'),
        if (g.upcoming.isNotEmpty) _Section('Upcoming', g.upcoming, now: now),
        _Section('Inbox', g.inbox, now: now, empty: 'Inbox zero.'),
        if (g.doneToday.isNotEmpty) _Section('Done today', g.doneToday, now: now),
      ],
    );
  }
}

class _Section extends StatelessWidget {
  const _Section(this.title, this.items, {required this.now, this.empty, this.danger = false});
  final String title;
  final List<TaskItem> items;
  final DateTime now;
  final String? empty;
  final bool danger;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Glass(
        padding: const EdgeInsets.fromLTRB(10, 14, 10, 8),
        child: Semantics(
          container: true,
          label: '$title list',
          explicitChildNodes: true,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 6),
                child: Row(
                  children: [
                    Text(title.toUpperCase(), style: OrvText.label(l).copyWith(color: danger ? l.c.danger : l.accent)),
                    const SizedBox(width: 8),
                    if (items.isNotEmpty) Text('${items.length}', style: OrvText.muted(l)),
                  ],
                ),
              ),
              const SizedBox(height: 6),
              for (final t in items) _TaskRow(key: ValueKey(t.id), task: t, now: now),
              if (items.isEmpty && empty != null)
                Padding(
                  padding: const EdgeInsets.fromLTRB(6, 2, 6, 8),
                  child: Text(empty!, style: OrvText.muted(l)),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _TaskRow extends ConsumerStatefulWidget {
  const _TaskRow({super.key, required this.task, required this.now});
  final TaskItem task;
  final DateTime now;
  @override
  ConsumerState<_TaskRow> createState() => _TaskRowState();
}

class _TaskRowState extends ConsumerState<_TaskRow> {
  bool _settling = false;

  Future<void> _toggle() async {
    final done = widget.task.completedAt != null;
    if (!done) {
      unawaited(HapticFeedback.mediumImpact()); // the "settle" tick
      setState(() => _settling = true);
      await Future<void>.delayed(context.reduceMotion ? Duration.zero : const Duration(milliseconds: 380));
    }
    await ref.read(todayActionsProvider).complete(widget.task.id, !done);
    if (mounted) setState(() => _settling = false);
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final t = widget.task;
    final done = t.completedAt != null;
    final projects = ref.watch(projectNamesProvider).value ?? const {};
    final moment = t.moment;
    final loc = MaterialLocalizations.of(context);
    final meta = [
      if (moment != null) loc.formatTimeOfDay(TimeOfDay.fromDateTime(moment)),
      if (moment == null && t.dueDate != null && t.dueDate != dayKey(widget.now)) _shortDate(t.dueDate!, loc),
      if (t.projectId != null && projects[t.projectId] != null) projects[t.projectId]!,
      if (t.repeats) 'repeats',
    ].join(' · ');
    final late = moment != null && moment.isBefore(widget.now) && !done;
    return InkWell(
      borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
      onTap: () => showGlassSheet<void>(context, (_) => _TaskSheet(task: t)),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 8),
        child: Row(
          children: [
            Semantics(
              container: true,
              checked: done,
              label: '${done ? 'Mark not done' : 'Complete'} ${t.title}',
              excludeSemantics: true,
              child: GestureDetector(
                onTap: _toggle,
                child: AnimatedContainer(
                  duration: OrvTokens.durationBase,
                  curve: springSnappy,
                  width: 26,
                  height: 26,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: done || _settling ? l.accentGradient : null,
                    border: Border.all(color: done || _settling ? Colors.transparent : l.c.edge, width: 2),
                    boxShadow: _settling
                        ? [BoxShadow(color: l.accentFrom.withValues(alpha: 0.6), blurRadius: 18, spreadRadius: 4)]
                        : null,
                  ),
                  child: done || _settling ? const Icon(Icons.check_rounded, size: 16, color: Colors.white) : null,
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    t.title,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: OrvText.body(l).copyWith(
                      fontWeight: done ? FontWeight.w400 : FontWeight.w600,
                      color: done ? l.c.muted : l.c.text,
                      decoration: done ? TextDecoration.lineThrough : null,
                    ),
                  ),
                  if (meta.isNotEmpty)
                    Text(meta, style: OrvText.muted(l).copyWith(fontSize: 12, color: late ? l.c.danger : l.c.muted)),
                ],
              ),
            ),
            if (t.priority >= 2)
              Semantics(
                label: t.priority == 3 ? 'High priority' : 'Medium priority',
                child: Icon(LucideIcons.flag, size: 16, color: t.priority == 3 ? l.c.danger : l.c.warning),
              ),
          ],
        ),
      ),
    );
  }

  static String _shortDate(String day, MaterialLocalizations loc) => loc.formatShortMonthDay(DateTime.parse(day));
}

class _TaskSheet extends ConsumerStatefulWidget {
  const _TaskSheet({required this.task});
  final TaskItem task;
  @override
  ConsumerState<_TaskSheet> createState() => _TaskSheetState();
}

class _TaskSheetState extends ConsumerState<_TaskSheet> {
  late final _title = TextEditingController(text: widget.task.title);
  late final _notes = TextEditingController(text: widget.task.notes);
  late String? _day = widget.task.day;
  late TimeOfDay? _time = widget.task.dueAt == null ? null : TimeOfDay.fromDateTime(widget.task.dueAt!);
  late int _priority = widget.task.priority;

  @override
  void dispose() {
    _title.dispose();
    _notes.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    String? dueDate;
    String? dueAt;
    if (_day != null) {
      final d = DateTime.parse(_day!);
      if (_time != null) {
        dueAt = DateTime(d.year, d.month, d.day, _time!.hour, _time!.minute).toUtc().toIso8601String();
      } else {
        dueDate = _day;
      }
    }
    await ref.read(todayActionsProvider).update(widget.task.id, {
      'title': _title.text.trim().isEmpty ? widget.task.title : _title.text.trim(),
      'notes': _notes.text,
      'dueDate': dueDate,
      'dueAt': dueAt,
      'priority': _priority,
    });
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final loc = MaterialLocalizations.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Task', style: OrvText.heading(l)),
          const SizedBox(height: 12),
          OrvField(label: 'Title', controller: _title),
          const SizedBox(height: 12),
          Row(
            children: [
              OrvButton(
                small: true,
                icon: LucideIcons.calendar,
                label: _day == null ? 'No day' : loc.formatShortMonthDay(DateTime.parse(_day!)),
                onPressed: () async {
                  final now = ref.read(clockProvider)();
                  final d = await showDatePicker(
                    context: context,
                    initialDate: _day == null ? now : DateTime.parse(_day!),
                    firstDate: now.subtract(const Duration(days: 365)),
                    lastDate: now.add(const Duration(days: 365 * 5)),
                  );
                  if (d != null) setState(() => _day = dayKey(d));
                },
              ),
              const SizedBox(width: 8),
              OrvButton(
                small: true,
                icon: LucideIcons.clock,
                label: _time == null ? 'Any time' : loc.formatTimeOfDay(_time!),
                onPressed: _day == null
                    ? null
                    : () async {
                        final t = await showTimePicker(
                          context: context,
                          initialTime: _time ?? const TimeOfDay(hour: 9, minute: 0),
                        );
                        if (t != null) setState(() => _time = t);
                      },
              ),
              const Spacer(),
              if (_day != null)
                OrvButton(
                  small: true,
                  variant: ButtonVariant.ghost,
                  label: 'Clear',
                  onPressed: () => setState(() {
                    _day = null;
                    _time = null;
                  }),
                ),
            ],
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 6,
            children: [
              for (final (v, name) in const [(0, 'None'), (1, 'Low'), (2, 'Medium'), (3, 'High')])
                ChoiceChip(
                  label: Text(name),
                  selected: _priority == v,
                  showCheckmark: false,
                  onSelected: (_) => setState(() => _priority = v),
                  selectedColor: l.accent.withValues(alpha: 0.16),
                  side: BorderSide(color: _priority == v ? l.accent : l.c.edge),
                  backgroundColor: Colors.transparent,
                ),
            ],
          ),
          const SizedBox(height: 12),
          OrvField(label: 'Notes', controller: _notes),
          const SizedBox(height: 16),
          Row(
            children: [
              OrvButton(
                label: 'Delete',
                small: true,
                variant: ButtonVariant.danger,
                icon: LucideIcons.trash2,
                onPressed: () async {
                  await ref.read(todayActionsProvider).remove(widget.task.id);
                  if (context.mounted) Navigator.of(context).pop();
                },
              ),
              const Spacer(),
              OrvButton(label: 'Save', variant: ButtonVariant.primary, onPressed: _save),
            ],
          ),
        ],
      ),
    );
  }
}
