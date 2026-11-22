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

  String _shift(int n) {
    final y = int.parse(_month.substring(0, 4));
    final m = int.parse(_month.substring(5, 7)) + n;
    final d = DateTime(y, m);
    return monthKey(d);
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
      if (t.transfer) continue;
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
                      padding: const EdgeInsets.only(bottom: 16),
                      child: Container(
                        decoration: BoxDecoration(
                          color: l.c.glassStrong,
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(color: l.c.edge),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            IconButton(
                              tooltip: 'Previous month',
                              visualDensity: VisualDensity.compact,
                              icon: Icon(LucideIcons.chevronLeft, size: 18, color: l.c.muted),
                              onPressed: () => setState(() => _month = _shift(-1)),
                            ),
                            if (_month != thisMonth)
                              GestureDetector(
                                onTap: () => setState(() => _month = thisMonth),
                                child: Text('Now', style: OrvText.muted(l).copyWith(color: l.accent)),
                              ),
                            IconButton(
                              tooltip: 'Next month',
                              visualDensity: VisualDensity.compact,
                              icon: Icon(LucideIcons.chevronRight, size: 18, color: l.c.muted),
                              onPressed: _month.compareTo(thisMonth) >= 0
                                  ? null
                                  : () => setState(() => _month = _shift(1)),
                            ),
                          ],
                        ),
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.only(bottom: 16),
                      child: PopupMenuButton<String>(
                        tooltip: 'More',
                        icon: Icon(LucideIcons.ellipsisVertical, color: l.c.muted),
                        onSelected: (v) async {
                          if (v == 'copy') {
                            final toaster = Toaster.of(context);
                            await Clipboard.setData(ClipboardData(text: transactionsCsv(inMonth, cats, accounts)));
                            toaster.show('Copied ${inMonth.length} rows', body: 'Paste them into Sheets or Excel.');
                          } else if (context.mounted) {
                            await showGlassSheet<void>(context, (_) => const ManageSheet());
                          }
                        },
                        itemBuilder: (_) => const [
                          PopupMenuItem(value: 'copy', child: Text('Copy as spreadsheet text')),
                          PopupMenuItem(value: 'manage', child: Text('Accounts, categories, repeating')),
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
                    padding: const EdgeInsets.fromLTRB(14, 10, 8, 6),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Row(
                          children: [
                            Icon(LucideIcons.sparkles, size: 15, color: l.accent),
                            const SizedBox(width: 6),
                            Expanded(child: Text('New · ${fresh.length}', style: OrvText.label(l))),
                            TextButton.icon(
                              icon: const Icon(LucideIcons.checkCheck, size: 15),
                              label: const Text('All fine'),
                              onPressed: () async {
                                for (final t in fresh) {
                                  await ref.read(moneyActionsProvider).update(t.id, {'reviewed': true});
                                }
                              },
                            ),
                          ],
                        ),
                        for (final t in fresh.take(8)) _TxRow(tx: t, category: cat(t.categoryId), fresh: true),
                      ],
                    ),
                  ),
                ],
                InsightsStrip(
                  month: _month,
                  onOpenTx: (id) {
                    final t = txs.where((t) => t.id == id).firstOrNull;
                    if (t != null) showGlassSheet<void>(context, (_) => _TxSheet(tx: t));
                  },
                ),
                const SizedBox(height: 12),
                _Hero(spent: s.spent, earned: s.earned, days: days, byCategory: s.byCategory, cat: cat),
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
                        (_) => _MoneyFilterSheet(
                          cats: cats.where((c) => !c.archived).toList(),
                          accounts: accounts.where((a) => a.data['archived'] != true).toList(),
                          value: (
                            category: _categoryFilter,
                            account: _accountFilter,
                            direction: _directionFilter,
                            allTime: _allTime,
                          ),
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
                          formatMoney(list.where((t) => !t.credit && !t.transfer).fold(0, (a, t) => a + t.amountMinor)),
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

typedef _Filters = ({String? category, String? account, String? direction, bool allTime});

/// Which transactions: category, account, in or out, and any month — choices in a sheet, applied as you tap.
class _MoneyFilterSheet extends StatefulWidget {
  const _MoneyFilterSheet({required this.cats, required this.accounts, required this.value, required this.onChanged});
  final List<CategoryItem> cats;
  final List<AccountItem> accounts;
  final _Filters value;
  final ValueChanged<_Filters> onChanged;
  @override
  State<_MoneyFilterSheet> createState() => _MoneyFilterSheetState();
}

class _MoneyFilterSheetState extends State<_MoneyFilterSheet> {
  late _Filters _f = widget.value;
  void _set(_Filters f) {
    setState(() => _f = f);
    widget.onChanged(f);
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    Widget group<T>(String label, T value, List<(T, String)> options, ValueChanged<T> pick) => Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SectionLabel(label),
          const SizedBox(height: 6),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final (v, t) in options)
                ChoiceChip(
                  label: Text(t),
                  selected: value == v,
                  showCheckmark: false,
                  onSelected: (_) => pick(v),
                  selectedColor: l.accent.withValues(alpha: 0.16),
                  side: BorderSide(color: value == v ? l.accent : l.c.edge),
                  backgroundColor: Colors.transparent,
                ),
            ],
          ),
        ],
      ),
    );
    return Padding(
      padding: const EdgeInsets.fromLTRB(18, 16, 18, 12),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Filter transactions', style: OrvText.heading(l)),
          const SizedBox(height: 10),
          Flexible(
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  group<String?>('Money', _f.direction, const [
                    (null, 'Spent & came in'),
                    ('debit', 'Spent'),
                    ('credit', 'Came in'),
                  ], (v) => _set((category: _f.category, account: _f.account, direction: v, allTime: _f.allTime))),
                  group<bool>('Period', _f.allTime, const [
                    (false, 'This month'),
                    (true, 'All time'),
                  ], (v) => _set((category: _f.category, account: _f.account, direction: _f.direction, allTime: v))),
                  group<String?>('Category', _f.category, [
                    (null, 'All categories'),
                    ('none', 'Uncategorised'),
                    for (final c in widget.cats) (c.id, c.name),
                  ], (v) => _set((category: v, account: _f.account, direction: _f.direction, allTime: _f.allTime))),
                  if (widget.accounts.isNotEmpty)
                    group<String?>('Account', _f.account, [
                      (null, 'All accounts'),
                      for (final a in widget.accounts) (a.id, a.name),
                    ], (v) => _set((category: _f.category, account: v, direction: _f.direction, allTime: _f.allTime))),
                ],
              ),
            ),
          ),
          OrvButton(
            label: 'Show transactions',
            variant: ButtonVariant.primary,
            onPressed: () => Navigator.of(context).pop(),
          ),
        ],
      ),
    );
  }
}

