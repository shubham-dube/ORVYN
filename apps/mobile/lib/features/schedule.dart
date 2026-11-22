import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../app/calendar.dart';
import '../app/state.dart';
import '../app/today.dart';
import '../design/glass.dart';
import '../design/theme.dart';
import 'sheets.dart';
import 'task_sheet.dart';
import 'today_calendar.dart' show EventDraft, EventSheet, labelColour;
import 'today_kit.dart';

/// Meetings in the list and the board (spec 0012 M). Their state is worked out from the clock, never stored:
/// upcoming → starting soon (10 min) → now (with how long is left) → ended, folded under "Earlier today".
/// A meeting ends by itself at its end time; it is not a task, so there is nothing to tick.

enum MeetingState { upcoming, soon, now, ended }

class Meeting {
  Meeting(this.instance, this.event, this.colour);
  final Instance instance;
  final EventItem? event;
  final String colour;
  DateTime get start => instance.start!;
  DateTime get end => instance.end!;
  int get minutes => end.difference(start).inMinutes;
  String? get join => event == null ? null : joinLinkIn(event!.location, event!.notes);
  MeetingState stateAt(DateTime now) {
    if (!now.isBefore(end)) return MeetingState.ended;
    if (!now.isBefore(start)) return MeetingState.now;
    if (start.difference(now).inMinutes < 10) return MeetingState.soon;
    return MeetingState.upcoming;
  }
}

/// Today's timed events from every visible calendar, in order; all-day ones separately.
final todayMeetingsProvider = Provider.autoDispose<({List<Meeting> timed, List<Instance> allDay})>((ref) {
  final events = ref.watch(eventsProvider).value ?? const <EventItem>[];
  final calendars = ref.watch(calendarsProvider).value ?? const <CalendarItem>[];
  final now = ref.watch(clockProvider)();
  final d0 = DateTime(now.year, now.month, now.day);
  final hidden = {
    for (final c in calendars)
      if (!c.visible) c.id,
  };
  final colourOf = {for (final c in calendars) c.id: c.colour};
  final byId = {for (final e in events) e.id: e};
  final all = expandEvents(events, d0, d0.add(const Duration(days: 1)), hidden: hidden);
  final timed = [
    for (final i in all)
      if (!i.allDay && i.start != null && i.end != null)
        Meeting(i, byId[i.eventId] ?? byId[i.seriesId], colourOf[i.calendarId] ?? 'sky'),
  ]..sort((a, b) => a.start.compareTo(b.start));
  return (
    timed: timed,
    allDay: [
      for (final i in all)
        if (i.allDay) i,
    ],
  );
});

/// Rebuilds every 30 s so "in 8 min", "ends in 20 min" and the progress stay true.
mixin _Ticking<T extends StatefulWidget> on State<T> {
  Timer? _t;
  @override
  void initState() {
    super.initState();
    _t = Timer.periodic(const Duration(seconds: 30), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _t?.cancel();
    super.dispose();
  }
}

String _rel(Duration d) {
  final m = d.inMinutes;
  if (m < 1) return 'less than a minute';
  if (m < 60) return '$m min';
  final h = m ~/ 60;
  return m % 60 == 0 ? '$h h' : '$h h ${m % 60} min';
}

void _openEvent(BuildContext context, WidgetRef ref, Meeting m) {
  final events = ref.read(eventsProvider).value ?? const <EventItem>[];
  showGlassSheet<void>(context, (_) => EventSheet(draft: EventDraft.from(events, m.instance)));
}

/// The Schedule group at the top of Today's list.
class ScheduleGroup extends ConsumerStatefulWidget {
  const ScheduleGroup({super.key});
  @override
  ConsumerState<ScheduleGroup> createState() => _ScheduleGroupState();
}

class _ScheduleGroupState extends ConsumerState<ScheduleGroup> with _Ticking {
  bool _showEnded = false;

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final m = ref.watch(todayMeetingsProvider);
    final now = ref.watch(clockProvider)();
    if (m.timed.isEmpty && m.allDay.isEmpty) return const SizedBox.shrink();
    final ended = m.timed.where((x) => x.stateAt(now) == MeetingState.ended).toList();
    final ahead = m.timed.where((x) => x.stateAt(now) != MeetingState.ended).toList();
    return GroupCard(
      children: [
        GroupHeader(
          title: 'Schedule',
          icon: LucideIcons.calendarClock,
          count: ahead.length,
          hint: ahead.isEmpty && ended.isNotEmpty ? 'That’s every meeting for today.' : null,
        ),
        if (m.allDay.isNotEmpty)
          Padding(
            padding: const EdgeInsets.fromLTRB(6, 2, 6, 6),
            child: Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final a in m.allDay)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
                    decoration: BoxDecoration(
                      color: l.accent.withValues(alpha: 0.10),
                      borderRadius: BorderRadius.circular(OrvTokens.radiusFull),
                    ),
                    child: Text(
                      'All day · ${a.title}',
                      style: OrvText.muted(l).copyWith(fontSize: 12, fontWeight: FontWeight.w600),
                    ),
                  ),
              ],
            ),
          ),
        for (final x in ahead) MeetingRow(meeting: x, now: now),
        if (ended.isNotEmpty)
          InkWell(
            borderRadius: BorderRadius.circular(OrvTokens.radiusSm),
            onTap: () => setState(() => _showEnded = !_showEnded),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(6, 8, 6, 6),
              child: Row(
                children: [
                  Icon(_showEnded ? LucideIcons.chevronUp : LucideIcons.chevronDown, size: 15, color: l.c.faint),
                  const SizedBox(width: 6),
                  Text(
                    'Earlier today (${ended.length})',
                    style: OrvText.muted(l).copyWith(fontSize: 12.5, fontWeight: FontWeight.w600),
                  ),
                ],
              ),
            ),
          ),
        if (_showEnded)
          for (final x in ended) MeetingRow(meeting: x, now: now),
      ],
    );
  }
}

