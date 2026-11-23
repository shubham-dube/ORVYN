import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../app/repeat.dart';
import '../app/state.dart';
import '../design/controls.dart';
import '../design/theme.dart';
import '../design/toast.dart';
import '../money/brain.dart';
import '../money/money.dart';
import 'payment_sheet.dart';

String _day(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

/// Rupees typed in the amount box, in paise (null while it isn't a positive amount).
int? toMinor(String s) {
  final v = ((double.tryParse(s.replaceAll(RegExp(r'[,₹\s]'), '')) ?? 0) * 100).round();
  return v > 0 ? v : null;
}

/// The full "add" form: any day (today / yesterday / the day before, or pick one), an optional time, and "Repeats" to make
/// it a schedule (rent, subscription, salary) instead of a single entry. With [recurring] it edits that schedule.
Future<void> showAddTransaction(BuildContext context, {RecurringItem? recurring, Map<String, dynamic>? seed}) =>
    openPayment(context, recurring: recurring, seed: seed);

/// Scheduled entries, accounts and categories in one place.
class ManageSheet extends ConsumerStatefulWidget {
  const ManageSheet({super.key});
  @override
  ConsumerState<ManageSheet> createState() => _ManageSheetState();
}

class _ManageSheetState extends ConsumerState<ManageSheet> {
  String _tab = 'repeating';

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    ChoiceChip tab(String id, String label) => ChoiceChip(
      label: Text(label),
      selected: _tab == id,
      showCheckmark: false,
      onSelected: (_) => setState(() => _tab = id),
      selectedColor: l.accent.withValues(alpha: 0.16),
      side: BorderSide(color: _tab == id ? l.accent : l.c.edge),
      backgroundColor: Colors.transparent,
    );
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Manage money', style: OrvText.heading(l)),
          const SizedBox(height: 10),
          Wrap(
            spacing: 6,
            children: [
              tab('repeating', 'Repeating'),
              tab('accounts', 'Accounts'),
              tab('categories', 'Categories'),
              tab('learned', 'Learned'),
            ],
          ),
          const SizedBox(height: 12),
          switch (_tab) {
            'repeating' => const _RepeatingList(),
            'accounts' => const _Accounts(),
            'learned' => const _Learned(),
            _ => const _Categories(),
          },
        ],
      ),
    );
  }
}

final _rulesProvider = FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) async {
  final r = await ref.read(apiProvider).get<List<dynamic>>('/money/rules');
  return [for (final x in r) Map<String, dynamic>.from(x as Map)];
});

/// What ORVYN learned from answers to "what was it?" (spec 0007 C1); each can be forgotten.
class _Learned extends ConsumerWidget {
  const _Learned();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final rules = ref.watch(_rulesProvider);
    return switch (rules) {
      AsyncData(:final value) when value.isEmpty => Text(
        'Nothing yet. When ORVYN asks about a payment, answer with a category — “always food” files that merchant by '
        'itself from then on. Answering the same way twice does it too.',
        style: OrvText.muted(l),
      ),
      AsyncData(:final value) => Column(
        children: [
          for (final r in value)
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(r['merchant'] as String, style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600)),
              subtitle: Text(
                '${switch (r['action']) {
                  'ignore' => 'Skipped — not yours',
                  'transfer' => 'Your own transfer',
                  _ => 'Filed as ${r['category'] ?? 'a deleted category'}',
                }} · ${r['active'] == true ? (r['always'] == true ? 'always' : 'automatic') : 'asks once more first'}',
                style: OrvText.muted(l).copyWith(fontSize: 12),
              ),
              trailing: TextButton(
                onPressed: () async {
                  await ref.read(apiProvider).delete<dynamic>('/money/rules/${r['id']}');
                  ref.invalidate(_rulesProvider);
                },
                child: Text('Forget', semanticsLabel: 'Forget ${r['merchant']}'),
              ),
            ),
        ],
      ),
      AsyncError() => Text('Couldn’t load what ORVYN learned.', style: OrvText.muted(l)),
      _ => const Padding(
        padding: EdgeInsets.all(16),
        child: Center(child: CircularProgressIndicator()),
      ),
    };
  }
}

