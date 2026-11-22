import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../app/state.dart';
import '../app/task_query.dart';
import '../app/today.dart';
import '../design/glass.dart';
import '../design/theme.dart';
import '../design/toast.dart';
import 'schedule.dart';
import 'today_calendar.dart' show labelColour;
import 'today_kit.dart';

/// The board (spec 0012 A8): To do · Doing · Done today, one column per screen with a peek of the next. A project
/// pill narrows it; long-press a card and drop it on another column (or ⋯ → Move to).
class TaskBoard extends ConsumerStatefulWidget {
  const TaskBoard({super.key, required this.tasks, required this.onOpen});
  final List<TaskItem> tasks;
  final ValueChanged<TaskItem> onOpen;
  @override
  ConsumerState<TaskBoard> createState() => _TaskBoardState();
}

const _columns = [
  ('todo', 'To do', LucideIcons.circle),
  ('doing', 'Doing', LucideIcons.circleDashed),
  ('done', 'Done today', LucideIcons.circleCheck),
];

/// Moves a task to a board column: a status, or done.
Future<void> moveTask(WidgetRef ref, TaskItem t, String column) async {
  final a = ref.read(todayActionsProvider);
  if (column == 'done') {
    if (!t.done) await a.complete(t.id, true);
    return;
  }
  await a.update(t.id, {'status': column, if (t.done) 'completedAt': null});
}

class _TaskBoardState extends ConsumerState<TaskBoard> {
  String? _project; // null = all, '' = no project
  final _pages = PageController(viewportFraction: 0.86);

