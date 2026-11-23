import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app/state.dart';
import '../sync/sync_client.dart';
import 'parse.dart';
import 'spend_date.dart';

const moneyAccount = 'money.account';
const moneyCategory = 'money.category';
const moneyTransaction = 'money.transaction';
const moneyBudget = 'money.budget';
const moneyRecurring = 'money.recurring';
const moneyIou = 'money.iou';

class TxItem {
  TxItem(this.id, this.data);
  final String id;
  final Map<String, dynamic> data;
  int get amountMinor => (data['amountMinor'] as num?)?.toInt() ?? 0;
  String get currency => (data['currency'] as String?) ?? 'INR';
  bool get credit => data['direction'] == 'credit';
  DateTime get occurredAt => DateTime.parse(data['occurredAt'] as String).toLocal();
  String get merchant => (data['merchant'] as String?) ?? '';
  String get rawMerchant => (data['rawMerchant'] as String?) ?? '';
  String? get categoryId => data['categoryId'] as String?;
  String? get accountId => data['accountId'] as String?;
  String get note => (data['note'] as String?) ?? '';
  String get source => (data['source'] as String?) ?? 'manual';
  String? get dedupeKey => data['dedupeKey'] as String?;
  bool get transfer => data['transfer'] == true;
  bool get reviewed => data['reviewed'] != false;

  /// what it was, in your words ("Dinner with Riya"): shown first; the merchant is who was paid (spec 0014)
  String get title => (data['title'] as String?) ?? '';

  /// counted as spending/income; false for money that only moves (lending, being paid back, unconfirmed credits)
  bool get counted => data['counted'] != false;
  String? get toAccountId => data['toAccountId'] as String?;
  String? get iouId => data['iouId'] as String?;

  /// left out of spending and income: a transfer between your accounts, or not counted
  bool get ignored => transfer || !counted;

  /// the name a row shows: your title, else the merchant
  String get label => title.isNotEmpty ? title : merchant;

  Sighting get sighting => Sighting(
    id: id,
    amountMinor: amountMinor,
    direction: credit ? 'credit' : 'debit',
    occurredAt: occurredAt,
    dedupeKey: dedupeKey,
    source: source,
  );
}

class CategoryItem {
  CategoryItem(this.id, this.data);
  final String id;
  final Map<String, dynamic> data;
  String get name => (data['name'] as String?) ?? '';
  String get kind => (data['kind'] as String?) ?? 'expense';
  String get colour => (data['colour'] as String?) ?? 'slate';
  String? get slug => data['slug'] as String?;
  int get order => (data['order'] as num?)?.toInt() ?? 0;
  bool get archived => data['archived'] == true;
}

class AccountItem {
  AccountItem(this.id, this.data);
  final String id;
  final Map<String, dynamic> data;
  String get name => (data['name'] as String?) ?? '';
  String get kind => (data['kind'] as String?) ?? 'bank';
  String? get last4 => data['last4'] as String?;
  String? get institution => data['institution'] as String?;
  bool get archived => data['archived'] == true;

  /// cards and loans hold what you owe; the rest hold what you have
  bool get owed => kind == 'card' || kind == 'loan';
  int? get balanceMinor => (data['balanceMinor'] as num?)?.toInt();
  DateTime? get balanceAt => data['balanceAt'] == null ? null : DateTime.parse(data['balanceAt'] as String);
  int? get creditLimitMinor => (data['creditLimitMinor'] as num?)?.toInt();
}