class _RepeatingList extends ConsumerWidget {
  const _RepeatingList();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final items = ref.watch(recurringProvider).value ?? const <RecurringItem>[];
    final cats = ref.watch(categoriesProvider).value ?? const <CategoryItem>[];
    final today = _day(ref.watch(clockProvider)());
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (items.isEmpty)
          Text(
            'Nothing repeats yet. Add rent, a subscription or your salary once and it shows up on its day.',
            style: OrvText.muted(l),
          ),
        for (final r in items)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Row(
              children: [
                Expanded(
                  child: InkWell(
                    onTap: () => showAddTransaction(context, recurring: r),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(r.title, style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600)),
                        Text(
                          [
                            formatMoney(r.amountMinor, currency: r.currency),
                            parseRepeat(r.rrule) == null ? 'custom' : describeSpec(parseRepeat(r.rrule)!),
                            if (!r.paused && nextDates(r.rrule, r.startDate, 1, from: today).isNotEmpty)
                              'next ${nextDates(r.rrule, r.startDate, 1, from: today).first}',
                            if (r.mode == 'remind') 'reminder',
                            if (cats.where((c) => c.id == r.categoryId).firstOrNull != null)
                              cats.where((c) => c.id == r.categoryId).first.name,
                          ].join(' · '),
                          style: OrvText.muted(l).copyWith(fontSize: 12),
                        ),
                      ],
                    ),
                  ),
                ),
                if (r.paused) Text('Paused', style: OrvText.muted(l).copyWith(color: l.c.warning)),
                IconButton(
                  tooltip: r.paused ? 'Resume ${r.title}' : 'Pause ${r.title}',
                  icon: Icon(r.paused ? LucideIcons.play : LucideIcons.pause, size: 18, color: l.c.muted),
                  onPressed: () => ref.read(moneyActionsProvider).saveRecurring(r.id, {'paused': !r.paused}),
                ),
                IconButton(
                  tooltip: 'Delete ${r.title}',
                  icon: Icon(LucideIcons.trash2, size: 18, color: l.c.muted),
                  onPressed: () {
                    final toaster = Toaster.of(context);
                    ref.read(moneyActionsProvider).removeRecurring(r.id);
                    toaster.show('Schedule removed. Entries already added stay.');
                  },
                ),
              ],
            ),
          ),
        const SizedBox(height: 8),
        OrvButton(
          label: 'New repeating entry',
          icon: LucideIcons.plus,
          onPressed: () => showAddTransaction(context, seed: const {'rrule': 'FREQ=MONTHLY;BYMONTHDAY=1'}),
        ),
      ],
    );
  }
}

class _Accounts extends ConsumerStatefulWidget {
  const _Accounts();
  @override
  ConsumerState<_Accounts> createState() => _AccountsState();
}

class _AccountsState extends ConsumerState<_Accounts> {
  final _name = TextEditingController();
  final _last4 = TextEditingController();
  String _kind = 'bank';

