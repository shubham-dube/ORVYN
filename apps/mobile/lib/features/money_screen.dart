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
import '../money/capture.dart';
import '../money/money.dart';
import '../money/spend_date.dart';
import 'money_brain.dart';
import 'money_filters.dart';
import 'money_hand.dart';
import 'money_ui.dart';
import 'payment_sheet.dart';
import 'money_manage.dart';
import 'common.dart';
import 'sheets.dart';
import 'today_calendar.dart' show labelColour;

/// Money (spec 0003): the month, budgets, the "new" strip for captured payments, typed entries, edits, and the switch
/// that lets the phone read bank and UPI messages (ADR-0012).
class MoneyScreen extends ConsumerStatefulWidget {
  const MoneyScreen({super.key});
  @override
  ConsumerState<MoneyScreen> createState() => _MoneyScreenState();
}

class _MoneyScreenState extends ConsumerState<MoneyScreen> {
  late String _month = monthKey(ref.read(clockProvider)());
  final _search = TextEditingController();
  String? _categoryFilter;
  String? _accountFilter;
  String? _directionFilter;
  bool _allTime = false;
  bool _searchOpen = false;

  bool get _filtering =>
      _search.text.trim().isNotEmpty ||
      _categoryFilter != null ||
      _accountFilter != null ||
      _directionFilter != null ||
      _allTime;

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    unawaited(ref.read(moneyActionsProvider).ensureSetup());
  }

  @override
  Widget build(BuildContext context) {
    final txs = ref.watch(transactionsProvider).value ?? const <TxItem>[];
    final cats = ref.watch(categoriesProvider).value ?? const <CategoryItem>[];
    final budgets = ref.watch(budgetsProvider).value ?? const <BudgetItem>[];
    final loc = MaterialLocalizations.of(context);
    final s = summarise(txs, _month);
    final fresh = txs.where((t) => !t.reviewed).toList();
    final accounts = ref.watch(accountsProvider).value ?? const <AccountItem>[];
    String catName(String? id) => cats.where((c) => c.id == id).firstOrNull?.name ?? '';
    final inMonth = txs
        .where(
          (t) =>
              (_allTime || monthKey(t.occurredAt) == _month) &&
              txMatches(
                t,
                q: _search.text,
                categoryId: _categoryFilter,
                accountId: _accountFilter,
                direction: _directionFilter,
                categoryName: catName,
              ),
        )
        .toList();
    var shownOut = 0, shownIn = 0;
    for (final t in inMonth) {
      if (t.ignored) continue;
      if (t.credit) {
        shownIn += t.amountMinor;
      } else {
        shownOut += t.amountMinor;
      }
    }
    final now = ref.watch(clockProvider)();
    final thisMonth = monthKey(now);
    CategoryItem? cat(String? id) => cats.where((c) => c.id == id).firstOrNull;
    final filters =
        (_categoryFilter != null ? 1 : 0) +
        (_accountFilter != null ? 1 : 0) +
        (_directionFilter != null ? 1 : 0) +
        (_allTime ? 1 : 0);
    final days = _month == thisMonth
        ? now.day
        : DateUtils.getDaysInMonth(int.parse(_month.substring(0, 4)), int.parse(_month.substring(5, 7)));
    // the list, by day: "Today · 16 Nov", then the rows, each day with what it cost
    final byDay = <String, List<TxItem>>{};
    for (final t in inMonth) {
      byDay.putIfAbsent(dayKeyOf(t.occurredAt), () => []).add(t);
    }
    return OrvModule(
      module: 'money',
      child: Builder(
        builder: (context) {
          final l = context.orv;
          return RefreshIndicator(
            color: l.accent,
            onRefresh: () => ref.read(syncProvider).sync().catchError((Object _) {}),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 56, 16, 120),
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Expanded(child: PageTitle('Money', overline: loc.formatMonthYear(DateTime.parse('$_month-01')))),
                    Padding(
                      padding: const EdgeInsets.only(bottom: 14),
                      child: MonthSwitcher(
                        month: _month,
                        thisMonth: thisMonth,
                        onChanged: (m) => setState(() => _month = m),
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.only(bottom: 14),
                      child: PopupMenuButton<String>(
                        tooltip: 'More',
                        icon: Icon(LucideIcons.ellipsisVertical, color: l.c.muted),
                        onSelected: (v) async {
                          if (v == 'copy') {
                            final toaster = Toaster.of(context);
                            await Clipboard.setData(ClipboardData(text: transactionsCsv(inMonth, cats, accounts)));
                            toaster.show('Copied ${inMonth.length} rows', body: 'Paste them into Sheets or Excel.');
                          } else if (v == 'balances' && context.mounted) {
                            await showGlassSheet<void>(context, (_) => const BalancesSheet());
                          } else if (context.mounted) {
                            await showGlassSheet<void>(context, (_) => const ManageSheet());
                          }
                        },
                        itemBuilder: (_) => const [
                          PopupMenuItem(value: 'balances', child: Text('Balances & accounts')),
                          PopupMenuItem(value: 'copy', child: Text('Copy as spreadsheet text')),
                          PopupMenuItem(value: 'manage', child: Text('Categories, repeating, learned')),
                        ],
                      ),
                    ),
                  ],
                ),
                const _QuickEntry(),
                const _CaptureCard(),
                if (fresh.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  Glass(
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 8),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Row(
                          children: [
                            Icon(LucideIcons.sparkles, size: 15, color: l.accent),
                            const SizedBox(width: 6),
                            Expanded(child: Text('NEW · ${fresh.length}', style: OrvText.label(l))),
                            if (fresh.any((t) => !t.credit))
                              GestureDetector(
                                onTap: () async {
                                  // spending looks right; money in still waits for its own answer
                                  for (final t in fresh.where((t) => !t.credit)) {
                                    await ref.read(moneyActionsProvider).update(t.id, {'reviewed': true});
                                  }
                                },
                                child: Row(
                                  children: [
                                    Icon(LucideIcons.checkCheck, size: 15, color: l.accent),
                                    const SizedBox(width: 4),
                                    Text(
                                      'All fine',
                                      style: OrvText.muted(l)
                                          .copyWith(color: l.accent, fontWeight: FontWeight.w700, fontSize: 12.5),
                                    ),
                                  ],
                                ),
                              ),
                          ],
                        ),
                        const SizedBox(height: 4),
                        for (final t in fresh.take(8)) _TxRow(tx: t, category: cat(t.categoryId), fresh: true),
                      ],
                    ),
                  ),
                ],
                const SizedBox(height: 12),
                const HandCard(),
                InsightsStrip(
                  month: _month,
                  onOpenTx: (id) {
                    final t = txs.where((t) => t.id == id).firstOrNull;
                    if (t != null) openPayment(context, tx: t);
                  },
                ),
                const SizedBox(height: 12),
                _Hero(spent: s.spent, earned: s.earned, days: days, byCategory: s.byCategory, cat: cat),
                const SizedBox(height: 12),
                const PeopleCard(),
                const SizedBox(height: 12),
                _Budgets(month: _month, txs: txs, budgets: budgets, cats: cats),
                const SizedBox(height: 18),
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        _allTime ? 'All time' : 'Transactions',
                        style: OrvText.heading(l).copyWith(fontSize: 17),
                      ),
                    ),
                    _ToolIcon(
                      icon: _searchOpen ? LucideIcons.x : LucideIcons.search,
                      label: _searchOpen ? 'Close search' : 'Search transactions',
                      on: _searchOpen,
                      onTap: () => setState(() {
                        if (_searchOpen) _search.clear();
                        _searchOpen = !_searchOpen;
                      }),
                    ),
                    _ToolIcon(
                      icon: LucideIcons.slidersHorizontal,
                      label: 'Filters',
                      on: filters > 0,
                      badge: filters,
                      onTap: () => showGlassSheet<void>(
                        context,
                        (_) => MoneyFilterSheet(
                          cats: cats.where((c) => !c.archived).toList(),
                          accounts: accounts.where((a) => !a.archived).toList(),
                          value: (
                            category: _categoryFilter,
                            account: _accountFilter,
                            direction: _directionFilter,
                            allTime: _allTime,
                          ),
                          count: (f) => txs
                              .where(
                                (t) =>
                                    (f.allTime || monthKey(t.occurredAt) == _month) &&
                                    txMatches(
                                      t,
                                      q: _search.text,
                                      categoryId: f.category,
                                      accountId: f.account,
                                      direction: f.direction,
                                      categoryName: catName,
                                    ),
                              )
                              .length,
                          onChanged: (f) => setState(() {
                            _categoryFilter = f.category;
                            _accountFilter = f.account;
                            _directionFilter = f.direction;
                            _allTime = f.allTime;
                          }),
                        ),
                      ),
                    ),
                  ],
                ),
                if (_searchOpen)
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: FocusRing(
                      radius: 14,
                      padding: const EdgeInsets.symmetric(horizontal: 8),
                      child: TextField(
                        key: const Key('money-search'),
                        controller: _search,
                        autofocus: true,
                        onChanged: (_) => setState(() {}),
                        style: OrvText.body(l),
                        decoration:
                            bareInput(
                              l,
                              hint: 'Merchant, note or amount',
                              fontSize: 15,
                              padding: const EdgeInsets.symmetric(vertical: 11),
                            ).copyWith(
                              prefixIcon: Icon(LucideIcons.search, size: 16, color: l.c.faint),
                              prefixIconConstraints: const BoxConstraints(minWidth: 30),
                            ),
                      ),
                    ),
                  ),
                if (_filtering)
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          '${inMonth.length} found · ${formatMoney(shownOut)} spent${shownIn > 0 ? ' · ${formatMoney(shownIn)} came in' : ''}',
                          style: OrvText.muted(l).copyWith(fontSize: 12),
                        ),
                      ),
                      TextButton(
                        onPressed: () => setState(() {
                          _search.clear();
                          _searchOpen = false;
                          _categoryFilter = _accountFilter = _directionFilter = null;
                          _allTime = false;
                        }),
                        child: const Text('Clear'),
                      ),
                    ],
                  ),
                if (inMonth.isEmpty && _filtering)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    child: Text('Nothing matches. Clear a filter to see more.', style: OrvText.muted(l)),
                  ),
                if (inMonth.isEmpty && !_filtering)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    child: Text(
                      'Nothing yet. Type above (“spent 240 on lunch”), or let ORVYN read your bank and UPI messages.',
                      style: OrvText.muted(l),
                    ),
                  ),
                for (final list in byDay.values) ...[
                  Padding(
                    padding: const EdgeInsets.fromLTRB(2, 12, 2, 2),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            _dayHeading(list.first.occurredAt, now, loc),
                            style: OrvText.muted(l).copyWith(fontWeight: FontWeight.w600, fontSize: 12.5),
                          ),
                        ),
                        Text(
                          formatMoney(list.where((t) => !t.credit && !t.ignored).fold(0, (a, t) => a + t.amountMinor)),
                          style: OrvText.muted(l).copyWith(fontSize: 12.5),
                        ),
                      ],
                    ),
                  ),
                  Glass(
                    blur: false,
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
                    child: Column(
                      children: [for (final t in list) _TxRow(tx: t, category: cat(t.categoryId))],
                    ),
                  ),
                ],
              ],
            ),
          );
        },
      ),
    );
  }
}

