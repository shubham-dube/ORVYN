import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../app/calendar.dart';
import '../app/dashboard.dart';
import '../app/state.dart';
import '../app/today.dart';
import '../design/controls.dart';
import '../design/glass.dart';
import '../design/theme.dart';
import '../design/toast.dart';
import '../drop/drop.dart';
import '../money/money.dart';
import '../money/spend_date.dart';

/// A ring that fills as the day's tasks get done.
class ProgressRing extends StatelessWidget {
  const ProgressRing({super.key, required this.value, required this.label, required this.sub, this.size = 104});
  final double value;
  final String label;
  final String sub;
  final double size;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return Semantics(
      label: '$label, $sub. ${(value * 100).round()} percent done',
      excludeSemantics: true,
      child: SizedBox(
        width: size,
        height: size,
        child: Stack(
          alignment: Alignment.center,
          children: [
            TweenAnimationBuilder<double>(
              tween: Tween(end: value.clamp(0, 1)),
              duration: context.reduceMotion ? Duration.zero : const Duration(milliseconds: 700),
              curve: Curves.easeOutCubic,
              builder: (_, v, _) =>
                  CustomPaint(size: Size.square(size), painter: _RingPainter(v, l.c.track, l.accentFrom, l.accentTo)),
            ),
            Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(label, style: OrvText.heading(l)),
                Text(sub, style: OrvText.muted(l).copyWith(fontSize: 11)),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _RingPainter extends CustomPainter {
  _RingPainter(this.v, this.track, this.from, this.to);
  final double v;
  final Color track;
  final Color from;
  final Color to;
  @override
  void paint(Canvas canvas, Size s) {
    const w = 9.0;
    final rect = Rect.fromCircle(center: s.center(Offset.zero), radius: (s.width - w) / 2);
    canvas.drawArc(
      rect,
      0,
      math.pi * 2,
      false,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = w
        ..color = track,
    );
    if (v <= 0) return;
    canvas.drawArc(
      rect,
      -math.pi / 2,
      math.pi * 2 * v,
      false,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = w
        ..strokeCap = StrokeCap.round
        ..shader = SweepGradient(
          startAngle: -math.pi / 2,
          endAngle: 3 * math.pi / 2,
          colors: [from, to],
          transform: const GradientRotation(0),
        ).createShader(rect),
    );
  }

  @override
  bool shouldRepaint(_RingPainter o) => o.v != v || o.track != track;
}

class _SparkPainter extends CustomPainter {
  _SparkPainter(this.values, this.colour);
  final List<int> values;
  final Color colour;
  @override
  void paint(Canvas canvas, Size s) {
    if (values.isEmpty) return;
    final mx = math.max(1, values.reduce(math.max));
    Offset pt(int i) => Offset(
      values.length == 1 ? s.width / 2 : 4 + i / (values.length - 1) * (s.width - 8),
      s.height - 6 - values[i] / mx * (s.height - 14),
    );
    final path = Path()..moveTo(pt(0).dx, pt(0).dy);
    for (var i = 1; i < values.length; i++) {
      path.lineTo(pt(i).dx, pt(i).dy);
    }
    final fill = Path.from(path)
      ..lineTo(pt(values.length - 1).dx, s.height)
      ..lineTo(pt(0).dx, s.height)
      ..close();
    canvas.drawPath(
      fill,
      Paint()
        ..shader = LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [colour.withValues(alpha: 0.32), colour.withValues(alpha: 0)],
        ).createShader(Offset.zero & s),
    );
    canvas.drawPath(
      path,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round
        ..color = colour,
    );
    canvas.drawCircle(pt(values.length - 1), 3.5, Paint()..color = colour);
  }

  @override
  bool shouldRepaint(_SparkPainter o) => o.values != values || o.colour != colour;
}

Widget _card(BuildContext context, String title, IconData icon, {String? route, required List<Widget> children}) {
  final l = context.orv;
  return Padding(
    padding: const EdgeInsets.only(bottom: 14),
    child: Glass(
      padding: const EdgeInsets.all(18),
      child: Semantics(
        container: true,
        label: title,
        explicitChildNodes: true,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Icon(icon, size: 15, color: l.accent),
                const SizedBox(width: 8),
                Expanded(child: SectionLabel(title)),
                if (route != null)
                  GestureDetector(
                    onTap: () => context.go(route),
                    child: Text('Open →', style: OrvText.muted(l).copyWith(fontSize: 12)),
                  ),
              ],
            ),
            const SizedBox(height: 10),
            ...children,
          ],
        ),
      ),
    ),
  );
}

