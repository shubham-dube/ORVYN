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
import '../money/brain.dart';
import '../money/money.dart';
import '../money/parse.dart' show cleanMerchant;
import '../money/spend_date.dart';
import 'money_manage.dart' show SmartFill, toMinor;
import 'money_ui.dart';
import 'repeat_editor.dart';
import 'sheets.dart';
import 'today_kit.dart';

/// Add or change a payment (spec 0014): the amount first, what it was for, who was paid, the category as icons,
/// then compact rows — when, account, between people, counted or not, a note, repeats. One sheet for add and edit.
Future<void> openPayment(BuildContext context, {TxItem? tx, RecurringItem? recurring, Map<String, dynamic>? seed}) =>
    showGlassSheet<void>(context, (_) => PaymentSheet(tx: tx, recurring: recurring, seed: seed));

/// How a payment is between you and someone else.
enum Between { none, theyOwe, repaidMe, iOwe, iRepaid }

class PaymentSheet extends ConsumerStatefulWidget {
  const PaymentSheet({super.key, this.tx, this.recurring, this.seed});
  final TxItem? tx;
  final RecurringItem? recurring;

  /// amount (rupees text), credit, merchant, title, categoryId, date, time, note, rrule
  final Map<String, dynamic>? seed;
  @override
  ConsumerState<PaymentSheet> createState() => _PaymentSheetState();
}

class _PaymentSheetState extends ConsumerState<PaymentSheet> {
  late final TextEditingController _amount;
  late final TextEditingController _title;
  late final TextEditingController _merchant;
  late final TextEditingController _note;
  final _person = TextEditingController();

  /// 'debit' | 'credit' | 'move'
  late String _kind;
  String? _categoryId;
  String? _accountId;
  String? _toAccountId;
  late String _date;
  String? _time;
  String _rrule = '';
  String _mode = 'add';
  late bool _counted;
  Between _between = Between.none;
  String? _settleIouId;
  bool _catTouched = false;
  bool _acctTouched = false;
  String? _why;
  String? _problem;
  bool _busy = false;
  bool _noteOpen = false;

  bool get _editing => widget.tx != null;

  @override
  void initState() {
    super.initState();
    final t = widget.tx;
    final r = widget.recurring;
    final s = widget.seed ?? const <String, dynamic>{};
    final now = ref.read(clockProvider)();
    String rupees(int minor) => minor % 100 == 0 ? '${minor ~/ 100}' : (minor / 100).toStringAsFixed(2);
    _amount = TextEditingController(
      text: t != null ? rupees(t.amountMinor) : (r != null ? rupees(r.amountMinor) : (s['amount'] as String? ?? '')),
    );
    _title = TextEditingController(text: t?.title ?? (r?.title ?? (s['title'] as String? ?? '')));
    _merchant = TextEditingController(text: t?.merchant ?? (r?.merchant ?? (s['merchant'] as String? ?? '')));
    _note = TextEditingController(text: t?.note ?? (r?.note ?? (s['note'] as String? ?? '')));
    _noteOpen = _note.text.isNotEmpty;
    _kind = t != null
        ? (t.transfer ? 'move' : (t.credit ? 'credit' : 'debit'))
        : ((r?.credit ?? (s['credit'] as bool? ?? false)) ? 'credit' : 'debit');
    _categoryId = t?.categoryId ?? r?.categoryId ?? s['categoryId'] as String?;
    _catTouched = _categoryId != null;
    _accountId = t?.accountId ?? r?.accountId;
    _acctTouched = _accountId != null;
    _toAccountId = t?.toAccountId;
    final at = t?.occurredAt;
    _date = at != null ? dayKeyOf(at) : (r?.startDate ?? (s['date'] as String? ?? dayKeyOf(now)));
    _time = at != null
        ? '${at.hour.toString().padLeft(2, '0')}:${at.minute.toString().padLeft(2, '0')}'
        : (r?.time ?? s['time'] as String?);
    _rrule = r?.rrule ?? (s['rrule'] as String? ?? '');
    _mode = r?.mode ?? 'add';
    _counted = t?.counted ?? true;
    _merchant.addListener(_onMerchant);
    _amount.addListener(() => setState(() {}));
    _title.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    for (final c in [_amount, _title, _merchant, _note, _person]) {
      c.dispose();
    }
    super.dispose();
  }

