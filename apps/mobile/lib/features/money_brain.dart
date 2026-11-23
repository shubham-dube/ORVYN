import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../app/state.dart';
import '../design/controls.dart';
import '../design/glass.dart';
import '../design/theme.dart';
import '../design/toast.dart';
import '../money/brain.dart';
import '../money/money.dart';
import '../money/parse.dart' show cleanMerchant;
import 'money_filters.dart' show BudgetSheet;
import 'money_manage.dart' show showAddTransaction;
import 'sheets.dart';
import 'today_calendar.dart' show labelColour;
import 'today_kit.dart';

/// The money brain on the phone (spec 0013): the month read for you (insights from the server, rules only), the
/// merchant sheet, quick filing of payments without a category, and a check for double charges.

typedef J = Map<String, dynamic>;

/// The month's pace and cards. Re-read when the local payments change (they reach the server through sync).
final moneyInsightsProvider = FutureProvider.autoDispose.family<J, String>((ref, month) async {
  ref.watch(transactionsProvider.select((v) => v.value?.length));
  ref.keepAlive(); // one per month looked at: few, and coming back shows them at once
  return ref.read(apiProvider).get<J>('/money/insights', query: {'month': month});
});

// ------------------------------------------------------------------ the insights strip

class InsightsStrip extends ConsumerWidget {
  const InsightsStrip({super.key, required this.month, required this.onOpenTx});
  final String month;
  final ValueChanged<String> onOpenTx;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(moneyInsightsProvider(month));
    final data = async.value;
    // insights are extra: offline or an older server, the screen works as before
    if (data == null) {
      return async.isLoading
          ? const Padding(padding: EdgeInsets.only(top: 12), child: SkeletonRows(count: 1))
          : const SizedBox.shrink();
    }
    final pace = J.from(data['pace'] as Map);
    final cards = [for (final c in data['cards'] as List) J.from(c as Map)];
    final paceCard = cards.where((c) => c['kind'] == 'pace' || c['kind'] == 'safe').toList();
    final rest = cards.where((c) => c['kind'] != 'pace' && c['kind'] != 'safe').toList();
    if (cards.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (paceCard.isNotEmpty) _PaceCard(pace: pace, cards: paceCard),
          if (rest.isNotEmpty) ...[
            const SizedBox(height: 10),
            Padding(
              padding: const EdgeInsets.only(left: 2, bottom: 6),
              child: Row(
                children: [
                  Icon(LucideIcons.sparkles, size: 14, color: context.orv.accent),
                  const SizedBox(width: 6),
                  Text('WORTH A LOOK · ${rest.length}', style: OrvText.label(context.orv)),
                ],
              ),
            ),
            SizedBox(
              height: 122,
              child: PageView(
                controller: PageController(viewportFraction: 0.9),
                padEnds: false,
                children: [
                  for (final c in rest)
                    Padding(
                      padding: const EdgeInsets.only(right: 10),
                      child: _InsightCard(card: c, onOpenTx: onOpenTx),
                    ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

Color _tone(OrvLook l, String? tone) => switch (tone) {
  'alert' => l.c.danger,
  'warn' => l.c.warning,
  'good' => l.c.success,
  _ => l.accent,
};

IconData _icon(String? kind) => switch (kind) {
  'unusual' => LucideIcons.triangleAlert,
  'duplicate' => LucideIcons.copy,
  'price' => LucideIcons.trendingUp,
  'new-subscription' => LucideIcons.repeat,
  'upcoming' => LucideIcons.calendarClock,
  'top' => LucideIcons.store,
  'uncategorised' => LucideIcons.tags,
  'weekend' => LucideIcons.partyPopper,
  _ => LucideIcons.sparkles,
};

/// Spent so far, where the month is heading, and the budget, on one bar; and what is safe per day.
class _PaceCard extends ConsumerWidget {
  const _PaceCard({required this.pace, required this.cards});
  final J pace;
  final List<J> cards;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final spent = (pace['spentMinor'] as num).toInt();
    final projected = (pace['projectedMinor'] as num).toInt();
    final budget = (pace['budgetMinor'] as num?)?.toInt();
    final safe = (pace['safePerDayMinor'] as num?)?.toInt();
    final last = (pace['lastMonthMinor'] as num?)?.toInt() ?? 0;
    final scale = [projected, budget ?? 0, last, spent, 1].reduce((a, b) => a > b ? a : b) * 1.08;
    final p = cards.where((c) => c['kind'] == 'pace').firstOrNull;
    final over = budget != null ? projected > budget : (last > 0 && projected > last * 1.05);
    final c = over ? l.c.warning : l.c.success;
    return Glass(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Icon(over ? LucideIcons.trendingUp : LucideIcons.gauge, size: 16, color: c),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  p?['title'] as String? ?? 'This month',
                  style: OrvText.body(l).copyWith(fontWeight: FontWeight.w700),
                ),
              ),
              // the one place the overall budget is set or changed (spec 0014: no second budget card)
              TextButton.icon(
                key: const Key('pace-budget'),
                style: TextButton.styleFrom(visualDensity: VisualDensity.compact, foregroundColor: l.accent),
                icon: Icon(budget == null ? LucideIcons.target : LucideIcons.pencil, size: 14),
                label: Text(budget == null ? 'Set budget' : formatMoney(budget)),
                onPressed: () => showGlassSheet<void>(
                  context,
                  (_) => BudgetSheet(
                    cats: ref.read(categoriesProvider).value ?? const [],
                    budgets: ref.read(budgetsProvider).value ?? const [],
                    overall: true,
                  ),
                ),
              ),
            ],
          ),
          if (p?['body'] != null)
            Padding(
              padding: const EdgeInsets.only(left: 24, top: 2),
              child: Text(p!['body'] as String, style: OrvText.muted(l).copyWith(fontSize: 12)),
            ),
          const SizedBox(height: 12),
          LayoutBuilder(
            builder: (context, box) {
              double x(int v) => (v / scale * box.maxWidth).clamp(0, box.maxWidth);
              return SizedBox(
                height: 22,
                child: Stack(
                  clipBehavior: Clip.none,
                  children: [
                    Positioned.fill(
                      top: 7,
                      bottom: 7,
                      child: Container(
                        decoration: BoxDecoration(color: l.c.track, borderRadius: BorderRadius.circular(4)),
                      ),
                    ),
                    // where it's heading
                    Positioned(
                      left: 0,
                      top: 7,
                      bottom: 7,
                      width: x(projected),
                      child: Container(
                        decoration: BoxDecoration(
                          color: c.withValues(alpha: 0.25),
                          borderRadius: BorderRadius.circular(4),
                        ),
                      ),
                    ),
                    // spent so far
                    Positioned(
                      left: 0,
                      top: 7,
                      bottom: 7,
                      width: x(spent),
                      child: Container(
                        decoration: BoxDecoration(gradient: l.accentGradient, borderRadius: BorderRadius.circular(4)),
                      ),
                    ),
                    if (budget != null)
                      Positioned(
                        left: x(budget) - 1,
                        top: 0,
                        bottom: 0,
                        width: 2,
                        child: Container(color: l.c.text.withValues(alpha: 0.7)),
                      ),
                  ],
                ),
              );
            },
          ),
          const SizedBox(height: 6),
          Row(
            children: [
              _Legend(colour: l.accent, label: 'Spent ${formatMoney(spent)}'),
              const SizedBox(width: 12),
              _Legend(colour: c.withValues(alpha: 0.5), label: 'Heading for ${formatMoney(projected)}'),
              const Spacer(),
              if (budget != null) Text('Budget ${formatMoney(budget)}', style: OrvText.muted(l).copyWith(fontSize: 11)),
            ],
          ),
          if (safe != null) ...[
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: (safe == 0 ? l.c.danger : l.accent).withValues(alpha: 0.10),
                borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
              ),
              child: Row(
                children: [
                  Icon(LucideIcons.shieldCheck, size: 16, color: safe == 0 ? l.c.danger : l.accent),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      cards.where((c) => c['kind'] == 'safe').firstOrNull?['title'] as String? ??
                          '${formatMoney(safe)} a day is safe to spend',
                      style: OrvText.body(l).copyWith(fontSize: 13.5, fontWeight: FontWeight.w600),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _Legend extends StatelessWidget {
  const _Legend({required this.colour, required this.label});
  final Color colour;
  final String label;
  @override
  Widget build(BuildContext context) => Row(
    children: [
      Container(
        width: 8,
        height: 8,
        decoration: BoxDecoration(color: colour, borderRadius: BorderRadius.circular(2)),
      ),
      const SizedBox(width: 5),
      Text(label, style: OrvText.muted(context.orv).copyWith(fontSize: 11)),
    ],
  );
}

class _InsightCard extends ConsumerWidget {
  const _InsightCard({required this.card, required this.onOpenTx});
  final J card;
  final ValueChanged<String> onOpenTx;

  Future<void> _act(BuildContext context, WidgetRef ref) async {
    final a = card['action'] as Map?;
    if (a == null) return;
    switch (a['kind']) {
      case 'open-tx':
        onOpenTx(a['txId'] as String);
      case 'open-merchant':
        await openMerchant(context, a['merchant'] as String);
      case 'track-recurring':
        final txs = ref.read(transactionsProvider).value ?? const <TxItem>[];
        final last = txs.where((t) => merchantKey(t.merchant) == merchantKey(a['merchant'] as String)).toList()
          ..sort((x, y) => y.occurredAt.compareTo(x.occurredAt));
        final day = last.isEmpty ? 1 : last.first.occurredAt.day;
        final minor = (a['amountMinor'] as num).toInt();
        if (!context.mounted) return;
        await showAddTransaction(
          context,
          seed: {
            'amount': minor % 100 == 0 ? '${minor ~/ 100}' : (minor / 100).toStringAsFixed(2),
            'merchant': a['merchant'],
            'categoryId': last.isEmpty ? null : last.first.categoryId,
            'rrule': 'FREQ=MONTHLY;BYMONTHDAY=$day',
          },
        );
      case 'categorise':
        await showGlassSheet<void>(context, (_) => const QuickFileSheet());
      case 'review-duplicates':
        await showGlassSheet<void>(
          context,
          (_) => DuplicatesSheet(ids: [for (final x in a['txIds'] as List) x as String]),
        );
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final c = _tone(l, card['tone'] as String?);
    final hasAction = card['action'] != null;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
        onTap: hasAction
            ? () {
                HapticFeedback.selectionClick();
                _act(context, ref);
              }
            : null,
        child: Glass(
          blur: false,
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 10),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(color: c.withValues(alpha: 0.14), shape: BoxShape.circle),
                child: Icon(_icon(card['kind'] as String?), size: 17, color: c),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      card['title'] as String,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: OrvText.body(l).copyWith(fontWeight: FontWeight.w700, fontSize: 14),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      card['body'] as String,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: OrvText.muted(l).copyWith(fontSize: 12),
                    ),
                    const Spacer(),
                    if (hasAction)
                      Text(switch ((card['action'] as Map)['kind']) {
                        'open-tx' => 'Look at it →',
                        'open-merchant' => 'See the history →',
                        'track-recurring' => 'Track it →',
                        'categorise' => 'File them →',
                        'review-duplicates' => 'Check them →',
                        _ => 'Open →',
                      }, style: OrvText.muted(l).copyWith(fontSize: 12, fontWeight: FontWeight.w700, color: c)),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ------------------------------------------------------------------ the merchant sheet

Future<void> openMerchant(BuildContext context, String merchant) =>
    showGlassSheet<void>(context, (_) => MerchantSheet(merchant: merchant));

/// Everything about one merchant from your history: totals, the last 6 months, the usual category, recent payments;
/// file them all one way, or rename them everywhere (merging spellings).
class MerchantSheet extends ConsumerWidget {
  const MerchantSheet({super.key, required this.merchant});
  final String merchant;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final now = ref.watch(clockProvider)();
    final loc = MaterialLocalizations.of(context);
    final p = ref.watch(merchantProfilesProvider)[merchantKey(merchant)];
    final cats = ref.watch(categoriesProvider).value ?? const <CategoryItem>[];
    final actions = ref.read(moneyActionsProvider);
    if (p == null) {
      return StickySheet(
        title: merchant,
        footer: const SizedBox.shrink(),
        children: [Text('No payments to $merchant yet.', style: OrvText.muted(l))],
      );
    }
    final cat = cats.where((c) => c.id == p.categoryId).firstOrNull;
    final months = [for (var i = 5; i >= 0; i--) monthKey(DateTime(now.year, now.month - i))];
    final perMonth = {
      for (final m in months)
        m: p.txs.where((t) => monthKey(t.occurredAt) == m).fold<int>(0, (a, t) => a + t.amountMinor),
    };
    final top = perMonth.values.fold<int>(1, (a, b) => a > b ? a : b);
    final thisYear = p.txs.where((t) => t.occurredAt.year == now.year).fold<int>(0, (a, t) => a + t.amountMinor);

    Widget stat(String label, String value) => Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(value, style: OrvText.heading(l).copyWith(fontSize: 17)),
          Text(label, style: OrvText.muted(l).copyWith(fontSize: 11.5)),
        ],
      ),
    );

    return StickySheet(
      title: p.merchant,
      trailing: IconButton(
        tooltip: 'Rename everywhere',
        icon: Icon(LucideIcons.pencil, size: 18, color: l.c.muted),
        onPressed: () async {
          final c = TextEditingController(text: p.merchant);
          final name = await showGlassSheet<String>(
            context,
            (ctx) => StickySheet(
              title: 'Rename ${p.merchant}',
              footer: Align(
                alignment: Alignment.centerRight,
                child: OrvButton(
                  label: 'Rename ${p.count}',
                  variant: ButtonVariant.primary,
                  onPressed: () => Navigator.of(ctx).pop(c.text.trim()),
                ),
              ),
              children: [
                OrvField(label: 'Name', controller: c, autofocus: true),
                const SizedBox(height: 6),
                Text(
                  'Every payment to ${p.merchant} gets this name — handy to merge “AMZN MKTP” into Amazon.',
                  style: OrvText.muted(l).copyWith(fontSize: 12),
                ),
              ],
            ),
          );
          if (name == null || name.isEmpty || name == p.merchant) return;
          for (final t in p.txs) {
            await actions.update(t.id, {'merchant': name});
          }
          if (context.mounted) {
            Toaster.of(context).show('Renamed ${p.count} payments', body: name, tone: ToastTone.success);
            Navigator.of(context).pop();
          }
        },
      ),
      footer: Row(
        children: [
          Expanded(
            child: Text(
              cat == null ? 'Not filed yet' : 'Usually ${cat.name} · ${(p.categoryShare * 100).round()}%',
              style: OrvText.muted(l).copyWith(fontSize: 12),
            ),
          ),
          OrvButton(
            label: 'File all as…',
            small: true,
            icon: LucideIcons.tags,
            onPressed: () async {
              final v = await pickOne<String>(context, 'File all ${p.count} as', [
                for (final c in cats.where((c) => !c.archived && c.kind == (p.credit ? 'income' : 'expense')))
                  PickOption(c.id, c.name, colour: labelColour(l, c.colour), selected: c.id == p.categoryId),
              ]);
              if (v == null) return;
              var n = 0;
              for (final t in p.txs.where((t) => t.categoryId != v)) {
                await actions.update(t.id, {'categoryId': v, 'reviewed': true});
                n++;
              }
              if (context.mounted) {
                Toaster.of(context).show(
                  n == 0 ? 'Already filed that way' : 'Filed $n payments',
                  body: 'New ones from ${p.merchant} will be filed the same way.',
                  tone: ToastTone.success,
                );
              }
            },
          ),
        ],
      ),
      children: [
        Row(
          children: [
            stat('this year', formatMoney(thisYear)),
            stat('payments', '${p.count}'),
            stat('usually', formatMoney(p.medianMinor)),
          ],
        ),
        const SizedBox(height: 16),
        const SectionLabel('Last 6 months'),
        const SizedBox(height: 8),
        SizedBox(
          height: 96,
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              for (final m in months)
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 4),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        if (perMonth[m]! > 0)
                          Text(
                            formatMoney(perMonth[m]!).replaceAll('.00', ''),
                            style: OrvText.muted(l).copyWith(fontSize: 9.5),
                            maxLines: 1,
                            overflow: TextOverflow.clip,
                          ),
                        const SizedBox(height: 2),
                        TweenAnimationBuilder<double>(
                          tween: Tween(begin: 0, end: perMonth[m]! / top),
                          duration: OrvTokens.durationSlow,
                          curve: springSmooth,
                          builder: (_, v, _) => Container(
                            height: (56 * v).clamp(3, 56),
                            decoration: BoxDecoration(
                              gradient: m == months.last ? l.accentGradient : null,
                              color: m == months.last ? null : l.accent.withValues(alpha: 0.35),
                              borderRadius: BorderRadius.circular(4),
                            ),
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          loc.formatMonthYear(DateTime.parse('$m-01')).substring(0, 3),
                          style: OrvText.muted(l).copyWith(fontSize: 10.5),
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        const SectionLabel('Recent'),
        for (final t in p.txs.take(8))
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    '${loc.formatMediumDate(t.occurredAt)} · ${cats.where((c) => c.id == t.categoryId).firstOrNull?.name ?? 'Uncategorised'}',
                    style: OrvText.muted(l).copyWith(fontSize: 12.5),
                  ),
                ),
                Text(
                  formatMoney(t.amountMinor),
                  style: OrvText.body(l).copyWith(
                    fontWeight: FontWeight.w600,
                    color: t.amountMinor > p.medianMinor * 2.5 ? l.c.warning : null,
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

// ------------------------------------------------------------------ quick filing

/// Payments without a category, one tap each: the likely categories first (from your history, then the name).
/// Filing one files the other uncategorised ones from the same merchant too.
class QuickFileSheet extends ConsumerStatefulWidget {
  const QuickFileSheet({super.key});
  @override
  ConsumerState<QuickFileSheet> createState() => _QuickFileSheetState();
}

class _QuickFileSheetState extends ConsumerState<QuickFileSheet> {
  int _done = 0;

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final loc = MaterialLocalizations.of(context);
    final txs =
        (ref.watch(transactionsProvider).value ?? const <TxItem>[])
            .where((t) => t.categoryId == null && !t.ignored)
            .toList()
          ..sort((a, b) => b.occurredAt.compareTo(a.occurredAt));
    final cats = (ref.watch(categoriesProvider).value ?? const <CategoryItem>[]).where((c) => !c.archived).toList();
    final profiles = ref.watch(merchantProfilesProvider);
    final used = <String, int>{};
    for (final t in ref.watch(transactionsProvider).value ?? const <TxItem>[]) {
      if (t.categoryId != null) used[t.categoryId!] = (used[t.categoryId!] ?? 0) + 1;
    }
    List<CategoryItem> likely(TxItem t) {
      final want = t.credit ? 'income' : 'expense';
      final pool = cats.where((c) => c.kind == want).toList();
      final out = <CategoryItem>[];
      void add(CategoryItem? c) {
        if (c != null && !out.contains(c)) out.add(c);
      }

      final p = profiles[merchantKey(t.merchant)];
      add(pool.where((c) => c.id == p?.categoryId).firstOrNull);
      final guess = cleanMerchant(t.rawMerchant.isNotEmpty ? t.rawMerchant : t.merchant).category;
      add(pool.where((c) => c.slug == guess).firstOrNull);
      for (final c in [...pool]..sort((a, b) => (used[b.id] ?? 0).compareTo(used[a.id] ?? 0))) {
        add(c);
      }
      return out.take(4).toList();
    }

    Future<void> file(TxItem t, String categoryId) async {
      unawaited(HapticFeedback.selectionClick());
      final same = txs.where(
        (x) => x.id == t.id || (t.merchant.isNotEmpty && merchantKey(x.merchant) == merchantKey(t.merchant)),
      );
      for (final x in same) {
        await ref.read(moneyActionsProvider).update(x.id, {'categoryId': categoryId, 'reviewed': true});
      }
      setState(() => _done += same.length);
    }

    return StickySheet(
      title: txs.isEmpty ? 'All filed' : 'File ${txs.length}',
      footer: Row(
        children: [
          Expanded(
            child: Text(
              _done == 0 ? 'Tap a category — the same merchant is filed along with it.' : 'Filed $_done so far.',
              style: OrvText.muted(l).copyWith(fontSize: 12),
            ),
          ),
          OrvButton(label: 'Done', variant: ButtonVariant.primary, onPressed: () => Navigator.of(context).pop()),
        ],
      ),
      children: [
        if (txs.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 24),
            child: Column(
              children: [
                Icon(LucideIcons.partyPopper, size: 28, color: l.accent),
                const SizedBox(height: 8),
                Text('Every payment has a category.', style: OrvText.body(l)),
              ],
            ),
          ),
        for (final t in txs.take(30))
          AnimatedSize(
            key: ValueKey(t.id),
            duration: OrvTokens.durationBase,
            child: Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Glass(
                blur: false,
                padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            t.merchant.isEmpty ? 'Payment' : t.merchant,
                            style: OrvText.body(l).copyWith(fontWeight: FontWeight.w700),
                          ),
                        ),
                        Text(formatMoney(t.amountMinor), style: OrvText.body(l).copyWith(fontWeight: FontWeight.w700)),
                      ],
                    ),
                    Text(loc.formatMediumDate(t.occurredAt), style: OrvText.muted(l).copyWith(fontSize: 12)),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: [
                        for (final c in likely(t))
                          ActionChip(
                            label: Text(c.name),
                            avatar: Container(
                              width: 9,
                              height: 9,
                              decoration: BoxDecoration(color: labelColour(l, c.colour), shape: BoxShape.circle),
                            ),
                            onPressed: () => file(t, c.id),
                            backgroundColor: Colors.transparent,
                            side: BorderSide(color: l.c.edge),
                          ),
                        ActionChip(
                          label: const Text('Other…'),
                          onPressed: () async {
                            final v = await pickOne<String>(context, 'File as', [
                              for (final c in cats.where((c) => c.kind == (t.credit ? 'income' : 'expense')))
                                PickOption(c.id, c.name, colour: labelColour(l, c.colour)),
                            ]);
                            if (v != null) await file(t, v);
                          },
                          backgroundColor: Colors.transparent,
                          side: BorderSide(color: l.c.edge),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
      ],
    );
  }
}

// ------------------------------------------------------------------ double charges

class DuplicatesSheet extends ConsumerWidget {
  const DuplicatesSheet({super.key, required this.ids});
  final List<String> ids;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final loc = MaterialLocalizations.of(context);
    final txs = (ref.watch(transactionsProvider).value ?? const <TxItem>[]).where((t) => ids.contains(t.id)).toList()
      ..sort((a, b) => a.occurredAt.compareTo(b.occurredAt));
    return StickySheet(
      title: 'Charged twice?',
      footer: Align(
        alignment: Alignment.centerRight,
        child: OrvButton(label: 'Keep both', onPressed: () => Navigator.of(context).pop()),
      ),
      children: [
        Text(
          txs.length < 2
              ? 'One of them is gone already.'
              : 'Same amount, same place, minutes apart. If your bank shows only one payment, delete the extra.',
          style: OrvText.muted(l),
        ),
        const SizedBox(height: 12),
        for (final t in txs)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Glass(
              blur: false,
              padding: const EdgeInsets.fromLTRB(12, 8, 6, 8),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${formatMoney(t.amountMinor)} · ${t.merchant}',
                          style: OrvText.body(l).copyWith(fontWeight: FontWeight.w700),
                        ),
                        Text(
                          '${loc.formatMediumDate(t.occurredAt)}, ${loc.formatTimeOfDay(TimeOfDay.fromDateTime(t.occurredAt))} · ${t.source == 'manual' ? 'typed' : t.source}',
                          style: OrvText.muted(l).copyWith(fontSize: 12),
                        ),
                      ],
                    ),
                  ),
                  if (txs.length > 1)
                    TextButton.icon(
                      icon: Icon(LucideIcons.trash2, size: 15, color: l.c.danger),
                      label: Text('Delete', style: TextStyle(color: l.c.danger)),
                      onPressed: () async {
                        await ref.read(moneyActionsProvider).remove(t.id);
                        if (context.mounted) {
                          Toaster.of(context).show('Deleted the extra ${formatMoney(t.amountMinor)}');
                          Navigator.of(context).pop();
                        }
                      },
                    ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}