/// Who owes whom (spec 0014): money owed to me, or that I owe (borrowed, or holding someone's money).
class IouItem {
  IouItem(this.id, this.data);
  final String id;
  final Map<String, dynamic> data;
  String get person => (data['person'] as String?) ?? '';
  bool get owedToMe => data['direction'] != 'i_owe';
  int get amountMinor => (data['amountMinor'] as num?)?.toInt() ?? 0;
  int get paidMinor => (data['paidMinor'] as num?)?.toInt() ?? 0;
  int get leftMinor => (amountMinor - paidMinor).clamp(0, amountMinor);
  String get note => (data['note'] as String?) ?? '';
  String? get dueDate => data['dueDate'] as String?;
  bool get sure => data['sure'] != false;
  DateTime? get settledAt => data['settledAt'] == null ? null : DateTime.parse(data['settledAt'] as String).toLocal();
  bool get open => settledAt == null;
  String? get taskId => data['taskId'] as String?;
  DateTime get startedAt =>
      data['startedAt'] == null ? DateTime(2000) : DateTime.parse(data['startedAt'] as String).toLocal();
}

class BudgetItem {
  BudgetItem(this.id, this.data);
  final String id;
  final Map<String, dynamic> data;
  String? get categoryId => data['categoryId'] as String?;
  int get amountMinor => (data['amountMinor'] as num?)?.toInt() ?? 0;
  String get from => (data['from'] as String?) ?? '0000-00';
  bool get archived => data['archived'] == true;
}

/// Money that comes on a schedule (rent, subscriptions, salary): the server adds each occurrence on its day, once.
class RecurringItem {
  RecurringItem(this.id, this.data);
  final String id;
  final Map<String, dynamic> data;
  String get title => (data['title'] as String?) ?? '';
  int get amountMinor => (data['amountMinor'] as num?)?.toInt() ?? 0;
  String get currency => (data['currency'] as String?) ?? 'INR';
  bool get credit => data['direction'] == 'credit';
  String get merchant => (data['merchant'] as String?) ?? '';
  String? get categoryId => data['categoryId'] as String?;
  String? get accountId => data['accountId'] as String?;
  String get note => (data['note'] as String?) ?? '';
  String get rrule => (data['rrule'] as String?) ?? 'FREQ=MONTHLY';
  String get startDate => (data['startDate'] as String?) ?? '2026-01-01';
  String get time => (data['time'] as String?) ?? '09:00';
  String get mode => (data['mode'] as String?) ?? 'add';
  bool get paused => data['paused'] == true;
}

Stream<List<T>> _watch<T>(Ref ref, String entity, T Function(String, Map<String, dynamic>) make) =>
    ref.watch(syncProvider).watch(entity).map((rows) => [for (final r in rows) make(r.id, r.data)]);

final transactionsProvider = StreamProvider<List<TxItem>>(
  (ref) =>
      _watch(ref, moneyTransaction, TxItem.new).map((l) => l..sort((a, b) => b.occurredAt.compareTo(a.occurredAt))),
);
final categoriesProvider = StreamProvider<List<CategoryItem>>(
  (ref) => _watch(ref, moneyCategory, CategoryItem.new).map((l) => l..sort((a, b) => a.order.compareTo(b.order))),
);
final accountsProvider = StreamProvider<List<AccountItem>>((ref) => _watch(ref, moneyAccount, AccountItem.new));
final budgetsProvider = StreamProvider<List<BudgetItem>>((ref) => _watch(ref, moneyBudget, BudgetItem.new));
final recurringProvider = StreamProvider<List<RecurringItem>>((ref) => _watch(ref, moneyRecurring, RecurringItem.new));
final iousProvider = StreamProvider<List<IouItem>>(
  (ref) => _watch(ref, moneyIou, IouItem.new).map((l) => l..sort((a, b) => b.startedAt.compareTo(a.startedAt))),
);

String monthKey(DateTime d) => '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}';

/// Same rules as `summarise` in packages/money: transfers left out, credits counted as came in.
({int spent, int earned, List<(String?, int)> byCategory}) summarise(List<TxItem> txs, String month) {
  var spent = 0, earned = 0;
  final by = <String?, int>{};
  for (final t in txs) {
    if (t.ignored || monthKey(t.occurredAt) != month) continue;
    if (t.credit) {
      earned += t.amountMinor;
    } else {
      spent += t.amountMinor;
      by[t.categoryId] = (by[t.categoryId] ?? 0) + t.amountMinor;
    }
  }
  final list = [for (final e in by.entries) (e.key, e.value)]..sort((a, b) => b.$2.compareTo(a.$2));
  return (spent: spent, earned: earned, byCategory: list);
}

