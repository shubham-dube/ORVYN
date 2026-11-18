import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../app/calendar.dart';
import '../app/state.dart';
import '../app/today.dart';
import '../app/today_settings.dart';
import '../core/api.dart';
import '../design/controls.dart';
import '../design/glass.dart';
import '../design/theme.dart';
import '../design/toast.dart';
import 'sheets.dart';

const hourPx = 56.0;

Color labelColour(OrvLook l, String? key) {
  final c = OrvTokens.labels[key ?? 'sky'] ?? OrvTokens.labels['sky']!;
  return l.dark ? c.dark : c.light;
}

String _hm(BuildContext context, DateTime d) =>
    MaterialLocalizations.of(context).formatTimeOfDay(TimeOfDay.fromDateTime(d));
DateTime _at(String day, int minutes) {
  final d = DateTime.parse(day);
  return DateTime(d.year, d.month, d.day, minutes ~/ 60, minutes % 60);
}

String _shift(String day, int n) {
  final d = DateTime.parse(day);
  return dayKey(DateTime(d.year, d.month, d.day + n));
}

String _dur(int min) {
  final h = min ~/ 60, m = min % 60;
  return h == 0 ? '$m min' : (m == 0 ? '$h h' : '$h h $m min');
}

enum CalView { day, week }

/// Today's calendar on the phone: the day as a river (events, timed tasks, free time, now), a week agenda,
/// events with repeats and per-occurrence changes, and "plan my day" (spec 0002 M4/M5).
class TodayCalendar extends ConsumerStatefulWidget {
  const TodayCalendar({super.key, required this.onOpenTask});
  final void Function(TaskItem) onOpenTask;
  @override
  ConsumerState<TodayCalendar> createState() => _TodayCalendarState();
}

class _TodayCalendarState extends ConsumerState<TodayCalendar> {
  CalView _view = CalView.day;
  late String _day = dayKey(ref.read(clockProvider)());

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final loc = MaterialLocalizations.of(context);
    final today = dayKey(ref.watch(clockProvider)());
    final step = _view == CalView.day ? 1 : 7;
    final week = _weekOf(_day);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            for (final (v, name) in const [(CalView.day, 'Day'), (CalView.week, 'Week')])
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
            const Spacer(),
            IconButton(
              tooltip: 'Previous',
              icon: Icon(LucideIcons.chevronLeft, color: l.c.muted),
              onPressed: () => setState(() => _day = _shift(_day, -step)),
            ),
            TextButton(
              onPressed: () => setState(() => _day = today),
              child: Text('Today', style: OrvText.muted(l).copyWith(color: _day == today ? l.accent : l.c.muted)),
            ),
            IconButton(
              tooltip: 'Next',
              icon: Icon(LucideIcons.chevronRight, color: l.c.muted),
              onPressed: () => setState(() => _day = _shift(_day, step)),
            ),
          ],
        ),
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Row(
            children: [
              Expanded(
                child: Semantics(
                  header: true,
                  child: Text(
                    _view == CalView.day
                        ? loc.formatFullDate(DateTime.parse(_day))
                        : 'Week of ${loc.formatShortMonthDay(DateTime.parse(week.first))}',
                    style: OrvText.heading(l),
                  ),
                ),
              ),
              if (_view == CalView.day)
                OrvButton(label: 'Plan my day', small: true, icon: LucideIcons.wandSparkles, onPressed: _plan),
              const SizedBox(width: 6),
              OrvButton(
                label: 'Event',
                small: true,
                variant: ButtonVariant.secondary,
                icon: LucideIcons.calendarPlus,
                onPressed: () =>
                    showGlassSheet<void>(context, (_) => EventSheet(draft: EventDraft.blank(_day, 10 * 60))),
              ),
            ],
          ),
        ),
        if (_view == CalView.day)
          DayRiver(day: _day, onOpenTask: widget.onOpenTask)
        else
          _WeekAgenda(
            days: week,
            onOpenTask: widget.onOpenTask,
            onPickDay: (d) => setState(() {
              _day = d;
              _view = CalView.day;
            }),
          ),
      ],
    );
  }

  List<String> _weekOf(String day) {
    final d = DateTime.parse(day);
    final monday = DateTime(d.year, d.month, d.day - (d.weekday - 1));
    return [for (var i = 0; i < 7; i++) dayKey(DateTime(monday.year, monday.month, monday.day + i))];
  }

  Future<void> _plan() async {
    final toaster = Toaster.of(context);
    try {
      final p = await ref.read(calendarActionsProvider).preview(_day);
      if (!mounted) return;
      await showGlassSheet<void>(context, (_) => PlanSheet(plan: p));
    } on ApiError catch (e) {
      toaster.show(
        e.code == 'no_working_hours' ? 'Set your working hours first' : 'Couldn’t plan right now',
        body: e.code == 'no_working_hours' ? 'Settings → Working hours & reminders.' : null,
        tone: ToastTone.danger,
      );
    } catch (_) {
      toaster.show('Planning needs a connection', tone: ToastTone.danger);
    }
  }
}

