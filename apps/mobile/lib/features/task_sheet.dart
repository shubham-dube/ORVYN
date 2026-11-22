import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../app/reminder_ways.dart';
import '../app/smart_add.dart' show repeatLabel;
import '../app/state.dart';
import '../app/task_query.dart';
import '../app/today.dart';
import '../app/today_settings.dart';
import '../design/controls.dart';
import '../design/theme.dart';
import '../design/toast.dart';
import 'repeat_editor.dart';
import 'sheets.dart';
import 'task_tools.dart';
import 'today_calendar.dart' show labelColour;
import 'today_kit.dart';
import 'today_settings_screen.dart' show LeadTimesEditor;
import 'ways_editor.dart';

/// Opens a task (or, with [task] null, a new one pre-filled from [initial]: what quick add understood).
Future<void> openTaskSheet(BuildContext context, TaskItem? task, {Map<String, dynamic>? initial}) =>
    showGlassSheet<void>(context, (_) => TaskSheet(task: task, initial: initial));

/// The task sheet (spec 0012 A3): a big title, the facts as pills (When · Time · Duration · Priority · Project ·
/// Deadline), and "+" rows for the rest that open only when used — short for simple tasks, complete for big ones.
class TaskSheet extends ConsumerStatefulWidget {
  const TaskSheet({super.key, this.task, this.initial});
  final TaskItem? task;
  final Map<String, dynamic>? initial;
  @override
  ConsumerState<TaskSheet> createState() => _TaskSheetState();
}

class _TaskSheetState extends ConsumerState<TaskSheet> {
  late final Map<String, dynamic> _d = {...?widget.task?.data, ...?widget.initial};
  late final TaskItem _t = TaskItem(widget.task?.id ?? '', _d);
  late final _title = TextEditingController(text: _t.title);
  late final _notes = TextEditingController(text: _t.notes);
  late String? _day = _t.day;
  late TimeOfDay? _time = _t.dueAt == null ? null : TimeOfDay.fromDateTime(_t.dueAt!);
  late int _priority = _t.priority;
  late int? _duration = _t.durationMin;
  late String? _deadline = _t.deadline;
  late String _status = _t.status;
  late List<String> _tags = [..._t.tags];
  late List<({String id, String text, bool done})> _steps = [..._t.checklist];
  late String _rrule = _t.rrule ?? '';
  late String? _projectId = _t.projectId;
  late bool _done = widget.task?.done ?? false;
  bool _busy = false;

  /// the "+" rows the person opened (or that already have something)
  late final _open = <String>{
    if (_t.notes.isNotEmpty) 'notes',
    if (_t.checklist.isNotEmpty) 'checklist',
    if (_t.tags.isNotEmpty) 'tags',
    if (_t.rrule != null) 'repeat',
    if (_d['reminders'] != null) 'reminders',
  };

  late List<String>? _ways = () {
    for (final r in (_d['reminders'] as List?) ?? const []) {
      final via = (r as Map)['via'] as List?;
      if (via != null && via.isNotEmpty) return via.cast<String>();
    }
    return null;
  }();

  late List<int>? _reminders = _d['reminders'] == null
      ? null
      : [
          for (final r in (_d['reminders'] as List).cast<Map<String, dynamic>>())
            if (r['kind'] == 'before') (r['minutes'] as num).toInt(),
        ];

  bool get _isNew => widget.task == null;

  @override
  void initState() {
    super.initState();
    _title.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _title.dispose();
    _notes.dispose();
    super.dispose();
  }

  DateTime get _now => ref.read(clockProvider)();

  Map<String, dynamic> _fields() {
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
    return {
      'title': _title.text.trim(),
      'notes': _notes.text,
      'dueDate': dueDate,
      'dueAt': dueAt,
      // a time block that no longer matches the new day would put it back on the old one
      if (!_isNew && _day != _t.day) 'scheduledStart': null,
      'priority': _priority,
      'durationMin': _duration,
      'deadline': _deadline,
      'status': _status,
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
      if (_rrule.isNotEmpty && dueDate == null && dueAt == null) 'dueDate': dayKey(_now),
      'reminders': _reminders == null
          ? null
          : [
              for (final m in _reminders!) {'kind': 'before', 'minutes': m, if (_ways != null) 'via': _ways},
            ],
    };
  }