  @override
  void dispose() {
    _name.dispose();
    _last4.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final live = (ref.watch(accountsProvider).value ?? const <AccountItem>[]).where((a) => a.data['archived'] != true);
    const kinds = {'bank': 'Bank', 'card': 'Card', 'upi': 'UPI app', 'wallet': 'Wallet', 'cash': 'Cash'};
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (live.isEmpty)
          Text('No accounts yet. They’re also created when a bank message is read.', style: OrvText.muted(l)),
        for (final a in live)
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(a.name, style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600)),
                    Text(
                      '${kinds[a.kind] ?? a.kind}${a.last4 == null ? '' : ' ··${a.last4}'}',
                      style: OrvText.muted(l).copyWith(fontSize: 12),
                    ),
                  ],
                ),
              ),
              IconButton(
                tooltip: 'Archive ${a.name}',
                icon: Icon(LucideIcons.trash2, size: 18, color: l.c.muted),
                onPressed: () => ref.read(moneyActionsProvider).saveAccount(a.id, {'archived': true}),
              ),
            ],
          ),
        const SizedBox(height: 10),
        OrvField(label: 'New account', hint: 'HDFC savings, Cash…', controller: _name),
        const SizedBox(height: 8),
        Wrap(
          spacing: 6,
          children: [
            for (final e in kinds.entries)
              ChoiceChip(
                label: Text(e.value),
                selected: _kind == e.key,
                showCheckmark: false,
                onSelected: (_) => setState(() => _kind = e.key),
                selectedColor: l.accent.withValues(alpha: 0.16),
                side: BorderSide(color: _kind == e.key ? l.accent : l.c.edge),
                backgroundColor: Colors.transparent,
              ),
          ],
        ),
        const SizedBox(height: 8),
        OrvField(label: 'Last digits (optional)', controller: _last4, keyboardType: TextInputType.number),
        const SizedBox(height: 10),
        Align(
          alignment: Alignment.centerRight,
          child: OrvButton(
            label: 'Add account',
            variant: ButtonVariant.primary,
            onPressed: () async {
              if (_name.text.trim().isEmpty) return;
              await ref.read(moneyActionsProvider).saveAccount(null, {
                'name': _name.text.trim(),
                'kind': _kind,
                'last4': RegExp(r'^\d{3,6}$').hasMatch(_last4.text) ? _last4.text : null,
              });
              _name.clear();
              _last4.clear();
            },
          ),
        ),
      ],
    );
  }
}

class _Categories extends ConsumerStatefulWidget {
  const _Categories();
  @override
  ConsumerState<_Categories> createState() => _CategoriesState();
}

class _CategoriesState extends ConsumerState<_Categories> {
  final _name = TextEditingController();
  String _kind = 'expense';

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final all = ref.watch(categoriesProvider).value ?? const <CategoryItem>[];
    final live = all.where((c) => !c.archived);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final c in live)
          Row(
            children: [
              Container(
                width: 10,
                height: 10,
                decoration: BoxDecoration(color: l.accent, shape: BoxShape.circle),
              ),
              const SizedBox(width: 10),
              Expanded(child: Text(c.name, style: OrvText.body(l))),
              if (c.kind != 'expense') Text(c.kind, style: OrvText.muted(l).copyWith(fontSize: 12)),
              IconButton(
                tooltip: 'Archive ${c.name}',
                icon: Icon(LucideIcons.trash2, size: 18, color: l.c.muted),
                onPressed: () => ref.read(moneyActionsProvider).saveCategory(c.id, {'archived': true}),
              ),
            ],
          ),
        const SizedBox(height: 10),
        OrvField(label: 'New category', hint: 'Pets, Hobbies…', controller: _name),
        const SizedBox(height: 8),
        Wrap(
          spacing: 6,
          children: [
            for (final e in const {'expense': 'Expense', 'income': 'Income'}.entries)
              ChoiceChip(
                label: Text(e.value),
                selected: _kind == e.key,
                showCheckmark: false,
                onSelected: (_) => setState(() => _kind = e.key),
                selectedColor: l.accent.withValues(alpha: 0.16),
                side: BorderSide(color: _kind == e.key ? l.accent : l.c.edge),
                backgroundColor: Colors.transparent,
              ),
          ],
        ),
        const SizedBox(height: 10),
        Align(
          alignment: Alignment.centerRight,
          child: OrvButton(
            label: 'Add category',
            variant: ButtonVariant.primary,
            onPressed: () async {
              if (_name.text.trim().isEmpty) return;
              await ref.read(moneyActionsProvider).saveCategory(null, {
                'name': _name.text.trim(),
                'kind': _kind,
                'colour': 'sky',
                'order': all.length + 1,
              });
              _name.clear();
            },
          ),
        ),
        Text(
          'Archiving hides a category from the lists; past entries keep it.',
          style: OrvText.muted(l).copyWith(fontSize: 12),
        ),
      ],
    );
  }
}