/// "yesterday" / "12 Nov" for a typed day (null for today).
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

  @override
  void dispose() {
    _c.dispose();
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
      'note': p.note,
      'categoryId': category?.id,
      'occurredAt': occurredAtFor(date: p.date, time: p.time, now: now).toUtc().toIso8601String(),
    });
    _c.clear();
    setState(() {});
    toaster.show(
      '${p.direction == 'credit' ? 'Received' : 'Spent'} ${formatMoney(p.amountMinor)}${_dayLabel(p.date, now) == null ? '' : ' · ${_dayLabel(p.date, now)}'}',
      tone: ToastTone.success,
    );
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final now = ref.watch(clockProvider)();
    final p = _c.text.trim().isEmpty ? null : parseSpend(_c.text, now: now);
    final cats = ref.watch(categoriesProvider).value ?? const <CategoryItem>[];
    final category = p == null
        ? null
        : _categoryFor((merchant: p.merchant, category: p.category), cats, ref.watch(merchantProfilesProvider));
    return Glass(
      level: GlassLevel.float,
      padding: const EdgeInsets.fromLTRB(14, 4, 8, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Icon(LucideIcons.plus, color: l.accent, size: 18),
              const SizedBox(width: 8),
              Expanded(
                child: TextField(
                  key: const Key('money-add'),
                  controller: _c,
                  onChanged: (_) => setState(() {}),
                  onSubmitted: (_) => _add(),
                  textInputAction: TextInputAction.done,
                  style: OrvText.body(l).copyWith(fontSize: 16),
                  decoration: InputDecoration(
                    hintText: 'Add… “spent 240 on lunch yesterday”',
                    hintStyle: OrvText.body(l).copyWith(color: l.c.faint, fontSize: 16),
                    border: InputBorder.none,
                  ),
                ),
              ),
              if (_c.text.trim().isEmpty)
                IconButton(
                  key: const Key('money-open-add'),
                  tooltip: 'Add with details',
                  icon: Icon(LucideIcons.listPlus, color: l.accent, size: 20),
                  onPressed: () => showAddTransaction(context),
                )
              else
                OrvButton(
                  label: 'Add',
                  small: true,
                  variant: ButtonVariant.primary,
                  onPressed: p == null ? null : _add,
                ),
            ],
          ),
          if (p != null)
            Text(
              [
                '${p.direction == 'credit' ? '+' : ''}${formatMoney(p.amountMinor)}',
                if (p.merchant.isNotEmpty) p.merchant,
                if (category != null) category.name,
                if (_dayLabel(p.date, now) != null) _dayLabel(p.date, now)!,
                if (p.time != null) p.time!,
              ].join(' · '),
              style: OrvText.muted(l).copyWith(color: l.accent),
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
    final progress = budgetProgress(budgets, txs, month);
    if (progress.isEmpty) {
      return Semantics(
        button: true,
        label: 'Set a monthly budget',
        excludeSemantics: true,
        child: InkWell(
          borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
          onTap: () => showGlassSheet<void>(context, (_) => _BudgetSheet(cats: cats, budgets: budgets)),
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
                Expanded(child: Text('Set a monthly budget', style: OrvText.body(l).copyWith(fontSize: 14))),
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
              Expanded(child: Text('Budgets', style: OrvText.label(l))),
              OrvButton(
                label: 'Set',
                small: true,
                variant: ButtonVariant.ghost,
                icon: LucideIcons.plus,
                onPressed: () => showGlassSheet<void>(context, (_) => _BudgetSheet(cats: cats, budgets: budgets)),
              ),
            ],
          ),
          if (progress.isEmpty) Text('None yet.', style: OrvText.muted(l)),
          for (final p in progress)
            Padding(
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
                        style: OrvText.muted(l).copyWith(color: p.used > p.budget.amountMinor ? l.c.danger : l.c.muted),
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
        ],
      ),
    );
  }
}