  Future<void> _save() async {
    if (_title.text.trim().isEmpty) return;
    setState(() => _busy = true);
    final actions = ref.read(todayActionsProvider);
    final toaster = Toaster.of(context);
    if (_isNew) {
      await actions.addParsed(_fields(), newProject: widget.initial?['_newProject'] as String?);
      toaster.show('Added', body: _title.text.trim(), tone: ToastTone.success);
    } else {
      await actions.update(widget.task!.id, _fields());
      if (_done != widget.task!.done) await actions.complete(widget.task!.id, _done);
    }
    if (mounted) Navigator.of(context).pop();
  }

  // ------------------------------------------------------------------ pickers

  Future<void> _pickWhen() async {
    final now = _now;
    final today = dayKey(now);
    String plus(int n) => dayKey(now.add(Duration(days: n)));
    final sat = plus((DateTime.saturday - now.weekday) % 7);
    final mon = plus((DateTime.monday - now.weekday + 7) % 7 == 0 ? 7 : (DateTime.monday - now.weekday + 7) % 7);
    final v = await pickOne<String>(context, 'When will you do it?', [
      PickOption(today, 'Today', icon: LucideIcons.sun, selected: _day == today),
      PickOption(
        plus(1),
        'Tomorrow',
        icon: LucideIcons.sunrise,
        sub: dayWords(plus(1), now),
        selected: _day == plus(1),
      ),
      if (sat != today)
        PickOption(sat, 'This weekend', icon: LucideIcons.armchair, sub: dayWords(sat, now), selected: _day == sat),
      PickOption(mon, 'Next week', icon: LucideIcons.calendarRange, sub: dayWords(mon, now), selected: _day == mon),
      const PickOption('pick', 'Pick a date…', icon: LucideIcons.calendarSearch),
      PickOption('', 'No day — keep in Inbox', icon: LucideIcons.inbox, selected: _day == null),
    ]);
    if (v == null || !mounted) return;
    if (v == 'pick') {
      final d = await showDatePicker(
        context: context,
        initialDate: _day == null ? now : DateTime.parse(_day!),
        firstDate: now.subtract(const Duration(days: 365)),
        lastDate: now.add(const Duration(days: 365 * 5)),
      );
      if (d != null) setState(() => _day = dayKey(d));
      return;
    }
    setState(() {
      _day = v.isEmpty ? null : v;
      if (_day == null) _time = null;
    });
  }

  Future<void> _pickTime() async {
    final t = await showTimePicker(context: context, initialTime: _time ?? const TimeOfDay(hour: 10, minute: 0));
    if (t != null) setState(() => _time = t);
    if (t != null && _day == null) setState(() => _day = dayKey(_now));
  }

  Future<void> _pickDuration() async {
    final v = await pickOne<int>(context, 'How long will it take?', [
      for (final m in const [15, 30, 45, 60, 90, 120, 180, 240])
        PickOption(m, hm(m), icon: LucideIcons.timer, selected: _duration == m),
      PickOption(0, 'No estimate', icon: LucideIcons.circleSlash, selected: _duration == null),
    ]);
    if (v != null) setState(() => _duration = v == 0 ? null : v);
  }

  Future<void> _pickPriority() async {
    final l = context.orv;
    final v = await pickOne<int>(context, 'Priority', [
      PickOption(3, 'High', colour: l.c.danger, sub: '!!! or p1', selected: _priority == 3),
      PickOption(2, 'Medium', colour: l.c.warning, sub: '!! or p2', selected: _priority == 2),
      PickOption(1, 'Low', colour: l.c.faint, sub: '! or p3', selected: _priority == 1),
      PickOption(0, 'None', icon: LucideIcons.circleSlash, selected: _priority == 0),
    ]);
    if (v != null) setState(() => _priority = v);
  }

