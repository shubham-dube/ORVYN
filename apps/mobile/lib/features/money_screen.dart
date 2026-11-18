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
import '../money/capture.dart';
import '../money/money.dart';
import '../money/spend_date.dart';
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
    final thisMonth = monthKey(ref.watch(clockProvider)());
    CategoryItem? cat(String? id) => cats.where((c) => c.id == id).firstOrNull;
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
                PageTitle('Money', overline: loc.formatMonthYear(DateTime.parse('$_month-01'))),
                Row(
                  children: [
                    IconButton(
                      tooltip: 'Previous month',
                      icon: Icon(LucideIcons.chevronLeft, color: l.c.muted),
                      onPressed: () => setState(() => _month = _shift(-1)),
                    ),
                    TextButton(
                      onPressed: () => setState(() => _month = thisMonth),
                      child: Text('This month', style: OrvText.muted(l)),
                    ),
                    IconButton(
                      tooltip: 'Next month',
                      icon: Icon(LucideIcons.chevronRight, color: l.c.muted),
                      onPressed: _month.compareTo(thisMonth) >= 0 ? null : () => setState(() => _month = _shift(1)),
                    ),
                    const Spacer(),
                    PopupMenuButton<String>(
                      tooltip: 'More',
                      icon: Icon(LucideIcons.ellipsis, color: l.c.muted),
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
                    OrvButton(
                      key: const Key('money-open-add'),
                      label: 'Add',
                      small: true,
                      variant: ButtonVariant.primary,
                      icon: LucideIcons.plus,
                      onPressed: () => showAddTransaction(context),
                    ),
                  ],
                ),
                const _QuickEntry(),
                const SizedBox(height: 12),
                const _CaptureCard(),
                if (fresh.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  Glass(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Row(
                          children: [
                            Expanded(child: Text('New · ${fresh.length}', style: OrvText.label(l))),
                            OrvButton(
                              label: 'All fine',
                              small: true,
                              variant: ButtonVariant.ghost,
                              icon: LucideIcons.check,
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
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: _Stat(label: 'Spent', value: formatMoney(s.spent), semantics: 'Spent this month'),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: _Stat(label: 'Came in', value: formatMoney(s.earned)),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                _Budgets(month: _month, txs: txs, budgets: budgets, cats: cats),
                const SizedBox(height: 12),
                if (s.byCategory.isNotEmpty)
                  Glass(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text('By category', style: OrvText.label(l)),
                        const SizedBox(height: 6),
                        for (final (id, minor) in s.byCategory)
                          Padding(
                            padding: const EdgeInsets.symmetric(vertical: 3),
                            child: Row(
                              children: [
                                Container(
                                  width: 10,
                                  height: 10,
                                  decoration: BoxDecoration(
                                    color: labelColour(l, cat(id)?.colour),
                                    shape: BoxShape.circle,
                                  ),
                                ),
                                const SizedBox(width: 8),
                                Expanded(child: Text(cat(id)?.name ?? 'Uncategorised', style: OrvText.body(l))),
                                Text(formatMoney(minor), style: OrvText.muted(l)),
                              ],
                            ),
                          ),
                      ],
                    ),
                  ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        _allTime ? 'All time' : loc.formatMonthYear(DateTime.parse('$_month-01')),
                        style: OrvText.label(l),
                      ),
                    ),
                    if (_filtering)
                      Text(
                        '${inMonth.length} found · ${formatMoney(shownOut)} spent${shownIn > 0 ? ' · ${formatMoney(shownIn)} came in' : ''}',
                        style: OrvText.muted(l).copyWith(fontSize: 12),
                      ),
                  ],
                ),
                const SizedBox(height: 6),
                _FilterBar(
                  search: _search,
                  cats: cats.where((c) => !c.archived).toList(),
                  accounts: accounts.where((a) => a.data['archived'] != true).toList(),
                  category: _categoryFilter,
                  account: _accountFilter,
                  direction: _directionFilter,
                  allTime: _allTime,
                  dirty: _filtering,
                  onChanged: (f) => setState(() {
                    _categoryFilter = f.category;
                    _accountFilter = f.account;
                    _directionFilter = f.direction;
                    _allTime = f.allTime;
                  }),
                  onSearch: () => setState(() {}),
                  onClear: () => setState(() {
                    _search.clear();
                    _categoryFilter = _accountFilter = _directionFilter = null;
                    _allTime = false;
                  }),
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
                for (final t in inMonth) _TxRow(tx: t, category: cat(t.categoryId)),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.label, required this.value, this.semantics});
  final String label;
  final String value;
  final String? semantics;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return Glass(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: OrvText.label(l)),
          Semantics(
            label: semantics == null ? null : '$semantics: $value',
            excludeSemantics: semantics != null,
            child: Text(value, style: OrvText.title(l)),
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

typedef _Filters = ({String? category, String? account, String? direction, bool allTime});

class _FilterBar extends StatelessWidget {
  const _FilterBar({
    required this.search,
    required this.cats,
    required this.accounts,
    required this.category,
    required this.account,
    required this.direction,
    required this.allTime,
    required this.dirty,
    required this.onChanged,
    required this.onSearch,
    required this.onClear,
  });
  final TextEditingController search;
  final List<CategoryItem> cats;
  final List<AccountItem> accounts;
  final String? category;
  final String? account;
  final String? direction;
  final bool allTime;
  final bool dirty;
  final ValueChanged<_Filters> onChanged;
  final VoidCallback onSearch;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    _Filters f({Object? cat = _keep, Object? acct = _keep, Object? dir = _keep, bool? all}) => (
      category: cat == _keep ? category : cat as String?,
      account: acct == _keep ? account : acct as String?,
      direction: dir == _keep ? direction : dir as String?,
      allTime: all ?? allTime,
    );
    Widget menu(String label, String? value, List<(String?, String)> options, ValueChanged<String?> pick) =>
        PopupMenuButton<String?>(
          tooltip: label,
          onSelected: pick,
          itemBuilder: (_) => [for (final (v, t) in options) PopupMenuItem<String?>(value: v, child: Text(t))],
          child: Chip(
            label: Text(options.where((o) => o.$1 == value).firstOrNull?.$2 ?? label),
            side: BorderSide(color: value == null ? l.c.edge : l.accent),
            backgroundColor: value == null ? Colors.transparent : l.accent.withValues(alpha: 0.12),
          ),
        );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          key: const Key('money-search'),
          controller: search,
          onChanged: (_) => onSearch(),
          style: OrvText.body(l),
          decoration: InputDecoration(
            isDense: true,
            prefixIcon: Icon(LucideIcons.search, size: 16, color: l.c.faint),
            hintText: 'Search merchant, note, amount',
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
            menu('All categories', category, [
              (null, 'All categories'),
              ('none', 'Uncategorised'),
              for (final c in cats) (c.id, c.name),
            ], (v) => onChanged(f(cat: v))),
            if (accounts.isNotEmpty)
              menu('All accounts', account, [
                (null, 'All accounts'),
                for (final a in accounts) (a.id, a.name),
              ], (v) => onChanged(f(acct: v))),
            menu('Spent & came in', direction, const [
              (null, 'Spent & came in'),
              ('debit', 'Spent'),
              ('credit', 'Came in'),
            ], (v) => onChanged(f(dir: v))),
            FilterChip(
              label: const Text('All time'),
              selected: allTime,
              showCheckmark: false,
              onSelected: (v) => onChanged(f(all: v)),
              selectedColor: l.accent.withValues(alpha: 0.16),
              side: BorderSide(color: allTime ? l.accent : l.c.edge),
              backgroundColor: Colors.transparent,
            ),
            if (dirty) ActionChip(label: const Text('Clear'), onPressed: onClear, backgroundColor: Colors.transparent),
          ],
        ),
      ],
    );
  }
}

const Object _keep = Object();

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
    final category = cats.where((c) => c.slug != null && c.slug == p.category).firstOrNull;
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
    final category = p == null ? null : cats.where((c) => c.slug != null && c.slug == p.category).firstOrNull;
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
              OrvButton(label: 'Add', small: true, variant: ButtonVariant.primary, onPressed: p == null ? null : _add),
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
    if (_on == null) return const SizedBox.shrink();
    return Glass(
      blur: false,
      padding: const EdgeInsets.all(14),
      child: Row(
        children: [
          Icon(_on! ? LucideIcons.shieldCheck : LucideIcons.messageSquareText, color: l.accent),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _on! ? 'Reading bank & UPI messages' : 'Fill Money automatically',
                  style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600),
                ),
                Text(
                  _on! ? 'Only payment messages, read on this phone. The messages themselves never leave it.' : 'Let ORVYN read payment notifications from your bank SMS, GPay, PhonePe and Paytm — on this phone only.',
                  style: OrvText.muted(l),
                ),
              ],
            ),
          ),
          if (!_on!)
            OrvButton(label: 'Turn on', small: true, onPressed: () => ref.read(captureChannelProvider).openSettings()),
        ],
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
                    '${loc.formatShortMonthDay(tx.occurredAt)}',
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
