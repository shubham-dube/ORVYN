import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../app/repeat.dart';
import '../app/state.dart';
import '../app/today_settings.dart' show todaySettingsProvider;
import '../design/controls.dart';
import '../design/theme.dart';
import '../design/toast.dart';
import '../money/money.dart';
import '../money/spend_date.dart';
import 'repeat_editor.dart';
import 'sheets.dart';

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
    showGlassSheet<void>(context, (_) => AddTransactionSheet(recurring: recurring, seed: seed));

class AddTransactionSheet extends ConsumerStatefulWidget {
  const AddTransactionSheet({super.key, this.recurring, this.seed});
  final RecurringItem? recurring;

  /// amount (rupees text), credit, merchant, categoryId, date, time, note, rrule
  final Map<String, dynamic>? seed;
  @override
  ConsumerState<AddTransactionSheet> createState() => _AddTransactionSheetState();
}

class _AddTransactionSheetState extends ConsumerState<AddTransactionSheet> {
  late final TextEditingController _amount;
  late final TextEditingController _merchant;
  late final TextEditingController _note;
  late bool _credit;
  String? _categoryId;
  String? _accountId;
  late String _date;
  String? _time;
  String _rrule = '';
  String _mode = 'add';
  String? _problem;

  @override
  void initState() {
    super.initState();
    final r = widget.recurring;
    final s = widget.seed ?? const {};
    final today = _day(ref.read(clockProvider)());
    _amount = TextEditingController(
      text: r != null ? (r.amountMinor / 100).toString() : (s['amount'] as String? ?? ''),
    );
    _merchant = TextEditingController(
      text: r != null ? (r.merchant.isEmpty ? r.title : r.merchant) : (s['merchant'] as String? ?? ''),
    );
    _note = TextEditingController(text: r?.note ?? (s['note'] as String? ?? ''));
    _credit = r?.credit ?? (s['credit'] as bool? ?? false);
    _categoryId = r?.categoryId ?? s['categoryId'] as String?;
    _accountId = r?.accountId;
    _date = r?.startDate ?? (s['date'] as String? ?? today);
    _time = r != null ? r.time : s['time'] as String?;
    _rrule = r?.rrule ?? (s['rrule'] as String? ?? '');
    _mode = r?.mode ?? 'add';
  }

  @override
  void dispose() {
    _amount.dispose();
    _merchant.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final now = ref.read(clockProvider)();
    final today = _day(now);
    final minor = toMinor(_amount.text);
    if (minor == null) return setState(() => _problem = 'Enter an amount above zero.');
    final repeats = _rrule.isNotEmpty;
    if (!repeats && _date.compareTo(today) > 0) {
      return setState(() => _problem = 'That day hasn’t happened yet. Turn on “Repeats” to schedule it.');
    }
    final toaster = Toaster.of(context);
    final nav = Navigator.of(context);
    final loc = MaterialLocalizations.of(context);
    final actions = ref.read(moneyActionsProvider);
    unawaited(HapticFeedback.lightImpact());
    if (repeats) {
      final tz = (ref.read(todaySettingsProvider).value?['timeZone'] as String?) ?? 'Asia/Kolkata';
      final cats = ref.read(categoriesProvider).value ?? const <CategoryItem>[];
      await actions.saveRecurring(widget.recurring?.id, {
        'title': _merchant.text.trim().isNotEmpty
            ? _merchant.text.trim()
            : (cats.where((c) => c.id == _categoryId).firstOrNull?.name ?? 'Scheduled'),
        'amountMinor': minor,
        'direction': _credit ? 'credit' : 'debit',
        'merchant': _merchant.text.trim(),
        'categoryId': _categoryId,
        'accountId': _accountId,
        'note': _note.text,
        'rrule': _rrule,
        'startDate': _date,
        'time': _time ?? '09:00',
        'timeZone': tz,
        'mode': _mode,
        if (widget.recurring == null) 'paused': false,
      });
      toaster.show('Scheduled · ${describeSpec(parseRepeat(_rrule)!)}', tone: ToastTone.success);
    } else {
      final at = occurredAtFor(date: _date, time: _time, now: now);
      await actions.add({
        'amountMinor': minor,
        'direction': _credit ? 'credit' : 'debit',
        'merchant': _merchant.text.trim(),
        'categoryId': _categoryId,
        'accountId': _accountId,
        'note': _note.text,
        'occurredAt': at.toUtc().toIso8601String(),
      });
      toaster.show(
        '${_credit ? 'Received' : 'Spent'} ${formatMoney(minor)}${_date == today ? '' : ' · ${loc.formatShortMonthDay(at)}'}',
        tone: ToastTone.success,
      );
    }
    if (nav.mounted) nav.pop();
  }

  Future<void> _pickDate() async {
    final now = ref.read(clockProvider)();
    final repeats = _rrule.isNotEmpty;
    final picked = await showDatePicker(
      context: context,
      initialDate: DateTime.parse(_date),
      firstDate: DateTime(now.year - 5),
      lastDate: repeats ? DateTime(now.year + 5) : DateTime(now.year, now.month, now.day),
    );
    if (picked != null) setState(() => _date = _day(picked));
  }