// ================================================================== the river

class DayRiver extends ConsumerStatefulWidget {
  const DayRiver({super.key, required this.day, required this.onOpenTask});
  final String day;
  final void Function(TaskItem) onOpenTask;
  @override
  ConsumerState<DayRiver> createState() => _DayRiverState();
}

class _Block {
  _Block(this.key, this.title, this.start, this.end, {this.task, this.instance, this.colour});
  final String key;
  final String title;
  final int start;
  final int end;
  final TaskItem? task;
  final Instance? instance;
  final Color? colour;
  int col = 0;
  int cols = 1;
}

List<_Block> _layout(List<_Block> blocks) {
  blocks.sort((a, b) => a.start != b.start ? a.start.compareTo(b.start) : b.end.compareTo(a.end));
  var cluster = <_Block>[];
  var clusterEnd = -1;
  void flush() {
    final ends = <int>[];
    for (final b in cluster) {
      var col = ends.indexWhere((e) => e <= b.start);
      if (col == -1) {
        ends.add(b.end);
        col = ends.length - 1;
      } else {
        ends[col] = b.end;
      }
      b.col = col;
    }
    for (final b in cluster) {
      b.cols = ends.length;
    }
    cluster = [];
  }

  for (final b in blocks) {
    if (b.start >= clusterEnd && cluster.isNotEmpty) flush();
    cluster.add(b);
    if (b.end > clusterEnd) clusterEnd = b.end;
  }
  if (cluster.isNotEmpty) flush();
  return blocks;
}