/// Budgets in force for a month (latest from-or-before, per category) with what's used; overall first.
List<({BudgetItem budget, int used})> budgetProgress(List<BudgetItem> budgets, List<TxItem> txs, String month) {
  final s = summarise(txs, month);
  final live = <String?, BudgetItem>{};
  for (final b in [
    ...budgets.where((b) => !b.archived && b.from.compareTo(month) <= 0),
  ]..sort((a, b) => a.from.compareTo(b.from))) {
    live[b.categoryId] = b;
  }
  final out = [
    for (final b in live.values)
      (
        budget: b,
        used: b.categoryId == null
            ? s.spent
            : s.byCategory.firstWhere((c) => c.$1 == b.categoryId, orElse: () => (null, 0)).$2,
      ),
  ];
  out.sort((a, b) => a.budget.categoryId == null ? -1 : (b.budget.categoryId == null ? 1 : 0));
  return out;
}

/// ₹1,23,456 — Indian grouping; paise only when there are any.
String formatMoney(int minor, {String currency = 'INR'}) {
  final neg = minor < 0;
  final v = minor.abs();
  final rupees = v ~/ 100;
  final paise = v % 100;
  final s = rupees.toString();
  String grouped;
  if (s.length <= 3) {
    grouped = s;
  } else {
    final last3 = s.substring(s.length - 3);
    var rest = s.substring(0, s.length - 3);
    final parts = <String>[];
    while (rest.length > 2) {
      parts.insert(0, rest.substring(rest.length - 2));
      rest = rest.substring(0, rest.length - 2);
    }
    if (rest.isNotEmpty) parts.insert(0, rest);
    grouped = '${parts.join(',')},$last3';
  }
  final sym = currency == 'INR' ? '₹' : '$currency ';
  return '${neg ? '−' : ''}$sym$grouped${paise == 0 ? '' : '.${paise.toString().padLeft(2, '0')}'}';
}

