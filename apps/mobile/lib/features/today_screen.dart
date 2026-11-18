import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../app/state.dart';
import '../app/task_query.dart';
import '../app/today.dart';
import '../app/reminder_ways.dart';
import '../app/smart_add.dart';
import '../app/today_settings.dart';
import 'today_settings_screen.dart' show LeadTimesEditor;
import '../design/controls.dart';
import '../design/glass.dart';
import '../design/theme.dart';
import 'common.dart';
import 'repeat_editor.dart';
import 'sheets.dart';
import 'task_tools.dart';
import 'ways_editor.dart';
import 'today_calendar.dart';

/// Today (spec 0002, M1): quick add, overdue / today / upcoming / inbox / done, settle on complete, task sheet.
class TodayScreen extends ConsumerStatefulWidget {
  const TodayScreen({super.key});
  @override
  ConsumerState<TodayScreen> createState() => _TodayScreenState();
}

class _TodayScreenState extends ConsumerState<TodayScreen> {
  /// 'list' | 'board' | 'calendar'
  String _view = 'list';
  TaskQuery _query = TaskQuery.empty;
  String _scope = 'all';
  bool _selecting = false;
  final _picked = <String>{};

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
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Row(
                    children: [
                      for (final (v, name) in const [('list', 'List'), ('board', 'Board'), ('calendar', 'Calendar')])
                        Padding(
                          padding: const EdgeInsets.only(right: 6),
                          child: ChoiceChip(
                            label: Text(name),
                            selected: _view == v,
                            showCheckmark: false,
                            onSelected: (_) => setState(() => _view = v),
                            selectedColor: l.accent.withValues(alpha: 0.16),
                            side: BorderSide(color: _view == v ? l.accent : l.c.edge),
                            backgroundColor: Colors.transparent,
                          ),
                        ),
                    ],
                  ),
                ),
                // "+" on the home-screen widget opens Today ready to type
                _QuickAdd(focus: GoRouterState.of(context).uri.queryParameters['add'] == '1'),
                const SizedBox(height: 14),
                if (_view == 'calendar')
                  TodayCalendar(onOpenTask: (t) => openTaskSheet(context, t))
                else
                  switch (tasks) {
                    AsyncData(:final value) => _taskArea(context, l, value, now),
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

  Widget _taskArea(BuildContext context, OrvLook l, List<TaskItem> all, DateTime now) {
    final filtered = _query.isEmpty ? all : all.where((t) => taskMatches(t, _query, now)).toList();
    final picked = all.where((t) => _picked.contains(t.id)).toList();
    void open(TaskItem t) {
      if (!_selecting) return openTaskSheet(context, t);
      setState(() => _picked.contains(t.id) ? _picked.remove(t.id) : _picked.add(t.id));
    }

    void setSelecting(bool v) => setState(() {
      _selecting = v;
      if (!v) _picked.clear();
    });
    final g = groupTasks(filtered, now);
    final done = filtered.where((t) => t.completedAt != null).toList()
      ..sort((a, b) => b.completedAt!.compareTo(a.completedAt!));
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TaskFilterBar(
          query: _query,
          onChanged: (q) => setState(() => _query = q),
          tasks: all,
          selecting: _selecting,
          onSelecting: setSelecting,
        ),
        if (_selecting && picked.isNotEmpty) ...[
          const SizedBox(height: 8),
          BulkBar(
            picked: picked,
            onDone: () => setState(() {
              _picked.clear();
              _selecting = false;
            }),
          ),
        ],
        const SizedBox(height: 10),
        if (_view == 'board')
          TaskBoard(tasks: filtered, onOpen: open)
        else ...[
          Wrap(
            spacing: 6,
            children: [
              for (final (v, name) in const [
                ('all', 'All'),
                ('today', 'Today'),
                ('upcoming', 'Upcoming'),
                ('inbox', 'Inbox'),
                ('done', 'Done'),
              ])
                ChoiceChip(
                  label: Text(name),
                  selected: _scope == v,
                  showCheckmark: false,
                  onSelected: (_) => setState(() => _scope = v),
                  selectedColor: l.accent.withValues(alpha: 0.16),
                  side: BorderSide(color: _scope == v ? l.accent : l.c.edge),
                  backgroundColor: Colors.transparent,
                ),
            ],
          ),
          const SizedBox(height: 10),
          _Sections(
            groups: g,
            done: done.take(100).toList(),
            scope: _scope,
            now: now,
            picked: _picked,
            onOpen: open,
            filtering: !_query.isEmpty,
          ),
        ],
      ],
    );
  }
}