class _DayRiverState extends ConsumerState<DayRiver> {
  final _scroll = ScrollController();
  final _riverKey = GlobalKey();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToStart());
  }

  @override
  void didUpdateWidget(DayRiver old) {
    super.didUpdateWidget(old);
    if (old.day != widget.day) WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToStart());
  }

  void _scrollToStart() {
    if (!_scroll.hasClients) return;
    final now = ref.read(clockProvider)();
    final working = workingOn(ref.read(todaySettingsProvider).value, widget.day);
    final first = dayKey(now) == widget.day
        ? now.hour * 60 + now.minute - 60
        : (working.isNotEmpty ? working.first.start - 60 : 8 * 60);
    _scroll.jumpTo(((first < 0 ? 0 : first) / 60 * hourPx).clamp(0, _scroll.position.maxScrollExtent));
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final day = widget.day;
    final now = ref.watch(clockProvider)();
    final tasks = ref.watch(tasksProvider).value ?? const <TaskItem>[];
    final events = ref.watch(eventsProvider).value ?? const <EventItem>[];
    final calendars = ref.watch(calendarsProvider).value ?? const <CalendarItem>[];
    final settings = ref.watch(todaySettingsProvider).value;
    final colourOf = {for (final c in calendars) c.id: c.colour};
    final hidden = {
      for (final c in calendars)
        if (!c.visible) c.id,
    };
    final d0 = DateTime.parse(day);
    final instances = expandEvents(events, d0, DateTime(d0.year, d0.month, d0.day + 1), hidden: hidden);
    final blocks = _layout([
      for (final i in instances)
        if (spanOn(i, day) case final s?)
          _Block(
            'e-${i.eventId}-${i.occurrence}',
            i.title,
            s.start,
            s.end,
            instance: i,
            colour: labelColour(l, colourOf[i.calendarId]),
          ),
      for (final t in tasks)
        if (t.completedAt == null && t.moment != null && dayKey(t.moment!) == day)
          _Block(
            't-${t.id}',
            t.title,
            t.moment!.hour * 60 + t.moment!.minute,
            (t.moment!.hour * 60 + t.moment!.minute + ((t.data['durationMin'] as num?)?.toInt() ?? 30)).clamp(
              0,
              24 * 60,
            ),
            task: t,
          ),
    ]);
    final allDay = instances.where((i) => allDayOn(i, day)).toList();
    final isToday = dayKey(now) == day;
    final from = isToday ? ((now.hour * 60 + now.minute + 4) ~/ 5) * 5 : (day.compareTo(dayKey(now)) < 0 ? 24 * 60 : 0);
    final free = freeRanges(workingOn(settings, day), [
      for (final b in blocks) (start: b.start, end: b.end),
    ], from: from);
    final unplaced = [
      for (final t in tasks)
        if (t.completedAt == null && t.moment == null && t.day != null && t.day!.compareTo(day) <= 0) t,
    ];

    Future<void> place(TaskItem t, int minutes) async {
      final len = (t.data['durationMin'] as num?)?.toInt() ?? 30;
      await ref.read(todayActionsProvider).update(t.id, {
        'scheduledStart': _at(day, minutes).toUtc().toIso8601String(),
        'durationMin': len,
        if (t.dueDate != null) 'dueDate': day,
      });
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (allDay.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final i in allDay)
                  ActionChip(
                    label: Text(i.title),
                    onPressed: () => _openEvent(events, i),
                    side: BorderSide(color: labelColour(l, colourOf[i.calendarId])),
                    backgroundColor: Colors.transparent,
                    labelStyle: OrvText.muted(l).copyWith(color: labelColour(l, colourOf[i.calendarId])),
                  ),
              ],
            ),
          ),
        Glass(
          padding: EdgeInsets.zero,
          child: SizedBox(
            height: 480,
            child: SingleChildScrollView(
              controller: _scroll,
              child: SizedBox(
                height: 24 * hourPx,
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SizedBox(
                      width: 48,
                      child: Stack(
                        children: [
                          for (var h = 1; h < 24; h++)
                            Positioned(
                              top: h * hourPx - 7,
                              right: 6,
                              child: Text(
                                _hm(context, _at(day, h * 60)).replaceAll(':00', ''),
                                style: OrvText.muted(l).copyWith(fontSize: 10, color: l.c.faint),
                              ),
                            ),
                        ],
                      ),
                    ),
                    Expanded(
                      child: DragTarget<TaskItem>(
                        onAcceptWithDetails: (d) {
                          final box = _riverKey.currentContext!.findRenderObject()! as RenderBox;
                          final y = box.globalToLocal(d.offset).dy;
                          final m = ((y / hourPx * 60) ~/ 15 * 15).clamp(0, 24 * 60 - 15);
                          unawaited(place(d.data, m));
                        },
                        builder: (context, candidates, _) => LayoutBuilder(
                          key: _riverKey,
                          builder: (context, box) => GestureDetector(
                            behavior: HitTestBehavior.translucent,
                            onLongPressStart: (d) => showGlassSheet<void>(
                              context,
                              (_) => EventSheet(
                                draft: EventDraft.blank(
                                  day,
                                  ((d.localPosition.dy / hourPx * 60) ~/ 15 * 15).clamp(0, 23 * 60),
                                ),
                              ),
                            ),
                            child: Stack(
                              children: [
                                for (var h = 0; h < 24; h++)
                                  Positioned(
                                    top: h * hourPx,
                                    left: 0,
                                    right: 0,
                                    child: Container(height: 1, color: l.c.hairline),
                                  ),
                                for (final f in free)
                                  Positioned(
                                    top: f.start / 60 * hourPx,
                                    height: (f.end - f.start) / 60 * hourPx,
                                    left: 2,
                                    right: 6,
                                    child: Semantics(
                                      label: 'Free, ${_dur(f.end - f.start)}',
                                      excludeSemantics: true,
                                      child: Container(
                                        decoration: BoxDecoration(
                                          color: l.accent.withValues(alpha: candidates.isNotEmpty ? 0.12 : 0.05),
                                          borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
                                          border: Border.all(color: l.c.edge),
                                        ),
                                        alignment: Alignment.topRight,
                                        padding: const EdgeInsets.all(4),
                                        child: Text(
                                          'Free · ${_dur(f.end - f.start)}',
                                          style: OrvText.muted(l).copyWith(fontSize: 10, color: l.c.faint),
                                        ),
                                      ),
                                    ),
                                  ),
                                for (final b in blocks)
                                  Positioned(
                                    top: b.start / 60 * hourPx + 1,
                                    height: ((b.end - b.start) / 60 * hourPx - 2).clamp(20, double.infinity),
                                    left: b.col * (box.maxWidth - 6) / b.cols + 2,
                                    width: (box.maxWidth - 6) / b.cols - 4,
                                    child: _BlockTile(
                                      block: b,
                                      day: day,
                                      onTap: () =>
                                          b.task != null ? widget.onOpenTask(b.task!) : _openEvent(events, b.instance!),
                                    ),
                                  ),
                                if (isToday)
                                  Positioned(
                                    top: (now.hour * 60 + now.minute) / 60 * hourPx - 1,
                                    left: 0,
                                    right: 0,
                                    child: Semantics(
                                      label: 'Now, ${_hm(context, now)}',
                                      child: Container(
                                        height: 2,
                                        decoration: BoxDecoration(gradient: l.accentGradient),
                                      ),
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
            ),
          ),
        ),
        if (settings == null)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text('Set your working hours in Settings to see your free time here.', style: OrvText.muted(l)),
          ),
        const SizedBox(height: 12),
        Text(
          unplaced.isEmpty ? 'Everything for this day has a time.' : 'To place · ${unplaced.length}',
          style: OrvText.label(l),
        ),
        if (unplaced.isNotEmpty)
          Text('Hold and drag onto the day, or tap Place for the first free time.', style: OrvText.muted(l)),
        const SizedBox(height: 6),
        for (final t in unplaced)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: LongPressDraggable<TaskItem>(
              data: t,
              feedback: Material(
                type: MaterialType.transparency,
                child: Glass(
                  padding: const EdgeInsets.all(10),
                  child: Text(t.title, style: OrvText.body(l)),
                ),
              ),
              child: Glass(
                blur: false,
                padding: const EdgeInsets.fromLTRB(12, 6, 6, 6),
                child: Row(
                  children: [
                    Icon(LucideIcons.gripVertical, size: 16, color: l.c.faint),
                    const SizedBox(width: 8),
                    Expanded(
                      child: GestureDetector(
                        onTap: () => widget.onOpenTask(t),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(t.title, style: OrvText.body(l)),
                            Text(
                              '${_dur((t.data['durationMin'] as num?)?.toInt() ?? 30)}'
                              '${t.day!.compareTo(day) < 0 ? ' · overdue' : ''}',
                              style: OrvText.muted(l).copyWith(fontSize: 11),
                            ),
                          ],
                        ),
                      ),
                    ),
                    Builder(
                      builder: (context) {
                        final len = (t.data['durationMin'] as num?)?.toInt() ?? 30;
                        final slot = free.where((f) => f.end - f.start >= len).firstOrNull;
                        return OrvButton(
                          label: 'Place',
                          semanticLabel: 'Place ${t.title}',
                          small: true,
                          variant: ButtonVariant.ghost,
                          onPressed: slot == null ? null : () => place(t, slot.start),
                        );
                      },
                    ),
                  ],
                ),
              ),
            ),
          ),
      ],
    );
  }

  void _openEvent(List<EventItem> events, Instance i) =>
      showGlassSheet<void>(context, (_) => EventSheet(draft: EventDraft.from(events, i)));
}

class _BlockTile extends StatelessWidget {
  const _BlockTile({required this.block, required this.day, required this.onTap});
  final _Block block;
  final String day;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final b = block;
    final colour = b.colour ?? l.accent;
    final isTask = b.task != null;
    final s = _hm(context, _at(day, b.start));
    final e = _hm(context, _at(day, b.end));
    return Semantics(
      button: true,
      label: '${b.title}, $s to $e${isTask ? ', task' : ''}',
      excludeSemantics: true,
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.fromLTRB(8, 3, 6, 3),
          decoration: BoxDecoration(
            color: Color.alphaBlend(colour.withValues(alpha: isTask ? 0.10 : 0.20), l.c.glassStrong),
            borderRadius: BorderRadius.circular(OrvTokens.radiusSm),
            border: isTask ? Border.all(color: colour) : Border(left: BorderSide(color: colour, width: 3)),
          ),
          // one paragraph clips to the block instead of overflowing it
          child: Text.rich(
            TextSpan(
              children: [
                TextSpan(
                  text: b.title,
                  style: OrvText.body(l).copyWith(fontSize: 12, fontWeight: FontWeight.w600),
                ),
                if (b.end - b.start >= 40) TextSpan(text: '\n$s – $e', style: OrvText.muted(l).copyWith(fontSize: 11)),
              ],
            ),
            overflow: TextOverflow.clip,
          ),
        ),
      ),
    );
  }
}