/// A typed entry ("spent 240 on lunch", "uber 180 yesterday", "got 500 from rahul") — same rules as parseSpend in
/// TypeScript, and the same fixtures (packages/money/fixtures/spend.json).
({int amountMinor, String direction, String merchant, String? category, String note, String? date, String? time})?
parseSpend(String text, {DateTime? now}) {
  var t = text.trim();
  // the date and time first, so their numbers aren't mistaken for the amount
  final day = findDate(t, todayOn(now ?? DateTime.now()));
  if (day != null) t = '${t.substring(0, day.start)} ${t.substring(day.end)}'.replaceAll(RegExp(r'\s{2,}'), ' ').trim();
  final clock = findTime(t);
  if (clock != null) {
    t = '${t.substring(0, clock.start)} ${t.substring(clock.end)}'.replaceAll(RegExp(r'\s{2,}'), ' ').trim();
  }
  final m = RegExp(
    r'(?:₹|rs\.?\s*|inr\s*)?(\d[\d,]*(?:\.\d{1,2})?)\s*(k|thousand)?\b',
    caseSensitive: false,
  ).firstMatch(t);
  if (m == null) return null;
  var amount = double.parse(m.group(1)!.replaceAll(',', ''));
  if (m.group(2) != null) amount *= 1000;
  if (amount <= 0) return null;
  final credit = RegExp(r'\b(got|received|refund|salary|earned|returned)\b', caseSensitive: false).hasMatch(t);
  final without = t.replaceFirst(m.group(0)!, '');
  final rest = '${t.substring(0, m.start)} ${t.substring(m.end)}'
      .replaceAll(
        RegExp(
          r'\b(spent|paid|pay|gave|bought|for|on|got|received|from|to|rs|inr|rupees|bucks)\b',
          caseSensitive: false,
        ),
        ' ',
      )
      .replaceAll('₹', ' ')
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim();
  final at = RegExp(r"\b(?:at|on|from|to)\s+([a-z][\w&' .-]{1,40})$", caseSensitive: false).firstMatch(without);
  final who = (at?.group(1) ?? '').trim();
  final known = cleanMerchant(who.isNotEmpty ? who : rest);
  const hints = <(String, String)>[
    (r'\b(lunch|dinner|breakfast|snacks?|coffee|tea|chai|food|restaurant|cafe)\b', 'food'),
    (r'\b(groceries|grocery|vegetables|veggies|milk|fruits?)\b', 'groceries'),
    (r'\b(cab|auto|taxi|metro|bus|train ticket|parking|toll)\b', 'transport'),
    (r'\b(petrol|diesel|fuel)\b', 'fuel'),
    (r'\b(rent)\b', 'rent'),
    (r'\b(medicine|doctor|hospital|pharmacy|clinic)\b', 'health'),
    (r'\b(movie|movies|concert|game)\b', 'entertainment'),
    (r'\b(recharge|electricity|wifi|internet|bill)\b', 'bills'),
    (r'\b(clothes|shoes|shopping)\b', 'shopping'),
    (r'\b(gift|donation)\b', 'gifts'),
    (r'\b(flight|hotel|trip)\b', 'travel'),
  ];
  String? hint;
  for (final (p, c) in hints) {
    if (RegExp(p, caseSensitive: false).hasMatch(t)) {
      hint = c;
      break;
    }
  }
  final String note = known.category != null || who.isNotEmpty
      ? rest
            .replaceFirst(RegExp(RegExp.escape(who), caseSensitive: false), '')
            .replaceFirst(RegExp(r'\bat\b', caseSensitive: false), '')
            .trim()
      : rest;
  return (
    amountMinor: (amount * 100).round(),
    direction: credit ? 'credit' : 'debit',
    merchant: known.category != null || who.isNotEmpty ? known.merchant : '',
    category: credit
        ? (RegExp(r'\bsalary\b', caseSensitive: false).hasMatch(t)
              ? 'salary'
              : RegExp(r'\brefund\b', caseSensitive: false).hasMatch(t)
              ? 'refunds'
              : null)
        : (known.category ?? hint),
    note: note,
    date: day == null ? null : ymdString(day.date),
    time: clock?.time,
  );
}

final moneyActionsProvider = Provider<MoneyActions>((ref) => MoneyActions(ref.watch(syncProvider), ref));

class MoneyActions {
  MoneyActions(this.sync, this.ref);
  final SyncClient sync;
  final Ref ref;

  /// Starting categories, once per person (the server makes them; harmless to ask again).
  Future<void> ensureSetup() async {
    try {
      await ref.read(apiProvider).post<Map<String, dynamic>>('/money/setup');
      unawaited(sync.sync().catchError((Object _) {}));
    } catch (_) {
      // offline: the next open asks again
    }
  }

  Future<String> add(Map<String, dynamic> fields) =>
      _then(sync.upsert(moneyTransaction, {'source': 'manual', ...fields}));
  Future<void> update(String id, Map<String, dynamic> fields) => _then(sync.upsert(moneyTransaction, fields, id: id));
  Future<void> remove(String id) => _then(sync.remove(moneyTransaction, id));
  Future<String> saveBudget(String? id, Map<String, dynamic> fields) => _then(sync.upsert(moneyBudget, fields, id: id));
  Future<void> removeBudget(String id) => _then(sync.remove(moneyBudget, id));
  Future<String> saveRecurring(String? id, Map<String, dynamic> fields) =>
      _then(sync.upsert(moneyRecurring, fields, id: id));
  Future<void> removeRecurring(String id) => _then(sync.remove(moneyRecurring, id));
  Future<String> saveAccount(String? id, Map<String, dynamic> fields) =>
      _then(sync.upsert(moneyAccount, fields, id: id));
  Future<String> saveCategory(String? id, Map<String, dynamic> fields) =>
      _then(sync.upsert(moneyCategory, fields, id: id));
  Future<String> saveIou(String? id, Map<String, dynamic> fields) => _then(sync.upsert(moneyIou, fields, id: id));
  Future<void> removeIou(String id) => _then(sync.remove(moneyIou, id));

