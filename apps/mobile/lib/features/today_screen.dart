import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../app/state.dart';
import '../app/task_query.dart';
import '../app/today.dart';
import '../design/glass.dart';
import '../design/theme.dart';
import '../design/toast.dart';
import 'clickup.dart' show TimerPill;
import 'common.dart';
import 'connections.dart';
import 'quick_add.dart';
import 'schedule.dart';
import 'sheets.dart';
import 'task_board.dart';
import 'task_sheet.dart';
import 'task_tools.dart';
import 'today_calendar.dart';
import 'today_kit.dart';
import 'tools.dart';

export 'task_sheet.dart' show openTaskSheet;

/// Today (spec 0002 M1, refined in 0012): quick add; Schedule (meetings), Overdue, Today, Working on (ClickUp),
/// Upcoming, Inbox, Done by day; select mode with a floating action bar; List · Board · Calendar.
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
  bool _searching = false;
  final _picked = <String>{};

  void _setSelecting(bool v, {String? first}) {
    unawaited(HapticFeedback.selectionClick());
    setState(() {
      _selecting = v;
      _picked.clear();
      if (v && first != null) _picked.add(first);
    });
  }

  void _toggle(TaskItem t) {
    HapticFeedback.selectionClick();
    setState(() => _picked.contains(t.id) ? _picked.remove(t.id) : _picked.add(t.id));
  }

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
          return PopScope(
            canPop: !_selecting,
            onPopInvokedWithResult: (didPop, _) {
              if (!didPop && _selecting) _setSelecting(false);
            },
            child: Stack(
              children: [
                RefreshIndicator(
                  color: l.accent,
                  onRefresh: () async {
                    ref.invalidate(clickupTasksProvider);
                    await ref.read(syncProvider).sync().catchError((Object _) {});
                  },
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(16, 56, 16, 160),
                    children: [
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Expanded(child: PageTitle('Today', overline: loc.formatFullDate(now))),
                          Padding(
                            padding: const EdgeInsets.only(bottom: 18, right: 6),
                            child: IconButton(
                              tooltip: 'Schedule a meeting',
                              icon: Icon(LucideIcons.video, color: l.c.muted),
                              onPressed: () => openMeetingSheet(context),
                            ),
                          ),
                          Padding(
                            padding: const EdgeInsets.only(bottom: 18),
                            child: _ViewSwitch(value: _view, onChanged: (v) => setState(() => _view = v)),
                          ),
                        ],
                      ),
                      const Align(alignment: Alignment.centerLeft, child: TimerPill()),
                      const SizedBox(height: 8),
                      // "+" on the home-screen widget opens Today ready to type
                      QuickAdd(focus: GoRouterState.of(context).uri.queryParameters['add'] == '1'),
                      const SizedBox(height: 14),
                      if (_view == 'calendar')
                        TodayCalendar(onOpenTask: (t) => openTaskSheet(context, t))
                      else
                        switch (tasks) {
                          AsyncData(:final value) => _taskArea(context, l, value, now),
                          AsyncError() => Text('Couldn’t read your tasks.', style: OrvText.muted(l)),
                          _ => const GroupCard(children: [SkeletonRows(count: 3)]),
                        },
                    ],
                  ),
                ),
                // the floating action bar while selecting
                Positioned(
                  left: 12,
                  right: 12,
                  bottom: 104,
                  child: AnimatedSwitcher(
                    duration: OrvTokens.durationBase,
                    switchInCurve: springSmooth,
                    transitionBuilder: (c, a) => SlideTransition(
                      position: Tween(begin: const Offset(0, 1.6), end: Offset.zero).animate(a),
                      child: FadeTransition(opacity: a, child: c),
                    ),
                    child: !_selecting
                        ? const SizedBox.shrink()
                        : _SelectBar(
                            picked: [
                              for (final t in tasks.value ?? const <TaskItem>[])
                                if (_picked.contains(t.id)) t,
                            ],
                            onDone: () => _setSelecting(false),
                          ),
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _taskArea(BuildContext context, OrvLook l, List<TaskItem> all, DateTime now) {
    final filtered = _query.isEmpty ? all : all.where((t) => taskMatches(t, _query, now)).toList();
    void open(TaskItem t) => _selecting ? _toggle(t) : openTaskSheet(context, t);
    void hold(TaskItem t) => _selecting ? _toggle(t) : _setSelecting(true, first: t.id);
    final g = groupTasks(filtered, now);
    final rowCtx = _RowCtx(now: now, selecting: _selecting, picked: _picked, onOpen: open, onHold: hold);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        AnimatedSwitcher(
          duration: OrvTokens.durationFast,
          child: _selecting
              ? _SelectHeader(
                  key: const ValueKey('sel'),
                  count: _picked.length,
                  onAll: () => setState(() {
                    final open = filtered.where((t) => !t.done).map((t) => t.id);
                    _picked.length >= open.length ? _picked.clear() : _picked.addAll(open);
                  }),
                  onClose: () => _setSelecting(false),
                )
              : _Toolbar(
                  key: const ValueKey('bar'),
                  scope: _view == 'board' ? null : _scope,
                  onScope: (v) => setState(() => _scope = v),
                  searching: _searching || _query.text.isNotEmpty,
                  onSearch: () => setState(() {
                    final open = _searching || _query.text.isNotEmpty;
                    if (open) _query = _query.copy(text: '');
                    _searching = !open;
                  }),
                  filters: filterCount(_query),
                  onFilters: () => showGlassSheet(
                    context,
                    (_) => TaskFilterSheet(query: _query, tasks: all, onChanged: (q) => setState(() => _query = q)),
                  ),
                  onSelect: () => _setSelecting(true),
                ),
        ),
        const SizedBox(height: 8),
        TaskFilterBar(
          query: _query,
          onChanged: (q) => setState(() => _query = q),
          tasks: all,
          searching: _searching || _query.text.isNotEmpty,
        ),
        const SizedBox(height: 4),
        if (_view == 'board')
          TaskBoard(tasks: filtered, onOpen: open)
        else if (_scope == 'done')
          _DoneByDay(tasks: filtered.where((t) => t.done).toList(), row: rowCtx)
        else ...[
          if ((_scope == 'all' || _scope == 'today') && _query.isEmpty) const ScheduleGroup(),
          if (_scope == 'all' || _scope == 'today') ...[
            if (g.overdue.isNotEmpty)
              _Section(title: 'Overdue', icon: LucideIcons.alarmClock, items: g.overdue, row: rowCtx, danger: true),
            _Section(
              title: 'Today',
              icon: LucideIcons.sun,
              items: g.today,
              row: rowCtx,
              empty: !_query.isEmpty
                  ? 'Nothing matches today.'
                  : 'Nothing planned for today. Add something above, or enjoy it.',
            ),
            if (_query.isEmpty) const WorkingOnGroup(),
          ],
          if ((_scope == 'all' && g.upcoming.isNotEmpty) || _scope == 'upcoming')
            _Section(
              title: 'Upcoming',
              icon: LucideIcons.calendarDays,
              items: g.upcoming,
              row: rowCtx,
              empty: 'Nothing coming up.',
              dayHeaders: true,
            ),
          if (_scope == 'all' || _scope == 'inbox')
            _Section(
              title: 'Inbox',
              icon: LucideIcons.inbox,
              items: g.inbox,
              row: rowCtx,
              hint: g.inbox.isEmpty ? null : 'No day yet — give one a day to plan it.',
              empty: !_query.isEmpty ? 'Nothing matches in the Inbox.' : 'Inbox zero — everything has a day.',
            ),
          if (_scope == 'all' && g.doneToday.isNotEmpty)
            _Section(
              title: 'Done today',
              icon: LucideIcons.circleCheck,
              items: g.doneToday,
              row: rowCtx,
              tone: l.c.success,
              collapsible: true,
            ),
          if (_scope == 'all' && _query.isEmpty) const FromYourToolsSection(),
        ],
      ],
    );
  }
}

