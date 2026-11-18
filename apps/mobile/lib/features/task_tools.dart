import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../app/state.dart';
import '../app/task_query.dart';
import '../app/today.dart';
import '../design/controls.dart';
import '../design/glass.dart';
import '../design/theme.dart';
import '../design/toast.dart';
import 'today_calendar.dart' show labelColour;

/// Search, filters and saved filters for the task list.
class TaskFilterBar extends ConsumerStatefulWidget {
  const TaskFilterBar({
    super.key,
    required this.query,
    required this.onChanged,
    required this.tasks,
    required this.selecting,
    required this.onSelecting,
  });
  final TaskQuery query;
  final ValueChanged<TaskQuery> onChanged;
  final List<TaskItem> tasks;
  final bool selecting;
  final ValueChanged<bool> onSelecting;
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
    final tags = allTags(widget.tasks);
    String? projectName(String id) => projects.where((p) => p.id == id).firstOrNull?.name;
    TaskQuery fromSaved(SavedFilterItem f) => TaskQuery.fromJson(f.data);
    final active = saved.where((f) => fromSaved(f) == q).firstOrNull;

    Widget menu(String label, String? value, List<(String?, String)> options, ValueChanged<String?> pick) =>
        PopupMenuButton<String?>(
          tooltip: label,
          onSelected: pick,
          itemBuilder: (_) => [for (final (v, t) in options) PopupMenuItem<String?>(value: v, child: Text(t))],
          child: Chip(
            label: Text(options.where((o) => o.$1 == value).firstOrNull?.$2 ?? label),
            side: BorderSide(color: value == null || value == 'any' || value == '0' ? l.c.edge : l.accent),
            backgroundColor: value == null || value == 'any' || value == '0'
                ? Colors.transparent
                : l.accent.withValues(alpha: 0.12),
          ),
        );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          key: const Key('task-search'),
          controller: _search,
          onChanged: (v) => widget.onChanged(q.copy(text: v)),
          style: OrvText.body(l),
          decoration: InputDecoration(
            isDense: true,
            prefixIcon: Icon(LucideIcons.search, size: 16, color: l.c.faint),
            hintText: 'Search tasks, notes, tags',
            hintStyle: OrvText.body(l).copyWith(color: l.c.faint),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
              borderSide: BorderSide(color: l.c.edge),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
              borderSide: BorderSide(color: l.c.edge),
            ),
          ),
        ),
        const SizedBox(height: 6),
        Wrap(
          spacing: 6,
          runSpacing: 0,
          children: [
            menu('All projects', q.projectId, [
              (null, 'All projects'),
              ('none', 'No project'),
              for (final p in projects) (p.id, p.name),
            ], (v) => widget.onChanged(q.copy(projectId: v))),
            if (tags.isNotEmpty)
              menu('Any tag', q.tag, [
                (null, 'Any tag'),
                for (final t in tags) (t, '#$t'),
              ], (v) => widget.onChanged(q.copy(tag: v))),
            menu('Any priority', q.minPriority == 0 ? null : '${q.minPriority}', const [
              (null, 'Any priority'),
              ('1', 'Low and up'),
              ('2', 'Medium and up'),
              ('3', 'High only'),
            ], (v) => widget.onChanged(q.copy(minPriority: int.tryParse(v ?? '') ?? 0))),
            menu('Any time', q.when == 'any' ? null : q.when, const [
              (null, 'Any time'),
              ('overdue', 'Overdue'),
              ('today', 'Today'),
              ('week', 'Next 7 days'),
              ('later', 'Later'),
              ('none', 'No date'),
            ], (v) => widget.onChanged(q.copy(when: v ?? 'any'))),
            FilterChip(
              label: const Text('Select'),
              avatar: Icon(LucideIcons.listChecks, size: 14, color: l.accent),
              selected: widget.selecting,
              showCheckmark: false,
              onSelected: widget.onSelecting,
              selectedColor: l.accent.withValues(alpha: 0.16),
              side: BorderSide(color: widget.selecting ? l.accent : l.c.edge),
              backgroundColor: Colors.transparent,
            ),
          ],
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
                    Expanded(
                      child: Text(
                        describeQuery(q, projectName: projectName),
                        style: OrvText.muted(l).copyWith(fontSize: 12),
                      ),
                    ),
                    TextButton.icon(
                      onPressed: () => setState(() => _naming = true),
                      icon: const Icon(LucideIcons.bookmark, size: 14),
                      label: const Text('Save this filter'),
                    ),
                    TextButton(onPressed: () => widget.onChanged(TaskQuery.empty), child: const Text('Clear')),
                  ],
                ),
        if (saved.isNotEmpty)
          Wrap(
            spacing: 6,
            children: [
              for (final f in saved)
                InputChip(
                  label: Text(f.name),
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
            ],
          ),
      ],
    );
  }
}