  Future<T> _then<T>(Future<T> f) async {
    final r = await f;
    unawaited(sync.sync().catchError((Object _) {}));
    return r;
  }
}

/// What the search box and filters keep: a word in the merchant, note, category or amount, plus kind, category, account.
bool txMatches(
  TxItem t, {
  String q = '',
  String? categoryId,
  String? accountId,
  String? direction,
  String Function(String?)? categoryName,
}) {
  if (direction != null && (t.credit ? 'credit' : 'debit') != direction) return false;
  if (categoryId != null && (categoryId == 'none' ? t.categoryId != null : t.categoryId != categoryId)) return false;
  if (accountId != null && t.accountId != accountId) return false;
  final w = q.trim().toLowerCase().replaceFirst('₹', '');
  if (w.isEmpty) return true;
  final amount = (t.amountMinor / 100).toString().replaceFirst(RegExp(r'\.0$'), '');
  return [
    t.title,
    t.merchant,
    t.rawMerchant,
    t.note,
    categoryName?.call(t.categoryId) ?? '',
    amount,
  ].any((x) => x.toLowerCase().contains(w));
}

String _csv(String v) {
  var s = v;
  if (RegExp(r'^[=+\-@\t\r]').hasMatch(s)) s = "'$s"; // a spreadsheet must not run a note as a formula
  return RegExp(r'[",\n]').hasMatch(s) ? '"${s.replaceAll('"', '""')}"' : s;
}

/// Transactions as spreadsheet text (CSV): day, time, type, amount, merchant, category, account, note.
String transactionsCsv(List<TxItem> list, List<CategoryItem> cats, List<AccountItem> accounts) {
  String two(int n) => n.toString().padLeft(2, '0');
  final rows = <List<String>>[
    ['Date', 'Time', 'Type', 'Amount', 'Currency', 'Merchant', 'Category', 'Account', 'Note', 'Transfer', 'Source'],
  ];
  final sorted = [...list]..sort((a, b) => a.occurredAt.compareTo(b.occurredAt));
  for (final t in sorted) {
    final at = t.occurredAt;
    rows.add([
      '${at.year}-${two(at.month)}-${two(at.day)}',
      '${two(at.hour)}:${two(at.minute)}',
      t.credit ? 'Came in' : 'Spent',
      (t.amountMinor / 100).toStringAsFixed(2),
      t.currency,
      t.merchant,
      cats.where((c) => c.id == t.categoryId).firstOrNull?.name ?? '',
      accounts.where((a) => a.id == t.accountId).firstOrNull?.name ?? '',
      t.note,
      t.transfer ? 'yes' : '',
      t.source,
    ]);
  }
  return '${rows.map((r) => r.map(_csv).join(',')).join('\n')}\n';
}

/// Spending per day of a month for the dashboard chart (0 for quiet days; transfers and income left out), up to
/// [upTo] (today). Same as dailySpend in packages/money.
List<int> dailySpend(List<TxItem> txs, String month, {int? upTo}) {
  final y = int.parse(month.substring(0, 4)), m = int.parse(month.substring(5, 7));
  final days = DateTime(y, m + 1, 0).day;
  final by = List<int>.filled(days, 0);
  for (final t in txs) {
    if (t.transfer || t.credit || monthKey(t.occurredAt) != month) continue;
    by[t.occurredAt.day - 1] += t.amountMinor;
  }
  return by.sublist(0, (upTo ?? days).clamp(0, days));
}