class _QuickAdd extends ConsumerStatefulWidget {
  const _QuickAdd({this.focus = false});
  final bool focus;
  @override
  ConsumerState<_QuickAdd> createState() => _QuickAddState();
}

enum _When { today, tomorrow, someday }

class _QuickAddState extends ConsumerState<_QuickAdd> {
  final _c = TextEditingController();
  _When _when = _When.today;
  ParsedTask? _parsed;
  String _parsedFor = '';
  final _literal = <List<int>>[];
  Timer? _debounce;

  @override
  void initState() {
    super.initState();
    _c.addListener(_onText);
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _c.dispose();
    super.dispose();
  }

  void _onText() {
    final text = _c.text;
    // a removed chip only counts while its words are still where they were
    _literal.removeWhere((r) => r[1] > text.length);
    _debounce?.cancel();
    if (text.trim().length < 2) {
      if (_parsed != null) setState(() => _parsed = null);
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 250), _parse);
  }

  Future<void> _parse() async {
    final text = _c.text;
    final p = await parseOnline(ref, text, [..._literal]);
    if (!mounted || _c.text != text) return;
    setState(() {
      _parsed = p;
      _parsedFor = text;
    });
  }

  Future<void> _add() async {
    final title = _c.text.trim();
    if (title.isEmpty) return;
    final now = ref.read(clockProvider)();
    final fallback = switch (_when) {
      _When.today => dayKey(now),
      _When.tomorrow => dayKey(now.add(const Duration(days: 1))),
      _When.someday => null,
    };
    unawaited(HapticFeedback.lightImpact());
    var p = _parsedFor == _c.text ? _parsed : null; // offline or not parsed yet: the words as typed
    // date/time words the rules couldn't read: the server's AI has a look (on submit only)
    if (p != null && looksUnread(p)) p = await parseOnline(ref, _c.text, [..._literal], ai: true) ?? p;
    if (p != null) {
      await ref.read(todayActionsProvider).addParsed(p.fields(fallback), newProject: p.projectName);
    } else {
      await ref.read(todayActionsProvider).add(title, dueDate: fallback);
    }
    _c.clear();
    _literal.clear();
    setState(() => _parsed = null);
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final loc = MaterialLocalizations.of(context);
    final p = _parsedFor == _c.text ? _parsed : null;
    final hasDay = p != null && (p.dueAt != null || p.dueDate != null);
    return Glass(
      level: GlassLevel.float,
      padding: const EdgeInsets.fromLTRB(14, 6, 8, 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(LucideIcons.plus, color: l.accent, size: 20),
              const SizedBox(width: 8),
              Expanded(
                child: TextField(
                  key: const Key('quick-add'),
                  controller: _c,
                  autofocus: widget.focus,
                  textInputAction: TextInputAction.done,
                  onSubmitted: (_) => _add(),
                  style: OrvText.body(l).copyWith(fontSize: 16),
                  decoration: InputDecoration(
                    hintText: 'Add a task… “kal shaam 6 baje call mom”',
                    hintStyle: OrvText.body(l).copyWith(color: l.c.faint, fontSize: 16),
                    border: InputBorder.none,
                  ),
                ),
              ),
            ],
          ),
          if (p != null && p.spans.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(left: 28, bottom: 6),
              child: Semantics(
                container: true,
                label: 'Understood',
                explicitChildNodes: true,
                child: Wrap(
                  spacing: 6,
                  runSpacing: 4,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    Text('“${p.title}”', style: OrvText.muted(l).copyWith(fontSize: 12)),
                    for (final s in p.spans)
                      InputChip(
                        visualDensity: VisualDensity.compact,
                        label: Text(
                          chipLabel(
                            s,
                            p,
                            (d) => loc.formatShortMonthDay(d),
                            (t) => loc.formatTimeOfDay(TimeOfDay.fromDateTime(t)),
                          ),
                        ),
                        labelStyle: OrvText.muted(l)
                            .copyWith(color: l.accent, fontWeight: FontWeight.w600, fontSize: 12),
                        side: BorderSide(color: l.accent.withValues(alpha: 0.4)),
                        backgroundColor: l.accent.withValues(alpha: 0.10),
                        deleteButtonTooltipMessage: 'Not a ${s.kind}: “${s.text}”',
                        onDeleted: () {
                          _literal.add([s.start, s.end]);
                          _parse();
                        },
                      ),
                  ],
                ),
              ),
            ),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    if (!hasDay)
                      for (final w in _When.values)
                        ChoiceChip(
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
                  ],
                ),
              ),
              const SizedBox(width: 8),
              OrvButton(label: 'Add', small: true, variant: ButtonVariant.primary, onPressed: _add),
            ],
          ),
        ],
      ),
    );
  }
}

