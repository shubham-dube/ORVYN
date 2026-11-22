import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../app/calendar.dart' show urlOpenerProvider;
import '../app/state.dart';
import '../app/today.dart' show dayKey, dayWords, clock12;
import '../design/controls.dart';
import '../design/glass.dart';
import '../design/theme.dart';
import '../design/toast.dart';
import 'common.dart';
import 'connections.dart';
import 'sheets.dart';
import 'today_kit.dart';

/// ClickUp without opening ClickUp (spec 0012 B): every status grouped, the task sheet (status, priority, due,
/// timer, time, subtasks, comments) and a running-timer pill.

typedef J = Map<String, dynamic>;

// ------------------------------------------------------------------ data

final clickupClosedProvider = FutureProvider.autoDispose<List<J>>((ref) async {
  final r = await ref.read(apiProvider).get<List<dynamic>>('/connections/clickup/tasks', query: {'closed': '1'});
  return [for (final x in r) J.from(x as Map)];
});

/// The running timer (any account), or null. A timer started in ClickUp itself shows here too.
final clickupTimerProvider = FutureProvider.autoDispose<J?>((ref) async {
  ref.keepAlive();
  final conns = await ref.watch(connectionsProvider.future);
  if (!conns.any((c) => c.provider == 'clickup')) return null;
  final r = await ref.read(apiProvider).get<J>('/connections/clickup/timer');
  return r['timer'] == null ? null : J.from(r['timer'] as Map);
});

final clickupDetailProvider = FutureProvider.autoDispose.family<J, (String, String)>((ref, k) async {
  return ref.read(apiProvider).get<J>('/connections/clickup/tasks/${k.$2}', query: {'connectionId': k.$1});
});

String _taskPath(J t) => '/connections/clickup/tasks/${Uri.encodeComponent(t['id'] as String)}';

/// Status change, optimistic: Today moves the task at once; if ClickUp refuses, it moves back with a toast.
Future<bool> setClickUpStatus(WidgetRef ref, BuildContext context, J t, String status) async {
  final toaster = Toaster.of(context);
  try {
    await ref.read(apiProvider).patch<dynamic>(_taskPath(t), {'connectionId': t['connectionId'], 'status': status});
    ref.invalidate(clickupTasksProvider);
    ref.invalidate(clickupDetailProvider((t['connectionId'] as String, t['id'] as String)));
    toaster.show('Moved to $status', body: t['name'] as String?, tone: ToastTone.success);
    return true;
  } catch (e) {
    toaster.show('ClickUp didn’t take it', body: messageFor(e), tone: ToastTone.danger);
    return false;
  }
}

/// Opens the status list for a task and moves it.
Future<void> pickClickUpStatus(WidgetRef ref, BuildContext context, J t, {List<J>? statuses}) async {
  final l = context.orv;
  var list = statuses;
  if (list == null) {
    try {
      final d = await ref.read(clickupDetailProvider((t['connectionId'] as String, t['id'] as String)).future);
      list = [for (final s in d['statuses'] as List) J.from(s as Map)];
    } catch (_) {
      list = const [];
    }
  }
  if (!context.mounted || list.isEmpty) return;
  final v = await pickOne<String>(context, 'Move to', [
    for (final s in list)
      PickOption(
        s['name'] as String,
        _cap(s['name'] as String),
        colour: hexColour(s['color'] as String?, l),
        sub: s['type'] == 'closed' || s['type'] == 'done' ? 'Done' : null,
        selected: (s['name'] as String).toLowerCase() == (t['status'] as String).toLowerCase(),
      ),
  ]);
  if (v != null && context.mounted && v.toLowerCase() != (t['status'] as String).toLowerCase()) {
    await setClickUpStatus(ref, context, t, v);
  }
}

String _cap(String s) => s.isEmpty ? s : s[0].toUpperCase() + s.substring(1);

Future<void> openClickUpTask(BuildContext context, J t) =>
    showGlassSheet<void>(context, (_) => ClickUpTaskSheet(task: t));

// ------------------------------------------------------------------ one row, used in Today and the ClickUp screen

class ClickUpRow extends ConsumerWidget {
  const ClickUpRow({super.key, required this.task, this.showStatus = true, this.timing = false});
  final J task;
  final bool showStatus;
  final bool timing;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final now = ref.watch(clockProvider)();
    final colour = hexColour(task['statusColor'] as String?, l);
    final due = task['due'] == null ? null : DateTime.parse(task['due'] as String).toLocal();
    final late = due != null && dayKey(due).compareTo(dayKey(now)) < 0;
    final prio = task['priority'] as String?;
    final prioColour = switch (prio) {
      'urgent' => l.c.danger,
      'high' => l.c.warning,
      'normal' => l.accent,
      _ => l.c.faint,
    };
    final tracked = (task['trackedMin'] as num?)?.toInt() ?? 0;
    return InkWell(
      borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
      onTap: () => openClickUpTask(context, task),
      onLongPress: () {
        HapticFeedback.selectionClick();
        pickClickUpStatus(ref, context, task);
      },
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 8),
        child: Row(
          children: [
            // the status as a ring in its own colour: tap to move it
            Semantics(
              container: true,
              button: true,
              label: 'Status ${task['status']}. Change',
              excludeSemantics: true,
              child: GestureDetector(
                onTap: () => pickClickUpStatus(ref, context, task),
                child: Padding(
                  padding: const EdgeInsets.all(4),
                  child: Container(
                    width: 22,
                    height: 22,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      border: Border.all(color: colour, width: 2.2),
                    ),
                    child: Center(
                      child: Container(
                        width: 9,
                        height: 9,
                        decoration: BoxDecoration(color: colour, shape: BoxShape.circle),
                      ),
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    task['name'] as String,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 2),
                  Wrap(
                    spacing: 8,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      if (showStatus)
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 1),
                          decoration: BoxDecoration(
                            color: colour.withValues(alpha: 0.16),
                            borderRadius: BorderRadius.circular(OrvTokens.radiusFull),
                          ),
                          child: Text(
                            (task['status'] as String).toUpperCase(),
                            style: OrvText.muted(l).copyWith(
                              fontSize: 10,
                              fontWeight: FontWeight.w800,
                              letterSpacing: 0.6,
                              color: l.dark ? Colors.white : colour,
                            ),
                          ),
                        ),
                      Text(
                        task['list'] as String,
                        style: OrvText.muted(l).copyWith(fontSize: 12),
                        overflow: TextOverflow.ellipsis,
                      ),
                      if (due != null)
                        Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(LucideIcons.calendar, size: 11, color: late ? l.c.danger : l.c.faint),
                            const SizedBox(width: 3),
                            Text(
                              dayWords(dayKey(due), now),
                              style: OrvText.muted(l).copyWith(fontSize: 12, color: late ? l.c.danger : null),
                            ),
                          ],
                        ),
                      if (tracked > 0)
                        Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(LucideIcons.timer, size: 11, color: l.c.faint),
                            const SizedBox(width: 3),
                            Text(hm(tracked), style: OrvText.muted(l).copyWith(fontSize: 12)),
                          ],
                        ),
                    ],
                  ),
                ],
              ),
            ),
            if (timing) _PulseDot(colour: l.c.danger),
            if (prio != null && prio != 'low')
              Padding(
                padding: const EdgeInsets.only(left: 6, right: 4),
                child: Icon(LucideIcons.flag, size: 15, color: prioColour),
              ),
          ],
        ),
      ),
    );
  }
}