/// What every row needs to know, passed down once.
class _RowCtx {
  const _RowCtx({
    required this.now,
    required this.selecting,
    required this.picked,
    required this.onOpen,
    required this.onHold,
  });
  final DateTime now;
  final bool selecting;
  final Set<String> picked;
  final ValueChanged<TaskItem> onOpen;
  final ValueChanged<TaskItem> onHold;
}

/// List · Board · Calendar as three icons in one pill, next to the title.
class _ViewSwitch extends StatelessWidget {
  const _ViewSwitch({required this.value, required this.onChanged});
  final String value;
  final ValueChanged<String> onChanged;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return Container(
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(
        color: l.c.glassStrong,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: l.c.edge),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final (v, name, icon) in const [
            ('list', 'List', LucideIcons.list),
            ('board', 'Board', LucideIcons.columns3),
            ('calendar', 'Calendar', LucideIcons.calendarDays),
          ])
            Semantics(
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
                  width: 38,
                  height: 32,
                  decoration: BoxDecoration(
                    gradient: value == v ? l.accentGradient : null,
                    borderRadius: BorderRadius.circular(11),
                  ),
                  child: Icon(icon, size: 17, color: value == v ? Colors.white : l.c.muted),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

Widget _iconButton(OrvLook l, IconData i, String label, bool on, VoidCallback tap, {int badge = 0}) => Semantics(
  container: true,
  button: true,
  selected: on,
  label: label,
  excludeSemantics: true,
  child: GestureDetector(
    onTap: tap,
    child: Stack(
      clipBehavior: Clip.none,
      children: [
        AnimatedContainer(
          duration: OrvTokens.durationFast,
          width: 36,
          height: 36,
          decoration: BoxDecoration(
            color: on ? l.accent.withValues(alpha: 0.14) : Colors.transparent,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Icon(i, size: 18, color: on ? l.accent : l.c.muted),
        ),
        if (badge > 0)
          Positioned(
            right: 2,
            top: 2,
            child: Container(
              width: 15,
              height: 15,
              alignment: Alignment.center,
              decoration: BoxDecoration(gradient: l.accentGradient, shape: BoxShape.circle),
              child: Text(
                '$badge',
                style: const TextStyle(
                  fontFamily: fontFamily,
                  color: Colors.white,
                  fontSize: 9,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ),
      ],
    ),
  ),
);

/// One quiet row: which tasks (text tabs), then search, filters and select as icons.
class _Toolbar extends StatelessWidget {
  const _Toolbar({
    super.key,
    required this.scope,
    required this.onScope,
    required this.searching,
    required this.onSearch,
    required this.filters,
    required this.onFilters,
    required this.onSelect,
  });

  /// null on the board (it shows every open task by status)
  final String? scope;
  final ValueChanged<String> onScope;
  final bool searching;
  final VoidCallback onSearch;
  final int filters;
  final VoidCallback onFilters;
  final VoidCallback onSelect;

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return Row(
      children: [
        Expanded(
          child: scope == null
              ? Text('By status', style: OrvText.muted(l).copyWith(fontWeight: FontWeight.w600))
              : SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: [
                      for (final (v, name) in const [
                        ('all', 'All'),
                        ('today', 'Today'),
                        ('upcoming', 'Upcoming'),
                        ('inbox', 'Inbox'),
                        ('done', 'Done'),
                      ])
                        GestureDetector(
                          behavior: HitTestBehavior.opaque,
                          onTap: () {
                            HapticFeedback.selectionClick();
                            onScope(v);
                          },
                          child: Padding(
                            padding: const EdgeInsets.fromLTRB(4, 8, 12, 8),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  name,
                                  style: OrvText.body(l).copyWith(
                                    fontSize: 15,
                                    fontWeight: scope == v ? FontWeight.w700 : FontWeight.w500,
                                    color: scope == v ? l.c.text : l.c.muted,
                                  ),
                                ),
                                const SizedBox(height: 4),
                                AnimatedContainer(
                                  duration: OrvTokens.durationFast,
                                  height: 3,
                                  width: scope == v ? 18 : 0,
                                  decoration: BoxDecoration(
                                    gradient: l.accentGradient,
                                    borderRadius: BorderRadius.circular(2),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
        ),
        _iconButton(
          l,
          searching ? LucideIcons.x : LucideIcons.search,
          searching ? 'Close search' : 'Search tasks',
          searching,
          onSearch,
        ),
        _iconButton(l, LucideIcons.slidersHorizontal, 'Filters', filters > 0, onFilters, badge: filters),
        _iconButton(l, LucideIcons.squareCheck, 'Select tasks', false, onSelect),
      ],
    );
  }
}

/// While selecting, the toolbar becomes "3 selected · Select all · ✕".
class _SelectHeader extends StatelessWidget {
  const _SelectHeader({super.key, required this.count, required this.onAll, required this.onClose});
  final int count;
  final VoidCallback onAll;
  final VoidCallback onClose;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return Container(
      height: 46,
      padding: const EdgeInsets.only(left: 4),
      decoration: BoxDecoration(
        color: l.accent.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
        border: Border.all(color: l.accent.withValues(alpha: 0.35)),
      ),
      child: Row(
        children: [
          _iconButton(l, LucideIcons.x, 'Stop selecting', false, onClose),
          const SizedBox(width: 4),
          Expanded(
            child: AnimatedSwitcher(
              duration: OrvTokens.durationFast,
              transitionBuilder: (c, a) => ScaleTransition(scale: a, child: c),
              child: Text(
                count == 0 ? 'Tap tasks to select' : '$count selected',
                key: ValueKey(count),
                style: OrvText.body(l).copyWith(fontWeight: FontWeight.w700, color: count == 0 ? l.c.muted : l.c.text),
              ),
            ),
          ),
          TextButton(onPressed: onAll, child: const Text('Select all')),
        ],
      ),
    );
  }
}

/// The floating bar while selecting: Done · When · Project · Priority · Delete.
class _SelectBar extends ConsumerWidget {
  const _SelectBar({required this.picked, required this.onDone});
  final List<TaskItem> picked;
  final VoidCallback onDone;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final actions = ref.read(todayActionsProvider);
    final toaster = Toaster.of(context);
    final none = picked.isEmpty;
    Future<void> each(Future<void> Function(TaskItem t) fn, String said) async {
      final n = picked.length;
      for (final t in [...picked]) {
        await fn(t);
      }
      onDone();
      toaster.show('$said $n', tone: ToastTone.success);
    }

    Widget act(IconData i, String label, VoidCallback? tap, {Color? tone}) => Expanded(
      child: Semantics(
        container: true,
        button: true,
        enabled: tap != null,
        label: label,
        excludeSemantics: true,
        child: InkWell(
          borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
          onTap: tap == null
              ? null
              : () {
                  HapticFeedback.selectionClick();
                  tap();
                },
          child: AnimatedOpacity(
            duration: OrvTokens.durationFast,
            opacity: tap == null ? 0.4 : 1,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(i, size: 20, color: tone ?? l.c.text),
                  const SizedBox(height: 3),
                  Text(label, style: OrvText.muted(l).copyWith(fontSize: 11, color: tone ?? l.c.text)),
                ],
              ),
            ),
          ),
        ),
      ),
    );

    return Glass(
      level: GlassLevel.float,
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      child: Row(
        children: [
          act(
            LucideIcons.circleCheck,
            'Done',
            none ? null : () => each((t) => actions.complete(t.id, true), 'Done:'),
            tone: l.accent,
          ),
          act(
            LucideIcons.calendar,
            'When',
            none
                ? null
                : () async {
                    final now = ref.read(clockProvider)();
                    String plus(int n) => dayKey(now.add(Duration(days: n)));
                    final v = await pickOne<String>(context, 'Move ${picked.length} to…', [
                      PickOption(plus(0), 'Today', icon: LucideIcons.sun),
                      PickOption(plus(1), 'Tomorrow', icon: LucideIcons.sunrise),
                      PickOption(plus(7), 'In a week', icon: LucideIcons.calendarRange, sub: dayWords(plus(7), now)),
                      const PickOption('pick', 'Pick a date…', icon: LucideIcons.calendarSearch),
                      const PickOption('', 'No day (Inbox)', icon: LucideIcons.inbox),
                    ]);
                    if (v == null || !context.mounted) return;
                    var day = v;
                    if (v == 'pick') {
                      final d = await showDatePicker(
                        context: context,
                        initialDate: now,
                        firstDate: now.subtract(const Duration(days: 365)),
                        lastDate: now.add(const Duration(days: 365 * 5)),
                      );
                      if (d == null) return;
                      day = dayKey(d);
                    }
                    await each(
                      (t) => actions.update(t.id, {
                        'dueDate': day.isEmpty ? null : day,
                        'dueAt': null,
                        'scheduledStart': null,
                      }),
                      'Moved',
                    );
                  },
          ),
          act(
            LucideIcons.folder,
            'Project',
            none
                ? null
                : () async {
                    final projects = ref.read(projectsProvider).value ?? const <ProjectItem>[];
                    final v = await pickOne<String>(context, 'Move to project', [
                      for (final p in projects) PickOption(p.id, p.name, colour: labelColour(l, p.colour)),
                      const PickOption('', 'No project', icon: LucideIcons.circleSlash),
                    ]);
                    if (v != null) {
                      await each((t) => actions.update(t.id, {'projectId': v.isEmpty ? null : v}), 'Moved');
                    }
                  },
          ),
          act(
            LucideIcons.flag,
            'Priority',
            none
                ? null
                : () async {
                    final v = await pickOne<int>(context, 'Priority', [
                      PickOption(3, 'High', colour: l.c.danger),
                      PickOption(2, 'Medium', colour: l.c.warning),
                      PickOption(1, 'Low', colour: l.c.faint),
                      const PickOption(0, 'None', icon: LucideIcons.circleSlash),
                    ]);
                    if (v != null) await each((t) => actions.update(t.id, {'priority': v}), 'Updated');
                  },
          ),
          act(
            LucideIcons.trash2,
            'Delete',
            none
                ? null
                : () async {
                    final ok = await showDialog<bool>(
                      context: context,
                      builder: (ctx) => AlertDialog(
                        title: Text('Delete ${picked.length} ${picked.length == 1 ? 'task' : 'tasks'}?'),
                        actions: [
                          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Keep')),
                          TextButton(onPressed: () => Navigator.of(ctx).pop(true), child: const Text('Delete')),
                        ],
                      ),
                    );
                    if (ok == true) await each((t) => actions.remove(t.id), 'Deleted');
                  },
            tone: l.c.danger,
          ),
        ],
      ),
    );
  }
}

class _Section extends StatefulWidget {
  const _Section({
    required this.title,
    required this.icon,
    required this.items,
    required this.row,
    this.empty,
    this.hint,
    this.danger = false,
    this.tone,
    this.collapsible = false,
    this.dayHeaders = false,
  });
  final String title;
  final IconData icon;
  final List<TaskItem> items;
  final _RowCtx row;
  final String? empty;
  final String? hint;
  final bool danger;
  final Color? tone;
  final bool collapsible;
  final bool dayHeaders;
  @override
  State<_Section> createState() => _SectionState();
}

class _SectionState extends State<_Section> {
  bool _open = true;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final tone = widget.danger ? l.c.danger : widget.tone;
    String? lastDay;
    return Semantics(
      container: true,
      label: '${widget.title} list',
      explicitChildNodes: true,
      child: GroupCard(
        children: [
          GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: widget.collapsible ? () => setState(() => _open = !_open) : null,
            child: GroupHeader(
              title: widget.title,
              icon: widget.icon,
              count: widget.items.length,
              tone: tone,
              hint: widget.hint,
              trailing: widget.collapsible
                  ? Icon(_open ? LucideIcons.chevronUp : LucideIcons.chevronDown, size: 16, color: l.c.muted)
                  : null,
            ),
          ),
          if (_open) ...[
            for (final t in widget.items) ...[
              if (widget.dayHeaders && t.day != lastDay && (lastDay = t.day) != null)
                Padding(
                  padding: const EdgeInsets.fromLTRB(6, 8, 6, 2),
                  child: Text(
                    dayWords(t.day!, widget.row.now),
                    style: OrvText.muted(l).copyWith(fontSize: 12, fontWeight: FontWeight.w700),
                  ),
                ),
              _TaskRow(key: ValueKey(t.id), task: t, ctx: widget.row),
            ],
            if (widget.items.isEmpty && widget.empty != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(6, 2, 6, 8),
                child: Text(widget.empty!, style: OrvText.muted(l)),
              ),
          ],
        ],
      ),
    );
  }
}

/// The Done tab: under day headers ("Today", "Yesterday", "Mon 18 Nov"), newest first, a month at a time.
class _DoneByDay extends StatefulWidget {
  const _DoneByDay({required this.tasks, required this.row});
  final List<TaskItem> tasks;
  final _RowCtx row;
  @override
  State<_DoneByDay> createState() => _DoneByDayState();
}

class _DoneByDayState extends State<_DoneByDay> {
  int _days = 30;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final now = widget.row.now;
    final since = now.subtract(Duration(days: _days));
    final all = [...widget.tasks]..sort((a, b) => b.completedAt!.compareTo(a.completedAt!));
    final shown = all.where((t) => t.completedAt!.isAfter(since)).toList();
    final groups = <String, List<TaskItem>>{};
    for (final t in shown) {
      (groups[doneDayHeader(t.completedAt!, now)] ??= []).add(t);
    }
    if (all.isEmpty) {
      return GroupCard(children: [Text('Nothing finished yet. It’ll all be here, by day.', style: OrvText.muted(l))]);
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final e in groups.entries)
          GroupCard(
            children: [
              GroupHeader(title: e.key, icon: LucideIcons.circleCheck, count: e.value.length, tone: l.c.success),
              for (final t in e.value) _TaskRow(key: ValueKey(t.id), task: t, ctx: widget.row),
            ],
          ),
        if (shown.length < all.length)
          Center(
            child: TextButton.icon(
              icon: const Icon(LucideIcons.history, size: 16),
              label: Text('Show older (${all.length - shown.length})'),
              onPressed: () => setState(() => _days += 60),
            ),
          ),
      ],
    );
  }
}

