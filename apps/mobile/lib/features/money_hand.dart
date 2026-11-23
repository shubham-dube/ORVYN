import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../app/state.dart';
import '../app/today.dart' show todayActionsProvider;
import '../design/controls.dart';
import '../design/glass.dart';
import '../design/theme.dart';
import '../design/toast.dart';
import '../money/hand.dart';
import '../money/money.dart';
import 'money_manage.dart' show toMinor;
import 'money_ui.dart';
import 'payment_sheet.dart' show accountIcon;
import 'sheets.dart';
import 'today_kit.dart';

/// What's in my hand and who owes whom (spec 0014).

String _rupees(int minor) => minor % 100 == 0 ? '${minor ~/ 100}' : (minor / 100).toStringAsFixed(2);
String _iso(DateTime d) => d.toUtc().toIso8601String();
String _day(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

// ------------------------------------------------------------------ in your hand

class HandCard extends ConsumerStatefulWidget {
  const HandCard({super.key});
  @override
  ConsumerState<HandCard> createState() => _HandCardState();
}

class _HandCardState extends ConsumerState<HandCard> {
  bool _open = false;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final h = ref.watch(handProvider);
    final accounts = ref.watch(accountsProvider).value ?? const <AccountItem>[];
    if (!h.anyKnown) {
      return Glass(
        padding: const EdgeInsets.all(14),
        child: Row(
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(color: l.accent.withValues(alpha: 0.14), shape: BoxShape.circle),
              child: Icon(LucideIcons.wallet, size: 19, color: l.accent),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('What’s really in your hand?', style: OrvText.body(l).copyWith(fontWeight: FontWeight.w700)),
                  Text(
                    'Tell ORVYN your balances and card dues once; payments keep them current.',
                    style: OrvText.muted(l).copyWith(fontSize: 12),
                  ),
                ],
              ),
            ),
            OrvButton(
              key: const Key('hand-setup'),
              label: accounts.isEmpty ? 'Start' : 'Set',
              small: true,
              variant: ButtonVariant.primary,
              onPressed: () => showGlassSheet<void>(context, (_) => const BalancesSheet()),
            ),
          ],
        ),
      );
    }
    final neg = h.inHandMinor < 0;
    Widget line(IconData i, String label, int minor, {bool minus = false, Color? tone, String? note}) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        children: [
          Icon(i, size: 15, color: tone ?? l.c.muted),
          const SizedBox(width: 10),
          Expanded(
            child: Text.rich(
              TextSpan(
                children: [
                  TextSpan(text: label),
                  if (note != null)
                    TextSpan(
                      text: '  $note',
                      style: TextStyle(color: l.c.faint, fontSize: 11.5),
                    ),
                ],
              ),
              style: OrvText.body(l).copyWith(fontSize: 14),
            ),
          ),
          Text(
            '${minus ? '−' : '+'}${formatMoney(minor)}',
            style: OrvText.body(l).copyWith(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: tone,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
        ],
      ),
    );
    return Glass(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Icon(LucideIcons.wallet, size: 15, color: l.accent),
              const SizedBox(width: 6),
              Expanded(child: Text('IN YOUR HAND', style: OrvText.label(l))),
              GestureDetector(
                onTap: () => showGlassSheet<void>(context, (_) => const BalancesSheet()),
                child: Text(
                  'Balances',
                  style: OrvText.muted(l).copyWith(color: l.accent, fontWeight: FontWeight.w700, fontSize: 12.5),
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          GestureDetector(
            onTap: () => setState(() => _open = !_open),
            behavior: HitTestBehavior.opaque,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Semantics(
                  label: 'In your hand: ${formatMoney(h.inHandMinor)}',
                  excludeSemantics: true,
                  child: Text(
                    '${neg ? '−' : ''}${formatMoney(h.inHandMinor.abs())}',
                    style: OrvText.display(l).copyWith(fontSize: 36, color: neg ? l.c.danger : l.c.text),
                  ),
                ),
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        h.owedToMeSureMinor > 0
                            ? '${h.inHandTodayMinor < 0 ? '−' : ''}${formatMoney(h.inHandTodayMinor.abs())} without what’s still to come'
                            : (neg ? 'You owe more than you have right now' : 'Yours, after every due'),
                        style: OrvText.muted(l).copyWith(fontSize: 12.5),
                      ),
                    ),
                    Icon(_open ? LucideIcons.chevronUp : LucideIcons.chevronDown, size: 16, color: l.c.muted),
                  ],
                ),
              ],
            ),
          ),
          AnimatedSize(
            duration: OrvTokens.durationBase,
            curve: springSmooth,
            alignment: Alignment.topCenter,
            child: !_open
                ? const SizedBox(width: double.infinity)
                : Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Column(
                      children: [
                        line(LucideIcons.landmark, 'In your accounts', h.cashMinor, tone: l.c.success),
                        if (h.duesMinor > 0)
                          line(LucideIcons.creditCard, 'Card & loan dues', h.duesMinor, minus: true, tone: l.c.danger),
                        if (h.iOweMinor > 0)
                          line(LucideIcons.handCoins, 'You owe people', h.iOweMinor, minus: true, tone: l.c.danger),
                        if (h.owedToMeSureMinor > 0)
                          line(LucideIcons.undo2, 'Will surely come back', h.owedToMeSureMinor, tone: l.c.success),
                        if (h.owedToMeMaybeMinor > 0)
                          line(LucideIcons.circleHelp, 'Might come back', h.owedToMeMaybeMinor, note: 'not counted'),
                        if (h.cardAvailableMinor > 0)
                          line(LucideIcons.creditCard, 'Card credit left', h.cardAvailableMinor, note: 'not yours'),
                        if (h.unknown.isNotEmpty)
                          Padding(
                            padding: const EdgeInsets.only(top: 6),
                            child: Text(
                              'No balance yet: ${h.unknown.map((a) => a.name).join(', ')}',
                              style: OrvText.muted(l).copyWith(fontSize: 12, color: l.c.warning),
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

/// Every account with what's in it (or owed on it) now; tap one to say what it really is. Add accounts here.
class BalancesSheet extends ConsumerWidget {
  const BalancesSheet({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final h = ref.watch(handProvider);
    final loc = MaterialLocalizations.of(context);
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SheetHead(
          title: 'Balances',
          subtitle: 'Check them against your bank app now and then; payments move them in between.',
          trailing: IconButton(
            tooltip: 'Add an account',
            icon: Icon(LucideIcons.plus, color: l.accent),
            onPressed: () => showGlassSheet<void>(context, (_) => const AccountSheet()),
          ),
        ),
        Flexible(
          child: ListView(
            shrinkWrap: true,
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
            children: [
              if (h.accounts.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  child: Text('Add your bank accounts, cards, cash and loans with +.', style: OrvText.muted(l)),
                ),
              for (final kind in const [false, true]) ...[
                if (h.accounts.any((a) => a.account.owed == kind))
                  Padding(
                    padding: const EdgeInsets.fromLTRB(2, 10, 2, 6),
                    child: Text(kind ? 'WHAT YOU OWE ON' : 'WHAT YOU HAVE', style: OrvText.label(l)),
                  ),
                if (h.accounts.any((a) => a.account.owed == kind))
                  SheetCard(
                    children: [
                      for (final (i, a) in h.accounts.where((a) => a.account.owed == kind).indexed) ...[
                        if (i > 0) const SheetRule(),
                        InkWell(
                          onTap: () => showGlassSheet<void>(context, (_) => AccountSheet(account: a.account, now: a)),
                          child: Padding(
                            padding: const EdgeInsets.symmetric(vertical: 10),
                            child: Row(
                              children: [
                                Icon(accountIcon(a.account.kind), size: 18, color: l.c.muted),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        '${a.account.name}${a.account.last4 == null ? '' : ' ··${a.account.last4}'}',
                                        style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600, fontSize: 14.5),
                                      ),
                                      Text(
                                        a.nowMinor == null
                                            ? 'Tap to set'
                                            : [
                                                if (a.account.balanceAt != null)
                                                  'Checked ${loc.formatShortMonthDay(a.account.balanceAt!.toLocal())}',
                                                if (a.movedMinor != 0)
                                                  '${a.movedMinor > 0 ? '+' : '−'}${formatMoney(a.movedMinor.abs())} since',
                                                if (a.availableMinor != null) '${formatMoney(a.availableMinor!)} left',
                                              ].join(' · '),
                                        style: OrvText.muted(l).copyWith(fontSize: 12),
                                      ),
                                    ],
                                  ),
                                ),
                                Text(
                                  a.nowMinor == null ? '—' : formatMoney(a.nowMinor!),
                                  style: OrvText.body(l).copyWith(
                                    fontWeight: FontWeight.w700,
                                    color: a.nowMinor == null ? l.c.faint : (kind ? l.c.danger : l.c.text),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

/// One account: its name and kind, and what it really holds (or owes) right now; a card's limit.
class AccountSheet extends ConsumerStatefulWidget {
  const AccountSheet({super.key, this.account, this.now});
  final AccountItem? account;
  final AccountNow? now;
  @override
  ConsumerState<AccountSheet> createState() => _AccountSheetState();
}

class _AccountSheetState extends ConsumerState<AccountSheet> {
  late final _name = TextEditingController(text: widget.account?.name ?? '');
  late final _balance = TextEditingController(text: widget.now?.nowMinor == null ? '' : _rupees(widget.now!.nowMinor!));
  late final _limit = TextEditingController(
    text: widget.account?.creditLimitMinor == null ? '' : _rupees(widget.account!.creditLimitMinor!),
  );
  late String _kind = widget.account?.kind ?? 'bank';

  @override
  void dispose() {
    _name.dispose();
    _balance.dispose();
    _limit.dispose();
    super.dispose();
  }

  bool get _owed => _kind == 'card' || _kind == 'loan';

  Future<void> _save() async {
    final name = _name.text.trim();
    if (name.isEmpty) return;
    final bal = toMinor(_balance.text) ?? (_balance.text.trim() == '0' ? 0 : null);
    final changed = widget.now?.nowMinor != bal;
    await ref.read(moneyActionsProvider).saveAccount(widget.account?.id, {
      'name': name,
      'kind': _kind,
      if (bal != null && changed) 'balanceMinor': bal,
      if (bal != null && changed) 'balanceAt': _iso(ref.read(clockProvider)()),
      'creditLimitMinor': _kind == 'card' ? toMinor(_limit.text) : null,
    });
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SheetHead(title: widget.account == null ? 'New account' : widget.account!.name),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              SizedBox(
                height: 40,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  children: [
                    for (final (k, name) in const [
                      ('bank', 'Bank'),
                      ('card', 'Credit card'),
                      ('cash', 'Cash'),
                      ('wallet', 'Wallet'),
                      ('upi', 'UPI'),
                      ('loan', 'Loan'),
                    ])
                      Padding(
                        padding: const EdgeInsets.only(right: 6),
                        child: FactPill(
                          icon: accountIcon(k),
                          label: name,
                          set: _kind == k,
                          onTap: () => setState(() => _kind = k),
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              SheetCard(
                children: [
                  InlineField(
                    controller: _name,
                    fieldKey: const Key('account-name'),
                    hint: _owed ? 'Name — “ICICI Amazon card”' : 'Name — “HDFC savings”',
                    icon: LucideIcons.tag,
                    bold: true,
                  ),
                ],
              ),
              const SizedBox(height: 14),
              Text(
                _owed ? 'Owed on it right now' : 'In it right now',
                textAlign: TextAlign.center,
                style: OrvText.muted(l).copyWith(fontWeight: FontWeight.w600),
              ),
              AmountHero(controller: _balance, tone: _owed ? l.c.danger : l.c.text),
              if (_kind == 'card') ...[
                const SizedBox(height: 8),
                SheetCard(
                  children: [InlineField(controller: _limit, hint: 'Credit limit (optional)', icon: LucideIcons.gauge)],
                ),
              ],
              const SizedBox(height: 8),
              Text(
                'From now on, payments on this account move it. Check it against your bank app now and then.',
                textAlign: TextAlign.center,
                style: OrvText.muted(l).copyWith(fontSize: 12),
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
          child: OrvButton(
            key: const Key('account-save'),
            label: 'Save',
            variant: ButtonVariant.primary,
            expand: true,
            onPressed: _save,
          ),
        ),
      ],
    );
  }
}

// ------------------------------------------------------------------ who owes whom

class PeopleCard extends ConsumerWidget {
  const PeopleCard({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final ious = ref.watch(iousProvider).value ?? const <IouItem>[];
    final people = peopleBalances(ious);
    final now = ref.watch(clockProvider)();
    final toMe = people.where((p) => p.netMinor > 0).fold<int>(0, (a, p) => a + p.netMinor);
    final iOwe = people.where((p) => p.netMinor < 0).fold<int>(0, (a, p) => a - p.netMinor);
    return Glass(
      padding: const EdgeInsets.fromLTRB(16, 14, 10, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Icon(LucideIcons.handCoins, size: 15, color: l.accent),
              const SizedBox(width: 6),
              Expanded(child: Text('WHO OWES WHOM', style: OrvText.label(l))),
              IconButton(
                key: const Key('iou-add'),
                tooltip: 'Add who owes whom',
                visualDensity: VisualDensity.compact,
                icon: Icon(LucideIcons.plus, size: 19, color: l.accent),
                onPressed: () => showGlassSheet<void>(context, (_) => const DebtSheet()),
              ),
            ],
          ),
          if (people.isEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(0, 2, 6, 8),
              child: Text(
                'Lent someone money, or holding theirs? Keep it here — with a reminder in Today when it’s due.',
                style: OrvText.muted(l).copyWith(fontSize: 12.5),
              ),
            )
          else ...[
            Row(
              children: [
                if (toMe > 0) ...[
                  Text(formatMoney(toMe), style: OrvText.heading(l).copyWith(color: l.c.success, fontSize: 18)),
                  Text(' owed to you', style: OrvText.muted(l).copyWith(fontSize: 12.5)),
                  const SizedBox(width: 14),
                ],
                if (iOwe > 0) ...[
                  Text(formatMoney(iOwe), style: OrvText.heading(l).copyWith(color: l.c.danger, fontSize: 18)),
                  Text(' you owe', style: OrvText.muted(l).copyWith(fontSize: 12.5)),
                ],
              ],
            ),
            const SizedBox(height: 4),
            for (final p in people.take(5))
              InkWell(
                borderRadius: BorderRadius.circular(OrvTokens.radiusSm),
                onTap: () => showGlassSheet<void>(context, (_) => PersonSheet(person: p.person)),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 7),
                  child: Row(
                    children: [
                      OrvAvatar(name: p.person, size: 30),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              p.person,
                              style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600, fontSize: 14.5),
                            ),
                            Text(
                              [
                                p.netMinor > 0 ? 'owes you' : 'you owe',
                                if (p.nextDue != null) 'due ${_dueWords(p.nextDue!, now)}',
                              ].join(' · '),
                              style: OrvText.muted(l).copyWith(
                                fontSize: 12,
                                color: p.nextDue != null && p.nextDue!.compareTo(_day(now)) < 0 ? l.c.danger : null,
                              ),
                            ),
                          ],
                        ),
                      ),
                      Text(
                        formatMoney(p.netMinor.abs()),
                        style: OrvText.body(l)
                            .copyWith(fontWeight: FontWeight.w700, color: p.netMinor > 0 ? l.c.success : l.c.danger),
                      ),
                      const SizedBox(width: 6),
                    ],
                  ),
                ),
              ),
          ],
        ],
      ),
    );
  }
}

String _dueWords(String day, DateTime now) {
  final d = DateTime.parse(day);
  final n = DateTime(d.year, d.month, d.day).difference(DateTime(now.year, now.month, now.day)).inDays;
  if (n == 0) return 'today';
  if (n == 1) return 'tomorrow';
  if (n < 0) return '${-n}d ago';
  if (n < 7) return 'in ${n}d';
  return '${d.day}/${d.month}';
}

/// A new debt: who, which way, how much, by when — a reminder in Today, and the money moving now if it did.
class DebtSheet extends ConsumerStatefulWidget {
  const DebtSheet({super.key, this.person, this.owedToMe = true});
  final String? person;
  final bool owedToMe;
  @override
  ConsumerState<DebtSheet> createState() => _DebtSheetState();
}

class _DebtSheetState extends ConsumerState<DebtSheet> {
  late bool _owedToMe = widget.owedToMe;
  final _amount = TextEditingController();
  late final _person = TextEditingController(text: widget.person ?? '');
  final _note = TextEditingController();
  String? _due;
  bool _sure = true;
  bool _remind = true;
  String? _accountId;
  bool _busy = false;
  String? _problem;

  @override
  void initState() {
    super.initState();
    _amount.addListener(() => setState(() {}));
    _person.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _amount.dispose();
    _person.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final minor = toMinor(_amount.text);
    final who = _person.text.trim();
    if (minor == null || who.isEmpty) return setState(() => _problem = 'Who, and how much?');
    setState(() => _busy = true);
    final now = ref.read(clockProvider)();
    final money = ref.read(moneyActionsProvider);
    String? taskId;
    if (_due != null && _remind) {
      taskId = await ref.read(todayActionsProvider).addParsed({
        'title': _owedToMe ? 'Collect ${formatMoney(minor)} from $who' : 'Pay ${formatMoney(minor)} back to $who',
        'dueDate': _due,
        'notes': _note.text.trim(),
        'tags': ['money'],
        'priority': 2,
      }, source: 'money');
    }
    final id = await money.saveIou(null, {
      'person': who,
      'direction': _owedToMe ? 'owed_to_me' : 'i_owe',
      'amountMinor': minor,
      'note': _note.text.trim(),
      'dueDate': _due,
      'sure': _sure,
      'taskId': taskId,
      'startedAt': _iso(now),
    });
    // the money moved now too: lent from an account, or borrowed into one (not spending, not income)
    if (_accountId != null) {
      await money.add({
        'amountMinor': minor,
        'direction': _owedToMe ? 'debit' : 'credit',
        'title': _owedToMe ? 'Lent to $who' : 'Borrowed from $who',
        'merchant': who,
        'accountId': _accountId,
        'counted': false,
        'iouId': id,
        'occurredAt': _iso(now),
        'reviewed': true,
      });
    }
    if (!mounted) return;
    Toaster.of(context).show(
      _owedToMe ? '$who owes you ${formatMoney(minor)}' : 'You owe $who ${formatMoney(minor)}',
      body: taskId == null ? null : 'A reminder is in Today',
      tone: ToastTone.success,
    );
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final now = ref.watch(clockProvider)();
    final loc = MaterialLocalizations.of(context);
    final known = {for (final d in ref.watch(iousProvider).value ?? const <IouItem>[]) d.person.trim()}
        .where(
          (p) =>
              p.isNotEmpty && p.toLowerCase().contains(_person.text.trim().toLowerCase()) && p != _person.text.trim(),
        )
        .take(6);
    final accounts = (ref.watch(accountsProvider).value ?? const <AccountItem>[]).where((a) => !a.archived).toList();
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SheetHead(title: 'Who owes whom'),
        Flexible(
          child: ListView(
            shrinkWrap: true,
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
            children: [
              Segment<bool>(
                value: _owedToMe,
                onChanged: (v) => setState(() => _owedToMe = v),
                options: [
                  (true, 'They owe me', LucideIcons.arrowDownLeft, l.c.success),
                  (false, 'I owe them', LucideIcons.arrowUpRight, l.c.danger),
                ],
              ),
              const SizedBox(height: 8),
              AmountHero(controller: _amount, tone: _owedToMe ? l.c.success : l.c.danger, autofocus: true),
              const SizedBox(height: 8),
              SheetCard(
                children: [
                  InlineField(
                    controller: _person,
                    fieldKey: const Key('iou-person'),
                    hint: 'Who — “Rahul”',
                    icon: LucideIcons.user,
                    bold: true,
                  ),
                  const SheetRule(),
                  InlineField(controller: _note, hint: 'For what — “cash for his rent”', icon: LucideIcons.pencilLine),
                ],
              ),
              if (known.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Wrap(
                    spacing: 6,
                    children: [
                      for (final p in known)
                        FactPill(icon: LucideIcons.user, label: p, set: false, onTap: () => _person.text = p),
                    ],
                  ),
                ),
              const SizedBox(height: 10),
              SheetCard(
                children: [
                  SheetRow(
                    icon: LucideIcons.calendarClock,
                    label: _owedToMe ? 'Back by' : 'Pay back by',
                    value: _due == null ? 'No date' : loc.formatMediumDate(DateTime.parse(_due!)),
                    onTap: () async {
                      final d = await showDatePicker(
                        context: context,
                        initialDate: now.add(const Duration(days: 7)),
                        firstDate: now.subtract(const Duration(days: 365)),
                        lastDate: now.add(const Duration(days: 365 * 3)),
                      );
                      if (d != null) setState(() => _due = _day(d));
                    },
                  ),
                  if (_due != null) ...[
                    const SheetRule(),
                    SheetRow(
                      icon: LucideIcons.bellRing,
                      label: 'Remind me in Today',
                      trailing: Switch(
                        value: _remind,
                        onChanged: (v) => setState(() => _remind = v),
                        activeTrackColor: l.accent,
                        inactiveTrackColor: l.c.track,
                      ),
                    ),
                  ],
                  if (_owedToMe) ...[
                    const SheetRule(),
                    SheetRow(
                      icon: LucideIcons.shieldCheck,
                      label: 'Sure to come back',
                      trailing: Switch(
                        value: _sure,
                        onChanged: (v) => setState(() => _sure = v),
                        activeTrackColor: l.accent,
                        inactiveTrackColor: l.c.track,
                      ),
                    ),
                  ],
                  if (accounts.isNotEmpty) ...[
                    const SheetRule(),
                    SheetRow(
                      icon: LucideIcons.landmark,
                      label: _owedToMe ? 'Money left from' : 'Money came into',
                      value: accounts.where((a) => a.id == _accountId).firstOrNull?.name ?? 'Not now',
                      onTap: () async {
                        final v = await pickOne<String>(context, _owedToMe ? 'Paid out from' : 'Came into', [
                          for (final a in accounts)
                            PickOption(a.id, a.name, icon: accountIcon(a.kind), selected: a.id == _accountId),
                          PickOption(
                            '',
                            'It didn’t move now',
                            icon: LucideIcons.circleSlash,
                            selected: _accountId == null,
                          ),
                        ]);
                        if (v != null) setState(() => _accountId = v.isEmpty ? null : v);
                      },
                    ),
                  ],
                ],
              ),
              if (!_sure && _owedToMe)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Text(
                    'Shown, but not counted in what’s in your hand.',
                    style: OrvText.muted(l).copyWith(fontSize: 12),
                  ),
                ),
              if (_problem != null)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(_problem!, style: OrvText.muted(l).copyWith(color: l.c.danger)),
                ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
          child: OrvButton(
            key: const Key('iou-save'),
            label: 'Save',
            variant: ButtonVariant.primary,
            expand: true,
            loading: _busy,
            onPressed: _save,
          ),
        ),
      ],
    );
  }
}

/// Everything with one person: what's open and what's done; record a payment, settle, or add another.
class PersonSheet extends ConsumerWidget {
  const PersonSheet({super.key, required this.person});
  final String person;

  Future<void> _record(BuildContext context, WidgetRef ref, IouItem d) async {
    final c = TextEditingController(text: _rupees(d.leftMinor));
    final minor = await showGlassSheet<int>(
      context,
      (ctx) => Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SheetHead(
            title: d.owedToMe ? '${d.person} paid you' : 'You paid ${d.person}',
            subtitle: '${formatMoney(d.leftMinor)} left of ${formatMoney(d.amountMinor)}',
          ),
          AmountHero(controller: c, tone: d.owedToMe ? ctx.orv.c.success : ctx.orv.c.danger, autofocus: true),
          Padding(
            padding: const EdgeInsets.all(16),
            child: OrvButton(
              label: 'Record',
              variant: ButtonVariant.primary,
              expand: true,
              onPressed: () => Navigator.of(ctx).pop(toMinor(c.text)),
            ),
          ),
        ],
      ),
    );
    if (minor == null) return;
    final now = ref.read(clockProvider)();
    final money = ref.read(moneyActionsProvider);
    final paid = (d.paidMinor + minor).clamp(0, d.amountMinor);
    await money.add({
      'amountMinor': minor,
      'direction': d.owedToMe ? 'credit' : 'debit',
      'title': d.owedToMe ? '${d.person} paid back' : 'Paid back ${d.person}',
      'merchant': d.person,
      'counted': false,
      'iouId': d.id,
      'occurredAt': _iso(now),
      'reviewed': true,
    });
    await money.saveIou(d.id, {'paidMinor': paid, if (paid >= d.amountMinor) 'settledAt': _iso(now)});
    if (paid >= d.amountMinor && d.taskId != null) {
      await ref.read(todayActionsProvider).complete(d.taskId!, true);
    }
    if (context.mounted) {
      unawaited(HapticFeedback.mediumImpact());
      Toaster.of(context).show(
        paid >= d.amountMinor ? 'All settled with ${d.person}' : '${formatMoney(d.amountMinor - paid)} left',
        tone: ToastTone.success,
      );
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final loc = MaterialLocalizations.of(context);
    final all = (ref.watch(iousProvider).value ?? const <IouItem>[])
        .where((d) => d.person.trim().toLowerCase() == person.trim().toLowerCase())
        .toList();
    final open = all.where((d) => d.open).toList();
    final done = all.where((d) => !d.open).toList();
    final net = open.fold<int>(0, (a, d) => a + (d.owedToMe ? d.leftMinor : -d.leftMinor));
    Widget debt(IouItem d) {
      final progress = d.amountMinor == 0 ? 0.0 : d.paidMinor / d.amountMinor;
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Icon(
                  d.owedToMe ? LucideIcons.arrowDownLeft : LucideIcons.arrowUpRight,
                  size: 16,
                  color: d.owedToMe ? l.c.success : l.c.danger,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        d.note.isEmpty ? (d.owedToMe ? 'Owes you' : 'You owe') : d.note,
                        style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600, fontSize: 14),
                      ),
                      Text(
                        [
                          loc.formatMediumDate(d.startedAt),
                          if (d.dueDate != null) 'due ${loc.formatShortMonthDay(DateTime.parse(d.dueDate!))}',
                          if (!d.sure && d.owedToMe) 'not sure',
                          if (!d.open) 'settled',
                        ].join(' · '),
                        style: OrvText.muted(l).copyWith(fontSize: 12),
                      ),
                    ],
                  ),
                ),
                Text(
                  d.open ? formatMoney(d.leftMinor) : formatMoney(d.amountMinor),
                  style: OrvText.body(l).copyWith(
                    fontWeight: FontWeight.w700,
                    decoration: d.open ? null : TextDecoration.lineThrough,
                    color: d.open ? (d.owedToMe ? l.c.success : l.c.danger) : l.c.faint,
                  ),
                ),
              ],
            ),
            if (d.open && d.paidMinor > 0) ...[
              const SizedBox(height: 6),
              ClipRRect(
                borderRadius: BorderRadius.circular(3),
                child: LinearProgressIndicator(
                  value: progress,
                  minHeight: 4,
                  color: l.c.success,
                  backgroundColor: l.c.track,
                ),
              ),
              Text(
                '${formatMoney(d.paidMinor)} of ${formatMoney(d.amountMinor)} back',
                style: OrvText.muted(l).copyWith(fontSize: 11),
              ),
            ],
            if (d.open)
              Row(
                children: [
                  TextButton.icon(
                    icon: const Icon(LucideIcons.check, size: 15),
                    label: Text(d.owedToMe ? 'They paid' : 'I paid'),
                    onPressed: () => _record(context, ref, d),
                  ),
                  TextButton(
                    onPressed: () async {
                      final now = ref.read(clockProvider)();
                      await ref.read(moneyActionsProvider).saveIou(d.id, {'settledAt': _iso(now)});
                      if (d.taskId != null) await ref.read(todayActionsProvider).complete(d.taskId!, true);
                    },
                    child: const Text('Forget it'),
                  ),
                ],
              ),
          ],
        ),
      );
    }

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SheetHead(
          title: person,
          subtitle: net == 0
              ? 'All square'
              : (net > 0 ? 'Owes you ${formatMoney(net)}' : 'You owe ${formatMoney(-net)}'),
          trailing: IconButton(
            tooltip: 'Add another',
            icon: Icon(LucideIcons.plus, color: l.accent),
            onPressed: () => showGlassSheet<void>(context, (_) => DebtSheet(person: person, owedToMe: net >= 0)),
          ),
        ),
        Flexible(
          child: ListView(
            shrinkWrap: true,
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            children: [
              for (final d in open) debt(d),
              if (done.isNotEmpty) ...[
                const SizedBox(height: 8),
                Text('SETTLED', style: OrvText.label(l)),
                for (final d in done.take(10)) debt(d),
              ],
            ],
          ),
        ),
      ],
    );
  }
}