  Future<void> _pickProject() async {
    final l = context.orv;
    final projects = ref.read(projectsProvider).value ?? const <ProjectItem>[];
    final v = await pickOne<String>(context, 'Project', [
      for (final p in projects)
        PickOption(p.id, p.name, colour: labelColour(l, p.colour), selected: _projectId == p.id),
      PickOption('', 'No project', icon: LucideIcons.circleSlash, selected: _projectId == null),
      const PickOption('+', 'New project…', icon: LucideIcons.folderPlus),
    ]);
    if (v == null || !mounted) return;
    if (v == '+') {
      final name = await _ask('New project', 'Name');
      if (name == null || name.trim().isEmpty) return;
      const colours = ['sky', 'emerald', 'violet', 'amber', 'coral', 'cyan', 'gold'];
      final id = await ref
          .read(todayActionsProvider)
          .addProject(name.trim(), colour: colours[projects.length % colours.length]);
      if (mounted) setState(() => _projectId = id);
      return;
    }
    setState(() => _projectId = v.isEmpty ? null : v);
  }

  Future<void> _pickDeadline() async {
    final now = _now;
    final d = await showDatePicker(
      context: context,
      helpText: 'Deadline — the last day',
      initialDate: _deadline == null ? now.add(const Duration(days: 7)) : DateTime.parse(_deadline!),
      firstDate: now.subtract(const Duration(days: 365)),
      lastDate: now.add(const Duration(days: 365 * 5)),
    );
    if (d != null) setState(() => _deadline = dayKey(d));
  }

  Future<String?> _ask(String title, String label) {
    final c = TextEditingController();
    return showGlassSheet<String>(
      context,
      (ctx) => StickySheet(
        title: title,
        footer: Align(
          alignment: Alignment.centerRight,
          child: OrvButton(
            label: 'Add',
            variant: ButtonVariant.primary,
            onPressed: () => Navigator.of(ctx).pop(c.text),
          ),
        ),
        children: [
          OrvField(label: label, controller: c, autofocus: true, onSubmitted: (v) => Navigator.of(ctx).pop(v)),
        ],
      ),
    );
  }

  // ------------------------------------------------------------------ build

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final now = ref.watch(clockProvider)();
    final loc = MaterialLocalizations.of(context);
    final projects = ref.watch(projectsProvider).value ?? const <ProjectItem>[];
    final project = projects.where((p) => p.id == _projectId).firstOrNull;
    final allTasks = ref.watch(tasksProvider).value ?? const <TaskItem>[];
    final dlTone = deadlineTone(_deadline, now);
    final priorityColour = [l.c.faint, l.c.faint, l.c.warning, l.c.danger][_priority];