class MeetingRow extends ConsumerWidget {
  const MeetingRow({super.key, required this.meeting, required this.now});
  final Meeting meeting;
  final DateTime now;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final loc = MaterialLocalizations.of(context);
    final m = meeting;
    final st = m.stateAt(now);
    final c = labelColour(l, m.colour);
    final ended = st == MeetingState.ended;
    final progress = st == MeetingState.now
        ? now.difference(m.start).inSeconds / m.end.difference(m.start).inSeconds.clamp(1, 1 << 30)
        : 0.0;
    final status = switch (st) {
      MeetingState.now => 'Now · ends in ${_rel(m.end.difference(now))}',
      MeetingState.soon => 'In ${_rel(m.start.difference(now))}',
      MeetingState.ended => 'Ended',
      MeetingState.upcoming => null,
    };
    return InkWell(
      borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
      onTap: () => _openEvent(context, ref, m),
      child: AnimatedContainer(
        duration: OrvTokens.durationBase,
        margin: const EdgeInsets.symmetric(vertical: 2),
        padding: const EdgeInsets.fromLTRB(6, 8, 0, 8),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
          color: st == MeetingState.now ? c.withValues(alpha: 0.10) : null,
          border: Border.all(
            color: st == MeetingState.soon || st == MeetingState.now ? c.withValues(alpha: 0.6) : Colors.transparent,
          ),
        ),
        child: Opacity(
          opacity: ended ? 0.5 : 1,
          child: Row(
            children: [
              SizedBox(
                width: 62,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      loc.formatTimeOfDay(TimeOfDay.fromDateTime(m.start)),
                      style: OrvText.body(l).copyWith(
                        fontWeight: FontWeight.w700,
                        fontSize: 13,
                        fontFeatures: const [FontFeature.tabularFigures()],
                      ),
                    ),
                    Text(hm(m.minutes), style: OrvText.muted(l).copyWith(fontSize: 11.5)),
                  ],
                ),
              ),
              Container(
                width: 3,
                height: 36,
                margin: const EdgeInsets.only(right: 10),
                decoration: BoxDecoration(color: c, borderRadius: BorderRadius.circular(2)),
              ),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      m.instance.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: OrvText.body(l)
                          .copyWith(fontWeight: FontWeight.w600, decoration: ended ? TextDecoration.lineThrough : null),
                    ),
                    if (status != null)
                      Row(
                        children: [
                          if (st == MeetingState.now) ...[_Live(colour: c), const SizedBox(width: 6)],
                          Text(
                            status,
                            style: OrvText.muted(l).copyWith(
                              fontSize: 12,
                              fontWeight: st == MeetingState.ended ? null : FontWeight.w600,
                              color: st == MeetingState.ended ? null : c,
                            ),
                          ),
                        ],
                      )
                    else if (m.event != null && m.event!.location.isNotEmpty && m.join == null)
                      Text(
                        m.event!.location,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: OrvText.muted(l).copyWith(fontSize: 12),
                      ),
                    if (st == MeetingState.now)
                      Padding(
                        padding: const EdgeInsets.only(top: 6, right: 10),
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(2),
                          child: LinearProgressIndicator(
                            value: progress.clamp(0, 1),
                            minHeight: 3,
                            color: c,
                            backgroundColor: c.withValues(alpha: 0.15),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              if (m.join != null && !ended)
                Padding(
                  padding: const EdgeInsets.only(left: 6),
                  child: Material(
                    color: Colors.transparent,
                    child: InkWell(
                      borderRadius: BorderRadius.circular(OrvTokens.radiusFull),
                      onTap: () => ref.read(urlOpenerProvider)(Uri.parse(m.join!)),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
                        decoration: BoxDecoration(
                          gradient: st == MeetingState.upcoming ? null : l.accentGradient,
                          color: st == MeetingState.upcoming ? l.accent.withValues(alpha: 0.12) : null,
                          borderRadius: BorderRadius.circular(OrvTokens.radiusFull),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(
                              LucideIcons.video,
                              size: 14,
                              color: st == MeetingState.upcoming ? l.accent : Colors.white,
                            ),
                            const SizedBox(width: 5),
                            Text(
                              'Join',
                              style: OrvText.muted(l).copyWith(
                                fontWeight: FontWeight.w700,
                                fontSize: 12.5,
                                color: st == MeetingState.upcoming ? l.accent : Colors.white,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              PopupMenuButton<String>(
                tooltip: 'More',
                icon: Icon(LucideIcons.ellipsisVertical, size: 16, color: l.c.faint),
                onSelected: (v) {
                  if (v == 'follow') {
                    openTaskSheet(
                      context,
                      null,
                      initial: {
                        'title': 'Follow up: ${m.instance.title}',
                        'dueDate': dayKey(ref.read(clockProvider)()),
                      },
                    );
                  } else if (v == 'open') {
                    _openEvent(context, ref, m);
                  }
                },
                itemBuilder: (_) => const [
                  PopupMenuItem(value: 'follow', child: Text('Make a follow-up task')),
                  PopupMenuItem(value: 'open', child: Text('Open the event')),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Live extends StatefulWidget {
  const _Live({required this.colour});
  final Color colour;
  @override
  State<_Live> createState() => _LiveState();
}

class _LiveState extends State<_Live> with SingleTickerProviderStateMixin {
  late final _a = AnimationController(vsync: this, duration: const Duration(milliseconds: 1200))..repeat();
  @override
  void dispose() {
    _a.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => SizedBox(
    width: 10,
    height: 10,
    child: AnimatedBuilder(
      animation: _a,
      builder: (_, _) => Stack(
        alignment: Alignment.center,
        children: [
          Container(
            width: 4 + 6 * _a.value,
            height: 4 + 6 * _a.value,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: widget.colour.withValues(alpha: 0.5 * (1 - _a.value)),
            ),
          ),
          Container(
            width: 6,
            height: 6,
            decoration: BoxDecoration(shape: BoxShape.circle, color: widget.colour),
          ),
        ],
      ),
    ),
  );
}

/// On the board: a slim strip with what's on now and the next two (spec 0012 M).
class ScheduleStrip extends ConsumerStatefulWidget {
  const ScheduleStrip({super.key});
  @override
  ConsumerState<ScheduleStrip> createState() => _ScheduleStripState();
}

class _ScheduleStripState extends ConsumerState<ScheduleStrip> with _Ticking {
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final loc = MaterialLocalizations.of(context);
    final now = ref.watch(clockProvider)();
    final ahead = ref
        .watch(todayMeetingsProvider)
        .timed
        .where((m) => m.stateAt(now) != MeetingState.ended)
        .take(3)
        .toList();
    if (ahead.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: SizedBox(
        height: 52,
        child: ListView(
          scrollDirection: Axis.horizontal,
          children: [
            for (final m in ahead)
              Padding(
                padding: const EdgeInsets.only(right: 8),
                child: GestureDetector(
                  onTap: () => _openEvent(context, ref, m),
                  child: Glass(
                    blur: false,
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    child: Row(
                      children: [
                        if (m.stateAt(now) == MeetingState.now)
                          Padding(
                            padding: const EdgeInsets.only(right: 8),
                            child: _Live(colour: labelColour(l, m.colour)),
                          )
                        else
                          Container(
                            width: 3,
                            height: 26,
                            margin: const EdgeInsets.only(right: 8),
                            decoration: BoxDecoration(
                              color: labelColour(l, m.colour),
                              borderRadius: BorderRadius.circular(2),
                            ),
                          ),
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            ConstrainedBox(
                              constraints: const BoxConstraints(maxWidth: 170),
                              child: Text(
                                m.instance.title,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: OrvText.body(l).copyWith(fontSize: 13, fontWeight: FontWeight.w600),
                              ),
                            ),
                            Text(
                              m.stateAt(now) == MeetingState.now
                                  ? 'Now · ${_rel(m.end.difference(now))} left'
                                  : '${loc.formatTimeOfDay(TimeOfDay.fromDateTime(m.start))} · ${hm(m.minutes)}',
                              style: OrvText.muted(l).copyWith(fontSize: 11),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