/// The day at a glance: ring, one line, what's next.
class TodayCard extends ConsumerWidget {
  const TodayCard({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final now = ref.watch(clockProvider)();
    final tasks = ref.watch(tasksProvider).value;
    final events = ref.watch(eventsProvider).value ?? const <EventItem>[];
    final cals = ref.watch(calendarsProvider).value ?? const <CalendarItem>[];
    final loc = MaterialLocalizations.of(context);
    String hm(DateTime d) => loc.formatTimeOfDay(TimeOfDay.fromDateTime(d));
    if (tasks == null) return const SizedBox(height: 120);
    final start = DateTime(now.year, now.month, now.day);
    final hidden = {
      for (final c in cals)
        if (!c.visible) c.id,
    };
    final shape = dayShape(
      tasks,
      expandEvents(events, start, start.add(const Duration(days: 1)), hidden: hidden),
      now,
      hhmm: hm,
    );
    final total = shape.open + shape.doneToday;
    return _card(
      context,
      'Your day',
      LucideIcons.listTodo,
      route: '/today',
      children: [
        Row(
          children: [
            ProgressRing(
              value: shape.progress,
              label: total == 0 ? '✓' : '${shape.doneToday}/$total',
              sub: total == 0 ? 'nothing due' : 'done',
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(shape.line, key: const Key('dash-line'), style: OrvText.heading(l)),
                  if (shape.overdue > 0)
                    Text(
                      '${shape.overdue} overdue — still on your plate',
                      style: OrvText.muted(l).copyWith(color: l.c.danger),
                    ),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        for (final n in shape.next.take(5))
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 3),
            child: Row(
              children: [
                SizedBox(
                  width: 64,
                  child: Text(
                    n.allDay ? 'All day' : (n.at == null ? 'Anytime' : hm(n.at!)),
                    textAlign: TextAlign.right,
                    style: OrvText.muted(l).copyWith(fontSize: 12),
                  ),
                ),
                const SizedBox(width: 10),
                Container(
                  width: 4,
                  height: 18,
                  decoration: BoxDecoration(
                    gradient: n.kind == 'event' ? l.accentGradient : null,
                    color: n.kind == 'event' ? null : l.c.edge,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(n.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: OrvText.body(l)),
                ),
              ],
            ),
          ),
        if (shape.next.isEmpty)
          Text(
            total > 0 ? 'Nothing left on the clock today.' : 'Nothing planned. Add something above, or enjoy it.',
            style: OrvText.muted(l),
          ),
      ],
    );
  }
}

/// The next seven days, as bars of how much is due.
class WeekCard extends ConsumerWidget {
  const WeekCard({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final now = ref.watch(clockProvider)();
    final tasks = ref.watch(tasksProvider).value ?? const <TaskItem>[];
    final week = weekAhead(tasks, now);
    final mx = math.max(1, week.map((d) => d.count).reduce(math.max));
    const letters = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    return _card(
      context,
      'Week ahead',
      LucideIcons.calendarDays,
      route: '/today',
      children: [
        Semantics(
          label: 'Tasks due: ${week.map((d) => d.count).join(', ')}',
          excludeSemantics: true,
          child: SizedBox(
            height: 108,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                for (final (i, d) in week.indexed)
                  Expanded(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        Text(d.count == 0 ? '' : '${d.count}', style: OrvText.muted(l).copyWith(fontSize: 11)),
                        const SizedBox(height: 2),
                        AnimatedContainer(
                          duration: const Duration(milliseconds: 400),
                          margin: const EdgeInsets.symmetric(horizontal: 4),
                          height: 6 + d.count / mx * 50,
                          decoration: BoxDecoration(
                            gradient: i == 0 ? l.accentGradient : null,
                            color: i == 0 ? null : l.c.track,
                            borderRadius: const BorderRadius.vertical(top: Radius.circular(6)),
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          letters[DateTime.parse(d.date).weekday - 1],
                          style: OrvText.muted(l).copyWith(
                            fontSize: 11,
                            color: i == 0 ? l.accent : l.c.muted,
                            fontWeight: i == 0 ? FontWeight.w700 : FontWeight.w400,
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

/// This month's spending against what was set aside.
class MoneyCard extends ConsumerWidget {
  const MoneyCard({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final now = ref.watch(clockProvider)();
    final txs = ref.watch(transactionsProvider).value ?? const <TxItem>[];
    final budgets = ref.watch(budgetsProvider).value ?? const <BudgetItem>[];
    final month = monthKey(now);
    final s = summarise(txs, month);
    final overall = budgetProgress(budgets, txs, month).where((b) => b.budget.categoryId == null).firstOrNull;
    final daily = dailySpend(txs, month, upTo: now.day);
    final fresh = txs.where((t) => !t.reviewed).length;
    return _card(
      context,
      'This month',
      LucideIcons.circleDollarSign,
      route: '/money',
      children: [
        Semantics(
          label: 'Spent this month: ${formatMoney(s.spent)}',
          child: Text(formatMoney(s.spent), style: OrvText.display(l)),
        ),
        Text('spent this month${s.earned > 0 ? ' · ${formatMoney(s.earned)} came in' : ''}', style: OrvText.muted(l)),
        const SizedBox(height: 8),
        Semantics(
          label: 'Spending each day this month',
          child: SizedBox(
            height: 56,
            child: CustomPaint(painter: _SparkPainter(daily, l.accentFrom), size: Size.infinite),
          ),
        ),
        const SizedBox(height: 8),
        if (overall != null) ...[
          Row(
            children: [
              Text('Budget', style: OrvText.muted(l).copyWith(fontSize: 12)),
              const Spacer(),
              Text(
                '${formatMoney(overall.used)} / ${formatMoney(overall.budget.amountMinor)}',
                style: OrvText.muted(l)
                    .copyWith(fontSize: 12, color: overall.used > overall.budget.amountMinor ? l.c.danger : l.c.muted),
              ),
            ],
          ),
          const SizedBox(height: 4),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: (overall.used / math.max(1, overall.budget.amountMinor)).clamp(0, 1),
              minHeight: 6,
              backgroundColor: l.c.track,
              color: overall.used > overall.budget.amountMinor ? l.c.danger : l.accent,
            ),
          ),
        ] else
          Text(
            'Set a monthly budget in Money to see it here.',
            style: OrvText.muted(l).copyWith(fontSize: 12, color: l.c.faint),
          ),
        if (fresh > 0)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: GestureDetector(
              onTap: () => context.go('/money'),
              child: Text('$fresh new to check →', style: OrvText.muted(l).copyWith(color: l.accent, fontSize: 12)),
            ),
          ),
      ],
    );
  }
}

/// What was dropped and is waiting for a decision.
class DropCard extends ConsumerWidget {
  const DropCard({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final items = ref.watch(dropItemsProvider).value ?? const <DropItemView>[];
    final waiting = items.where((i) => i.status == 'proposed').toList();
    final thinking = items.where((i) => const {'new', 'thinking', 'waiting'}.contains(i.status)).length;
    return _card(
      context,
      'Waiting for you',
      LucideIcons.inbox,
      route: '/drop',
      children: [
        Text('${waiting.length}', style: OrvText.display(l)),
        Text(
          waiting.isNotEmpty
              ? 'waiting for your yes${thinking > 0 ? ' · $thinking being read' : ''}'
              : thinking > 0
              ? '$thinking being read'
              : 'Nothing waiting. Drop anything — a photo, a link, a thought.',
          style: OrvText.muted(l),
        ),
        for (final i in waiting.take(2))
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Glass(
              blur: false,
              padding: const EdgeInsets.all(10),
              child: SizedBox(
                width: double.infinity,
                child: Text(
                  (i.proposal?['title'] as String?) ?? i.summary,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: OrvText.body(l),
                ),
              ),
            ),
          ),
      ],
    );
  }
}

/// Add a task, an expense or a drop without leaving the dashboard.
class QuickAddCard extends ConsumerStatefulWidget {
  const QuickAddCard({super.key, required this.modes});
  final List<String> modes; // task | expense | drop
  @override
  ConsumerState<QuickAddCard> createState() => _QuickAddCardState();
}

class _QuickAddCardState extends ConsumerState<QuickAddCard> {
  final _c = TextEditingController();
  late String _mode = widget.modes.first;

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final t = _c.text.trim();
    if (t.isEmpty) return;
    final now = ref.read(clockProvider)();
    final toaster = Toaster.of(context);
    unawaited(HapticFeedback.lightImpact());
    if (_mode == 'task') {
      await ref.read(todayActionsProvider).add(t, dueDate: dayKey(now));
      toaster.show('Added to Today', body: t, tone: ToastTone.success);
    } else if (_mode == 'expense') {
      final p = parseSpend(t, now: now);
      if (p == null) return;
      final cats = ref.read(categoriesProvider).value ?? const <CategoryItem>[];
      await ref.read(moneyActionsProvider).add({
        'amountMinor': p.amountMinor,
        'direction': p.direction,
        'merchant': p.merchant,
        'note': p.note,
        'categoryId': cats.where((c) => c.slug != null && c.slug == p.category).firstOrNull?.id,
        'occurredAt': occurredAtFor(date: p.date, time: p.time, now: now).toUtc().toIso8601String(),
      });
      toaster.show(
        '${p.direction == 'credit' ? 'Received' : 'Spent'} ${formatMoney(p.amountMinor)}',
        tone: ToastTone.success,
      );
    } else {
      await ref.read(dropActionsProvider).dropText(t);
      toaster.show('Dropped', body: 'ORVYN will read it and ask what to do.', tone: ToastTone.success);
    }
    _c.clear();
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    const names = {'task': 'Task', 'expense': 'Expense', 'drop': 'Drop'};
    final spend = _mode == 'expense' && _c.text.trim().isNotEmpty
        ? parseSpend(_c.text, now: ref.watch(clockProvider)())
        : null;
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Glass(
        level: GlassLevel.float,
        padding: const EdgeInsets.fromLTRB(16, 12, 10, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Icon(LucideIcons.plus, size: 15, color: l.accent),
                const SizedBox(width: 8),
                const Expanded(child: SectionLabel('Quick add')),
                if (widget.modes.length > 1)
                  for (final m in widget.modes)
                    Padding(
                      padding: const EdgeInsets.only(left: 4),
                      child: ChoiceChip(
                        label: Text(names[m]!),
                        selected: _mode == m,
                        showCheckmark: false,
                        onSelected: (_) => setState(() => _mode = m),
                        selectedColor: l.accent.withValues(alpha: 0.16),
                        side: BorderSide(color: _mode == m ? l.accent : l.c.edge),
                        backgroundColor: Colors.transparent,
                        visualDensity: VisualDensity.compact,
                      ),
                    ),
              ],
            ),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    key: const Key('dash-add'),
                    controller: _c,
                    onChanged: (_) => setState(() {}),
                    onSubmitted: (_) => _submit(),
                    textInputAction: TextInputAction.done,
                    style: OrvText.body(l).copyWith(fontSize: 16),
                    decoration: InputDecoration(
                      hintText: switch (_mode) {
                        'task' => 'Call the bank',
                        'expense' => 'spent 240 on lunch yesterday',
                        _ => 'A link, a thought, something to sort out…',
                      },
                      hintStyle: OrvText.body(l).copyWith(color: l.c.faint, fontSize: 16),
                      border: InputBorder.none,
                    ),
                  ),
                ),
                OrvButton(
                  label: 'Add',
                  small: true,
                  variant: ButtonVariant.primary,
                  onPressed: _c.text.trim().isEmpty || (_mode == 'expense' && spend == null) ? null : _submit,
                ),
              ],
            ),
            if (spend != null)
              Text(
                '${formatMoney(spend.amountMinor)}${spend.merchant.isEmpty ? '' : ' · ${spend.merchant}'}${spend.date == null ? '' : ' · ${spend.date}'}',
                style: OrvText.muted(l).copyWith(color: l.accent),
              ),
          ],
        ),
      ),
    );
  }
}