    Widget plusRow(String key, IconData icon, String label, Widget editor) {
      final on = _open.contains(key);
      return AnimatedSize(
        duration: OrvTokens.durationBase,
        curve: springSmooth,
        alignment: Alignment.topCenter,
        child: on
            ? Padding(
                padding: const EdgeInsets.only(top: 14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      children: [
                        Icon(icon, size: 15, color: l.accent),
                        const SizedBox(width: 6),
                        Text(label.toUpperCase(), style: OrvText.label(l)),
                      ],
                    ),
                    const SizedBox(height: 6),
                    editor,
                  ],
                ),
              )
            : InkWell(
                borderRadius: BorderRadius.circular(OrvTokens.radiusSm),
                onTap: () {
                  HapticFeedback.selectionClick();
                  setState(() => _open.add(key));
                },
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 9, horizontal: 2),
                  child: Row(
                    children: [
                      Icon(LucideIcons.plus, size: 16, color: l.c.muted),
                      const SizedBox(width: 10),
                      Icon(icon, size: 15, color: l.c.faint),
                      const SizedBox(width: 8),
                      Text(label, style: OrvText.body(l).copyWith(color: l.c.muted)),
                    ],
                  ),
                ),
              ),
      );
    }

    return StickySheet(
      title: _isNew ? 'New task' : (_done ? 'Done' : 'Task'),
      trailing: _isNew
          ? null
          : IconButton(
              tooltip: 'Delete task',
              icon: Icon(LucideIcons.trash2, size: 19, color: l.c.danger),
              onPressed: () async {
                final ok = await showDialog<bool>(
                  context: context,
                  builder: (ctx) => AlertDialog(
                    title: const Text('Delete this task?'),
                    content: Text(widget.task!.title),
                    actions: [
                      TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Keep')),
                      TextButton(onPressed: () => Navigator.of(ctx).pop(true), child: const Text('Delete')),
                    ],
                  ),
                );
                if (ok != true) return;
                await ref.read(todayActionsProvider).remove(widget.task!.id);
                if (context.mounted) Navigator.of(context).pop();
              },
            ),
      footer: Row(
        children: [
          if (!_isNew && widget.task!.data['source'] != null && widget.task!.data['source'] != 'typed')
            Text('From ${widget.task!.data['source']}', style: OrvText.muted(l).copyWith(fontSize: 12)),
          const Spacer(),
          OrvButton(label: 'Cancel', variant: ButtonVariant.ghost, onPressed: () => Navigator.of(context).pop()),
          const SizedBox(width: 6),
          OrvButton(
            key: const Key('task-save'),
            label: _isNew ? 'Add task' : 'Save',
            variant: ButtonVariant.primary,
            loading: _busy,
            onPressed: _title.text.trim().isEmpty ? null : _save,
          ),
        ],
      ),
      children: [
        // ------------------------------------------------ title, with done
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (!_isNew)
              Padding(
                padding: const EdgeInsets.only(top: 10, right: 10),
                child: CompleteCircle(
                  done: _done,
                  label: _done ? 'Mark not done' : 'Complete',
                  onTap: () async => setState(() => _done = !_done),
                ),
              ),
            Expanded(
              child: TextField(
                key: const Key('task-title'),
                controller: _title,
                autofocus: _isNew && _title.text.isEmpty,
                maxLines: 3,
                minLines: 1,
                textCapitalization: TextCapitalization.sentences,
                style: OrvText.heading(l).copyWith(
                  fontSize: 20,
                  decoration: _done ? TextDecoration.lineThrough : null,
                  color: _done ? l.c.muted : l.c.text,
                ),
                decoration: bareInput(l, hint: 'What needs doing?', fontSize: 20),
              ),
            ),
          ],
        ),
        if (_done && widget.task?.completedAt != null)
          Padding(
            padding: const EdgeInsets.only(left: 38, bottom: 4),
            child: Row(
              children: [
                Icon(LucideIcons.circleCheck, size: 14, color: l.c.success),
                const SizedBox(width: 6),
                Text(
                  doneLabel(widget.task!.completedAt!, now, long: true),
                  style: OrvText.muted(l).copyWith(color: l.c.success, fontWeight: FontWeight.w600),
                ),
              ],
            ),
          ),
        if (!_done) ...[
          const SizedBox(height: 4),
          _StatusSwitch(value: _status, onChanged: (v) => setState(() => _status = v)),
        ],
        const SizedBox(height: 14),
        // ------------------------------------------------ the facts
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            FactPill(
              icon: LucideIcons.calendar,
              label: _day == null ? 'When' : dayWords(_day!, now),
              set: _day != null,
              tone: _day != null && _day!.compareTo(dayKey(now)) < 0 && !_done ? l.c.danger : null,
              onTap: _pickWhen,
              onClear: () => setState(() {
                _day = null;
                _time = null;
              }),
            ),
            FactPill(
              icon: LucideIcons.clock,
              label: _time == null ? 'Time' : loc.formatTimeOfDay(_time!),
              set: _time != null,
              onTap: _pickTime,
              onClear: () => setState(() => _time = null),
            ),
            FactPill(
              icon: LucideIcons.timer,
              label: _duration == null ? 'Duration' : hm(_duration!),
              set: _duration != null,
              onTap: _pickDuration,
              onClear: () => setState(() => _duration = null),
            ),
            FactPill(
              icon: LucideIcons.flag,
              label: _priority == 0 ? 'Priority' : const ['', 'Low', 'Medium', 'High'][_priority],
              set: _priority > 0,
              tone: _priority > 0 ? priorityColour : null,
              onTap: _pickPriority,
              onClear: () => setState(() => _priority = 0),
            ),
            FactPill(
              icon: LucideIcons.folder,
              label: project?.name ?? 'Project',
              set: project != null,
              tone: project == null ? null : labelColour(l, project.colour),
              onTap: _pickProject,
              onClear: () => setState(() => _projectId = null),
            ),
            FactPill(
              icon: LucideIcons.flagTriangleRight,
              label: _deadline == null ? 'Deadline' : 'by ${dayWords(_deadline!, now)}',
              set: _deadline != null,
              tone: dlTone == 'past' ? l.c.danger : (dlTone == 'near' ? l.c.warning : null),
              onTap: _pickDeadline,
              onClear: () => setState(() => _deadline = null),
            ),
          ],
        ),
        const SizedBox(height: 10),
        // ------------------------------------------------ the rest, only when used
        plusRow(
          'notes',
          LucideIcons.stickyNote,
          'Notes',
          OrvField(label: '', controller: _notes, maxLines: 6, hint: 'Links, details, anything'),
        ),
        plusRow(
          'checklist',
          LucideIcons.listChecks,
          'Checklist',
          ChecklistEditor(value: _steps, onChanged: (v) => setState(() => _steps = v)),
        ),
        plusRow(
          'tags',
          LucideIcons.hash,
          'Tags',
          TagsEditor(value: _tags, onChanged: (t) => setState(() => _tags = t), suggestions: allTags(allTasks)),
        ),
        plusRow(
          'repeat',
          LucideIcons.repeat,
          _rrule.isEmpty ? 'Repeat' : 'Repeats ${repeatLabel(_rrule)}',
          RepeatEditor(value: _rrule, startDate: _day ?? dayKey(now), onChanged: (r) => setState(() => _rrule = r)),
        ),
        plusRow('reminders', LucideIcons.bellRing, 'Reminders', _remindersEditor(l)),
        if (!_isNew && widget.task!.data['lastDoneAt'] != null)
          Padding(
            padding: const EdgeInsets.only(top: 12),
            child: Text(
              'Last ${doneLabel(DateTime.parse(widget.task!.data['lastDoneAt'] as String).toLocal(), now).toLowerCase()}',
              style: OrvText.muted(l).copyWith(fontSize: 12),
            ),
          ),
      ],
    );
  }

  Widget _remindersEditor(OrvLook l) {
    if (_time == null) {
      return Text(
        'This task has only a day, so it follows your “things with only a date” setting. Give it a time for its own reminders.',
        style: OrvText.muted(l),
      );
    }
    final settings = ref.watch(todaySettingsProvider).value?['reminders'] as Map?;
    final defaults = (settings?['timed'] as List?)?.cast<int>();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 8,
          children: [
            FactPill(
              icon: LucideIcons.check,
              label: 'My defaults',
              set: _reminders == null,
              onTap: () => setState(() => _reminders = null),
            ),
            FactPill(
              icon: LucideIcons.check,
              label: 'Just for this task',
              set: _reminders != null,
              onTap: () => setState(() => _reminders = [...?defaults]),
            ),
          ],
        ),
        const SizedBox(height: 8),
        if (_reminders != null) ...[
          LeadTimesEditor(label: 'Remind me', value: _reminders!, onChanged: (v) => setState(() => _reminders = v)),
          const SizedBox(height: 10),
          WaysEditor(
            label: 'By',
            value: _ways ?? (settings?['via'] as List?)?.cast<String>(),
            onChanged: (v) => setState(() => _ways = v),
          ),
        ] else
          Text(
            defaults == null
                ? 'Set your defaults in Settings → Working hours & reminders.'
                : defaults.isEmpty
                ? 'No reminder'
                : '${defaults.map(leadLabel).join(', ')} · ${waysLabel(settings?['via'])}',
            style: OrvText.muted(l),
          ),
      ],
    );
  }
}

