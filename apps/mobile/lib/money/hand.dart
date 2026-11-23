import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'money.dart';

/// What's in my hand (spec 0014) — the same rules as `packages/money/src/hand.ts`, tested on the same case.
/// An account's balance is what you last told ORVYN; payments on it after that move it. Cards and loans hold what
/// you owe. Debts: owed to you counts when sure; what you owe always counts against you.

class AccountNow {
  AccountNow(this.account, this.nowMinor, this.movedMinor, this.availableMinor);
  final AccountItem account;

  /// in it (bank, cash …) or owed on it (card, loan); null = never told
  final int? nowMinor;
  final int movedMinor;
  final int? availableMinor;
}

class Hand {
  Hand({
    required this.accounts,
    required this.cashMinor,
    required this.duesMinor,
    required this.owedToMeSureMinor,
    required this.owedToMeMaybeMinor,
    required this.iOweMinor,
    required this.cardAvailableMinor,
  });
  final List<AccountNow> accounts;
  final int cashMinor;
  final int duesMinor;
  final int owedToMeSureMinor;
  final int owedToMeMaybeMinor;
  final int iOweMinor;
  final int cardAvailableMinor;

  /// yours now: cash − dues − what you owe + what will surely come
  int get inHandMinor => cashMinor - duesMinor - iOweMinor + owedToMeSureMinor;

  /// the hard floor: without what is still to come
  int get inHandTodayMinor => cashMinor - duesMinor - iOweMinor;
  List<AccountItem> get unknown => [
    for (final a in accounts)
      if (a.nowMinor == null) a.account,
  ];
  bool get anyKnown => accounts.any((a) => a.nowMinor != null);
}

List<AccountNow> accountsNow(List<AccountItem> accounts, List<TxItem> txs) => [
  for (final a in accounts.where((a) => !a.archived))
    () {
      final base = a.balanceMinor;
      if (base == null) return AccountNow(a, null, 0, null);
      final since = a.balanceAt ?? DateTime.fromMillisecondsSinceEpoch(0);
      var moved = 0;
      for (final t in txs) {
        if (!t.occurredAt.isAfter(since)) continue;
        if (t.accountId == a.id) moved += t.credit ? t.amountMinor : -t.amountMinor;
        if (t.toAccountId == a.id && !t.credit) moved += t.amountMinor;
      }
      final now = a.owed ? base - moved : base + moved;
      final limit = a.creditLimitMinor;
      return AccountNow(a, now, moved, a.kind == 'card' && limit != null ? (limit - now).clamp(0, limit) : null);
    }(),
];

Hand handOf(List<AccountItem> accounts, List<TxItem> txs, List<IouItem> ious) {
  final now = accountsNow(accounts, txs);
  var cash = 0, dues = 0, available = 0, sure = 0, maybe = 0, owe = 0;
  for (final a in now) {
    final v = a.nowMinor;
    if (v == null) continue;
    if (a.account.owed) {
      dues += v;
    } else {
      cash += v;
    }
    available += a.availableMinor ?? 0;
  }
  for (final d in ious.where((d) => d.open)) {
    if (!d.owedToMe) {
      owe += d.leftMinor;
    } else if (d.sure) {
      sure += d.leftMinor;
    } else {
      maybe += d.leftMinor;
    }
  }
  return Hand(
    accounts: now,
    cashMinor: cash,
    duesMinor: dues,
    owedToMeSureMinor: sure,
    owedToMeMaybeMinor: maybe,
    iOweMinor: owe,
    cardAvailableMinor: available,
  );
}

final handProvider = Provider<Hand>((ref) {
  final accounts = ref.watch(accountsProvider).value ?? const <AccountItem>[];
  final txs = ref.watch(transactionsProvider).value ?? const <TxItem>[];
  final ious = ref.watch(iousProvider).value ?? const <IouItem>[];
  return handOf(accounts, txs, ious);
});

/// Net per person across open debts: + they owe you, − you owe them. Biggest first.
class PersonBalance {
  PersonBalance(this.person);
  final String person;
  int netMinor = 0;
  final debts = <IouItem>[];
  String? nextDue;
}

List<PersonBalance> peopleBalances(List<IouItem> ious) {
  final by = <String, PersonBalance>{};
  for (final d in ious.where((d) => d.open)) {
    final p = by.putIfAbsent(d.person.trim().toLowerCase(), () => PersonBalance(d.person.trim()));
    p.netMinor += d.owedToMe ? d.leftMinor : -d.leftMinor;
    p.debts.add(d);
    final due = d.dueDate;
    if (due != null && (p.nextDue == null || due.compareTo(p.nextDue!) < 0)) p.nextDue = due;
  }
  return by.values.toList()..sort((a, b) => b.netMinor.abs().compareTo(a.netMinor.abs()));
}