class _Sections extends StatelessWidget {
  const _Sections({
    required this.groups,
    required this.done,
    required this.scope,
    required this.now,
    required this.picked,
    required this.onOpen,
    required this.filtering,
  });
  final TaskGroups groups;
  final List<TaskItem> done;
  final String scope;
  final DateTime now;
  final Set<String> picked;
  final ValueChanged<TaskItem> onOpen;
  final bool filtering;
  @override
  Widget build(BuildContext context) {
    final g = groups;
    _Section sec(String title, List<TaskItem> items, {String? empty, bool danger = false}) =>
        _Section(title, items, now: now, empty: empty, danger: danger, picked: picked, onOpen: onOpen);
    if (scope == 'done') return sec('Done', done, empty: 'Nothing finished yet.');
    return Column(
      children: [
        if (scope == 'all' || scope == 'today') ...[
          if (g.overdue.isNotEmpty) sec('Overdue', g.overdue, danger: true),
          sec(
            'Today',
            g.today,
            empty: filtering
                ? 'Nothing matches today.'
                : 'Nothing planned for today. Add something above, or enjoy it.',
          ),
        ],
        if ((scope == 'all' && g.upcoming.isNotEmpty) || scope == 'upcoming')
          sec('Upcoming', g.upcoming, empty: 'Nothing coming up.'),
        if (scope == 'all' || scope == 'inbox')
          sec('Inbox', g.inbox, empty: filtering ? 'Nothing matches in the inbox.' : 'Inbox zero.'),
        if (scope == 'all' && g.doneToday.isNotEmpty) sec('Done today', g.doneToday),
      ],
    );
  }
}