// ================================================================== week agenda

class _WeekAgenda extends ConsumerWidget {
  const _WeekAgenda({required this.days, required this.onOpenTask, required this.onPickDay});
  final List<String> days;
  final void Function(TaskItem) onOpenTask;
  final void Function(String) onPickDay;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final loc = MaterialLocalizations.of(context);
    final tasks = ref.watch(tasksProvider).value ?? const <TaskItem>[];
    final events = ref.watch(eventsProvider).value ?? const <EventItem>[];
    final calendars = ref.watch(calendarsProvider).value ?? const <CalendarItem>[];
    final colourOf = {for (final c in calendars) c.id: c.colour};
    final first = DateTime.parse(days.first);
    final instances = expandEvents(
      events,
      first,
      DateTime(first.year, first.month, first.day + 7),
      hidden: {
        for (final c in calendars)
          if (!c.visible) c.id,
      },
    );
    final today = dayKey(ref.watch(clockProvider)());
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final d in days)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Glass(
              blur: false,
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  GestureDetector(
                    onTap: () => onPickDay(d),
                    child: Text(
                      loc.formatMediumDate(DateTime.parse(d)),
                      style: OrvText.label(l).copyWith(color: d == today ? l.accent : l.c.muted),
                    ),
                  ),
                  const SizedBox(height: 4),
                  ...() {
                    final items = <(int, String, String, Color, VoidCallback)>[
                      for (final i in instances)
                        if (allDayOn(i, d) || spanOn(i, d) != null)
                          (
                            i.allDay ? -1 : spanOn(i, d)!.start,
                            i.allDay ? 'All day' : _hm(context, _at(d, spanOn(i, d)!.start)),
                            i.title,
                            labelColour(l, colourOf[i.calendarId]),
                            () => showGlassSheet<void>(context, (_) => EventSheet(draft: EventDraft.from(events, i))),
                          ),
                      for (final t in tasks)
                        if (t.completedAt == null && t.day == d)
                          (
                            t.moment == null ? 24 * 60 : t.moment!.hour * 60 + t.moment!.minute,
                            t.moment == null ? 'Task' : _hm(context, t.moment!),
                            t.title,
                            l.accent,
                            () => onOpenTask(t),
                          ),
                    ]..sort((a, b) => a.$1.compareTo(b.$1));
                    if (items.isEmpty) return [Text('Nothing yet', style: OrvText.muted(l))];
                    return [
                      for (final it in items)
                        InkWell(
                          onTap: it.$5,
                          child: Padding(
                            padding: const EdgeInsets.symmetric(vertical: 4),
                            child: Row(
                              children: [
                                Container(width: 3, height: 18, color: it.$4),
                                const SizedBox(width: 8),
                                SizedBox(width: 64, child: Text(it.$2, style: OrvText.muted(l))),
                                Expanded(child: Text(it.$3, style: OrvText.body(l))),
                              ],
                            ),
                          ),
                        ),
                    ];
                  }(),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

// ================================================================== event sheet

class EventDraft {
  EventDraft({
    required this.id,
    required this.seriesId,
    required this.occurrence,
    required this.isOverride,
    required this.title,
    required this.allDay,
    required this.day,
    required this.lastDay,
    required this.start,
    required this.end,
    required this.rrule,
    required this.location,
    required this.calendarId,
  });

  factory EventDraft.blank(String day, int minutes) => EventDraft(
    id: null,
    seriesId: null,
    occurrence: null,
    isOverride: false,
    title: '',
    allDay: false,
    day: day,
    lastDay: day,
    start: TimeOfDay(hour: minutes ~/ 60, minute: minutes % 60),
    end: TimeOfDay(hour: ((minutes + 60) ~/ 60).clamp(0, 23), minute: (minutes + 60) >= 24 * 60 ? 59 : minutes % 60),
    rrule: null,
    location: '',
    calendarId: null,
  );

  factory EventDraft.from(List<EventItem> events, Instance i) {
    final row = events.firstWhere((e) => e.id == i.eventId);
    final series = i.seriesId == null ? row : events.where((e) => e.id == i.seriesId).firstOrNull ?? row;
    return EventDraft(
      id: row.id,
      seriesId: i.seriesId,
      occurrence: i.occurrence,
      isOverride: row.recurringEventId != null,
      title: row.title,
      allDay: row.allDay,
      day: i.allDay ? i.startDate! : dayKey(i.start!),
      lastDay: i.allDay ? _shift(i.endDate!, -1) : dayKey(i.start!),
      start: i.start == null ? const TimeOfDay(hour: 9, minute: 0) : TimeOfDay.fromDateTime(i.start!),
      end: i.end == null ? const TimeOfDay(hour: 10, minute: 0) : TimeOfDay.fromDateTime(i.end!),
      rrule: series.rrule,
      location: row.location,
      calendarId: row.calendarId,
    );
  }

  final String? id;
  final String? seriesId;
  final String? occurrence;
  final bool isOverride;
  String title;
  bool allDay;
  String day;
  String lastDay;
  TimeOfDay start;
  TimeOfDay end;
  String? rrule;
  String location;
  String? calendarId;

  Map<String, dynamic> fields(String timeZone) {
    final d = DateTime.parse(day);
    final s = DateTime(d.year, d.month, d.day, start.hour, start.minute);
    var e = DateTime(d.year, d.month, d.day, end.hour, end.minute);
    if (!e.isAfter(s)) e = e.add(const Duration(days: 1)); // ends after midnight
    final last = lastDay.compareTo(day) < 0 ? day : lastDay;
    return {
      'title': title.trim(),
      'allDay': allDay,
      'start': allDay ? null : s.toUtc().toIso8601String(),
      'end': allDay ? null : e.toUtc().toIso8601String(),
      'startDate': allDay ? day : null,
      'endDate': allDay ? _shift(last, 1) : null,
      'location': location,
      'calendarId': calendarId,
      'timeZone': timeZone,
    };
  }
}

List<(String?, String)> repeatPresets(String day) {
  const codes = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
  final wd = codes[DateTime.parse(day).weekday - 1];
  return [
    (null, 'Doesn’t repeat'),
    ('FREQ=DAILY', 'Every day'),
    ('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 'Every weekday'),
    ('FREQ=WEEKLY;BYDAY=$wd', 'Every week'),
    ('FREQ=MONTHLY', 'Every month'),
    ('FREQ=YEARLY', 'Every year'),
  ];
}

class EventSheet extends ConsumerStatefulWidget {
  const EventSheet({super.key, required this.draft});
  final EventDraft draft;
  @override
  ConsumerState<EventSheet> createState() => _EventSheetState();
}

class _EventSheetState extends ConsumerState<EventSheet> {
  late final EventDraft _d = widget.draft;
  late final _title = TextEditingController(text: _d.title);
  late final _where = TextEditingController(text: _d.location);
  bool _all = false; // for a repeating event: change only this one (false) or all of them

  bool get _inSeries => _d.seriesId != null;

  @override
  void dispose() {
    _title.dispose();
    _where.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    _d
      ..title = _title.text
      ..location = _where.text;
    if (_d.title.trim().isEmpty) return;
    final tz = (ref.read(todaySettingsProvider).value?['timeZone'] as String?) ?? DateTime.now().timeZoneName;
    final f = _d.fields(tz);
    final actions = ref.read(calendarActionsProvider);
    final events = ref.read(eventsProvider).value ?? const <EventItem>[];
    if (_d.id == null) {
      await actions.addEvent({...f, 'rrule': _d.rrule});
    } else if (!_inSeries) {
      await actions.updateEvent(_d.id!, {...f, 'rrule': _d.rrule});
    } else if (!_all) {
      if (_d.isOverride) {
        await actions.updateEvent(_d.id!, f);
      } else {
        await actions.addEvent({...f, 'rrule': null, 'recurringEventId': _d.seriesId, 'originalStart': _d.occurrence});
      }
    } else {
      final series = events.firstWhere((e) => e.id == _d.seriesId);
      final patch = <String, dynamic>{
        'title': f['title'],
        'location': f['location'],
        'calendarId': f['calendarId'],
        'rrule': _d.rrule,
      };
      if (!series.allDay && _d.occurrence != null && series.start != null && f['start'] != null) {
        final delta = DateTime.parse(f['start'] as String).difference(DateTime.parse(_d.occurrence!));
        final len = DateTime.parse(f['end'] as String).difference(DateTime.parse(f['start'] as String));
        final s = series.start!.add(delta);
        patch['start'] = s.toUtc().toIso8601String();
        patch['end'] = s.add(len).toUtc().toIso8601String();
      }
      await actions.updateEvent(series.id, patch);
    }
    if (mounted) Navigator.of(context).pop();
  }

  Future<void> _delete() async {
    final actions = ref.read(calendarActionsProvider);
    final events = ref.read(eventsProvider).value ?? const <EventItem>[];
    if (_inSeries && !_all) {
      final series = events.firstWhere((e) => e.id == _d.seriesId);
      await actions.removeOccurrence(
        series,
        _d.occurrence!,
        override: _d.isOverride ? events.firstWhere((e) => e.id == _d.id) : null,
      );
    } else {
      await actions.removeSeries(_d.seriesId ?? _d.id!, events);
    }
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final loc = MaterialLocalizations.of(context);
    final calendars = [
      for (final c in ref.watch(calendarsProvider).value ?? const <CalendarItem>[])
        if (c.writable) c,
    ];
    ChoiceChip chip(String label, bool on, VoidCallback tap) => ChoiceChip(
      label: Text(label),
      selected: on,
      showCheckmark: false,
      onSelected: (_) => setState(tap),
      selectedColor: l.accent.withValues(alpha: 0.16),
      side: BorderSide(color: on ? l.accent : l.c.edge),
      backgroundColor: Colors.transparent,
    );
    Future<void> pickDate(bool last) async {
      final cur = DateTime.parse(last ? _d.lastDay : _d.day);
      final d = await showDatePicker(
        context: context,
        initialDate: cur,
        firstDate: DateTime(cur.year - 5),
        lastDate: DateTime(cur.year + 10),
      );
      if (d != null) setState(() => last ? _d.lastDay = dayKey(d) : _d.day = dayKey(d));
    }

    Future<void> pickTime(bool end) async {
      final t = await showTimePicker(context: context, initialTime: end ? _d.end : _d.start);
      if (t == null) return;
      setState(() {
        if (end) {
          _d.end = t;
        } else {
          final len = (_d.end.hour * 60 + _d.end.minute) - (_d.start.hour * 60 + _d.start.minute);
          final e = (t.hour * 60 + t.minute + (len > 15 ? len : 60)).clamp(0, 24 * 60 - 1);
          _d
            ..start = t
            ..end = TimeOfDay(hour: e ~/ 60, minute: e % 60);
        }
      });
    }

    return StickySheet(
      title: _d.id == null ? 'New event' : 'Event',
      footer: Row(
        children: [
          if (_d.id != null)
            OrvButton(
              label: 'Delete',
              small: true,
              variant: ButtonVariant.danger,
              icon: LucideIcons.trash2,
              onPressed: _delete,
            ),
          const Spacer(),
          OrvButton(label: 'Save', variant: ButtonVariant.primary, onPressed: _save),
        ],
      ),
      children: [
        OrvField(label: 'Title', controller: _title),
        OrvSwitchRow(label: 'All day', value: _d.allDay, onChanged: (v) => setState(() => _d.allDay = v)),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            OrvButton(
              label: loc.formatMediumDate(DateTime.parse(_d.day)),
              small: true,
              variant: ButtonVariant.secondary,
              icon: LucideIcons.calendar,
              onPressed: () => pickDate(false),
            ),
            if (_d.allDay)
              OrvButton(
                label: 'until ${loc.formatMediumDate(DateTime.parse(_d.lastDay))}',
                small: true,
                variant: ButtonVariant.secondary,
                onPressed: () => pickDate(true),
              )
            else ...[
              OrvButton(
                label: 'Starts ${_d.start.format(context)}',
                small: true,
                variant: ButtonVariant.secondary,
                onPressed: () => pickTime(false),
              ),
              OrvButton(
                label: 'Ends ${_d.end.format(context)}',
                small: true,
                variant: ButtonVariant.secondary,
                onPressed: () => pickTime(true),
              ),
            ],
          ],
        ),
        const SizedBox(height: 12),
        Text('Repeat', style: OrvText.label(l)),
        const SizedBox(height: 4),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            for (final (v, name) in repeatPresets(_d.day))
              if (!_inSeries || _all || v == _d.rrule) chip(name, _d.rrule == v, () => _d.rrule = v),
            if (_d.rrule != null && !repeatPresets(_d.day).any((p) => p.$1 == _d.rrule)) chip('Custom', true, () {}),
          ],
        ),
        if (calendars.isNotEmpty) ...[
          const SizedBox(height: 12),
          Text('Calendar', style: OrvText.label(l)),
          const SizedBox(height: 4),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              chip('ORVYN', _d.calendarId == null, () => _d.calendarId = null),
              for (final c in calendars) chip(c.name, _d.calendarId == c.id, () => _d.calendarId = c.id),
            ],
          ),
        ],
        const SizedBox(height: 12),
        OrvField(label: 'Where', controller: _where),
        if (_inSeries) ...[
          const SizedBox(height: 12),
          Wrap(
            spacing: 6,
            children: [chip('Only this one', !_all, () => _all = false), chip('All of them', _all, () => _all = true)],
          ),
        ],
      ],
    );
  }
}