  @override
  void dispose() {
    _pages.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final now = ref.watch(clockProvider)();
    final today = dayKey(now);
    final projects = ref.watch(projectsProvider).value ?? const <ProjectItem>[];
    final current = projects.where((p) => p.id == _project).firstOrNull;
    final shown = widget.tasks.where((t) => _project == null || (t.projectId ?? '') == _project).toList();
    List<TaskItem> col(String k) {
      final items = switch (k) {
        'done' => shown.where((t) => t.done && dayKey(t.completedAt!) == today).toList(),
        _ => shown.where((t) => !t.done && t.status == k).toList(),
      };
      items.sort((a, b) {
        if (k == 'done') return b.completedAt!.compareTo(a.completedAt!);
        // planned for today and overdue first, then by time, then priority
        final ad = a.day ?? '9999';
        final bd = b.day ?? '9999';
        if (ad != bd) return ad.compareTo(bd);
        final am = a.moment?.millisecondsSinceEpoch ?? 1 << 62;
        final bm = b.moment?.millisecondsSinceEpoch ?? 1 << 62;
        return am != bm ? am.compareTo(bm) : b.priority.compareTo(a.priority);
      });
      return items;
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            FactPill(
              icon: LucideIcons.folder,
              label: _project == null ? 'All projects' : (current?.name ?? 'No project'),
              tone: current == null ? null : labelColour(l, current.colour),
              onTap: () async {
                final v = await pickOne<String>(context, 'Show on the board', [
                  PickOption('*', 'All projects', icon: LucideIcons.layers, selected: _project == null),
                  for (final p in projects)
                    PickOption(p.id, p.name, colour: labelColour(l, p.colour), selected: _project == p.id),
                  PickOption('', 'No project', icon: LucideIcons.circleSlash, selected: _project == ''),
                ]);
                if (v != null) setState(() => _project = v == '*' ? null : v);
              },
            ),
            const Spacer(),
            Text('Hold a card to move it', style: OrvText.muted(l).copyWith(fontSize: 11.5, color: l.c.faint)),
          ],
        ),
        const SizedBox(height: 10),
        const ScheduleStrip(),
        FitAboveNav(
          builder: (height) => SizedBox(
            height: height,
            child: PageView(
              controller: _pages,
              padEnds: false,
              children: [
                for (final (k, name, icon) in _columns)
                  _Column(
                    keyName: k,
                    name: name,
                    icon: icon,
                    items: col(k),
                    showProject: _project == null,
                    onOpen: widget.onOpen,
                  ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _Column extends ConsumerWidget {
  const _Column({
    required this.keyName,
    required this.name,
    required this.icon,
    required this.items,
    required this.showProject,
    required this.onOpen,
  });
  final String keyName;
  final String name;
  final IconData icon;
  final List<TaskItem> items;
  final bool showProject;
  final ValueChanged<TaskItem> onOpen;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final tone = switch (keyName) {
      'doing' => l.accent,
      'done' => l.c.success,
      _ => l.c.muted,
    };
    return DragTarget<TaskItem>(
      onWillAcceptWithDetails: (d) => keyName == 'done' ? !d.data.done : (d.data.done || d.data.status != keyName),
      onAcceptWithDetails: (d) async {
        await HapticFeedback.mediumImpact();
        await moveTask(ref, d.data, keyName);
        if (context.mounted) Toaster.of(context).show('Moved to $name', body: d.data.title, tone: ToastTone.success);
      },
      builder: (context, cand, _) => Padding(
        padding: const EdgeInsets.only(right: 10),
        child: AnimatedContainer(
          duration: OrvTokens.durationFast,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
            border: Border.all(color: cand.isNotEmpty ? tone : Colors.transparent, width: 1.5),
            boxShadow: cand.isNotEmpty ? [BoxShadow(color: tone.withValues(alpha: 0.22), spreadRadius: 3)] : null,
          ),
          child: Glass(
            blur: false,
            padding: const EdgeInsets.fromLTRB(10, 12, 10, 4),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                GroupHeader(title: name, icon: icon, count: items.length, tone: tone),
                const SizedBox(height: 4),
                Expanded(
                  child: items.isEmpty
                      ? Center(
                          child: Padding(
                            padding: const EdgeInsets.all(20),
                            child: Text(
                              switch (keyName) {
                                'doing' => 'Drop what you’re on here.',
                                'done' => 'Nothing finished today yet.',
                                _ => 'All clear.',
                              },
                              textAlign: TextAlign.center,
                              style: OrvText.muted(l),
                            ),
                          ),
                        )
                      : ListView(
                          padding: const EdgeInsets.only(bottom: 8),
                          children: [
                            for (final t in items)
                              LongPressDraggable<TaskItem>(
                                data: t,
                                hapticFeedbackOnStart: true,
                                feedback: Material(
                                  color: Colors.transparent,
                                  child: SizedBox(
                                    width: MediaQuery.sizeOf(context).width * 0.74,
                                    child: Transform.rotate(
                                      angle: -0.02,
                                      child: _Card(task: t, showProject: showProject, lifted: true),
                                    ),
                                  ),
                                ),
                                childWhenDragging: Opacity(
                                  opacity: 0.3,
                                  child: _Card(task: t, showProject: showProject),
                                ),
                                child: GestureDetector(
                                  onTap: () => onOpen(t),
                                  child: _Card(task: t, showProject: showProject, column: keyName),
                                ),
                              ),
                          ],
                        ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Card extends ConsumerWidget {
  const _Card({required this.task, required this.showProject, this.lifted = false, this.column});
  final TaskItem task;
  final bool showProject;
  final bool lifted;
  final String? column;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final now = ref.watch(clockProvider)();
    final projects = ref.watch(projectsProvider).value ?? const <ProjectItem>[];
    final p = projects.where((x) => x.id == task.projectId).firstOrNull;
    final prog = checklistProgress(task);
    final day = task.day;
    final late = day != null && day.compareTo(dayKey(now)) < 0 && !task.done;
    final dl = deadlineTone(task.deadline, now);
    final loc = MaterialLocalizations.of(context);
    Widget meta(IconData i, String s, [Color? c]) => Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(i, size: 11, color: c ?? l.c.faint),
        const SizedBox(width: 3),
        Text(s, style: OrvText.muted(l).copyWith(fontSize: 11.5, color: c)),
      ],
    );
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.fromLTRB(12, 10, 6, 10),
      decoration: BoxDecoration(
        color: lifted ? l.c.glassStrong : l.c.field,
        borderRadius: BorderRadius.circular(12),
        border: Border(
          left: BorderSide(color: p == null ? l.c.edge : labelColour(l, p.colour), width: 3),
          top: BorderSide(color: l.c.edge),
          right: BorderSide(color: l.c.edge),
          bottom: BorderSide(color: l.c.edge),
        ),
        boxShadow: lifted
            ? [BoxShadow(color: Colors.black.withValues(alpha: 0.22), blurRadius: 24, offset: const Offset(0, 10))]
            : null,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  task.title,
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                  style: OrvText.body(l).copyWith(
                    fontWeight: FontWeight.w600,
                    fontSize: 14,
                    color: task.done ? l.c.muted : null,
                    decoration: task.done ? TextDecoration.lineThrough : null,
                  ),
                ),
                const SizedBox(height: 4),
                Wrap(
                  spacing: 8,
                  runSpacing: 2,
                  children: [
                    if (task.done) meta(LucideIcons.circleCheck, doneLabel(task.completedAt!, now), l.c.success),
                    if (!task.done && task.moment != null)
                      meta(
                        LucideIcons.clock,
                        '${day == dayKey(now) ? '' : '${dayWords(day!, now)} '}${loc.formatTimeOfDay(TimeOfDay.fromDateTime(task.moment!))}',
                        late ? l.c.danger : null,
                      )
                    else if (!task.done && day != null)
                      meta(LucideIcons.calendar, dayWords(day, now), late ? l.c.danger : null),
                    if (task.durationMin != null) meta(LucideIcons.timer, hm(task.durationMin!)),
                    if (task.deadline != null && !task.done)
                      meta(
                        LucideIcons.flagTriangleRight,
                        'by ${dayWords(task.deadline!, now)}',
                        dl == 'past' ? l.c.danger : (dl == 'near' ? l.c.warning : null),
                      ),
                    if (prog.total > 0) meta(LucideIcons.listChecks, '${prog.done}/${prog.total}'),
                    if (showProject && p != null) meta(LucideIcons.folder, p.name, labelColour(l, p.colour)),
                  ],
                ),
              ],
            ),
          ),
          if (task.priority >= 2)
            Padding(
              padding: const EdgeInsets.only(left: 4, top: 2),
              child: Icon(LucideIcons.flag, size: 14, color: task.priority == 3 ? l.c.danger : l.c.warning),
            ),
          if (column != null)
            PopupMenuButton<String>(
              tooltip: 'Move to',
              padding: EdgeInsets.zero,
              iconSize: 16,
              icon: Icon(LucideIcons.ellipsisVertical, size: 16, color: l.c.faint),
              onSelected: (v) => moveTask(ref, task, v),
              itemBuilder: (_) => [
                for (final (k, name, _) in _columns)
                  if (k != column) PopupMenuItem(value: k, child: Text('Move to $name')),
              ],
            ),
        ],
      ),
    );
  }
}