/// One task row: a circle to tick (a checkbox while selecting), the title, and what matters about it as small
/// icon-labels. Swipe right: done. Swipe left: to tomorrow. Hold: select (spec 0012 A1, A7).
class _TaskRow extends ConsumerWidget {
  const _TaskRow({super.key, required this.task, required this.ctx});
  final TaskItem task;
  final _RowCtx ctx;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final t = task;
    final now = ctx.now;
    final done = t.done;
    final selected = ctx.picked.contains(t.id);
    final projects = ref.watch(projectsProvider).value ?? const <ProjectItem>[];
    final project = projects.where((p) => p.id == t.projectId).firstOrNull;
    final loc = MaterialLocalizations.of(context);
    final moment = t.moment;
    final late = !done && moment != null && moment.isBefore(now);
    final lateDay = !done && t.day != null && t.day!.compareTo(dayKey(now)) < 0;
    final dl = deadlineTone(t.deadline, now);
    final prog = checklistProgress(t);

    Widget meta(IconData i, String s, [Color? c]) => Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(i, size: 12, color: c ?? l.c.faint),
        const SizedBox(width: 3),
        Text(s, style: OrvText.muted(l).copyWith(fontSize: 12, color: c)),
      ],
    );

    final metas = <Widget>[
      if (done) meta(LucideIcons.circleCheck, doneLabel(t.completedAt!, now), l.c.success),
      if (!done && t.status == 'doing')
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
          decoration: BoxDecoration(
            color: l.accent.withValues(alpha: 0.14),
            borderRadius: BorderRadius.circular(OrvTokens.radiusFull),
          ),
          child: Text(
            'DOING',
            style: OrvText.muted(l)
                .copyWith(fontSize: 9.5, fontWeight: FontWeight.w800, letterSpacing: 0.7, color: l.accent),
          ),
        ),
      if (!done && moment != null)
        meta(
          LucideIcons.clock,
          '${t.day == dayKey(now) ? '' : '${dayWords(t.day!, now)}, '}${loc.formatTimeOfDay(TimeOfDay.fromDateTime(moment))}',
          late ? l.c.danger : null,
        )
      else if (!done && t.day != null && t.day != dayKey(now))
        meta(LucideIcons.calendar, dayWords(t.day!, now), lateDay ? l.c.danger : null),
      if (t.durationMin != null) meta(LucideIcons.timer, hm(t.durationMin!)),
      if (t.deadline != null && !done)
        meta(
          LucideIcons.flagTriangleRight,
          'by ${dayWords(t.deadline!, now)}',
          dl == 'past' ? l.c.danger : (dl == 'near' ? l.c.warning : null),
        ),
      if (project != null)
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 7,
              height: 7,
              decoration: BoxDecoration(color: labelColour(l, project.colour), shape: BoxShape.circle),
            ),
            const SizedBox(width: 4),
            Text(project.name, style: OrvText.muted(l).copyWith(fontSize: 12)),
          ],
        ),
      if (prog.total > 0) meta(LucideIcons.listChecks, '${prog.done}/${prog.total}'),
      if (t.repeats) meta(LucideIcons.repeat, ''),
      if (t.notes.trim().isNotEmpty) meta(LucideIcons.stickyNote, ''),
      for (final tag in t.tags.take(2)) Text('#$tag', style: OrvText.muted(l).copyWith(fontSize: 12, color: l.c.faint)),
    ];

    final row = AnimatedContainer(
      duration: OrvTokens.durationFast,
      curve: Curves.easeOut,
      margin: const EdgeInsets.symmetric(vertical: 1),
      decoration: BoxDecoration(
        color: selected ? l.accent.withValues(alpha: l.dark ? 0.18 : 0.10) : Colors.transparent,
        borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
        border: Border.all(color: selected ? l.accent.withValues(alpha: 0.55) : Colors.transparent, width: 1.2),
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
          onTap: () => ctx.onOpen(t),
          onLongPress: () {
            HapticFeedback.mediumImpact();
            ctx.onHold(t);
          },
          child: Padding(
            padding: const EdgeInsets.fromLTRB(2, 6, 6, 6),
            child: Row(
              children: [
                AnimatedSwitcher(
                  duration: OrvTokens.durationFast,
                  transitionBuilder: (c, a) => ScaleTransition(scale: a, child: c),
                  child: ctx.selecting
                      ? _SelectBox(key: const ValueKey('box'), on: selected, onTap: () => ctx.onOpen(t))
                      : CompleteCircle(
                          key: const ValueKey('circle'),
                          done: done,
                          doing: t.status == 'doing',
                          label: '${done ? 'Mark not done' : 'Complete'} ${t.title}',
                          onTap: () => ref.read(todayActionsProvider).complete(t.id, !done),
                        ),
                ),
                const SizedBox(width: 8),
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
                          decorationColor: l.c.faint,
                        ),
                      ),
                      if (metas.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(top: 2),
                          child: Wrap(
                            spacing: 10,
                            runSpacing: 2,
                            crossAxisAlignment: WrapCrossAlignment.center,
                            children: metas,
                          ),
                        ),
                    ],
                  ),
                ),
                if (t.priority >= 1 && !done)
                  Semantics(
                    label: ['', 'Low priority', 'Medium priority', 'High priority'][t.priority],
                    child: Icon(
                      LucideIcons.flag,
                      size: 15,
                      color: t.priority == 3 ? l.c.danger : (t.priority == 2 ? l.c.warning : l.c.faint),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );

    if (ctx.selecting) return row;
    // swipe right: done; swipe left: tomorrow (an Inbox task: today)
    final toDay = t.day == null ? dayKey(now) : dayKey(now.add(const Duration(days: 1)));
    Widget bg(Alignment a, Color c, IconData i, String s) => Container(
      alignment: a,
      padding: const EdgeInsets.symmetric(horizontal: 18),
      decoration: BoxDecoration(
        color: c.withValues(alpha: 0.16),
        borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(i, size: 18, color: c),
          const SizedBox(width: 6),
          Text(
            s,
            style: OrvText.muted(l).copyWith(fontWeight: FontWeight.w700, color: c),
          ),
        ],
      ),
    );
    return Dismissible(
      key: ValueKey('swipe-${t.id}'),
      direction: done ? DismissDirection.startToEnd : DismissDirection.horizontal,
      background: bg(
        Alignment.centerLeft,
        l.c.success,
        done ? LucideIcons.rotateCcw : LucideIcons.check,
        done ? 'Not done' : 'Done',
      ),
      secondaryBackground: bg(
        Alignment.centerRight,
        l.c.warning,
        t.day == null ? LucideIcons.sun : LucideIcons.sunrise,
        t.day == null ? 'Today' : 'Tomorrow',
      ),
      confirmDismiss: (dir) async {
        unawaited(HapticFeedback.mediumImpact());
        final a = ref.read(todayActionsProvider);
        if (dir == DismissDirection.startToEnd) {
          await a.complete(t.id, !done);
        } else {
          await a.update(t.id, {'dueDate': toDay, 'dueAt': null, 'scheduledStart': null});
          if (context.mounted) {
            Toaster.of(context).show('Moved to ${t.day == null ? 'today' : 'tomorrow'}', body: t.title);
          }
        }
        return false; // the row moves by itself when the data changes
      },
      child: row,
    );
  }
}

class _SelectBox extends StatelessWidget {
  const _SelectBox({super.key, required this.on, required this.onTap});
  final bool on;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return Semantics(
      container: true,
      checked: on,
      button: true,
      label: on ? 'Selected' : 'Not selected',
      excludeSemantics: true,
      child: GestureDetector(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(5),
          child: AnimatedContainer(
            duration: OrvTokens.durationFast,
            curve: springSnappy,
            width: 24,
            height: 24,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(7),
              gradient: on ? l.accentGradient : null,
              border: Border.all(color: on ? Colors.transparent : l.c.faint, width: 2),
              boxShadow: on ? [BoxShadow(color: l.accentFrom.withValues(alpha: 0.4), blurRadius: 10)] : null,
            ),
            child: AnimatedScale(
              duration: OrvTokens.durationFast,
              scale: on ? 1 : 0,
              child: const Icon(Icons.check_rounded, size: 17, color: Colors.white),
            ),
          ),
        ),
      ),
    );
  }
}