class _PulseDot extends StatefulWidget {
  const _PulseDot({required this.colour});
  final Color colour;
  @override
  State<_PulseDot> createState() => _PulseDotState();
}

class _PulseDotState extends State<_PulseDot> with SingleTickerProviderStateMixin {
  late final _a = AnimationController(vsync: this, duration: const Duration(milliseconds: 900))..repeat(reverse: true);
  @override
  void dispose() {
    _a.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => FadeTransition(
    opacity: Tween(begin: 0.35, end: 1.0).animate(_a),
    child: Container(
      width: 8,
      height: 8,
      margin: const EdgeInsets.symmetric(horizontal: 6),
      decoration: BoxDecoration(color: widget.colour, shape: BoxShape.circle),
    ),
  );
}

// ------------------------------------------------------------------ the running timer, everywhere

/// "⏱ 0:42:10 · Login page" — tap to open the task, ■ to stop (spec 0012 B3).
class TimerPill extends ConsumerStatefulWidget {
  const TimerPill({super.key});
  @override
  ConsumerState<TimerPill> createState() => _TimerPillState();
}

class _TimerPillState extends ConsumerState<TimerPill> {
  Timer? _tick;
  Timer? _poll;
  @override
  void initState() {
    super.initState();
    _tick = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted && ref.read(clickupTimerProvider).value != null) setState(() {});
    });
    // a timer started or stopped in ClickUp shows up within a minute
    _poll = Timer.periodic(const Duration(seconds: 60), (_) => ref.invalidate(clickupTimerProvider));
  }

  @override
  void dispose() {
    _tick?.cancel();
    _poll?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final t = ref.watch(clickupTimerProvider).value;
    return AnimatedSwitcher(
      duration: OrvTokens.durationBase,
      transitionBuilder: (c, a) => SizeTransition(sizeFactor: a, axis: Axis.horizontal, child: c),
      child: t == null
          ? const SizedBox.shrink()
          : Padding(
              key: const ValueKey('timer'),
              padding: const EdgeInsets.only(top: 6),
              child: Material(
                color: Colors.transparent,
                child: InkWell(
                  borderRadius: BorderRadius.circular(OrvTokens.radiusFull),
                  onTap: t['taskId'] == null
                      ? null
                      : () => openClickUpTask(context, {
                          'id': t['taskId'],
                          'connectionId': t['connectionId'],
                          'name': t['taskName'],
                          'status': '',
                        }),
                  child: Container(
                    padding: const EdgeInsets.fromLTRB(10, 6, 4, 6),
                    decoration: BoxDecoration(
                      color: l.c.danger.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(OrvTokens.radiusFull),
                      border: Border.all(color: l.c.danger.withValues(alpha: 0.35)),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        _PulseDot(colour: l.c.danger),
                        Text(
                          clockOf(DateTime.now().difference(DateTime.parse(t['startedAt'] as String))),
                          style: OrvText.body(l).copyWith(
                            fontFamily: monoFamily,
                            fontWeight: FontWeight.w700,
                            fontSize: 13,
                            fontFeatures: const [FontFeature.tabularFigures()],
                          ),
                        ),
                        const SizedBox(width: 6),
                        Flexible(
                          child: Text(
                            t['taskName'] as String? ?? '',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: OrvText.muted(l).copyWith(fontSize: 12.5),
                          ),
                        ),
                        IconButton(
                          tooltip: 'Stop the timer',
                          visualDensity: VisualDensity.compact,
                          icon: Icon(LucideIcons.square, size: 15, color: l.c.danger),
                          onPressed: () => stopClickUpTimer(ref, context, t),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
    );
  }
}

Future<void> stopClickUpTimer(WidgetRef ref, BuildContext context, J t) async {
  final toaster = Toaster.of(context);
  try {
    final r = await ref.read(apiProvider).post<J>('/connections/clickup/timer/stop', {
      'connectionId': t['connectionId'],
      if (t['teamId'] != null) 'teamId': t['teamId'],
    });
    ref.invalidate(clickupTimerProvider);
    ref.invalidate(clickupTasksProvider);
    if (t['taskId'] != null) {
      ref.invalidate(clickupDetailProvider((t['connectionId'] as String, t['taskId'] as String)));
    }
    final m = (r['minutes'] as num?)?.toInt();
    toaster.show(
      m == null ? 'Timer stopped' : 'Logged ${hm(m)}',
      body: t['taskName'] as String?,
      tone: ToastTone.success,
    );
  } catch (e) {
    toaster.show('Couldn’t stop it', body: messageFor(e), tone: ToastTone.danger);
  }
}

// ------------------------------------------------------------------ the ClickUp screen

/// Everything assigned to me, grouped by status in ClickUp's colours; List or Board; search and filters.
class ClickUpScreen extends ConsumerStatefulWidget {
  const ClickUpScreen({super.key});
  @override
  ConsumerState<ClickUpScreen> createState() => _ClickUpScreenState();
}

class _ClickUpScreenState extends ConsumerState<ClickUpScreen> {
  final _search = TextEditingController();
  bool _board = false;
  String? _list;
  final _collapsed = <String>{};
  bool _showClosed = false;

  @override
  void initState() {
    super.initState();
    _search.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _refresh() async {
    ref.invalidate(clickupTasksProvider);
    ref.invalidate(clickupTimerProvider);
    if (_showClosed) ref.invalidate(clickupClosedProvider);
    await ref.read(clickupTasksProvider.future).catchError((Object _) => <J>[]);
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(clickupTasksProvider);
    final all = async.value ?? const <J>[];
    final timer = ref.watch(clickupTimerProvider).value;
    final q = _search.text.trim().toLowerCase();
    final lists = {for (final t in all) t['list'] as String}.toList()..sort();
    final shown = all
        .where((t) => _list == null || t['list'] == _list)
        .where((t) => q.isEmpty || (t['name'] as String).toLowerCase().contains(q))
        .toList();
    // groups: working statuses first, then the rest, in the order ClickUp gives
    final order = <String>[];
    final groups = <String, List<J>>{};
    for (final t in [...shown.where((t) => t['working'] == true), ...shown.where((t) => t['working'] != true)]) {
      final k = t['status'] as String;
      if (!groups.containsKey(k)) order.add(k);
      (groups[k] ??= []).add(t);
    }
    final working = shown.where((t) => t['working'] == true).length;

    return OrvModule(
      module: 'today',
      child: Builder(
        builder: (context) {
          final l = context.orv;
          return Scaffold(
            body: SafeArea(
              child: RefreshIndicator(
                color: l.accent,
                onRefresh: _refresh,
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 60),
                  children: [
                    Row(
                      children: [
                        IconButton(
                          onPressed: () => context.canPop() ? context.pop() : context.go('/today'),
                          icon: Icon(LucideIcons.arrowLeft, color: l.c.text),
                          tooltip: 'Back',
                        ),
                        const ProviderMark(provider: 'clickup', size: 26),
                        const SizedBox(width: 10),
                        Expanded(
                          child: PageTitle(
                            'ClickUp',
                            overline: async.hasValue ? '$working working · ${all.length} open' : null,
                          ),
                        ),
                        Padding(
                          padding: const EdgeInsets.only(bottom: 10),
                          child: _ListBoard(board: _board, onChanged: (v) => setState(() => _board = v)),
                        ),
                      ],
                    ),
                    if (timer != null) const Align(alignment: Alignment.centerLeft, child: TimerPill()),
                    const SizedBox(height: 8),
                    FocusRing(
                      radius: OrvTokens.radiusFull,
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      child: Row(
                        children: [
                          Icon(LucideIcons.search, size: 16, color: l.c.faint),
                          const SizedBox(width: 8),
                          Expanded(
                            child: TextField(
                              controller: _search,
                              style: OrvText.body(l),
                              decoration: bareInput(l, hint: 'Search your ClickUp tasks', fontSize: 15),
                            ),
                          ),
                          if (_search.text.isNotEmpty)
                            GestureDetector(
                              onTap: _search.clear,
                              child: Icon(LucideIcons.x, size: 16, color: l.c.muted),
                            ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 10),
                    if (lists.length > 1)
                      SizedBox(
                        height: 36,
                        child: ListView(
                          scrollDirection: Axis.horizontal,
                          children: [
                            for (final x in [null, ...lists])
                              Padding(
                                padding: const EdgeInsets.only(right: 6),
                                child: FactPill(
                                  icon: x == null ? LucideIcons.layers : LucideIcons.list,
                                  label: x ?? 'All lists',
                                  set: _list == x,
                                  onTap: () => setState(() => _list = x),
                                ),
                              ),
                          ],
                        ),
                      ),
                    const SizedBox(height: 12),
                    if (async.isLoading && !async.hasValue)
                      const GroupCard(children: [SkeletonRows(count: 4)])
                    else if (async.hasError && !async.hasValue)
                      GroupCard(
                        children: [
                          Text('ClickUp didn’t answer.', style: OrvText.body(l)),
                          const SizedBox(height: 8),
                          Align(
                            alignment: Alignment.centerLeft,
                            child: OrvButton(label: 'Try again', small: true, onPressed: _refresh),
                          ),
                        ],
                      )
                    else if (all.isEmpty)
                      GroupCard(children: [Text('Nothing open is assigned to you.', style: OrvText.muted(l))])
                    else if (_board)
                      _StatusBoard(order: order, groups: groups, timingTask: timer?['taskId'] as String?)
                    else ...[
                      for (final k in order)
                        GroupCard(
                          children: [
                            InkWell(
                              borderRadius: BorderRadius.circular(OrvTokens.radiusSm),
                              onTap: () =>
                                  setState(() => _collapsed.contains(k) ? _collapsed.remove(k) : _collapsed.add(k)),
                              child: GroupHeader(
                                title: k,
                                count: groups[k]!.length,
                                tone: hexColour(groups[k]!.first['statusColor'] as String?, l),
                                hint: groups[k]!.first['working'] == true && !_collapsed.contains(k)
                                    ? 'Shown in Today'
                                    : null,
                                trailing: Icon(
                                  _isCollapsed(k, groups) ? LucideIcons.chevronDown : LucideIcons.chevronUp,
                                  size: 16,
                                  color: l.c.muted,
                                ),
                              ),
                            ),
                            if (!_isCollapsed(k, groups))
                              for (final t in groups[k]!)
                                ClickUpRow(task: t, showStatus: false, timing: timer?['taskId'] == t['id']),
                          ],
                        ),
                      _ClosedGroup(
                        open: _showClosed,
                        onToggle: () => setState(() => _showClosed = !_showClosed),
                        query: q,
                        list: _list,
                      ),
                    ],
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  /// working groups start open, the rest start folded; a tap flips either
  bool _isCollapsed(String k, Map<String, List<J>> groups) {
    final working = groups[k]!.first['working'] == true;
    return working ? _collapsed.contains(k) : !_collapsed.contains(k);
  }
}

class _ListBoard extends StatelessWidget {
  const _ListBoard({required this.board, required this.onChanged});
  final bool board;
  final ValueChanged<bool> onChanged;
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
            (false, 'List', LucideIcons.list),
            (true, 'Board', LucideIcons.columns3),
          ])
            Semantics(
              container: true,
              button: true,
              selected: board == v,
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
                    gradient: board == v ? l.accentGradient : null,
                    borderRadius: BorderRadius.circular(11),
                  ),
                  child: Icon(icon, size: 17, color: board == v ? Colors.white : l.c.muted),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Done and closed tasks of the last 30 days, fetched only when opened.
class _ClosedGroup extends ConsumerWidget {
  const _ClosedGroup({required this.open, required this.onToggle, required this.query, required this.list});
  final bool open;
  final VoidCallback onToggle;
  final String query;
  final String? list;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final closed = open ? ref.watch(clickupClosedProvider) : null;
    final items = (closed?.value ?? const <J>[])
        .where((t) => list == null || t['list'] == list)
        .where((t) => query.isEmpty || (t['name'] as String).toLowerCase().contains(query))
        .toList();
    return GroupCard(
      children: [
        InkWell(
          borderRadius: BorderRadius.circular(OrvTokens.radiusSm),
          onTap: onToggle,
          child: GroupHeader(
            title: 'Done & closed · 30 days',
            icon: LucideIcons.circleCheck,
            tone: l.c.success,
            count: open && closed?.hasValue == true ? items.length : null,
            trailing: Icon(open ? LucideIcons.chevronUp : LucideIcons.chevronDown, size: 16, color: l.c.muted),
          ),
        ),
        if (open) ...[
          if (closed!.isLoading && !closed.hasValue) const SkeletonRows(count: 2),
          if (closed.hasValue && items.isEmpty)
            Padding(
              padding: const EdgeInsets.all(6),
              child: Text('Nothing closed lately.', style: OrvText.muted(l)),
            ),
          for (final t in items) ClickUpRow(task: t),
        ],
      ],
    );
  }
}

/// A column per status, one per screen with a peek of the next; long-press a card and drop it on another column.
class _StatusBoard extends ConsumerWidget {
  const _StatusBoard({required this.order, required this.groups, required this.timingTask});
  final List<String> order;
  final Map<String, List<J>> groups;
  final String? timingTask;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final h = MediaQuery.sizeOf(context).height * 0.62;
    return SizedBox(
      height: h,
      child: PageView(
        controller: PageController(viewportFraction: 0.86),
        padEnds: false,
        children: [
          for (final k in order)
            DragTarget<J>(
              onWillAcceptWithDetails: (d) => (d.data['status'] as String).toLowerCase() != k.toLowerCase(),
              onAcceptWithDetails: (d) {
                HapticFeedback.mediumImpact();
                setClickUpStatus(ref, context, d.data, k);
              },
              builder: (context, cand, _) => Padding(
                padding: const EdgeInsets.only(right: 10),
                child: AnimatedContainer(
                  duration: OrvTokens.durationFast,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
                    border: Border.all(
                      color: cand.isNotEmpty
                          ? hexColour(groups[k]!.first['statusColor'] as String?, l)
                          : Colors.transparent,
                      width: 1.5,
                    ),
                  ),
                  child: Glass(
                    blur: false,
                    padding: const EdgeInsets.all(10),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        GroupHeader(
                          title: k,
                          count: groups[k]!.length,
                          tone: hexColour(groups[k]!.first['statusColor'] as String?, l),
                        ),
                        const SizedBox(height: 4),
                        Expanded(
                          child: ListView(
                            children: [
                              for (final t in groups[k]!)
                                LongPressDraggable<J>(
                                  data: t,
                                  hapticFeedbackOnStart: true,
                                  feedback: Material(
                                    color: Colors.transparent,
                                    child: SizedBox(
                                      width: MediaQuery.sizeOf(context).width * 0.72,
                                      child: Glass(
                                        level: GlassLevel.float,
                                        padding: const EdgeInsets.all(10),
                                        child: Text(
                                          t['name'] as String,
                                          style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600),
                                        ),
                                      ),
                                    ),
                                  ),
                                  childWhenDragging: Opacity(
                                    opacity: 0.35,
                                    child: ClickUpRow(task: t, showStatus: false),
                                  ),
                                  child: ClickUpRow(task: t, showStatus: false, timing: timingTask == t['id']),
                                ),
                            ],
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

// ------------------------------------------------------------------ the task sheet

class ClickUpTaskSheet extends ConsumerStatefulWidget {
  const ClickUpTaskSheet({super.key, required this.task});
  final J task;
  @override
  ConsumerState<ClickUpTaskSheet> createState() => _ClickUpTaskSheetState();
}

class _ClickUpTaskSheetState extends ConsumerState<ClickUpTaskSheet> {
  final _comment = TextEditingController();
  bool _sending = false;
  bool _timerBusy = false;
  bool _descOpen = false;
  final _pending = <J>[];

  (String, String) get _key => (widget.task['connectionId'] as String, widget.task['id'] as String);

  @override
  void initState() {
    super.initState();
    _comment.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _comment.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final text = _comment.text.trim();
    if (text.isEmpty) return;
    setState(() {
      _sending = true;
      _pending.add({'id': 'p${_pending.length}', 'text': text, 'at': DateTime.now().toUtc().toIso8601String()});
    });
    _comment.clear();
    try {
      await ref.read(apiProvider).post<dynamic>('${_taskPath(widget.task)}/comments', {
        'connectionId': _key.$1,
        'text': text,
      });
      ref.invalidate(clickupDetailProvider(_key));
    } catch (e) {
      if (mounted) {
        Toaster.of(context).show('Comment not sent', body: messageFor(e), tone: ToastTone.danger);
        _comment.text = text;
      }
    } finally {
      if (mounted) {
        setState(() {
          _sending = false;
          _pending.clear();
        });
      }
    }
  }

  Future<void> _startStop(J t, J? running) async {
    setState(() => _timerBusy = true);
    final toaster = Toaster.of(context);
    try {
      if (running != null && running['taskId'] == t['id']) {
        await stopClickUpTimer(ref, context, running);
      } else {
        await ref.read(apiProvider).post<dynamic>('/connections/clickup/timer/start', {
          'connectionId': _key.$1,
          'taskId': t['id'],
          if ((t['teamId'] as String?)?.isNotEmpty == true) 'teamId': t['teamId'],
        });
        ref.invalidate(clickupTimerProvider);
        unawaited(HapticFeedback.mediumImpact());
        toaster.show('Timer started', body: t['name'] as String?, tone: ToastTone.success);
      }
    } catch (e) {
      toaster.show('ClickUp didn’t take it', body: messageFor(e), tone: ToastTone.danger);
    } finally {
      if (mounted) setState(() => _timerBusy = false);
    }
  }

  Future<void> _priority(J t) async {
    final l = context.orv;
    const names = {1: 'Urgent', 2: 'High', 3: 'Normal', 4: 'Low'};
    final cur = switch (t['priority']) {
      'urgent' => 1,
      'high' => 2,
      'normal' => 3,
      'low' => 4,
      _ => 0,
    };
    final v = await pickOne<int>(context, 'Priority', [
      PickOption(1, names[1]!, colour: l.c.danger, selected: cur == 1),
      PickOption(2, names[2]!, colour: l.c.warning, selected: cur == 2),
      PickOption(3, names[3]!, colour: l.accent, selected: cur == 3),
      PickOption(4, names[4]!, colour: l.c.faint, selected: cur == 4),
      PickOption(0, 'None', icon: LucideIcons.circleSlash, selected: cur == 0),
    ]);
    if (v == null || v == cur || !mounted) return;
    try {
      await ref.read(apiProvider).patch<dynamic>(_taskPath(t), {
        'connectionId': _key.$1,
        'priority': v == 0 ? null : v,
      });
      ref.invalidate(clickupDetailProvider(_key));
      ref.invalidate(clickupTasksProvider);
    } catch (e) {
      if (mounted) Toaster.of(context).show('ClickUp didn’t take it', body: messageFor(e), tone: ToastTone.danger);
    }
  }

  Future<void> _due(J t) async {
    final now = DateTime.now();
    final cur = t['due'] == null ? null : DateTime.parse(t['due'] as String).toLocal();
    final d = await showDatePicker(
      context: context,
      initialDate: cur ?? now,
      firstDate: now.subtract(const Duration(days: 365)),
      lastDate: now.add(const Duration(days: 365 * 3)),
    );
    if (d == null || !mounted) return;
    try {
      await ref.read(apiProvider).patch<dynamic>('${_taskPath(t)}/due', {
        'connectionId': _key.$1,
        'dueDate': dayKey(d),
      });
      ref.invalidate(clickupDetailProvider(_key));
      ref.invalidate(clickupTasksProvider);
    } catch (e) {
      if (mounted) Toaster.of(context).show('ClickUp didn’t take it', body: messageFor(e), tone: ToastTone.danger);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final now = ref.watch(clockProvider)();
    final async = ref.watch(clickupDetailProvider(_key));
    final running = ref.watch(clickupTimerProvider).value;
    final d = async.value;
    final t = d == null ? widget.task : J.from(d['task'] as Map);
    final statuses = d == null ? null : [for (final s in d['statuses'] as List) J.from(s as Map)];
    final comments = d == null ? const <J>[] : [for (final c in d['comments'] as List) J.from(c as Map)];
    final time = d == null ? const <J>[] : [for (final e in d['time'] as List) J.from(e as Map)];
    final mine = time.fold<int>(0, (a, e) => a + ((e['minutes'] as num?)?.toInt() ?? 0));
    final colour = hexColour(t['statusColor'] as String?, l);
    final isRunning = running != null && running['taskId'] == t['id'];
    final due = t['due'] == null ? null : DateTime.parse(t['due'] as String).toLocal();
    final open = ref.read(urlOpenerProvider);
    final max = MediaQuery.sizeOf(context).height * 0.92 - MediaQuery.viewInsetsOf(context).bottom;

    return ConstrainedBox(
      constraints: BoxConstraints(maxHeight: max.clamp(300, double.infinity)),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: 10),
          Center(
            child: Container(
              width: 36,
              height: 4,
              decoration: BoxDecoration(color: l.c.track, borderRadius: BorderRadius.circular(2)),
            ),
          ),
          // ---------------------------------------------- header
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 10, 8, 0),
            child: Row(
              children: [
                const ProviderMark(provider: 'clickup', size: 18),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    [t['folder'], t['list']].where((x) => x != null && (x as String).isNotEmpty).join(' › '),
                    style: OrvText.muted(l).copyWith(fontSize: 12),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                if (t['url'] != null)
                  IconButton(
                    tooltip: 'Open in ClickUp',
                    icon: Icon(LucideIcons.externalLink, size: 17, color: l.c.muted),
                    onPressed: () => open(Uri.parse(t['url'] as String)),
                  ),
              ],
            ),
          ),
          Flexible(
            child: ListView(
              shrinkWrap: true,
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
              children: [
                Text(t['name'] as String? ?? '', style: OrvText.title(l).copyWith(fontSize: 22)),
                const SizedBox(height: 12),
                // ------------------------------------------ status and facts
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    if ((t['status'] as String?)?.isNotEmpty == true)
                      Semantics(
                        container: true,
                        button: true,
                        label: 'Status ${t['status']}. Change',
                        excludeSemantics: true,
                        child: GestureDetector(
                          onTap: () => pickClickUpStatus(ref, context, t, statuses: statuses),
                          child: Container(
                            height: 34,
                            padding: const EdgeInsets.symmetric(horizontal: 12),
                            decoration: BoxDecoration(
                              color: colour,
                              borderRadius: BorderRadius.circular(OrvTokens.radiusFull),
                              boxShadow: [BoxShadow(color: colour.withValues(alpha: 0.35), blurRadius: 12)],
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(
                                  (t['status'] as String).toUpperCase(),
                                  style: const TextStyle(
                                    fontFamily: fontFamily,
                                    color: Colors.white,
                                    fontWeight: FontWeight.w800,
                                    fontSize: 12,
                                    letterSpacing: 0.8,
                                  ),
                                ),
                                const SizedBox(width: 6),
                                const Icon(LucideIcons.chevronDown, size: 14, color: Colors.white),
                              ],
                            ),
                          ),
                        ),
                      ),
                    FactPill(
                      icon: LucideIcons.calendar,
                      label: due == null ? 'Due date' : 'Due ${dayWords(dayKey(due), now)}',
                      set: due != null,
                      tone: due != null && dayKey(due).compareTo(dayKey(now)) < 0 ? l.c.danger : null,
                      onTap: () => _due(t),
                    ),
                    FactPill(
                      icon: LucideIcons.flag,
                      label: t['priority'] == null ? 'Priority' : _cap(t['priority'] as String),
                      set: t['priority'] != null,
                      tone: switch (t['priority']) {
                        'urgent' => l.c.danger,
                        'high' => l.c.warning,
                        _ => null,
                      },
                      onTap: () => _priority(t),
                    ),
                  ],
                ),
                if (d != null && (d['task']['assignees'] as List).isNotEmpty) ...[
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      for (final a in (d['task']['assignees'] as List).take(5))
                        Padding(
                          padding: const EdgeInsets.only(right: 4),
                          child: OrvAvatar(name: (a as Map)['name'] as String, size: 24),
                        ),
                      const SizedBox(width: 4),
                      Text(
                        (d['task']['assignees'] as List).map((a) => (a as Map)['name']).join(', '),
                        style: OrvText.muted(l).copyWith(fontSize: 12),
                      ),
                    ],
                  ),
                ],
                const SizedBox(height: 16),
                // ------------------------------------------ time
                Glass(
                  blur: false,
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('TIME', style: OrvText.label(l)),
                                const SizedBox(height: 4),
                                Text(
                                  isRunning
                                      ? clockOf(now.difference(DateTime.parse(running['startedAt'] as String)))
                                      : hm(((t['trackedMin'] as num?)?.toInt() ?? 0)),
                                  style: OrvText.title(l).copyWith(
                                    fontFamily: monoFamily,
                                    fontFeatures: const [FontFeature.tabularFigures()],
                                    color: isRunning ? l.c.danger : l.c.text,
                                  ),
                                ),
                                Text(
                                  isRunning
                                      ? 'Running since ${clock12(DateTime.parse(running['startedAt'] as String).toLocal())}'
                                      : 'tracked in all · ${hm(mine)} by you',
                                  style: OrvText.muted(l).copyWith(fontSize: 12),
                                ),
                              ],
                            ),
                          ),
                          _TimerButton(
                            running: isRunning,
                            busy: _timerBusy,
                            elsewhere: running != null && !isRunning,
                            onTap: () => _startStop(t, running),
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),
                      Row(
                        children: [
                          OrvButton(
                            label: 'Add time',
                            small: true,
                            icon: LucideIcons.plus,
                            onPressed: () => showGlassSheet<void>(context, (_) => AddTimeSheet(task: t)),
                          ),
                          const Spacer(),
                          if (time.isNotEmpty)
                            Text('${time.length} entries', style: OrvText.muted(l).copyWith(fontSize: 12)),
                        ],
                      ),
                      for (final e in time.take(6))
                        Dismissible(
                          key: ValueKey(e['id']),
                          direction: DismissDirection.endToStart,
                          background: Container(
                            alignment: Alignment.centerRight,
                            padding: const EdgeInsets.only(right: 12),
                            child: Icon(LucideIcons.trash2, size: 16, color: l.c.danger),
                          ),
                          confirmDismiss: (_) async {
                            final ok = await showDialog<bool>(
                              context: context,
                              builder: (ctx) => AlertDialog(
                                title: Text('Delete ${hm((e['minutes'] as num).toInt())}?'),
                                content: const Text('This removes the time entry in ClickUp too.'),
                                actions: [
                                  TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Keep')),
                                  TextButton(onPressed: () => Navigator.of(ctx).pop(true), child: const Text('Delete')),
                                ],
                              ),
                            );
                            if (ok != true) return false;
                            try {
                              await ref
                                  .read(apiProvider)
                                  .delete<dynamic>(
                                    '/connections/clickup/time/${e['id']}?connectionId=${_key.$1}${(t['teamId'] as String?)?.isNotEmpty == true ? '&teamId=${t['teamId']}' : ''}',
                                  );
                              ref.invalidate(clickupDetailProvider(_key));
                              return true;
                            } catch (_) {
                              return false;
                            }
                          },
                          child: Padding(
                            padding: const EdgeInsets.only(top: 8),
                            child: Row(
                              children: [
                                Icon(LucideIcons.clock, size: 13, color: l.c.faint),
                                const SizedBox(width: 8),
                                SizedBox(
                                  width: 64,
                                  child: Text(
                                    hm((e['minutes'] as num).toInt()),
                                    style: OrvText.body(l).copyWith(fontWeight: FontWeight.w700, fontSize: 13),
                                  ),
                                ),
                                Expanded(
                                  child: Text(
                                    [
                                      dayWords(dayKey(DateTime.parse(e['start'] as String).toLocal()), now),
                                      clock12(DateTime.parse(e['start'] as String).toLocal()),
                                      if ((e['note'] as String?)?.isNotEmpty == true) e['note'],
                                    ].join(' · '),
                                    style: OrvText.muted(l).copyWith(fontSize: 12),
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
                if (async.isLoading && d == null) ...[const SizedBox(height: 12), const SkeletonRows(count: 2)],
                if (async.hasError && d == null)
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Text('Couldn’t load the details. Pull down to retry.', style: OrvText.muted(l)),
                  ),
                // ------------------------------------------ description
                if (d != null && (d['task']['description'] as String).trim().isNotEmpty) ...[
                  const SizedBox(height: 16),
                  const SectionLabel('Description'),
                  const SizedBox(height: 6),
                  GestureDetector(
                    onTap: () => setState(() => _descOpen = !_descOpen),
                    child: AnimatedSize(
                      duration: OrvTokens.durationBase,
                      alignment: Alignment.topCenter,
                      child: Text(
                        _plain(d['task']['description'] as String),
                        maxLines: _descOpen ? null : 6,
                        overflow: _descOpen ? null : TextOverflow.fade,
                        style: OrvText.body(l).copyWith(fontSize: 14),
                      ),
                    ),
                  ),
                  if (!_descOpen && (d['task']['description'] as String).split('\n').length > 6)
                    TextButton(onPressed: () => setState(() => _descOpen = true), child: const Text('Show all')),
                ],
                // ------------------------------------------ subtasks
                if (d != null && (d['task']['subtasks'] as List).isNotEmpty) ...[
                  const SizedBox(height: 16),
                  SectionLabel(
                    'Subtasks · ${(d['task']['subtasks'] as List).where((s) => (s as Map)['done'] == true).length}/${(d['task']['subtasks'] as List).length}',
                  ),
                  const SizedBox(height: 4),
                  for (final s in (d['task']['subtasks'] as List).cast<Map<dynamic, dynamic>>())
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 5),
                      child: Row(
                        children: [
                          Icon(
                            s['done'] == true ? LucideIcons.circleCheck : LucideIcons.circle,
                            size: 16,
                            color: s['done'] == true ? l.c.success : hexColour(s['statusColor'] as String?, l),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              s['name'] as String,
                              style: OrvText.body(l).copyWith(
                                fontSize: 14,
                                color: s['done'] == true ? l.c.muted : null,
                                decoration: s['done'] == true ? TextDecoration.lineThrough : null,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                ],
                // ------------------------------------------ comments
                const SizedBox(height: 18),
                SectionLabel('Comments${comments.isEmpty ? '' : ' · ${comments.length}'}'),
                const SizedBox(height: 6),
                if (d != null && comments.isEmpty && _pending.isEmpty)
                  Text('No comments yet. Say how it’s going.', style: OrvText.muted(l)),
                for (final c in comments) _Comment(c: c, now: now),
                for (final c in _pending)
                  Opacity(
                    opacity: 0.6,
                    child: _Comment(
                      c: {
                        ...c,
                        'by': {'name': 'You', 'initials': 'Y'},
                        'mine': true,
                      },
                      now: now,
                    ),
                  ),
              ],
            ),
          ),
          // ---------------------------------------------- composer, pinned
          DecoratedBox(
            decoration: BoxDecoration(
              border: Border(top: BorderSide(color: l.c.hairline)),
            ),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(14, 10, 10, 10),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Expanded(
                    child: FocusRing(
                      radius: 22,
                      child: TextField(
                        key: const Key('clickup-comment'),
                        controller: _comment,
                        minLines: 1,
                        maxLines: 5,
                        textCapitalization: TextCapitalization.sentences,
                        style: OrvText.body(l).copyWith(fontSize: 15),
                        decoration: bareInput(l, hint: 'Write a comment…', fontSize: 15),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Semantics(
                    container: true,
                    button: true,
                    label: 'Send comment',
                    child: GestureDetector(
                      onTap: _sending || _comment.text.trim().isEmpty ? null : _send,
                      child: AnimatedContainer(
                        duration: OrvTokens.durationFast,
                        width: 42,
                        height: 42,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          gradient: _comment.text.trim().isEmpty ? null : l.accentGradient,
                          color: _comment.text.trim().isEmpty ? l.c.track : null,
                        ),
                        child: Icon(
                          LucideIcons.arrowUp,
                          size: 18,
                          color: _comment.text.trim().isEmpty ? l.c.faint : Colors.white,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// ClickUp markdown, made readable without a renderer: bold/italics markers and image links dropped.
  static String _plain(String md) => md
      .replaceAll(RegExp(r'!\[[^\]]*\]\([^)]*\)'), '')
      .replaceAllMapped(RegExp(r'\[([^\]]+)\]\(([^)]+)\)'), (m) => '${m[1]} (${m[2]})')
      .replaceAll(RegExp(r'(\*\*|__|~~|`)'), '')
      .replaceAll(RegExp(r'^#{1,6}\s*', multiLine: true), '')
      .trim();
}

class _TimerButton extends StatelessWidget {
  const _TimerButton({required this.running, required this.busy, required this.elsewhere, required this.onTap});
  final bool running;
  final bool busy;
  final bool elsewhere;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return Semantics(
      container: true,
      button: true,
      label: running
          ? 'Stop the timer'
          : (elsewhere ? 'Start the timer here (stops the other one)' : 'Start the timer'),
      excludeSemantics: true,
      child: GestureDetector(
        onTap: busy ? null : onTap,
        child: AnimatedContainer(
          duration: OrvTokens.durationBase,
          curve: springSnappy,
          width: 60,
          height: 60,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            gradient: running ? null : l.accentGradient,
            color: running ? l.c.danger : null,
            boxShadow: [
              BoxShadow(
                color: (running ? l.c.danger : l.accentFrom).withValues(alpha: 0.4),
                blurRadius: 18,
                offset: const Offset(0, 6),
              ),
            ],
          ),
          child: busy
              ? const Padding(
                  padding: EdgeInsets.all(19),
                  child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                )
              : Icon(running ? LucideIcons.square : LucideIcons.play, color: Colors.white, size: 24),
        ),
      ),
    );
  }
}

class _Comment extends StatelessWidget {
  const _Comment({required this.c, required this.now});
  final J c;
  final DateTime now;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final by = J.from(c['by'] as Map);
    final at = DateTime.parse(c['at'] as String).toLocal();
    final mine = c['mine'] == true;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          OrvAvatar(name: by['name'] as String? ?? '?', size: 30),
          const SizedBox(width: 10),
          Expanded(
            child: Container(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 10),
              decoration: BoxDecoration(
                color: mine ? l.accent.withValues(alpha: 0.10) : l.c.field,
                borderRadius: const BorderRadius.only(
                  topRight: Radius.circular(14),
                  bottomLeft: Radius.circular(14),
                  bottomRight: Radius.circular(14),
                  topLeft: Radius.circular(4),
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(
                        mine ? 'You' : by['name'] as String? ?? '',
                        style: OrvText.muted(l).copyWith(fontWeight: FontWeight.w700, color: l.c.text, fontSize: 12.5),
                      ),
                      const SizedBox(width: 6),
                      Text(timeAgo(at, now), style: OrvText.muted(l).copyWith(fontSize: 11, color: l.c.faint)),
                    ],
                  ),
                  const SizedBox(height: 2),
                  SelectableText(c['text'] as String, style: OrvText.body(l).copyWith(fontSize: 14)),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ------------------------------------------------------------------ add time

/// Time by duration ("1h 30m" on a day) or by range (from–to on a day), with a note (spec 0012 B3).
class AddTimeSheet extends ConsumerStatefulWidget {
  const AddTimeSheet({super.key, required this.task});
  final J task;
  @override
  ConsumerState<AddTimeSheet> createState() => _AddTimeSheetState();
}

class _AddTimeSheetState extends ConsumerState<AddTimeSheet> {
  bool _range = false;
  int _h = 0;
  int _m = 30;
  late DateTime _day = DateTime.now();
  TimeOfDay _from = TimeOfDay.fromDateTime(DateTime.now().subtract(const Duration(hours: 1)));
  TimeOfDay _to = TimeOfDay.fromDateTime(DateTime.now());
  final _note = TextEditingController();
  bool _busy = false;

  int get _minutes {
    if (!_range) return _h * 60 + _m;
    final a = _from.hour * 60 + _from.minute;
    final b = _to.hour * 60 + _to.minute;
    return b > a ? b - a : 0;
  }

  DateTime get _start {
    if (_range) return DateTime(_day.year, _day.month, _day.day, _from.hour, _from.minute);
    // a duration on a day: it ended now (today) or at 6 pm that day
    final today = dayKey(_day) == dayKey(DateTime.now());
    final end = today ? DateTime.now() : DateTime(_day.year, _day.month, _day.day, 18);
    return end.subtract(Duration(minutes: _minutes));
  }

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _busy = true);
    final toaster = Toaster.of(context);
    try {
      await ref.read(apiProvider).post<dynamic>('${_taskPath(widget.task)}/time', {
        'connectionId': widget.task['connectionId'],
        if ((widget.task['teamId'] as String?)?.isNotEmpty == true) 'teamId': widget.task['teamId'],
        'start': _start.toUtc().toIso8601String(),
        'durationMin': _minutes,
        if (_note.text.trim().isNotEmpty) 'note': _note.text.trim(),
      });
      ref.invalidate(clickupDetailProvider((widget.task['connectionId'] as String, widget.task['id'] as String)));
      ref.invalidate(clickupTasksProvider);
      if (mounted) Navigator.of(context).pop();
      toaster.show('Logged ${hm(_minutes)}', body: widget.task['name'] as String?, tone: ToastTone.success);
    } catch (e) {
      toaster.show('ClickUp didn’t take it', body: messageFor(e), tone: ToastTone.danger);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final loc = MaterialLocalizations.of(context);
    final now = DateTime.now();
    final future = _start.isAfter(now.add(const Duration(minutes: 1)));
    Widget stepper(String unit, int v, int max, int step, ValueChanged<int> set) => Expanded(
      child: FocusRing(
        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
        child: Row(
          children: [
            IconButton(
              tooltip: 'Less',
              onPressed: v <= 0 ? null : () => set((v - step).clamp(0, max)),
              icon: Icon(LucideIcons.minus, size: 16, color: l.c.muted),
            ),
            Expanded(
              child: Column(
                children: [
                  Text('$v', style: OrvText.title(l).copyWith(fontFeatures: const [FontFeature.tabularFigures()])),
                  Text(unit, style: OrvText.muted(l).copyWith(fontSize: 11)),
                ],
              ),
            ),
            IconButton(
              tooltip: 'More',
              onPressed: v >= max ? null : () => set((v + step).clamp(0, max)),
              icon: Icon(LucideIcons.plus, size: 16, color: l.accent),
            ),
          ],
        ),
      ),
    );

    return StickySheet(
      title: 'Add time',
      footer: Row(
        children: [
          Expanded(
            child: Text(
              future ? 'Time can’t be in the future' : '${hm(_minutes)} on ${dayWords(dayKey(_day), now)}',
              style: OrvText.muted(l).copyWith(color: future ? l.c.danger : null),
            ),
          ),
          OrvButton(
            label: 'Log ${hm(_minutes)}',
            variant: ButtonVariant.primary,
            icon: LucideIcons.check,
            loading: _busy,
            onPressed: _minutes < 1 || future ? null : _save,
          ),
        ],
      ),
      children: [
        Text(
          widget.task['name'] as String? ?? '',
          style: OrvText.muted(l),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        const SizedBox(height: 12),
        // Duration | Range
        Container(
          padding: const EdgeInsets.all(3),
          decoration: BoxDecoration(color: l.c.track, borderRadius: BorderRadius.circular(OrvTokens.radiusFull)),
          child: Row(
            children: [
              for (final (v, name) in const [(false, 'Duration'), (true, 'From – to')])
                Expanded(
                  child: GestureDetector(
                    onTap: () {
                      HapticFeedback.selectionClick();
                      setState(() => _range = v);
                    },
                    child: AnimatedContainer(
                      duration: OrvTokens.durationFast,
                      height: 34,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: _range == v ? l.c.glassStrong : Colors.transparent,
                        borderRadius: BorderRadius.circular(OrvTokens.radiusFull),
                        boxShadow: _range == v
                            ? [BoxShadow(color: Colors.black.withValues(alpha: 0.08), blurRadius: 6)]
                            : null,
                      ),
                      child: Text(
                        name,
                        style: OrvText.body(l).copyWith(
                          fontSize: 14,
                          fontWeight: _range == v ? FontWeight.w700 : FontWeight.w500,
                          color: _range == v ? l.c.text : l.c.muted,
                        ),
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        FactPill(
          icon: LucideIcons.calendar,
          label: dayWords(dayKey(_day), now),
          onTap: () async {
            final d = await showDatePicker(
              context: context,
              initialDate: _day,
              firstDate: now.subtract(const Duration(days: 365)),
              lastDate: now,
            );
            if (d != null) setState(() => _day = d);
          },
        ),
        const SizedBox(height: 14),
        if (!_range) ...[
          Row(
            children: [
              stepper('hours', _h, 23, 1, (v) => setState(() => _h = v)),
              const SizedBox(width: 10),
              stepper('minutes', _m, 55, 5, (v) => setState(() => _m = v)),
            ],
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final m in const [15, 30, 45, 60, 90, 120, 240])
                FactPill(
                  icon: LucideIcons.timer,
                  label: hm(m),
                  set: _minutes == m,
                  onTap: () => setState(() {
                    _h = m ~/ 60;
                    _m = m % 60;
                  }),
                ),
            ],
          ),
        ] else
          Row(
            children: [
              Expanded(
                child: _TimeBox(
                  label: 'From',
                  value: loc.formatTimeOfDay(_from),
                  onTap: () async {
                    final t = await showTimePicker(context: context, initialTime: _from);
                    if (t != null) setState(() => _from = t);
                  },
                ),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 8),
                child: Icon(LucideIcons.arrowRight, size: 16, color: l.c.faint),
              ),
              Expanded(
                child: _TimeBox(
                  label: 'To',
                  value: loc.formatTimeOfDay(_to),
                  onTap: () async {
                    final t = await showTimePicker(context: context, initialTime: _to);
                    if (t != null) setState(() => _to = t);
                  },
                ),
              ),
            ],
          ),
        const SizedBox(height: 14),
        OrvField(label: 'Note (optional)', controller: _note, hint: 'What you did'),
      ],
    );
  }
}

class _TimeBox extends StatelessWidget {
  const _TimeBox({required this.label, required this.value, required this.onTap});
  final String label;
  final String value;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return Semantics(
      container: true,
      button: true,
      label: '$label $value',
      excludeSemantics: true,
      child: GestureDetector(
        onTap: onTap,
        child: FocusRing(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: OrvText.muted(l).copyWith(fontSize: 11)),
              Text(value, style: OrvText.heading(l).copyWith(fontFeatures: const [FontFeature.tabularFigures()])),
            ],
          ),
        ),
      ),
    );
  }
}

// ------------------------------------------------------------------ "Show in Today"

/// Which ClickUp statuses mean "I'm working on it" — those show in Today (spec 0012 B1).
class ClickUpStatusesSheet extends ConsumerStatefulWidget {
  const ClickUpStatusesSheet({super.key});
  @override
  ConsumerState<ClickUpStatusesSheet> createState() => _ClickUpStatusesSheetState();
}

class _ClickUpStatusesSheetState extends ConsumerState<ClickUpStatusesSheet> {
  List<J>? _accounts;
  final _picked = <String, Set<String>>{};
  bool _busy = false;

  String? _problem;

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _take(List<J> accounts) {
    _accounts = accounts;
    for (final a in accounts) {
      _picked[a['connectionId'] as String] = {
        for (final s in a['statuses'] as List)
          if ((s as Map)['working'] == true) (s['name'] as String).toLowerCase(),
      };
    }
  }

  Future<void> _load() async {
    setState(() {
      _accounts = null;
      _problem = null;
    });
    try {
      final r = await ref.read(apiProvider).get<List<dynamic>>('/connections/clickup/statuses');
      if (mounted) setState(() => _take([for (final x in r) J.from(x as Map)]));
    } catch (e) {
      // the full list couldn't be read: show the statuses your open tasks are in, so you can still choose
      final tasks = await ref.read(clickupTasksProvider.future).catchError((Object _) => <J>[]);
      final by = <String, List<J>>{};
      for (final t in tasks) {
        (by[t['connectionId'] as String] ??= []).add(t);
      }
      if (!mounted) return;
      setState(() {
        _problem = 'Showing the statuses your open tasks are in. ${messageFor(e)}';
        _take([
          for (final e in by.entries)
            {
              'connectionId': e.key,
              'account': e.value.first['account'] ?? 'ClickUp',
              'statuses': [
                for (final name in {for (final t in e.value) t['status'] as String})
                  {
                    'name': name,
                    'color': e.value.firstWhere((t) => t['status'] == name)['statusColor'],
                    'type': e.value.firstWhere((t) => t['status'] == name)['statusType'],
                    'working': e.value.firstWhere((t) => t['status'] == name)['working'] == true,
                  },
              ],
            },
        ]);
      });
    }
  }

  Future<void> _save({bool reset = false}) async {
    setState(() => _busy = true);
    try {
      for (final a in _accounts!) {
        final id = a['connectionId'] as String;
        await ref.read(apiProvider).put<dynamic>('/connections/clickup/settings', {
          'connectionId': id,
          'workingStatuses': reset ? null : _picked[id]!.toList(),
        });
      }
      ref.invalidate(clickupTasksProvider);
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      if (mounted) Toaster.of(context).show('Couldn’t save', body: messageFor(e), tone: ToastTone.danger);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return StickySheet(
      title: 'Show in Today',
      footer: Row(
        children: [
          TextButton(
            onPressed: _busy || _accounts == null ? null : () => _save(reset: true),
            child: const Text('Use the default'),
          ),
          const Spacer(),
          OrvButton(
            label: 'Save',
            variant: ButtonVariant.primary,
            loading: _busy,
            onPressed: _accounts == null ? null : _save,
          ),
        ],
      ),
      children: [
        Text(
          'Tasks in these statuses are what you’re working on: they show in Today. Every other status stays in the ClickUp screen.',
          style: OrvText.muted(l),
        ),
        const SizedBox(height: 12),
        if (_accounts == null) const SkeletonRows(count: 4, dense: true),
        if (_problem != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Row(
              children: [
                Expanded(child: Text(_problem!, style: OrvText.muted(l).copyWith(fontSize: 12))),
                TextButton(onPressed: _load, child: const Text('Retry')),
              ],
            ),
          ),
        if (_accounts != null && _accounts!.isEmpty)
          Text('No ClickUp statuses found yet — is anything assigned to you?', style: OrvText.muted(l)),
        for (final a in _accounts ?? const <J>[]) ...[
          if ((_accounts ?? const []).length > 1) SectionLabel(a['account'] as String),
          for (final s in (a['statuses'] as List).cast<Map<dynamic, dynamic>>())
            Builder(
              builder: (context) {
                final k = (s['name'] as String).toLowerCase();
                final set = _picked[a['connectionId']]!;
                return Padding(
                  padding: const EdgeInsets.symmetric(vertical: 2),
                  child: Row(
                    children: [
                      Container(
                        width: 12,
                        height: 12,
                        decoration: BoxDecoration(color: hexColour(s['color'] as String?, l), shape: BoxShape.circle),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: OrvSwitchRow(
                          label: _cap(s['name'] as String),
                          subtitle: s['type'] == 'closed' || s['type'] == 'done' ? 'Done' : null,
                          value: set.contains(k),
                          onChanged: (v) => setState(() => v ? set.add(k) : set.remove(k)),
                        ),
                      ),
                    ],
                  ),
                );
              },
            ),
        ],
      ],
    );
  }
}
