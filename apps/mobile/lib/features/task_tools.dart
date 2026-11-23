import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../app/state.dart' show clockProvider;
import '../app/task_query.dart';
import '../app/today.dart';
import '../design/controls.dart';
import '../design/theme.dart';
import '../design/toast.dart';
import 'today_calendar.dart' show labelColour;

/// How many filters (besides words) are on — shown as a badge on the filter button.
int filterCount(TaskQuery q) =>
    (q.projectId != null ? 1 : 0) + (q.tag != null ? 1 : 0) + (q.minPriority > 0 ? 1 : 0) + (q.when != 'any' ? 1 : 0);

/// Search (when open), what is filtered in plain words, and saved filters. The filter choices themselves live in
/// [TaskFilterSheet] so the list stays calm (spec 0007 B).
class TaskFilterBar extends ConsumerStatefulWidget {
  const TaskFilterBar({
    super.key,
    required this.query,
    required this.onChanged,
    required this.tasks,
    this.searching = false,
  });
  final TaskQuery query;
  final ValueChanged<TaskQuery> onChanged;
  final List<TaskItem> tasks;
  final bool searching;
  @override
  ConsumerState<TaskFilterBar> createState() => _TaskFilterBarState();
}

class _TaskFilterBarState extends ConsumerState<TaskFilterBar> {
  late final _search = TextEditingController(text: widget.query.text);
  final _name = TextEditingController();
  bool _naming = false;

  @override
  void dispose() {
    _search.dispose();
    _name.dispose();
    super.dispose();
  }

  @override
  void didUpdateWidget(TaskFilterBar old) {
    super.didUpdateWidget(old);
    if (widget.query.text != _search.text) _search.text = widget.query.text;
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final q = widget.query;
    final projects = ref.watch(projectsProvider).value ?? const <ProjectItem>[];
    final saved = ref.watch(savedFiltersProvider).value ?? const <SavedFilterItem>[];
    String? projectName(String id) => projects.where((p) => p.id == id).firstOrNull?.name;
    TaskQuery fromSaved(SavedFilterItem f) => TaskQuery.fromJson(f.data);
    final active = saved.where((f) => fromSaved(f) == q).firstOrNull;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (widget.searching)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: FocusRing(
              radius: 14,
              padding: const EdgeInsets.symmetric(horizontal: 8),
              child: TextField(
                key: const Key('task-search'),
                controller: _search,
                autofocus: q.text.isEmpty,
                onChanged: (v) => widget.onChanged(q.copy(text: v)),
                style: OrvText.body(l),
                decoration:
                    bareInput(
                      l,
                      hint: 'Search tasks, notes, tags',
                      fontSize: 15,
                      padding: const EdgeInsets.symmetric(vertical: 11),
                    ).copyWith(
                      prefixIcon: Icon(LucideIcons.search, size: 16, color: l.c.faint),
                      prefixIconConstraints: const BoxConstraints(minWidth: 30),
                    ),
              ),
            ),
          ),
        if (!q.isEmpty && active == null)
          _naming
              ? Row(
                  children: [
                    Expanded(
                      child: OrvField(label: 'Name this filter', controller: _name),
                    ),
                    const SizedBox(width: 8),
                    OrvButton(
                      label: 'Save',
                      small: true,
                      variant: ButtonVariant.primary,
                      onPressed: () async {
                        final n = _name.text.trim();
                        if (n.isEmpty) return;
                        final toaster = Toaster.of(context);
                        await ref.read(todayActionsProvider).saveFilter(null, {
                          ...q.toJson(),
                          'name': n,
                          'order': saved.length,
                        });
                        _name.clear();
                        setState(() => _naming = false);
                        toaster.show('Filter saved', body: n, tone: ToastTone.success);
                      },
                    ),
                  ],
                )
              : Row(
                  children: [
                    Icon(LucideIcons.funnel, size: 13, color: l.accent),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        describeQuery(q, projectName: projectName),
                        style: OrvText.muted(l).copyWith(fontSize: 12),
                      ),
                    ),
                    TextButton(onPressed: () => setState(() => _naming = true), child: const Text('Save this filter')),
                    TextButton(onPressed: () => widget.onChanged(TaskQuery.empty), child: const Text('Clear')),
                  ],
                ),
        if (saved.isNotEmpty)
          SizedBox(
            height: 40,
            child: ListView(
              scrollDirection: Axis.horizontal,
              children: [
                for (final f in saved)
                  Padding(
                    padding: const EdgeInsets.only(right: 6),
                    child: InputChip(
                      label: Text(f.name),
                      avatar: Icon(LucideIcons.bookmark, size: 13, color: l.accent),
                      selected: active?.id == f.id,
                      showCheckmark: false,
                      tooltip: describeQuery(fromSaved(f), projectName: projectName),
                      onPressed: () => widget.onChanged(active?.id == f.id ? TaskQuery.empty : fromSaved(f)),
                      onDeleted: () => ref.read(todayActionsProvider).removeFilter(f.id),
                      deleteButtonTooltipMessage: 'Delete filter ${f.name}',
                      selectedColor: l.accent.withValues(alpha: 0.16),
                      side: BorderSide(color: active?.id == f.id ? l.accent : l.c.edge),
                      backgroundColor: Colors.transparent,
                    ),
                  ),
              ],
            ),
          ),
      ],
    );
  }
}