class _Section extends StatelessWidget {
  const _Section(
    this.title,
    this.items, {
    required this.now,
    required this.picked,
    required this.onOpen,
    this.empty,
    this.danger = false,
  });
  final Set<String> picked;
  final ValueChanged<TaskItem> onOpen;
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
              for (final t in items)
                _TaskRow(key: ValueKey(t.id), task: t, now: now, selected: picked.contains(t.id), onOpen: onOpen),
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
  const _TaskRow({super.key, required this.task, required this.now, required this.selected, required this.onOpen});
  final TaskItem task;
  final DateTime now;
  final bool selected;
  final ValueChanged<TaskItem> onOpen;
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
      if (t.durationMin != null)
        t.durationMin! >= 60
            ? '${(t.durationMin! / 60).toStringAsFixed(t.durationMin! % 60 == 0 ? 0 : 1)} h'
            : '${t.durationMin} min',
      if (t.projectId != null && projects[t.projectId] != null) projects[t.projectId]!,
      if (t.repeats) 'repeats',
      if (checklistProgress(t).total > 0) '${checklistProgress(t).done}/${checklistProgress(t).total} steps',
      ...t.tags.take(3).map((x) => '#$x'),
    ].join(' · ');
    final late = moment != null && moment.isBefore(widget.now) && !done;
    return InkWell(
      borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
      onTap: () => widget.onOpen(t),
      child: Container(
        decoration: widget.selected
            ? BoxDecoration(
                color: l.c.track,
                borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
                border: Border.all(color: l.accent),
              )
            : null,
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
            if (t.priority >= 1)
              Semantics(
                label: ['', 'Low priority', 'Medium priority', 'High priority'][t.priority],
                child: Icon(
                  LucideIcons.flag,
                  size: 16,
                  color: t.priority == 3 ? l.c.danger : (t.priority == 2 ? l.c.warning : l.c.faint),
                ),
              ),
          ],
        ),
      ),
    );
  }

  static String _shortDate(String day, MaterialLocalizations loc) => loc.formatShortMonthDay(DateTime.parse(day));
}