String dayKeyOf(DateTime t) => '${t.year}-${t.month}-${t.day}';

/// "Today · 16 Nov", "Yesterday · 15 Nov", "Fri · 13 Nov".
String _dayHeading(DateTime t, DateTime now, MaterialLocalizations loc) {
  final d = DateTime(t.year, t.month, t.day);
  final today = DateTime(now.year, now.month, now.day);
  final diff = today.difference(d).inDays;
  final md = loc.formatShortMonthDay(t);
  if (diff == 0) return 'Today · $md';
  if (diff == 1) return 'Yesterday · $md';
  const wd = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return '${wd[t.weekday - 1]} · $md';
}

class _ToolIcon extends StatelessWidget {
  const _ToolIcon({required this.icon, required this.label, required this.on, required this.onTap, this.badge = 0});
  final IconData icon;
  final String label;
  final bool on;
  final VoidCallback onTap;
  final int badge;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return Semantics(
      container: true,
      button: true,
      selected: on,
      label: label,
      excludeSemantics: true,
      child: GestureDetector(
        onTap: onTap,
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            Container(
              width: 38,
              height: 38,
              decoration: BoxDecoration(
                color: on ? l.accent.withValues(alpha: 0.14) : Colors.transparent,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(icon, size: 18, color: on ? l.accent : l.c.muted),
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
  }
}

/// The month in one card: what went out (big), what came in, the daily pace, and where it went as one bar.
class _Hero extends StatelessWidget {
  const _Hero({
    required this.spent,
    required this.earned,
    required this.days,
    required this.byCategory,
    required this.cat,
  });
  final int spent;
  final int earned;
  final int days;
  final List<(String?, int)> byCategory;
  final CategoryItem? Function(String?) cat;

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final top = byCategory.take(4).toList();
    final rest = byCategory.skip(4).fold(0, (a, e) => a + e.$2);
    final total = byCategory.fold(0, (a, e) => a + e.$2);
    return Glass(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Spent', style: OrvText.label(l)),
          const SizedBox(height: 2),
          Semantics(
            label: 'Spent this month: ${formatMoney(spent)}',
            excludeSemantics: true,
            child: Text(formatMoney(spent), style: OrvText.display(l).copyWith(fontSize: 38)),
          ),
          const SizedBox(height: 4),
          Wrap(
            spacing: 14,
            children: [
              Text.rich(
                TextSpan(
                  children: [
                    TextSpan(
                      text: '+${formatMoney(earned)} ',
                      style: TextStyle(color: l.c.success, fontWeight: FontWeight.w600),
                    ),
                    const TextSpan(text: 'came in'),
                  ],
                ),
                style: OrvText.muted(l),
              ),
              if (spent > 0 && days > 0)
                Text('${formatMoney((spent ~/ days ~/ 100) * 100)} a day', style: OrvText.muted(l)),
            ],
          ),
          if (total > 0) ...[
            const SizedBox(height: 14),
            ClipRRect(
              borderRadius: BorderRadius.circular(5),
              child: SizedBox(
                height: 10,
                child: Row(
                  children: [
                    for (final (id, minor) in top)
                      Expanded(
                        flex: (minor * 1000 ~/ total).clamp(1, 1000),
                        child: Container(color: labelColour(l, cat(id)?.colour)),
                      ),
                    if (rest > 0)
                      Expanded(
                        flex: (rest * 1000 ~/ total).clamp(1, 1000),
                        child: Container(color: l.c.track),
                      ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 10),
            for (final (id, minor) in top)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 3),
                child: Row(
                  children: [
                    Container(
                      width: 9,
                      height: 9,
                      decoration: BoxDecoration(color: labelColour(l, cat(id)?.colour), shape: BoxShape.circle),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(cat(id)?.name ?? 'Uncategorised', style: OrvText.body(l).copyWith(fontSize: 14)),
                    ),
                    Text('${(minor * 100 / total).round()}%  ', style: OrvText.muted(l).copyWith(fontSize: 12)),
                    Text(
                      formatMoney(minor),
                      style: OrvText.body(l).copyWith(fontSize: 14, fontWeight: FontWeight.w600),
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

String? _dayLabel(String? date, DateTime now) {
  if (date == null) return null;
  final today = ymdString(todayOn(now));
  if (date == today) return null;
  if (date == ymdString(addDays(todayOn(now), -1))) return 'yesterday';
  final d = DateTime.parse(date);
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return '${d.day} ${m[d.month - 1]}';
}

/// Your own history first (how you filed this merchant before), then what the words say ("lunch" → food).
CategoryItem? _categoryFor(
  ({String merchant, String? category}) p,
  List<CategoryItem> cats,
  Map<String, MerchantProfile> profiles,
) {
  final known = profiles[merchantKey(p.merchant)]?.categoryId;
  return cats.where((c) => c.id == known).firstOrNull ??
      cats.where((c) => c.slug != null && c.slug == p.category).firstOrNull;
}

class _QuickEntry extends ConsumerStatefulWidget {
  const _QuickEntry();
  @override
  ConsumerState<_QuickEntry> createState() => _QuickEntryState();
}

class _QuickEntryState extends ConsumerState<_QuickEntry> {
  final _c = TextEditingController();
  final _focus = FocusNode();

  @override
  void initState() {
    super.initState();
    _focus.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _c.dispose();
    _focus.dispose();
    super.dispose();
  }

  Future<void> _add() async {
    final now = ref.read(clockProvider)();
    final p = parseSpend(_c.text, now: now);
    if (p == null) return;
    final cats = ref.read(categoriesProvider).value ?? const <CategoryItem>[];
    final category = _categoryFor(
      (merchant: p.merchant, category: p.category),
      cats,
      ref.read(merchantProfilesProvider),
    );
    final toaster = Toaster.of(context);
    unawaited(HapticFeedback.lightImpact());
    await ref.read(moneyActionsProvider).add({
      'amountMinor': p.amountMinor,
      'direction': p.direction,
      'merchant': p.merchant,
      'title': quickTitle(p.note, p.merchant),
      'categoryId': category?.id,
      'occurredAt': occurredAtFor(date: p.date, time: p.time, now: now).toUtc().toIso8601String(),
    });
    _c.clear();
    setState(() {});
    final day = _dayLabel(p.date, now);
    toaster.show(
      '${p.direction == 'credit' ? 'Received' : 'Spent'} ${formatMoney(p.amountMinor)}${day == null ? '' : ' · $day'}',
      tone: ToastTone.success,
    );
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final now = ref.watch(clockProvider)();
    final empty = _c.text.trim().isEmpty;
    final p = empty ? null : parseSpend(_c.text, now: now);
    final cats = ref.watch(categoriesProvider).value ?? const <CategoryItem>[];
    final category = p == null
        ? null
        : _categoryFor((merchant: p.merchant, category: p.category), cats, ref.watch(merchantProfilesProvider));
    final day = p == null ? null : _dayLabel(p.date, now);
    Widget chip(IconData i, String text, {Color? tone}) => Container(
      height: 28,
      padding: const EdgeInsets.symmetric(horizontal: 9),
      decoration: BoxDecoration(
        color: (tone ?? l.accent).withValues(alpha: l.dark ? 0.18 : 0.10),
        borderRadius: BorderRadius.circular(OrvTokens.radiusFull),
        border: Border.all(color: (tone ?? l.accent).withValues(alpha: 0.35)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(i, size: 13, color: tone ?? l.accent),
          const SizedBox(width: 5),
          Text(
            text,
            style: OrvText.muted(
              l,
            ).copyWith(fontSize: 12.5, fontWeight: FontWeight.w600, color: l.dark ? Colors.white : (tone ?? l.accent)),
          ),
        ],
      ),
    );
    return AnimatedContainer(
      duration: OrvTokens.durationBase,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(OrvTokens.radiusLg),
        boxShadow: _focus.hasFocus
            ? [BoxShadow(color: l.accent.withValues(alpha: l.dark ? 0.30 : 0.20), spreadRadius: 3.5)]
            : const [],
      ),
      child: Stack(
        children: [
          Glass(
            level: GlassLevel.float,
            padding: EdgeInsets.fromLTRB(14, 2, 6, p == null ? 2 : 10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    AnimatedSwitcher(
                      duration: OrvTokens.durationFast,
                      child: Icon(
                        empty ? LucideIcons.plus : LucideIcons.sparkles,
                        key: ValueKey(empty),
                        color: l.accent,
                        size: 20,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: TextField(
                        key: const Key('money-add'),
                        controller: _c,
                        focusNode: _focus,
                        onChanged: (_) => setState(() {}),
                        onSubmitted: (_) => _add(),
                        textInputAction: TextInputAction.done,
                        style: OrvText.body(l).copyWith(fontSize: 16),
                        decoration: bareInput(
                          l,
                          hint: 'Add… “240 lunch at swiggy yesterday”',
                          padding: const EdgeInsets.symmetric(vertical: 14),
                        ),
                      ),
                    ),
                    IconButton(
                      key: const Key('money-open-add'),
                      tooltip: 'Add with details',
                      visualDensity: VisualDensity.compact,
                      icon: Icon(LucideIcons.maximize2, size: 18, color: empty ? l.c.faint : l.c.muted),
                      onPressed: () => showAddTransaction(context),
                    ),
                    AnimatedSwitcher(
                      duration: OrvTokens.durationFast,
                      transitionBuilder: (c, a) => ScaleTransition(scale: a, child: c),
                      child: empty
                          ? const SizedBox(width: 4, key: ValueKey('none'))
                          : Semantics(
                              key: const ValueKey('add'),
                              container: true,
                              button: true,
                              label: 'Add',
                              child: GestureDetector(
                                onTap: p == null ? null : _add,
                                child: AnimatedOpacity(
                                  duration: OrvTokens.durationFast,
                                  opacity: p == null ? 0.4 : 1,
                                  child: Container(
                                    width: 36,
                                    height: 36,
                                    margin: const EdgeInsets.only(left: 2, right: 4),
                                    decoration: BoxDecoration(
                                      gradient: l.accentGradient,
                                      shape: BoxShape.circle,
                                      boxShadow: [
                                        BoxShadow(
                                          color: l.accentFrom.withValues(alpha: 0.4),
                                          blurRadius: 12,
                                          offset: const Offset(0, 4),
                                        ),
                                      ],
                                    ),
                                    child: const Icon(LucideIcons.arrowUp, size: 18, color: Colors.white),
                                  ),
                                ),
                              ),
                            ),
                    ),
                  ],
                ),
                if (p != null)
                  Padding(
                    padding: const EdgeInsets.only(left: 28),
                    child: Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: [
                        chip(
                          p.direction == 'credit' ? LucideIcons.arrowDownLeft : LucideIcons.arrowUpRight,
                          '${p.direction == 'credit' ? '+' : ''}${formatMoney(p.amountMinor)}',
                          tone: p.direction == 'credit' ? l.c.success : null,
                        ),
                        if (p.merchant.isNotEmpty) chip(LucideIcons.store, p.merchant),
                        if (category != null) chip(category.iconData, category.name),
                        if (day != null) chip(LucideIcons.calendar, day),
                        if (p.time != null) chip(LucideIcons.clock, p.time!),
                      ],
                    ),
                  ),
              ],
            ),
          ),
          Positioned.fill(
            child: IgnorePointer(
              child: AnimatedContainer(
                duration: OrvTokens.durationBase,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(OrvTokens.radiusLg),
                  border: Border.all(color: _focus.hasFocus ? l.accent : Colors.transparent, width: 1.2),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The switch for reading bank and UPI messages on this phone (notification access, ADR-0012).
class _CaptureCard extends ConsumerStatefulWidget {
  const _CaptureCard();
  @override
  ConsumerState<_CaptureCard> createState() => _CaptureCardState();
}

class _CaptureCardState extends ConsumerState<_CaptureCard> with WidgetsBindingObserver {
  bool? _on;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_check());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) unawaited(_check()); // back from Android settings
  }

  Future<void> _check() async {
    final on = await ref.read(captureChannelProvider).enabled();
    if (mounted) setState(() => _on = on);
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    // once on, it stays out of the way (Settings shows it); off, it is one quiet line
    if (_on == null || _on!) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Glass(
        blur: false,
        padding: const EdgeInsets.fromLTRB(12, 8, 8, 8),
        child: Row(
          children: [
            Icon(LucideIcons.messageSquareText, color: l.accent, size: 18),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Fill Money from bank & UPI alerts',
                    style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600, fontSize: 14),
                  ),
                  Text('Read on this phone only.', style: OrvText.muted(l).copyWith(fontSize: 12)),
                ],
              ),
            ),
            OrvButton(label: 'Turn on', small: true, onPressed: () => ref.read(captureChannelProvider).openSettings()),
          ],
        ),
      ),
    );
  }
}

class _Budgets extends ConsumerWidget {
  const _Budgets({required this.month, required this.txs, required this.budgets, required this.cats});
  final String month;
  final List<TxItem> txs;
  final List<BudgetItem> budgets;
  final List<CategoryItem> cats;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    // the overall budget lives on the pace bar above; here, the categories
    final progress = budgetProgress(budgets, txs, month).where((p) => p.budget.categoryId != null).toList();
    final overall = budgets.any((b) => !b.archived && b.categoryId == null);
    if (progress.isEmpty) {
      return Semantics(
        button: true,
        label: 'Set a monthly budget',
        excludeSemantics: true,
        child: InkWell(
          borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
          onTap: () =>
              showGlassSheet<void>(context, (_) => BudgetSheet(cats: cats, budgets: budgets, overall: !overall)),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
              border: Border.all(color: l.c.hairline),
            ),
            child: Row(
              children: [
                Icon(LucideIcons.target, size: 18, color: l.accent),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    overall ? 'Add a budget for a category' : 'Set a monthly budget',
                    style: OrvText.body(l).copyWith(fontSize: 14),
                  ),
                ),
                Icon(LucideIcons.chevronRight, size: 16, color: l.c.muted),
              ],
            ),
          ),
        ),
      );
    }
    return Glass(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(child: Text('CATEGORY BUDGETS', style: OrvText.label(l))),
              OrvButton(
                label: 'Set',
                small: true,
                variant: ButtonVariant.ghost,
                icon: LucideIcons.plus,
                onPressed: () => showGlassSheet<void>(context, (_) => BudgetSheet(cats: cats, budgets: budgets)),
              ),
            ],
          ),
          if (progress.isEmpty) Text('None yet.', style: OrvText.muted(l)),
          for (final p in progress)
            GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: () => showGlassSheet<void>(
                context,
                (_) => BudgetSheet(cats: cats, budgets: budgets, categoryId: p.budget.categoryId),
              ),
              child: Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            p.budget.categoryId == null
                                ? 'Everything'
                                : (cats.where((c) => c.id == p.budget.categoryId).firstOrNull?.name ?? '—'),
                            style: OrvText.body(l),
                          ),
                        ),
                        Text(
                          '${formatMoney(p.used)} / ${formatMoney(p.budget.amountMinor)}',
                          style: OrvText.muted(l)
                              .copyWith(color: p.used > p.budget.amountMinor ? l.c.danger : l.c.muted),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(OrvTokens.radiusFull),
                      child: LinearProgressIndicator(
                        value: (p.used / p.budget.amountMinor).clamp(0, 1).toDouble(),
                        minHeight: 6,
                        backgroundColor: l.c.track,
                        color: p.used > p.budget.amountMinor
                            ? l.c.danger
                            : (p.used > p.budget.amountMinor * 0.8 ? l.c.warning : l.accent),
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
}

class _TxRow extends ConsumerWidget {
  const _TxRow({required this.tx, required this.category, this.fresh = false});
  final TxItem tx;
  final CategoryItem? category;
  final bool fresh;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final loc = MaterialLocalizations.of(context);
    final colour = labelColour(l, category?.colour);
    final name = tx.label.isNotEmpty ? tx.label : (category?.name ?? (tx.credit ? 'Money in' : 'Payment'));
    final accounts = ref.watch(accountsProvider).value ?? const <AccountItem>[];
    final acct = accounts.where((a) => a.id == tx.accountId).firstOrNull;
    final sub = [
      if (tx.title.isNotEmpty && tx.merchant.isNotEmpty) tx.merchant,
      if (tx.transfer)
        'moved${acct == null ? '' : ' from ${acct.name}'}'
      else
        category?.name ?? (tx.iouId != null ? (tx.credit ? 'paid back' : 'lent') : 'No category'),
      if (!tx.transfer && acct != null) acct.name,
      fresh ? loc.formatShortMonthDay(tx.occurredAt) : loc.formatTimeOfDay(TimeOfDay.fromDateTime(tx.occurredAt)),
    ].join(' · ');
    final waitingCredit = fresh && tx.credit;
    return InkWell(
      onTap: () => openPayment(context, tx: tx),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Row(
          children: [
            Container(
              width: 34,
              height: 34,
              decoration: BoxDecoration(
                color: (tx.transfer || tx.iouId != null ? l.accent : colour).withValues(alpha: 0.16),
                shape: BoxShape.circle,
              ),
              child: Icon(
                tx.transfer
                    ? LucideIcons.arrowLeftRight
                    : (tx.iouId != null ? LucideIcons.handCoins : (category?.iconData ?? LucideIcons.circleDot)),
                size: 16,
                color: tx.transfer || tx.iouId != null ? l.accent : colour,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600),
                  ),
                  Text(
                    sub,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: OrvText.muted(l).copyWith(fontSize: 12),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  '${tx.credit ? '+' : (tx.transfer ? '' : '−')}${formatMoney(tx.amountMinor, currency: tx.currency)}',
                  style: OrvText.body(l).copyWith(
                    fontWeight: FontWeight.w700,
                    color: tx.transfer ? l.c.muted : (tx.credit ? l.c.success : l.c.text),
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
                if (!tx.counted && !tx.transfer)
                  Text('not counted', style: OrvText.muted(l).copyWith(fontSize: 10.5, color: l.c.faint)),
              ],
            ),
            if (waitingCredit) ...[
              const SizedBox(width: 4),
              _Mini(
                icon: LucideIcons.check,
                label: 'Count it',
                tone: l.c.success,
                onTap: () => ref.read(moneyActionsProvider).update(tx.id, {'reviewed': true, 'counted': true}),
              ),
              _Mini(
                icon: LucideIcons.x,
                label: 'Not income',
                tone: l.c.muted,
                onTap: () => ref.read(moneyActionsProvider).update(tx.id, {'reviewed': true, 'counted': false}),
              ),
            ] else if (fresh)
              _Mini(
                icon: LucideIcons.check,
                label: 'Looks right: $name',
                tone: l.accent,
                onTap: () => ref.read(moneyActionsProvider).update(tx.id, {'reviewed': true}),
              ),
          ],
        ),
      ),
    );
  }
}

class _Mini extends StatelessWidget {
  const _Mini({required this.icon, required this.label, required this.tone, required this.onTap});
  final IconData icon;
  final String label;
  final Color tone;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => Semantics(
    container: true,
    button: true,
    label: label,
    excludeSemantics: true,
    child: GestureDetector(
      onTap: onTap,
      child: Container(
        width: 30,
        height: 30,
        margin: const EdgeInsets.only(left: 4),
        decoration: BoxDecoration(color: tone.withValues(alpha: 0.12), shape: BoxShape.circle),
        child: Icon(icon, size: 15, color: tone),
      ),
    ),
  );
}

/// The title a typed entry gets: what it was for ("Lunch"), not a repeat of the merchant ("uber").
String quickTitle(String note, String merchant) {
  final n = note.trim();
  if (n.isEmpty || n.toLowerCase() == merchant.trim().toLowerCase()) return '';
  return n[0].toUpperCase() + n.substring(1);
}