/// What can be done to the ticked tasks in one go.
class BulkBar extends ConsumerWidget {
  const BulkBar({super.key, required this.picked, required this.onDone});
  final List<TaskItem> picked;
  final VoidCallback onDone;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final actions = ref.read(todayActionsProvider);
    final projects = ref.watch(projectsProvider).value ?? const <ProjectItem>[];
    final toaster = Toaster.of(context);
    Future<void> each(Future<void> Function(TaskItem t) fn) async {
      for (final t in picked) {
        await fn(t);
      }
      onDone();
    }

    return Glass(
      level: GlassLevel.float,
      padding: const EdgeInsets.all(10),
      child: Semantics(
        container: true,
        label: 'Bulk actions',
        child: Wrap(
          spacing: 6,
          runSpacing: 6,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Text('${picked.length} selected', style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600)),
            OrvButton(
              label: 'Complete',
              small: true,
              variant: ButtonVariant.primary,
              icon: LucideIcons.check,
              onPressed: () async {
                final n = picked.length;
                await each((t) => actions.complete(t.id, true));
                toaster.show('$n done', tone: ToastTone.success);
              },
            ),
            PopupMenuButton<String>(
              tooltip: 'Move to project',
              onSelected: (v) async {
                final n = picked.length;
                await each((t) => actions.update(t.id, {'projectId': v == 'none' ? null : v}));
                toaster.show('Moved $n', tone: ToastTone.success);
              },
              itemBuilder: (_) => [
                const PopupMenuItem(value: 'none', child: Text('No project')),
                for (final p in projects) PopupMenuItem(value: p.id, child: Text(p.name)),
              ],
              child: const Chip(label: Text('Move to…')),
            ),
            PopupMenuButton<int>(
              tooltip: 'Set priority',
              onSelected: (v) => each((t) => actions.update(t.id, {'priority': v})),
              itemBuilder: (_) => const [
                PopupMenuItem(value: 0, child: Text('No priority')),
                PopupMenuItem(value: 1, child: Text('Low')),
                PopupMenuItem(value: 2, child: Text('Medium')),
                PopupMenuItem(value: 3, child: Text('High')),
              ],
              child: const Chip(label: Text('Priority…')),
            ),
            ActionChip(
              label: const Text('Set day'),
              avatar: const Icon(LucideIcons.calendar, size: 14),
              onPressed: () async {
                final now = ref.read(clockProvider)();
                final d = await showDatePicker(
                  context: context,
                  initialDate: now,
                  firstDate: now.subtract(const Duration(days: 365)),
                  lastDate: now.add(const Duration(days: 365 * 5)),
                );
                if (d == null) return;
                final n = picked.length;
                await each((t) => actions.update(t.id, {'dueDate': dayKey(d), 'dueAt': null, 'scheduledStart': null}));
                toaster.show('Planned $n for ${dayKey(d)}', tone: ToastTone.success);
              },
            ),
            OrvButton(
              label: 'Delete',
              small: true,
              variant: ButtonVariant.danger,
              icon: LucideIcons.trash2,
              onPressed: () async {
                final n = picked.length;
                await each((t) => actions.remove(t.id));
                toaster.show('Deleted $n');
              },
            ),
          ],
        ),
      ),
    );
  }
}