class _BudgetSheet extends ConsumerStatefulWidget {
  const _BudgetSheet({required this.cats, required this.budgets});
  final List<CategoryItem> cats;
  final List<BudgetItem> budgets;
  @override
  ConsumerState<_BudgetSheet> createState() => _BudgetSheetState();
}

class _BudgetSheetState extends ConsumerState<_BudgetSheet> {
  String? _categoryId;
  final _amount = TextEditingController();

  @override
  void dispose() {
    _amount.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    ChoiceChip chip(String label, bool on, VoidCallback tap) => ChoiceChip(
      label: Text(label),
      selected: on,
      showCheckmark: false,
      onSelected: (_) => setState(tap),
      selectedColor: l.accent.withValues(alpha: 0.16),
      side: BorderSide(color: on ? l.accent : l.c.edge),
      backgroundColor: Colors.transparent,
    );
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Monthly budget', style: OrvText.heading(l)),
          const SizedBox(height: 10),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              chip('Everything', _categoryId == null, () => _categoryId = null),
              for (final c in widget.cats.where((c) => c.kind == 'expense' && !c.archived))
                chip(c.name, _categoryId == c.id, () => _categoryId = c.id),
            ],
          ),
          const SizedBox(height: 12),
          OrvField(label: '₹ a month', controller: _amount, keyboardType: TextInputType.number),
          const SizedBox(height: 14),
          Align(
            alignment: Alignment.centerRight,
            child: OrvButton(
              label: 'Save',
              variant: ButtonVariant.primary,
              onPressed: () async {
                final v = (double.tryParse(_amount.text.replaceAll(',', '')) ?? 0) * 100;
                if (v <= 0) return;
                final existing = widget.budgets.where((b) => !b.archived && b.categoryId == _categoryId).firstOrNull;
                await ref.read(moneyActionsProvider).saveBudget(existing?.id, {
                  'categoryId': _categoryId,
                  'amountMinor': v.round(),
                  'from': monthKey(ref.read(clockProvider)()),
                });
                if (context.mounted) Navigator.of(context).pop();
              },
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
    final name = tx.merchant.isNotEmpty ? tx.merchant : (category?.name ?? 'Transaction');
    return InkWell(
      onTap: () => showGlassSheet<void>(context, (_) => _TxSheet(tx: tx)),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Row(
          children: [
            Container(
              width: 32,
              height: 32,
              decoration: BoxDecoration(color: colour.withValues(alpha: 0.16), shape: BoxShape.circle),
              child: Icon(LucideIcons.circleDot, size: 14, color: colour),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(name, style: OrvText.body(l).copyWith(fontWeight: FontWeight.w500)),
                  Text(
                    '${category?.name ?? 'Uncategorised'} · ${tx.source == 'manual' ? 'typed' : tx.source} · '
                    '${fresh ? loc.formatShortMonthDay(tx.occurredAt) : loc.formatTimeOfDay(TimeOfDay.fromDateTime(tx.occurredAt))}',
                    style: OrvText.muted(l).copyWith(fontSize: 12),
                  ),
                ],
              ),
            ),
            Text(
              '${tx.credit ? '+' : ''}${formatMoney(tx.amountMinor, currency: tx.currency)}',
              style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600, color: tx.credit ? l.c.success : l.c.text),
            ),
            if (fresh)
              IconButton(
                tooltip: 'Looks right: $name',
                icon: Icon(LucideIcons.check, size: 18, color: l.accent),
                onPressed: () => ref.read(moneyActionsProvider).update(tx.id, {'reviewed': true}),
              ),
          ],
        ),
      ),
    );
  }
}