// ================================================================== plan preview

class PlanSheet extends ConsumerWidget {
  const PlanSheet({super.key, required this.plan});
  final DayPlan plan;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final placed = plan.placed;
    final unplaced = plan.unplaced;
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Your plan', style: OrvText.heading(l)),
          const SizedBox(height: 4),
          Text(
            'Inside your working hours, around your events, with your gaps. Nothing changes until you accept.',
            style: OrvText.muted(l),
          ),
          const SizedBox(height: 12),
          if (placed.isEmpty) Text('Nothing to place for this day.', style: OrvText.muted(l)),
          for (final p in placed)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Glass(
                blur: false,
                padding: const EdgeInsets.all(12),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SizedBox(
                      width: 72,
                      child: Text(_hm(context, p.start), style: OrvText.body(l).copyWith(color: l.accent)),
                    ),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(p.title, style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600)),
                          Text(p.reason, style: OrvText.muted(l)),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          if (unplaced.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text('Didn’t fit', style: OrvText.label(l)),
            for (final u in unplaced) Text('${u.title} — ${u.reason}', style: OrvText.muted(l)),
          ],
          const SizedBox(height: 16),
          Row(
            children: [
              OrvButton(
                label: 'Not now',
                small: true,
                variant: ButtonVariant.ghost,
                onPressed: () => Navigator.of(context).pop(),
              ),
              const Spacer(),
              OrvButton(
                label: 'Accept plan',
                variant: ButtonVariant.primary,
                icon: LucideIcons.sparkles,
                onPressed: placed.isEmpty
                    ? null
                    : () async {
                        final toaster = Toaster.of(context);
                        final nav = Navigator.of(context);
                        await ref.read(calendarActionsProvider).accept(plan);
                        toaster.show(
                          'Planned ${placed.length} task${placed.length == 1 ? '' : 's'}',
                          tone: ToastTone.success,
                        );
                        nav.pop();
                      },
              ),
            ],
          ),
        ],
      ),
    );
  }
}
