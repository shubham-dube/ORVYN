import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../app/state.dart';
import '../design/controls.dart';
import '../design/theme.dart';
import '../design/toast.dart';
import '../money/money.dart';
import 'money_manage.dart' show toMinor;
import 'money_ui.dart';
import 'payment_sheet.dart' show accountIcon;
import 'today_kit.dart';

typedef MoneyFilters = ({String? category, String? account, String? direction, bool allTime});

/// Which payments (spec 0014): in or out, this month or all, a category (icons), an account — applied as you tap.
class MoneyFilterSheet extends StatefulWidget {
  const MoneyFilterSheet({
    super.key,
    required this.cats,
    required this.accounts,
    required this.value,
    required this.onChanged,
    required this.count,
  });
  final List<CategoryItem> cats;
  final List<AccountItem> accounts;
  final MoneyFilters value;
  final ValueChanged<MoneyFilters> onChanged;

  /// how many payments match, for the button
  final int Function(MoneyFilters) count;
  @override
  State<MoneyFilterSheet> createState() => _MoneyFilterSheetState();
}

class _MoneyFilterSheetState extends State<MoneyFilterSheet> {
  late MoneyFilters _f = widget.value;
  void _set(MoneyFilters f) {
    setState(() => _f = f);
    widget.onChanged(f);
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final cats = widget.cats
        .where((c) => _f.direction == null || c.kind == (_f.direction == 'credit' ? 'income' : 'expense'))
        .toList();
    final n = widget.count(_f);
    final any = _f.category != null || _f.account != null || _f.direction != null || _f.allTime;
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SheetHead(
          title: 'Show',
          trailing: any
              ? TextButton(
                  onPressed: () => _set((category: null, account: null, direction: null, allTime: false)),
                  child: const Text('Clear all'),
                )
              : null,
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Segment<String?>(
                value: _f.direction,
                onChanged: (v) => _set((category: null, account: _f.account, direction: v, allTime: _f.allTime)),
                options: [
                  (null, 'All', null, null),
                  ('debit', 'Spent', LucideIcons.arrowUpRight, null),
                  ('credit', 'Got', LucideIcons.arrowDownLeft, null),
                ],
              ),
              const SizedBox(height: 8),
              Segment<bool>(
                dense: true,
                value: _f.allTime,
                onChanged: (v) =>
                    _set((category: _f.category, account: _f.account, direction: _f.direction, allTime: v)),
                options: const [(false, 'This month', null, null), (true, 'All time', null, null)],
              ),
              const SizedBox(height: 14),
              Text('CATEGORY', style: OrvText.label(l)),
              const SizedBox(height: 4),
              CategoryPicker(
                cats: cats,
                value: _f.category,
                onChanged: (v) =>
                    _set((category: v, account: _f.account, direction: _f.direction, allTime: _f.allTime)),
              ),
              if (widget.accounts.isNotEmpty) ...[
                const SizedBox(height: 10),
                Text('ACCOUNT', style: OrvText.label(l)),
                const SizedBox(height: 6),
                SizedBox(
                  height: 36,
                  child: ListView(
                    scrollDirection: Axis.horizontal,
                    children: [
                      for (final a in widget.accounts)
                        Padding(
                          padding: const EdgeInsets.only(right: 6),
                          child: FactPill(
                            icon: accountIcon(a.kind),
                            label: a.name,
                            set: _f.account == a.id,
                            onTap: () => _set((
                              category: _f.category,
                              account: _f.account == a.id ? null : a.id,
                              direction: _f.direction,
                              allTime: _f.allTime,
                            )),
                          ),
                        ),
                    ],
                  ),
                ),
              ],
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 6, 16, 12),
          child: OrvButton(
            label: n == 0 ? 'Nothing matches' : 'Show $n',
            variant: ButtonVariant.primary,
            expand: true,
            onPressed: () => Navigator.of(context).pop(),
          ),
        ),
      ],
    );
  }
}

/// A monthly budget for everything or one category: pick it, see what it is now, set the amount, or remove it.
class BudgetSheet extends ConsumerStatefulWidget {
  const BudgetSheet({super.key, required this.cats, required this.budgets, this.categoryId, this.overall = false});
  final List<CategoryItem> cats;
  final List<BudgetItem> budgets;
  final String? categoryId;

  /// open on "Everything"
  final bool overall;
  @override
  ConsumerState<BudgetSheet> createState() => _BudgetSheetState();
}

class _BudgetSheetState extends ConsumerState<BudgetSheet> {
  late String? _categoryId = widget.categoryId;
  final _amount = TextEditingController();

  BudgetItem? get _existing => widget.budgets
      .where((b) => !b.archived && b.categoryId == _categoryId)
      .fold<BudgetItem?>(null, (a, b) => a == null || b.from.compareTo(a.from) > 0 ? b : a);

  @override
  void initState() {
    super.initState();
    _fill();
  }

  void _fill() {
    final e = _existing;
    _amount.text = e == null ? '' : '${e.amountMinor ~/ 100}';
  }

  @override
  void dispose() {
    _amount.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final cats = widget.cats.where((c) => c.kind == 'expense' && !c.archived).toList();
    final name = _categoryId == null ? 'Everything' : cats.where((c) => c.id == _categoryId).firstOrNull?.name ?? '';
    final existing = _existing;
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SheetHead(
          title: 'Monthly budget',
          subtitle: existing == null ? 'For $name' : 'For $name · now ${formatMoney(existing.amountMinor)}',
          trailing: existing == null
              ? null
              : IconButton(
                  tooltip: 'Remove this budget',
                  icon: Icon(LucideIcons.trash2, size: 18, color: l.c.danger),
                  onPressed: () async {
                    await ref.read(moneyActionsProvider).removeBudget(existing.id);
                    if (context.mounted) Navigator.of(context).pop();
                  },
                ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Align(
                alignment: Alignment.centerLeft,
                child: FactPill(
                  icon: LucideIcons.layers,
                  label: 'Everything',
                  set: _categoryId == null,
                  onTap: () => setState(() {
                    _categoryId = null;
                    _fill();
                  }),
                ),
              ),
              const SizedBox(height: 8),
              CategoryPicker(
                cats: cats,
                value: _categoryId,
                onChanged: (v) => setState(() {
                  _categoryId = v;
                  _fill();
                }),
              ),
              const SizedBox(height: 4),
              AmountHero(controller: _amount, tone: l.c.text, autofocus: true),
              Text('a month', textAlign: TextAlign.center, style: OrvText.muted(l)),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 6, 16, 12),
          child: OrvButton(
            label: 'Save',
            variant: ButtonVariant.primary,
            expand: true,
            onPressed: () async {
              final v = toMinor(_amount.text);
              if (v == null) return;
              await ref.read(moneyActionsProvider).saveBudget(existing?.id, {
                'categoryId': _categoryId,
                'amountMinor': v,
                'from': existing?.from ?? monthKey(ref.read(clockProvider)()),
              });
              if (context.mounted) {
                Toaster.of(context).show('$name: ${formatMoney(v)} a month', tone: ToastTone.success);
                Navigator.of(context).pop();
              }
            },
          ),
        ),
      ],
    );
  }
}