  static String dayKeyOf(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  void _onMerchant() {
    final p = ref.read(merchantProfilesProvider)[merchantKey(_merchant.text)];
    setState(() {
      if (!_catTouched) {
        if (p?.categoryId != null) {
          _categoryId = p!.categoryId;
          final times = (p.filed * p.categoryShare).round();
          _why = times <= 1 ? 'Like last time at ${p.merchant}' : 'Like your last $times at ${p.merchant}';
        } else {
          final guess = cleanMerchant(_merchant.text).category;
          final c = (ref.read(categoriesProvider).value ?? const <CategoryItem>[])
              .where((c) => guess != null && c.slug == guess)
              .firstOrNull;
          _categoryId = c?.id;
          _why = c == null ? null : 'Sounds like ${c.name}';
        }
      }
      if (!_acctTouched && p?.accountId != null) _accountId = p!.accountId;
    });
  }

  void _useProfile(MerchantProfile p, {bool amount = true}) {
    _merchant.removeListener(_onMerchant);
    _merchant.text = p.merchant;
    _merchant.addListener(_onMerchant);
    if (amount && toMinor(_amount.text) == null) {
      _amount.text = p.medianMinor % 100 == 0 ? '${p.medianMinor ~/ 100}' : (p.medianMinor / 100).toStringAsFixed(2);
    }
    if (_kind != 'move') _kind = p.credit ? 'credit' : 'debit';
    _onMerchant();
  }

  Color _tone(OrvLook l) => switch (_kind) {
    'credit' => l.c.success,
    'move' => l.accent,
    _ => l.c.text,
  };

  // ------------------------------------------------------------------ pickers

  Future<void> _pickWhen() async {
    final now = ref.read(clockProvider)();
    final today = dayKeyOf(now);
    final yesterday = dayKeyOf(now.subtract(const Duration(days: 1)));
    final repeats = _rrule.isNotEmpty;
    final v = await pickOne<String>(context, repeats ? 'Starts' : 'When', [
      PickOption(today, 'Today', icon: LucideIcons.sun, selected: _date == today),
      if (!repeats) PickOption(yesterday, 'Yesterday', icon: LucideIcons.history, selected: _date == yesterday),
      const PickOption('pick', 'Pick a day…', icon: LucideIcons.calendarSearch),
      PickOption('time', _time == null ? 'Add a time…' : 'Change the time ($_time)', icon: LucideIcons.clock),
      if (_time != null) const PickOption('notime', 'No time', icon: LucideIcons.circleSlash),
    ]);
    if (v == null || !mounted) return;
    if (v == 'pick') {
      final d = await showDatePicker(
        context: context,
        initialDate: DateTime.parse(_date),
        firstDate: DateTime(now.year - 5),
        lastDate: repeats ? DateTime(now.year + 5) : now,
      );
      if (d != null) setState(() => _date = dayKeyOf(d));
    } else if (v == 'time') {
      final parts = _time?.split(':').map(int.parse).toList();
      final t = await showTimePicker(
        context: context,
        initialTime: TimeOfDay(hour: parts?[0] ?? now.hour, minute: parts?[1] ?? now.minute),
      );
      if (t != null) {
        setState(() => _time = '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}');
      }
    } else if (v == 'notime') {
      setState(() => _time = null);
    } else {
      setState(() => _date = v);
    }
  }

  Future<void> _pickAccount({bool to = false}) async {
    final accounts = (ref.read(accountsProvider).value ?? const <AccountItem>[]).where((a) => !a.archived).toList();
    final cur = to ? _toAccountId : _accountId;
    final v = await pickOne<String>(context, to ? 'Moved to' : (_kind == 'credit' ? 'Into' : 'Paid from'), [
      for (final a in accounts)
        PickOption(
          a.id,
          '${a.name}${a.last4 == null ? '' : ' ··${a.last4}'}',
          icon: _accountIcon(a.kind),
          sub: a.owed ? 'Card / loan' : null,
          selected: a.id == cur,
        ),
      PickOption('', 'Not set', icon: LucideIcons.circleSlash, selected: cur == null),
    ]);
    if (v == null) return;
    setState(() {
      if (to) {
        _toAccountId = v.isEmpty ? null : v;
      } else {
        _acctTouched = true;
        _accountId = v.isEmpty ? null : v;
      }
    });
  }

  Future<void> _pickBetween() async {
    final credit = _kind == 'credit';
    final v = await pickOne<Between>(context, 'Between you and someone?', [
      PickOption(Between.none, 'No, it’s just mine', icon: LucideIcons.user, selected: _between == Between.none),
      if (!credit) ...[
        PickOption(
          Between.theyOwe,
          'I lent it / paid for someone',
          sub: 'They owe you; not counted as spending',
          icon: LucideIcons.handCoins,
          selected: _between == Between.theyOwe,
        ),
        PickOption(
          Between.iRepaid,
          'Paying back what I owed',
          sub: 'Settles a debt; not spending',
          icon: LucideIcons.undo2,
          selected: _between == Between.iRepaid,
        ),
      ] else ...[
        PickOption(
          Between.repaidMe,
          'Someone paid me back',
          sub: 'Settles what they owe; not income',
          icon: LucideIcons.undo2,
          selected: _between == Between.repaidMe,
        ),
        PickOption(
          Between.iOwe,
          'I borrowed it / holding it for someone',
          sub: 'You owe it; not income',
          icon: LucideIcons.handCoins,
          selected: _between == Between.iOwe,
        ),
      ],
    ]);
    if (v == null || !mounted) return;
    setState(() {
      _between = v;
      _settleIouId = null;
    });
    if (v == Between.repaidMe || v == Between.iRepaid) await _pickDebt(owedToMe: v == Between.repaidMe);
  }

  Future<void> _pickDebt({required bool owedToMe}) async {
    final open = (ref.read(iousProvider).value ?? const <IouItem>[]).where((d) => d.open && d.owedToMe == owedToMe);
    if (open.isEmpty) {
      Toaster.of(context).show(owedToMe ? 'Nobody owes you anything yet' : 'You don’t owe anyone yet');
      setState(() => _between = Between.none);
      return;
    }
    final v = await pickOne<String>(context, owedToMe ? 'Who paid you back?' : 'Who are you paying back?', [
      for (final d in open)
        PickOption(
          d.id,
          '${d.person} · ${formatMoney(d.leftMinor)} left',
          sub: d.note.isEmpty ? null : d.note,
          icon: LucideIcons.user,
          selected: d.id == _settleIouId,
        ),
    ]);
    if (v == null) return;
    final d = open.firstWhere((d) => d.id == v);
    setState(() {
      _settleIouId = v;
      if (toMinor(_amount.text) == null) {
        _amount.text = d.leftMinor % 100 == 0 ? '${d.leftMinor ~/ 100}' : (d.leftMinor / 100).toStringAsFixed(2);
      }
      if (_title.text.trim().isEmpty) _title.text = owedToMe ? '${d.person} paid back' : 'Paid back ${d.person}';
    });
  }

  // ------------------------------------------------------------------ save

  Future<void> _save() async {
    final now = ref.read(clockProvider)();
    final minor = toMinor(_amount.text);
    if (minor == null) return setState(() => _problem = 'Enter an amount above zero.');
    final repeats = _rrule.isNotEmpty;
    if (!repeats && _date.compareTo(dayKeyOf(now)) > 0) {
      return setState(() => _problem = 'That day hasn’t happened yet. Turn on “Repeats” to schedule it.');
    }
    if (_kind == 'move' && (_accountId == null || _toAccountId == null || _accountId == _toAccountId)) {
      return setState(() => _problem = 'Pick both accounts the money moved between.');
    }
    if ((_between == Between.theyOwe || _between == Between.iOwe) && _person.text.trim().isEmpty) {
      return setState(() => _problem = 'Who is it with?');
    }
    setState(() => _busy = true);
    final actions = ref.read(moneyActionsProvider);
    final toaster = Toaster.of(context);
    final nav = Navigator.of(context);
    unawaited(HapticFeedback.lightImpact());
    final credit = _kind == 'credit';
    final title = _title.text.trim();
    try {
      if (repeats) {
        final tz = (ref.read(todaySettingsProvider).value?['timeZone'] as String?) ?? 'Asia/Kolkata';
        final cats = ref.read(categoriesProvider).value ?? const <CategoryItem>[];
        await actions.saveRecurring(widget.recurring?.id, {
          'title': title.isNotEmpty
              ? title
              : (_merchant.text.trim().isNotEmpty
                    ? _merchant.text.trim()
                    : (cats.where((c) => c.id == _categoryId).firstOrNull?.name ?? 'Scheduled')),
          'amountMinor': minor,
          'direction': credit ? 'credit' : 'debit',
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
        String? iouId = widget.tx?.iouId;
        // between people: a new debt, or a payment towards one
        if (!_editing && (_between == Between.theyOwe || _between == Between.iOwe)) {
          iouId = await actions.saveIou(null, {
            'person': _person.text.trim(),
            'direction': _between == Between.theyOwe ? 'owed_to_me' : 'i_owe',
            'amountMinor': minor,
            'note': title,
            'startedAt': at.toUtc().toIso8601String(),
          });
        } else if (!_editing && _settleIouId != null) {
          final d = (ref.read(iousProvider).value ?? const <IouItem>[]).firstWhere((d) => d.id == _settleIouId);
          final paid = (d.paidMinor + minor).clamp(0, d.amountMinor);
          await actions.saveIou(d.id, {
            'paidMinor': paid,
            if (paid >= d.amountMinor) 'settledAt': now.toUtc().toIso8601String(),
          });
          iouId = d.id;
        }
        final between = _between != Between.none || (widget.tx?.iouId != null);
        final fields = <String, dynamic>{
          'amountMinor': minor,
          'direction': credit ? 'credit' : 'debit',
          'title': title,
          'merchant': _merchant.text.trim(),
          'categoryId': _kind == 'move' ? null : _categoryId,
          'accountId': _accountId,
          'toAccountId': _kind == 'move' ? _toAccountId : null,
          'transfer': _kind == 'move',
          'counted': _kind != 'move' && !between && _counted,
          'iouId': iouId,
          'note': _note.text,
          'occurredAt': at.toUtc().toIso8601String(),
          'reviewed': true,
        };
        if (_editing) {
          await actions.update(widget.tx!.id, fields);
          toaster.show('Saved', tone: ToastTone.success);
        } else {
          await actions.add(fields);
          toaster.show(
            '${_kind == 'move' ? 'Moved' : (credit ? 'Received' : 'Spent')} ${formatMoney(minor)}',
            body: title.isEmpty ? (_merchant.text.trim().isEmpty ? null : _merchant.text.trim()) : title,
            tone: ToastTone.success,
          );
        }
      }
      if (nav.mounted) nav.pop();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  // ------------------------------------------------------------------ build

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final now = ref.watch(clockProvider)();
    final loc = MaterialLocalizations.of(context);
    final accounts = (ref.watch(accountsProvider).value ?? const <AccountItem>[]).where((a) => !a.archived).toList();
    final cats = (ref.watch(categoriesProvider).value ?? const <CategoryItem>[])
        .where((c) => !c.archived && c.kind == (_kind == 'credit' ? 'income' : 'expense'))
        .toList();
    final ious = ref.watch(iousProvider).value ?? const <IouItem>[];
    final linked = ious.where((d) => d.id == (widget.tx?.iouId ?? _settleIouId)).firstOrNull;
    final repeats = _rrule.isNotEmpty;
    final today = dayKeyOf(now);
    final when = [
      _date == today
          ? 'Today'
          : (_date == dayKeyOf(now.subtract(const Duration(days: 1)))
                ? 'Yesterday'
                : loc.formatMediumDate(DateTime.parse(_date))),
      ?_time,
    ].join(', ');
    String acct(String? id) {
      final a = accounts.where((a) => a.id == id).firstOrNull;
      return a == null ? 'Not set' : '${a.name}${a.last4 == null ? '' : ' ··${a.last4}'}';
    }

    final betweenLabel = switch (_between) {
      Between.none => linked == null ? 'No' : '${linked.person} · ${linked.owedToMe ? 'owes you' : 'you owe'}',
      Between.theyOwe => 'They’ll owe you',
      Between.repaidMe => linked == null ? 'Paid back' : '${linked.person} paid back',
      Between.iOwe => 'You’ll owe it',
      Between.iRepaid => linked == null ? 'Paying back' : 'Paying back ${linked.person}',
    };
    final max = MediaQuery.sizeOf(context).height * 0.92 - MediaQuery.viewInsetsOf(context).bottom;

    return ConstrainedBox(
      constraints: BoxConstraints(maxHeight: max.clamp(320, double.infinity)),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SheetHead(
            title: _editing ? 'Payment' : (widget.recurring != null ? 'Scheduled' : 'New payment'),
            subtitle: _editing && widget.tx!.rawMerchant.isNotEmpty && widget.tx!.rawMerchant != widget.tx!.merchant
                ? 'The message said: ${widget.tx!.rawMerchant}'
                : null,
            trailing: _editing
                ? IconButton(
                    tooltip: 'Delete payment',
                    icon: Icon(LucideIcons.trash2, size: 19, color: l.c.danger),
                    onPressed: () async {
                      final ok = await showDialog<bool>(
                        context: context,
                        builder: (ctx) => AlertDialog(
                          title: const Text('Delete this payment?'),
                          actions: [
                            TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Keep')),
                            TextButton(onPressed: () => Navigator.of(ctx).pop(true), child: const Text('Delete')),
                          ],
                        ),
                      );
                      if (ok != true) return;
                      await ref.read(moneyActionsProvider).remove(widget.tx!.id);
                      if (context.mounted) Navigator.of(context).pop();
                    },
                  )
                : null,
          ),
          Flexible(
            child: ListView(
              shrinkWrap: true,
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
              children: [
                Segment<String>(
                  value: _kind,
                  onChanged: (v) => setState(() {
                    _kind = v;
                    _between = Between.none;
                    _settleIouId = null;
                    if (!_catTouched) _categoryId = null;
                  }),
                  options: [
                    ('debit', 'Spent', LucideIcons.arrowUpRight, l.c.danger),
                    ('credit', 'Got', LucideIcons.arrowDownLeft, l.c.success),
                    if (!repeats) ('move', 'Moved', LucideIcons.arrowLeftRight, l.accent),
                  ],
                ),
                const SizedBox(height: 10),
                AmountHero(controller: _amount, tone: _tone(l), autofocus: !_editing),
                const SizedBox(height: 10),
                SheetCard(
                  children: [
                    InlineField(
                      controller: _title,
                      fieldKey: const Key('money-title'),
                      hint: _kind == 'move' ? 'What for — “card bill”' : 'What for — “Dinner with Riya”',
                      icon: LucideIcons.pencilLine,
                      bold: true,
                      size: 16,
                    ),
                    if (_kind != 'move') ...[
                      const SheetRule(),
                      InlineField(
                        controller: _merchant,
                        fieldKey: const Key('money-merchant'),
                        hint: _kind == 'credit' ? 'From whom' : 'Paid to (shop, person, app)',
                        icon: LucideIcons.store,
                      ),
                    ],
                  ],
                ),
                if (_kind != 'move')
                  SmartFill(
                    merchant: _merchant.text,
                    amountMinor: toMinor(_amount.text),
                    why: _why,
                    onPick: _useProfile,
                    onAmount: (m) =>
                        setState(() => _amount.text = m % 100 == 0 ? '${m ~/ 100}' : (m / 100).toStringAsFixed(2)),
                  ),
                if (_kind != 'move' && _between == Between.none && (linked == null)) ...[
                  const SizedBox(height: 12),
                  CategoryPicker(
                    cats: cats,
                    value: _categoryId,
                    onChanged: (v) => setState(() {
                      _catTouched = true;
                      _why = null;
                      _categoryId = v;
                    }),
                  ),
                ],
                const SizedBox(height: 10),
                SheetCard(
                  children: [
                    SheetRow(
                      icon: LucideIcons.calendar,
                      label: repeats ? 'Starts' : 'When',
                      value: when,
                      onTap: _pickWhen,
                    ),
                    if (accounts.isNotEmpty) ...[
                      const SheetRule(),
                      SheetRow(
                        icon: LucideIcons.landmark,
                        label: _kind == 'move' ? 'From' : (_kind == 'credit' ? 'Into' : 'From'),
                        value: acct(_accountId),
                        onTap: () => _pickAccount(),
                      ),
                    ],
                    if (_kind == 'move') ...[
                      const SheetRule(),
                      SheetRow(
                        icon: LucideIcons.arrowRight,
                        label: 'To',
                        value: acct(_toAccountId),
                        onTap: () => _pickAccount(to: true),
                      ),
                    ],
                    if (_kind != 'move' && !repeats) ...[
                      const SheetRule(),
                      SheetRow(
                        icon: LucideIcons.users,
                        label: 'With someone',
                        value: betweenLabel,
                        tone: _between != Between.none || linked != null ? l.accent : null,
                        onTap: _editing ? null : _pickBetween,
                      ),
                      if (_between == Between.theyOwe || _between == Between.iOwe) ...[
                        const SheetRule(),
                        InlineField(
                          controller: _person,
                          fieldKey: const Key('money-person'),
                          hint: _between == Between.theyOwe ? 'Who owes you? (name)' : 'Whose money is it? (name)',
                          icon: LucideIcons.user,
                        ),
                      ],
                    ],
                    if (_kind != 'move' && _between == Between.none && linked == null) ...[
                      const SheetRule(),
                      SheetRow(
                        icon: LucideIcons.chartPie,
                        label: _kind == 'credit' ? 'Counts as income' : 'Counts as spending',
                        trailing: Switch(
                          value: _counted,
                          onChanged: (v) => setState(() => _counted = v),
                          activeTrackColor: l.accent,
                          inactiveTrackColor: l.c.track,
                        ),
                      ),
                    ],
                    const SheetRule(),
                    if (_noteOpen)
                      InlineField(
                        controller: _note,
                        hint: 'Details, a reference…',
                        icon: LucideIcons.stickyNote,
                        maxLines: 4,
                      )
                    else
                      SheetRow(
                        icon: LucideIcons.stickyNote,
                        label: 'Note',
                        value: '+ Add',
                        onTap: () => setState(() => _noteOpen = true),
                      ),
                    if (!_editing && _kind != 'move' && _between == Between.none) ...[
                      const SheetRule(),
                      SheetRow(
                        icon: LucideIcons.repeat,
                        label: 'Repeats',
                        trailing: Switch(
                          value: repeats,
                          onChanged: (v) => setState(
                            () => _rrule = v ? 'FREQ=MONTHLY;BYMONTHDAY=${int.parse(_date.substring(8, 10))}' : '',
                          ),
                          activeTrackColor: l.accent,
                          inactiveTrackColor: l.c.track,
                        ),
                      ),
                    ],
                  ],
                ),
                if (repeats) ...[
                  const SizedBox(height: 10),
                  RepeatEditor(
                    value: _rrule,
                    startDate: _date,
                    allowNone: false,
                    onChanged: (r) => setState(() => _rrule = r),
                  ),
                  const SizedBox(height: 8),
                  Segment<String>(
                    dense: true,
                    value: _mode,
                    onChanged: (v) => setState(() => _mode = v),
                    options: const [('add', 'Add it for me', null, null), ('remind', 'Just remind me', null, null)],
                  ),
                ],
                if (_problem != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 10),
                    child: Text(_problem!, style: OrvText.muted(l).copyWith(color: l.c.danger)),
                  ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
            child: OrvButton(
              key: const Key('money-save'),
              label: repeats
                  ? 'Save schedule'
                  : (_editing
                        ? 'Save'
                        : '${_kind == 'move' ? 'Move' : (_kind == 'credit' ? 'Add money in' : 'Add spending')}${toMinor(_amount.text) == null ? '' : ' · ${formatMoney(toMinor(_amount.text)!)}'}'),
              variant: ButtonVariant.primary,
              expand: true,
              loading: _busy,
              onPressed: _save,
            ),
          ),
        ],
      ),
    );
  }
}

IconData _accountIcon(String kind) => switch (kind) {
  'card' => LucideIcons.creditCard,
  'loan' => LucideIcons.landmark,
  'cash' => LucideIcons.banknote,
  'wallet' => LucideIcons.wallet,
  'upi' => LucideIcons.smartphone,
  _ => LucideIcons.building2,
};

IconData accountIcon(String kind) => _accountIcon(kind);