class TaskFilterSheet extends ConsumerStatefulWidget {
  const TaskFilterSheet({super.key, required this.query, required this.onChanged, required this.tasks});
  final TaskQuery query;
  final ValueChanged<TaskQuery> onChanged;
  final List<TaskItem> tasks;
  @override
  ConsumerState<TaskFilterSheet> createState() => _TaskFilterSheetState();
}

/// Filter tasks (spec 0014 redesign): when as six tiles, priority as a switch, projects and tags as pills, and the
/// button says how many match.
class _TaskFilterSheetState extends ConsumerState<TaskFilterSheet> {
  late TaskQuery _q = widget.query;

  void _set(TaskQuery q) {
    HapticFeedback.selectionClick();
    setState(() => _q = q);
    widget.onChanged(q);
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final projects = ref.watch(projectsProvider).value ?? const <ProjectItem>[];
    final tags = allTags(widget.tasks);
    final now = ref.watch(clockProvider)();
    final n = widget.tasks.where((t) => t.completedAt == null && taskMatches(t, _q, now)).length;
    Widget label(String s) => Padding(
      padding: const EdgeInsets.fromLTRB(2, 14, 2, 8),
      child: Text(s.toUpperCase(), style: OrvText.label(l)),
    );
    Widget pill(String text, bool on, VoidCallback tap, {Color? dot}) => Padding(
      padding: const EdgeInsets.only(right: 6, bottom: 6),
      child: Semantics(
        container: true,
        button: true,
        selected: on,
        label: text,
        excludeSemantics: true,
        child: GestureDetector(
          onTap: tap,
          child: AnimatedContainer(
            duration: OrvTokens.durationFast,
            height: 34,
            padding: const EdgeInsets.symmetric(horizontal: 12),
            decoration: BoxDecoration(
              color: on ? l.accent.withValues(alpha: l.dark ? 0.2 : 0.12) : Colors.transparent,
              borderRadius: BorderRadius.circular(OrvTokens.radiusFull),
              border: Border.all(color: on ? l.accent.withValues(alpha: 0.6) : l.c.edge),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (dot != null) ...[
                  Container(
                    width: 8,
                    height: 8,
                    decoration: BoxDecoration(color: dot, shape: BoxShape.circle),
                  ),
                  const SizedBox(width: 6),
                ],
                Text(
                  text,
                  style: OrvText.body(l).copyWith(
                    fontSize: 13,
                    fontWeight: on ? FontWeight.w700 : FontWeight.w500,
                    color: on ? l.accent : l.c.text,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
    const when = [
      ('any', 'Any time', LucideIcons.infinity),
      ('overdue', 'Overdue', LucideIcons.alarmClock),
      ('today', 'Today', LucideIcons.sun),
      ('week', 'Next 7 days', LucideIcons.calendarRange),
      ('later', 'Later', LucideIcons.calendarClock),
      ('none', 'No date', LucideIcons.inbox),
    ];
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 10, 10, 0),
          child: Column(
            children: [
              Container(
                width: 36,
                height: 4,
                decoration: BoxDecoration(color: l.c.track, borderRadius: BorderRadius.circular(2)),
              ),
              Row(
                children: [
                  Expanded(child: Text('Filter tasks', style: OrvText.heading(l))),
                  if (filterCount(_q) > 0)
                    TextButton(
                      onPressed: () => _set(TaskQuery(text: _q.text)),
                      child: const Text('Reset'),
                    ),
                ],
              ),
            ],
          ),
        ),
        Flexible(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                label('When'),
                GridView.count(
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  crossAxisCount: 3,
                  mainAxisSpacing: 8,
                  crossAxisSpacing: 8,
                  childAspectRatio: 1.9,
                  children: [
                    for (final (v, name, icon) in when)
                      Semantics(
                        container: true,
                        button: true,
                        selected: _q.when == v,
                        label: name,
                        excludeSemantics: true,
                        child: GestureDetector(
                          onTap: () => _set(_q.copy(when: v)),
                          child: AnimatedContainer(
                            duration: OrvTokens.durationFast,
                            decoration: BoxDecoration(
                              gradient: _q.when == v ? l.accentGradient : null,
                              color: _q.when == v ? null : l.c.field,
                              borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
                              border: Border.all(color: _q.when == v ? Colors.transparent : l.c.edge),
                            ),
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Icon(icon, size: 17, color: _q.when == v ? Colors.white : l.c.muted),
                                const SizedBox(height: 3),
                                Text(
                                  name,
                                  style: OrvText.muted(l).copyWith(
                                    fontSize: 12,
                                    fontWeight: FontWeight.w600,
                                    color: _q.when == v ? Colors.white : l.c.text,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
                label('Priority'),
                Container(
                  padding: const EdgeInsets.all(3),
                  decoration: BoxDecoration(
                    color: l.c.track,
                    borderRadius: BorderRadius.circular(OrvTokens.radiusFull),
                  ),
                  child: Row(
                    children: [
                      for (final (v, name, tone) in [
                        (0, 'Any', null),
                        (1, 'Low+', l.c.faint),
                        (2, 'Medium+', l.c.warning),
                        (3, 'High', l.c.danger),
                      ])
                        Expanded(
                          child: Semantics(
                            container: true,
                            button: true,
                            selected: _q.minPriority == v,
                            label: name,
                            excludeSemantics: true,
                            child: GestureDetector(
                              onTap: () => _set(_q.copy(minPriority: v)),
                              child: AnimatedContainer(
                                duration: OrvTokens.durationFast,
                                height: 34,
                                decoration: BoxDecoration(
                                  color: _q.minPriority == v ? l.c.glassStrong : Colors.transparent,
                                  borderRadius: BorderRadius.circular(OrvTokens.radiusFull),
                                ),
                                child: Row(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    if (tone != null) ...[
                                      Icon(LucideIcons.flag, size: 12, color: tone),
                                      const SizedBox(width: 4),
                                    ],
                                    Text(
                                      name,
                                      style: OrvText.body(l).copyWith(
                                        fontSize: 12.5,
                                        fontWeight: _q.minPriority == v ? FontWeight.w700 : FontWeight.w500,
                                        color: _q.minPriority == v ? l.c.text : l.c.muted,
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
                ),
                if (projects.isNotEmpty) ...[
                  label('Project'),
                  Wrap(
                    children: [
                      pill('All', _q.projectId == null, () => _set(_q.copy(projectId: null))),
                      pill('No project', _q.projectId == 'none', () => _set(_q.copy(projectId: 'none'))),
                      for (final p in projects)
                        pill(
                          p.name,
                          _q.projectId == p.id,
                          () => _set(_q.copy(projectId: _q.projectId == p.id ? null : p.id)),
                          dot: labelColour(l, p.colour),
                        ),
                    ],
                  ),
                ],
                if (tags.isNotEmpty) ...[
                  label('Tag'),
                  Wrap(
                    children: [
                      for (final t in tags) pill('#$t', _q.tag == t, () => _set(_q.copy(tag: _q.tag == t ? null : t))),
                    ],
                  ),
                ],
              ],
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 6, 16, 12),
          child: OrvButton(
            label: n == 0 ? 'Nothing matches' : 'Show $n ${n == 1 ? 'task' : 'tasks'}',
            variant: ButtonVariant.primary,
            expand: true,
            onPressed: () => Navigator.of(context).pop(),
          ),
        ),
      ],
    );
  }
}

/// Tags as chips with an input.
class TagsEditor extends StatefulWidget {
  const TagsEditor({super.key, required this.value, required this.onChanged, required this.suggestions});
  final List<String> value;
  final ValueChanged<List<String>> onChanged;
  final List<String> suggestions;
  @override
  State<TagsEditor> createState() => _TagsEditorState();
}

class _TagsEditorState extends State<TagsEditor> {
  final _c = TextEditingController();
  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  void _add(String raw) {
    final t = raw.trim().replaceFirst('#', '');
    if (t.isNotEmpty && !widget.value.any((x) => x.toLowerCase() == t.toLowerCase()) && widget.value.length < 20) {
      widget.onChanged([...widget.value, t.length > 40 ? t.substring(0, 40) : t]);
    }
    _c.clear();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final more = widget.suggestions.where((s) => !widget.value.any((v) => v.toLowerCase() == s.toLowerCase())).take(6);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Tags', style: OrvText.muted(l).copyWith(fontWeight: FontWeight.w600)),
        const SizedBox(height: 4),
        Wrap(
          spacing: 6,
          runSpacing: 4,
          children: [
            for (final t in widget.value)
              InputChip(
                label: Text('#$t'),
                onDeleted: () => widget.onChanged(widget.value.where((x) => x != t).toList()),
                deleteButtonTooltipMessage: 'Remove tag $t',
                backgroundColor: Colors.transparent,
                side: BorderSide(color: l.c.edge),
              ),
          ],
        ),
        TextField(
          key: const Key('task-tag-input'),
          controller: _c,
          onSubmitted: _add,
          textInputAction: TextInputAction.done,
          style: OrvText.body(l),
          decoration: InputDecoration(
            isDense: true,
            hintText: 'Add a tag',
            hintStyle: OrvText.body(l).copyWith(color: l.c.faint),
            border: InputBorder.none,
          ),
        ),
        if (more.isNotEmpty)
          Wrap(
            spacing: 6,
            children: [
              for (final s in more)
                ActionChip(label: Text('+#$s'), onPressed: () => _add(s), backgroundColor: Colors.transparent),
            ],
          ),
      ],
    );
  }
}

/// A checklist inside a task, with progress.
class ChecklistEditor extends StatefulWidget {
  const ChecklistEditor({super.key, required this.value, required this.onChanged});
  final List<({String id, String text, bool done})> value;
  final ValueChanged<List<({String id, String text, bool done})>> onChanged;
  @override
  State<ChecklistEditor> createState() => _ChecklistEditorState();
}

class _ChecklistEditorState extends State<ChecklistEditor> {
  final _c = TextEditingController();
  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final v = widget.value;
    final done = v.where((c) => c.done).length;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Steps', style: OrvText.muted(l).copyWith(fontWeight: FontWeight.w600)),
        if (v.isNotEmpty) ...[
          const SizedBox(height: 6),
          Row(
            children: [
              Expanded(
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(4),
                  child: LinearProgressIndicator(
                    value: done / v.length,
                    minHeight: 6,
                    backgroundColor: l.c.track,
                    color: l.accent,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Text('$done/${v.length}', style: OrvText.muted(l)),
            ],
          ),
        ],
        for (final (i, c) in v.indexed)
          Row(
            children: [
              Checkbox(
                value: c.done,
                semanticLabel: 'Done: ${c.text}',
                onChanged: (x) => widget.onChanged([
                  for (final (j, e) in v.indexed) j == i ? (id: e.id, text: e.text, done: x ?? false) : e,
                ]),
              ),
              Expanded(
                child: Text(
                  c.text,
                  style: OrvText.body(l).copyWith(
                    color: c.done ? l.c.muted : l.c.text,
                    decoration: c.done ? TextDecoration.lineThrough : null,
                  ),
                ),
              ),
              IconButton(
                tooltip: 'Remove step ${i + 1}',
                icon: Icon(LucideIcons.x, size: 16, color: l.c.faint),
                onPressed: () => widget.onChanged([
                  for (final (j, e) in v.indexed)
                    if (j != i) e,
                ]),
              ),
            ],
          ),
        TextField(
          key: const Key('task-step-input'),
          controller: _c,
          textInputAction: TextInputAction.done,
          onSubmitted: (t) {
            final s = t.trim();
            if (s.isNotEmpty && v.length < 100) {
              widget.onChanged([
                ...v,
                (id: DateTime.now().microsecondsSinceEpoch.toRadixString(36), text: s, done: false),
              ]);
            }
            _c.clear();
          },
          style: OrvText.body(l),
          decoration: InputDecoration(
            isDense: true,
            hintText: 'Add a step',
            hintStyle: OrvText.body(l).copyWith(color: l.c.faint),
            border: InputBorder.none,
          ),
        ),
      ],
    );
  }
}