/// Tasks as columns by project. Long-press a card to move it to another column.
class TaskBoard extends ConsumerWidget {
  const TaskBoard({super.key, required this.tasks, required this.onOpen});
  final List<TaskItem> tasks;
  final ValueChanged<TaskItem> onOpen;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final projects = ref.watch(projectsProvider).value ?? const <ProjectItem>[];
    final open = tasks.where((t) => t.completedAt == null).toList();
    final columns = <(String, String, ProjectItem?)>[
      ('none', 'No project', null),
      for (final p in projects) (p.id, p.name, p),
    ];
    return SizedBox(
      height: 420,
      child: ListView(
        scrollDirection: Axis.horizontal,
        children: [
          for (final (id, name, project) in columns)
            Builder(
              builder: (context) {
                final items = open.where((t) => id == 'none' ? t.projectId == null : t.projectId == id).toList()
                  ..sort((a, b) {
                    final am = a.moment?.millisecondsSinceEpoch ?? 1 << 62;
                    final bm = b.moment?.millisecondsSinceEpoch ?? 1 << 62;
                    return am != bm ? am.compareTo(bm) : b.priority.compareTo(a.priority);
                  });
                return Container(
                  width: 250,
                  margin: const EdgeInsets.only(right: 10),
                  child: Semantics(
                    container: true,
                    label: '$name, ${items.length} tasks',
                    explicitChildNodes: true,
                    child: Glass(
                      padding: const EdgeInsets.all(10),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Row(
                            children: [
                              Container(
                                width: 10,
                                height: 10,
                                decoration: BoxDecoration(
                                  color: labelColour(l, project?.colour),
                                  shape: BoxShape.circle,
                                ),
                              ),
                              const SizedBox(width: 8),
                              Expanded(child: Text(name.toUpperCase(), style: OrvText.label(l))),
                              Text('${items.length}', style: OrvText.muted(l)),
                            ],
                          ),
                          const SizedBox(height: 8),
                          Expanded(
                            child: ListView(
                              children: [
                                for (final t in items) _BoardCard(task: t, projects: projects, onOpen: onOpen),
                                if (items.isEmpty) Text('Nothing here.', style: OrvText.muted(l)),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                );
              },
            ),
          _NewProject(),
        ],
      ),
    );
  }
}

class _NewProject extends ConsumerStatefulWidget {
  @override
  ConsumerState<_NewProject> createState() => _NewProjectState();
}

class _NewProjectState extends ConsumerState<_NewProject> {
  final _c = TextEditingController();
  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 220,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          OrvField(label: 'New project', controller: _c),
          const SizedBox(height: 8),
          OrvButton(
            label: 'Add project',
            small: true,
            icon: LucideIcons.plus,
            onPressed: () async {
              final n = _c.text.trim();
              if (n.isEmpty) return;
              const colours = ['sky', 'emerald', 'violet', 'amber', 'coral', 'cyan', 'gold'];
              final count = (ref.read(projectsProvider).value ?? const []).length;
              await ref.read(todayActionsProvider).addProject(n, colour: colours[count % colours.length]);
              _c.clear();
            },
          ),
        ],
      ),
    );
  }
}

class _BoardCard extends ConsumerWidget {
  const _BoardCard({required this.task, required this.projects, required this.onOpen});
  final TaskItem task;
  final List<ProjectItem> projects;
  final ValueChanged<TaskItem> onOpen;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final prog = checklistProgress(task);
    final day = task.day;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => onOpen(task),
        onLongPress: () async {
          unawaited(HapticFeedback.selectionClick());
          final box = context.findRenderObject() as RenderBox;
          final pos = box.localToGlobal(Offset.zero);
          final v = await showMenu<String>(
            context: context,
            position: RelativeRect.fromLTRB(pos.dx, pos.dy, pos.dx + 1, pos.dy + 1),
            items: [
              const PopupMenuItem(value: 'none', child: Text('Move to: No project')),
              for (final p in projects) PopupMenuItem(value: p.id, child: Text('Move to: ${p.name}')),
            ],
          );
          if (v != null) await ref.read(todayActionsProvider).update(task.id, {'projectId': v == 'none' ? null : v});
        },
        child: Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: l.c.edge),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(task.title, style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600)),
              Text(
                [
                  if (day != null) day.substring(5),
                  if (task.priority > 0) ['', 'low', 'medium', 'high'][task.priority],
                  if (prog.total > 0) '${prog.done}/${prog.total}',
                  ...task.tags.take(3).map((t) => '#$t'),
                ].join(' · '),
                style: OrvText.muted(l).copyWith(fontSize: 12),
              ),
            ],
          ),
        ),
      ),
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