/// To do · Doing, as a small two-way switch (done is the circle).
class _StatusSwitch extends StatelessWidget {
  const _StatusSwitch({required this.value, required this.onChanged});
  final String value;
  final ValueChanged<String> onChanged;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return Padding(
      padding: const EdgeInsets.only(left: 2),
      child: Row(
        children: [
          for (final (v, name, icon) in const [
            ('todo', 'To do', LucideIcons.circle),
            ('doing', 'Doing', LucideIcons.circleDashed),
          ])
            Padding(
              padding: const EdgeInsets.only(right: 6),
              child: Semantics(
                container: true,
                button: true,
                selected: value == v,
                label: name,
                excludeSemantics: true,
                child: GestureDetector(
                  onTap: () {
                    HapticFeedback.selectionClick();
                    onChanged(v);
                  },
                  child: AnimatedContainer(
                    duration: OrvTokens.durationFast,
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                    decoration: BoxDecoration(
                      color: value == v ? l.accent.withValues(alpha: 0.14) : Colors.transparent,
                      borderRadius: BorderRadius.circular(OrvTokens.radiusFull),
                    ),
                    child: Row(
                      children: [
                        Icon(icon, size: 13, color: value == v ? l.accent : l.c.faint),
                        const SizedBox(width: 5),
                        Text(
                          name,
                          style: OrvText.muted(l).copyWith(
                            fontSize: 12.5,
                            fontWeight: FontWeight.w700,
                            color: value == v ? l.accent : l.c.muted,
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

/// The round "done" button: an outline that fills with the accent and a tick, with a little glow as it settles.
class CompleteCircle extends StatefulWidget {
  const CompleteCircle({
    super.key,
    required this.done,
    required this.onTap,
    required this.label,
    this.doing = false,
    this.size = 26,
  });
  final bool done;
  final bool doing;
  final Future<void> Function()? onTap;
  final String label;
  final double size;
  @override
  State<CompleteCircle> createState() => _CompleteCircleState();
}

class _CompleteCircleState extends State<CompleteCircle> {
  bool _settling = false;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final on = widget.done || _settling;
    return Semantics(
      container: true,
      checked: widget.done,
      button: true,
      label: widget.label,
      excludeSemantics: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: widget.onTap == null
            ? null
            : () async {
                if (!widget.done) {
                  unawaited(HapticFeedback.mediumImpact());
                  setState(() => _settling = true);
                  await Future<void>.delayed(context.reduceMotion ? Duration.zero : const Duration(milliseconds: 340));
                }
                await widget.onTap!();
                if (mounted) setState(() => _settling = false);
              },
        child: Padding(
          padding: const EdgeInsets.all(4),
          child: AnimatedContainer(
            duration: OrvTokens.durationBase,
            curve: springSnappy,
            width: widget.size,
            height: widget.size,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: on ? l.accentGradient : null,
              border: Border.all(
                color: on ? Colors.transparent : (widget.doing ? l.accent : l.c.faint.withValues(alpha: 0.7)),
                width: 2,
              ),
              boxShadow: _settling
                  ? [BoxShadow(color: l.accentFrom.withValues(alpha: 0.55), blurRadius: 16, spreadRadius: 3)]
                  : null,
            ),
            child: on
                ? Icon(Icons.check_rounded, size: widget.size * 0.62, color: Colors.white)
                : widget.doing
                ? Center(
                    child: Container(
                      width: widget.size * 0.42,
                      height: widget.size * 0.42,
                      decoration: BoxDecoration(shape: BoxShape.circle, color: l.accent.withValues(alpha: 0.85)),
                    ),
                  )
                : null,
          ),
        ),
      ),
    );
  }
}