  Future<void> _pickTime() async {
    final t = _time?.split(':').map(int.parse).toList();
    final picked = await showTimePicker(
      context: context,
      initialTime: TimeOfDay(hour: t?[0] ?? 12, minute: t?[1] ?? 0),
    );
    if (picked != null) {
      setState(() => _time = '${picked.hour.toString().padLeft(2, '0')}:${picked.minute.toString().padLeft(2, '0')}');
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final now = ref.watch(clockProvider)();
    final today = _day(now);
    final cats = (ref.watch(categoriesProvider).value ?? const <CategoryItem>[]).where((c) => !c.archived);
    final accounts = (ref.watch(accountsProvider).value ?? const <AccountItem>[]).toList();
    final repeats = _rrule.isNotEmpty;
    ChoiceChip chip(String label, bool on, VoidCallback tap) => ChoiceChip(
      label: Text(label),
      selected: on,
      showCheckmark: false,
      onSelected: (_) => setState(tap),
      selectedColor: l.accent.withValues(alpha: 0.16),
      side: BorderSide(color: on ? l.accent : l.c.edge),
      backgroundColor: Colors.transparent,
    );
    final yesterday = _day(DateTime(now.year, now.month, now.day - 1));
    final before = DateTime(now.year, now.month, now.day - 2);
    return StickySheet(
      title: widget.recurring != null ? 'Scheduled' : 'Add transaction',
      footer: Align(
        alignment: Alignment.centerRight,
        child: OrvButton(label: repeats ? 'Save schedule' : 'Add', variant: ButtonVariant.primary, onPressed: _submit),
      ),
      children: [
        OrvField(
          label: 'Amount (₹)',
          controller: _amount,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          autofocus: true,
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 6,
          children: [chip('Spent', !_credit, () => _credit = false), chip('Came in', _credit, () => _credit = true)],
        ),
        const SizedBox(height: 8),
        OrvField(label: 'Merchant or what for', controller: _merchant),
        const SizedBox(height: 10),
        Text(repeats ? 'Starts' : 'When', style: OrvText.label(l)),
        const SizedBox(height: 4),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            if (!repeats) ...[
              chip('Today', _date == today, () => _date = today),
              chip('Yesterday', _date == yesterday, () => _date = yesterday),
              chip(
                MaterialLocalizations.of(context).formatShortDate(before),
                _date == _day(before),
                () => _date = _day(before),
              ),
            ],
            ActionChip(
              key: const Key('money-pick-date'),
              avatar: Icon(LucideIcons.calendar, size: 14, color: l.accent),
              label: Text(
                [today, yesterday, _day(before)].contains(_date) && !repeats
                    ? 'Pick a day'
                    : MaterialLocalizations.of(context).formatMediumDate(DateTime.parse(_date)),
              ),
              onPressed: _pickDate,
              backgroundColor: Colors.transparent,
              side: BorderSide(color: l.c.edge),
            ),
            ActionChip(
              key: const Key('money-pick-time'),
              avatar: Icon(LucideIcons.clock, size: 14, color: l.accent),
              label: Text(_time ?? (repeats ? '09:00' : 'Add a time')),
              onPressed: _pickTime,
              backgroundColor: Colors.transparent,
              side: BorderSide(color: l.c.edge),
            ),
            if (_time != null && !repeats)
              ActionChip(
                label: const Text('Clear time'),
                onPressed: () => setState(() => _time = null),
                backgroundColor: Colors.transparent,
                side: BorderSide(color: l.c.edge),
              ),
          ],
        ),
        const SizedBox(height: 10),
        Text('Category', style: OrvText.label(l)),
        const SizedBox(height: 4),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            for (final c in cats.where((c) => c.kind == (_credit ? 'income' : 'expense') || c.kind == 'transfer'))
              chip(c.name, _categoryId == c.id, () => _categoryId = _categoryId == c.id ? null : c.id),
          ],
        ),
        if (accounts.isNotEmpty) ...[
          const SizedBox(height: 10),
          Text('Account', style: OrvText.label(l)),
          const SizedBox(height: 4),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final a in accounts.where((a) => a.data['archived'] != true))
                chip(
                  '${a.name}${a.last4 == null ? '' : ' ··${a.last4}'}',
                  _accountId == a.id,
                  () => _accountId = _accountId == a.id ? null : a.id,
                ),
            ],
          ),
        ],
        const SizedBox(height: 8),
        OrvField(label: 'Note', controller: _note),
        const SizedBox(height: 4),
        OrvSwitchRow(
          label: 'Repeats',
          subtitle: 'Rent, a subscription, your salary…',
          value: repeats,
          onChanged: (v) => setState(() {
            _rrule = v ? 'FREQ=MONTHLY;BYMONTHDAY=${int.parse(_date.substring(8, 10))}' : '';
          }),
        ),
        if (repeats) ...[
          RepeatEditor(value: _rrule, startDate: _date, allowNone: false, onChanged: (r) => setState(() => _rrule = r)),
          const SizedBox(height: 8),
          Wrap(
            spacing: 6,
            children: [
              chip('Add it for me', _mode == 'add', () => _mode = 'add'),
              chip('Just remind me', _mode == 'remind', () => _mode = 'remind'),
            ],
          ),
          Text(
            _mode == 'add'
                ? 'Each time it’s due it appears under “New”, so you can fix the amount if it changed.'
                : 'You get a reminder on the day and add the real amount yourself.',
            style: OrvText.muted(l).copyWith(fontSize: 12),
          ),
        ],
        if (_problem != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(_problem!, style: OrvText.muted(l).copyWith(color: l.c.danger)),
          ),
      ],
    );
  }
}

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