/// The task sheet, also opened from the calendar.
void openTaskSheet(BuildContext context, TaskItem t) => showGlassSheet<void>(context, (_) => _TaskSheet(task: t));

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
  late int? _duration = widget.task.durationMin;
  late List<String> _tags = [...widget.task.tags];
  late List<({String id, String text, bool done})> _steps = [...widget.task.checklist];
  late String _rrule = widget.task.rrule ?? '';
  late String? _projectId = widget.task.projectId;
  final _newProject = TextEditingController();

  /// null = my defaults (D17); [] = none for this task; else these minutes-before
  /// the ways for this task's own reminders (the data allows one set per reminder; the sheet keeps one for all)
  late List<String>? _ways = () {
    for (final r in (widget.task.data['reminders'] as List?) ?? const []) {
      final via = (r as Map)['via'] as List?;
      if (via != null && via.isNotEmpty) return via.cast<String>();
    }
    return null;
  }();

  late List<int>? _reminders = widget.task.data['reminders'] == null
      ? null
      : [
          for (final r in (widget.task.data['reminders'] as List).cast<Map<String, dynamic>>())
            if (r['kind'] == 'before') (r['minutes'] as num).toInt(),
        ];

  @override
  void dispose() {
    _title.dispose();
    _notes.dispose();
    _newProject.dispose();
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
      'durationMin': _duration,
      'tags': _tags,
      'checklist': [
        for (final c in _steps)
          {
            'id': c.id.isEmpty ? DateTime.now().microsecondsSinceEpoch.toRadixString(36) : c.id,
            'text': c.text,
            'done': c.done,
          },
      ],
      'projectId': _projectId,
      'rrule': _rrule.isEmpty ? null : _rrule,
      // a repeat needs a day to start from: today when none was chosen
      if (_rrule.isNotEmpty && dueDate == null && dueAt == null) 'dueDate': dayKey(ref.read(clockProvider)()),
      'reminders': _reminders == null
          ? null
          : [
              for (final m in _reminders!) {'kind': 'before', 'minutes': m, if (_ways != null) 'via': _ways},
            ],
    });
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final loc = MaterialLocalizations.of(context);
    final projects = ref.watch(projectsProvider).value ?? const <ProjectItem>[];
    final allTasks = ref.watch(tasksProvider).value ?? const <TaskItem>[];
    ChoiceChip chip(String label, bool on, VoidCallback tap) => ChoiceChip(
      label: Text(label),
      selected: on,
      showCheckmark: false,
      onSelected: (_) => setState(tap),
      selectedColor: l.accent.withValues(alpha: 0.16),
      side: BorderSide(color: on ? l.accent : l.c.edge),
      backgroundColor: Colors.transparent,
    );
    return SingleChildScrollView(
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
          Text('Takes', style: OrvText.muted(l).copyWith(fontWeight: FontWeight.w600)),
          const SizedBox(height: 4),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              chip('No estimate', _duration == null, () => _duration = null),
              for (final m in const [15, 30, 45, 60, 90, 120, 180, 240])
                chip(
                  m >= 60 ? '${m ~/ 60} h${m % 60 == 0 ? '' : ' 30'}' : '$m min',
                  _duration == m,
                  () => _duration = m,
                ),
            ],
          ),
          const SizedBox(height: 12),
          Text('Project', style: OrvText.muted(l).copyWith(fontWeight: FontWeight.w600)),
          const SizedBox(height: 4),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              chip('No project', _projectId == null, () => _projectId = null),
              for (final p in projects) chip(p.name, _projectId == p.id, () => _projectId = p.id),
            ],
          ),
          Row(
            children: [
              Expanded(
                child: OrvField(label: 'New project', controller: _newProject),
              ),
              const SizedBox(width: 8),
              OrvButton(
                label: 'Add',
                small: true,
                onPressed: () async {
                  final n = _newProject.text.trim();
                  if (n.isEmpty) return;
                  final id = await ref.read(todayActionsProvider).addProject(n);
                  _newProject.clear();
                  if (mounted) setState(() => _projectId = id);
                },
              ),
            ],
          ),
          const SizedBox(height: 12),
          TagsEditor(value: _tags, onChanged: (t) => setState(() => _tags = t), suggestions: allTags(allTasks)),
          const SizedBox(height: 12),
          ChecklistEditor(value: _steps, onChanged: (v) => setState(() => _steps = v)),
          const SizedBox(height: 12),
          Text('Repeats', style: OrvText.muted(l).copyWith(fontWeight: FontWeight.w600)),
          const SizedBox(height: 4),
          RepeatEditor(
            value: _rrule,
            startDate: _day ?? dayKey(ref.read(clockProvider)()),
            onChanged: (r) => setState(() => _rrule = r),
          ),
          const SizedBox(height: 12),
          if (_time != null)
            _taskReminders(l)
          else
            Text(
              'Reminders: this task has only a day, so it follows your “things with only a date” setting.',
              style: OrvText.muted(l),
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

  Widget _taskReminders(OrvLook l) {
    final defaults = ((ref.watch(todaySettingsProvider).value?['reminders'] as Map?)?['timed'] as List?)?.cast<int>();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 6,
          children: [
            ChoiceChip(
              label: const Text('My defaults'),
              selected: _reminders == null,
              showCheckmark: false,
              onSelected: (_) => setState(() => _reminders = null),
            ),
            ChoiceChip(
              label: const Text('Just for this task'),
              selected: _reminders != null,
              showCheckmark: false,
              onSelected: (_) => setState(() => _reminders = [...?defaults]),
            ),
          ],
        ),
        const SizedBox(height: 6),
        if (_reminders != null) ...[
          LeadTimesEditor(label: 'Remind me', value: _reminders!, onChanged: (v) => setState(() => _reminders = v)),
          const SizedBox(height: 10),
          WaysEditor(
            label: 'By',
            value:
                _ways ??
                ((ref.watch(todaySettingsProvider).value?['reminders'] as Map?)?['via'] as List?)?.cast<String>(),
            onChanged: (v) => setState(() => _ways = v),
          ),
        ] else
          Text(
            defaults == null
                ? 'Set your defaults in Settings → Working hours & reminders.'
                : defaults.isEmpty
                ? 'No reminder'
                : '${defaults.map(leadLabel).join(', ')} · ${waysLabel(((ref.watch(todaySettingsProvider).value?['reminders'] as Map?)?['via']))}',
            style: OrvText.muted(l),
          ),
      ],
    );
  }
}
