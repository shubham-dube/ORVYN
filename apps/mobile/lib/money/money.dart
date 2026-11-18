import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app/state.dart';
import '../sync/sync_client.dart';
import 'parse.dart';

const moneyAccount = 'money.account';
const moneyCategory = 'money.category';
const moneyTransaction = 'money.transaction';
const moneyBudget = 'money.budget';

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

String monthKey(DateTime d) => '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}';

/// Same rules as `summarise` in packages/money: transfers left out, credits counted as came in.
({int spent, int earned, List<(String?, int)> byCategory}) summarise(List<TxItem> txs, String month) {
  var spent = 0, earned = 0;
  final by = <String?, int>{};
  for (final t in txs) {
    if (t.transfer || monthKey(t.occurredAt) != month) continue;
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

/// A typed entry ("spent 240 on lunch", "uber 180", "got 500 from rahul") — same rules as parseSpend in TypeScript.
({int amountMinor, String direction, String merchant, String? category, String note})? parseSpend(String text) {
  final t = text.trim();
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
    note: rest,
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

  Future<T> _then<T>(Future<T> f) async {
    final r = await f;
    unawaited(sync.sync().catchError((Object _) {}));
    return r;
  }
}