/// Smart fill under the merchant field (spec 0013): merchants you've paid that match what's typed — or, with only an
/// amount typed, who you paid that much before — and the usual amounts for the merchant you picked.
class SmartFill extends ConsumerWidget {
  const SmartFill({
    super.key,
    required this.merchant,
    required this.amountMinor,
    required this.why,
    required this.onPick,
    required this.onAmount,
  });
  final String merchant;
  final int? amountMinor;
  final String? why;
  final void Function(MerchantProfile p, {bool amount}) onPick;
  final ValueChanged<int> onAmount;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final profiles = ref.watch(merchantProfilesProvider);
    final cats = ref.watch(categoriesProvider).value ?? const <CategoryItem>[];
    final now = ref.watch(clockProvider)();
    final exact = profiles[merchantKey(merchant)];
    final typed = merchant.trim();
    final amount = amountMinor;
    final List<MerchantProfile> people = typed.isEmpty
        ? (amount != null ? merchantsForAmount(profiles, amount) : suggestMerchants(profiles, '', now, n: 4))
        : (exact != null ? const [] : suggestMerchants(profiles, typed, now, n: 4));
    final amounts = exact == null ? const <int>[] : exact.amounts.where((a) => a != amount).take(3).toList();
    if (people.isEmpty && amounts.isEmpty && why == null) return const SizedBox(height: 4);
    String catName(String? id) => cats.where((c) => c.id == id).firstOrNull?.name ?? '';
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (people.isNotEmpty) ...[
            Text(
              typed.isEmpty && amount != null
                  ? 'You paid ${formatMoney(amount)} to'
                  : (typed.isEmpty ? 'Often' : 'From your history'),
              style: OrvText.muted(l).copyWith(fontSize: 11.5, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 4),
            SizedBox(
              height: 48,
              child: ListView(
                scrollDirection: Axis.horizontal,
                children: [
                  for (final p in people)
                    Padding(
                      padding: const EdgeInsets.only(right: 6),
                      child: Material(
                        color: Colors.transparent,
                        child: InkWell(
                          key: Key('smart-${p.key}'),
                          borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
                          onTap: () => onPick(p, amount: amount == null),
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                            decoration: BoxDecoration(
                              color: l.accent.withValues(alpha: 0.08),
                              borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
                              border: Border.all(color: l.accent.withValues(alpha: 0.3)),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Text(
                                  p.merchant,
                                  style: OrvText.body(l).copyWith(fontSize: 13, fontWeight: FontWeight.w700),
                                ),
                                Text(
                                  [
                                    '~${formatMoney(p.medianMinor)}',
                                    catName(p.categoryId),
                                    '${p.count}×',
                                  ].where((x) => x.isNotEmpty).join(' · '),
                                  style: OrvText.muted(l).copyWith(fontSize: 11),
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
          ],
          if (amounts.isNotEmpty) ...[
            const SizedBox(height: 6),
            Wrap(
              spacing: 6,
              children: [
                for (final a in amounts)
                  ActionChip(
                    visualDensity: VisualDensity.compact,
                    avatar: Icon(LucideIcons.history, size: 13, color: l.accent),
                    label: Text(formatMoney(a)),
                    onPressed: () => onAmount(a),
                    backgroundColor: Colors.transparent,
                    side: BorderSide(color: l.c.edge),
                  ),
              ],
            ),
          ],
          if (why != null)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Row(
                children: [
                  Icon(LucideIcons.sparkles, size: 13, color: l.accent),
                  const SizedBox(width: 6),
                  Flexible(
                    child: Text(why!, style: OrvText.muted(l).copyWith(fontSize: 12, color: l.accent)),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