class _TxSheet extends ConsumerStatefulWidget {
  const _TxSheet({required this.tx});
  final TxItem tx;
  @override
  ConsumerState<_TxSheet> createState() => _TxSheetState();
}

class _TxSheetState extends ConsumerState<_TxSheet> {
  late final _amount = TextEditingController(text: (widget.tx.amountMinor / 100).toStringAsFixed(2));
  late final _merchant = TextEditingController(text: widget.tx.merchant);
  late final _note = TextEditingController(text: widget.tx.note);
  late String? _categoryId = widget.tx.categoryId;
  late bool _credit = widget.tx.credit;
  late bool _transfer = widget.tx.transfer;

  @override
  void dispose() {
    _amount.dispose();
    _merchant.dispose();
    _note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final cats = (ref.watch(categoriesProvider).value ?? const <CategoryItem>[]).where((c) => !c.archived);
    ChoiceChip chip(String label, bool on, VoidCallback tap) => ChoiceChip(
      label: Text(label),
      selected: on,
      showCheckmark: false,
      onSelected: (_) => setState(tap),
      selectedColor: l.accent.withValues(alpha: 0.16),
      side: BorderSide(color: on ? l.accent : l.c.edge),
      backgroundColor: Colors.transparent,
    );
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Transaction', style: OrvText.heading(l)),
          const SizedBox(height: 10),
          OrvField(label: 'Amount (₹)', controller: _amount, keyboardType: TextInputType.number),
          const SizedBox(height: 8),
          Wrap(
            spacing: 6,
            children: [chip('Spent', !_credit, () => _credit = false), chip('Came in', _credit, () => _credit = true)],
          ),
          const SizedBox(height: 8),
          OrvField(label: 'Merchant', controller: _merchant),
          const SizedBox(height: 8),
          Text('Category', style: OrvText.label(l)),
          const SizedBox(height: 4),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final c in cats.where((c) => c.kind == (_credit ? 'income' : 'expense') || c.kind == 'transfer'))
                chip(c.name, _categoryId == c.id, () => _categoryId = c.id),
            ],
          ),
          const SizedBox(height: 8),
          OrvField(label: 'Note', controller: _note),
          OrvSwitchRow(
            label: 'Between my own accounts',
            subtitle: 'Not counted as spending',
            value: _transfer,
            onChanged: (v) => setState(() => _transfer = v),
          ),
          if (widget.tx.merchant.isNotEmpty)
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                icon: const Icon(LucideIcons.store, size: 15),
                label: Text('See all at ${widget.tx.merchant}'),
                onPressed: () => openMerchant(context, widget.tx.merchant),
              ),
            ),
          if (widget.tx.rawMerchant.isNotEmpty && widget.tx.rawMerchant != widget.tx.merchant)
            Text('The message said: ${widget.tx.rawMerchant}', style: OrvText.muted(l).copyWith(fontSize: 12)),
          const SizedBox(height: 14),
          Row(
            children: [
              OrvButton(
                label: 'Delete',
                small: true,
                variant: ButtonVariant.danger,
                icon: LucideIcons.trash2,
                onPressed: () async {
                  await ref.read(moneyActionsProvider).remove(widget.tx.id);
                  if (context.mounted) Navigator.of(context).pop();
                },
              ),
              const Spacer(),
              OrvButton(
                label: 'Save',
                variant: ButtonVariant.primary,
                onPressed: () async {
                  final v = ((double.tryParse(_amount.text.replaceAll(',', '')) ?? 0) * 100).round();
                  await ref.read(moneyActionsProvider).update(widget.tx.id, {
                    if (v > 0) 'amountMinor': v,
                    'direction': _credit ? 'credit' : 'debit',
                    'merchant': _merchant.text.trim(),
                    'categoryId': _categoryId,
                    'note': _note.text,
                    'transfer': _transfer,
                    'reviewed': true,
                  });
                  if (context.mounted) Navigator.of(context).pop();
                },
              ),
            ],
          ),
        ],
      ),
    );
  }
}
