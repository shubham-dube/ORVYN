import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'money.dart';

/// The on-device half of the money brain (spec 0013): what your own history says about a merchant, for smart fill
/// as you type. Same rules as `packages/money/src/brain.ts` (merchant key, profile, suggestions, confident filing),
/// tested against the same cases. Instant and offline: it reads the local mirror.

String _norm(String s) => s
    .toLowerCase()
    .replaceAll('&', ' and ')
    .replaceAll(RegExp(r'[^a-z0-9 ]+'), ' ')
    .replaceAll(RegExp(r'\s+'), ' ')
    .trim();

/// "SWIGGY 4521*" and "Swiggy" are the same merchant.
String merchantKey(String merchant) =>
    _norm(merchant).replaceAll(RegExp(r'\b\d{4,}\b'), '').replaceAll(RegExp(r'\s+'), ' ').trim();

class MerchantProfile {
  MerchantProfile({
    required this.key,
    required this.merchant,
    required this.count,
    required this.totalMinor,
    required this.medianMinor,
    required this.lastAmountMinor,
    required this.lastAt,
    required this.categoryId,
    required this.categoryShare,
    required this.filed,
    required this.accountId,
    required this.credit,
    required this.amounts,
    required this.txs,
  });
  final String key;
  final String merchant;
  final int count;
  final int totalMinor;
  final int medianMinor;
  final int lastAmountMinor;
  final DateTime lastAt;
  final String? categoryId;
  final double categoryShare;
  final int filed;
  final String? accountId;
  final bool credit;

  /// distinct amounts, most frequent first
  final List<int> amounts;

  /// newest first
  final List<TxItem> txs;

  /// filed the same way 3+ times and 80%+ of the time: confident enough to pick it for you
  bool get confident => categoryId != null && filed >= 3 && categoryShare >= 0.8;
}

int _median(List<int> xs) {
  if (xs.isEmpty) return 0;
  final s = [...xs]..sort();
  return s[s.length ~/ 2];
}

(T?, int) _mode<T>(Iterable<T> xs) {
  final m = <T, int>{};
  for (final x in xs) {
    m[x] = (m[x] ?? 0) + 1;
  }
  T? best;
  var n = 0;
  m.forEach((k, v) {
    if (v > n) {
      best = k;
      n = v;
    }
  });
  return (best, n);
}

Map<String, MerchantProfile> merchantProfiles(List<TxItem> txs) {
  final by = <String, List<TxItem>>{};
  for (final t in txs) {
    if (t.ignored || t.merchant.trim().isEmpty) continue;
    final k = merchantKey(t.merchant);
    if (k.isEmpty) continue;
    (by[k] ??= []).add(t);
  }
  final out = <String, MerchantProfile>{};
  by.forEach((key, list) {
    list.sort((a, b) => b.occurredAt.compareTo(a.occurredAt));
    final filed = [for (final t in list) ?t.categoryId];
    final (cat, catN) = _mode(filed);
    final (acct, _) = _mode([for (final t in list) ?t.accountId]);
    final (credit, _) = _mode(list.map((t) => t.credit));
    final amountCounts = <int, int>{};
    for (final t in list) {
      amountCounts[t.amountMinor] = (amountCounts[t.amountMinor] ?? 0) + 1;
    }
    final amounts = amountCounts.entries.toList()
      ..sort((a, b) => b.value != a.value ? b.value.compareTo(a.value) : b.key.compareTo(a.key));
    out[key] = MerchantProfile(
      key: key,
      merchant: list.first.merchant,
      count: list.length,
      totalMinor: list.fold(0, (a, t) => a + t.amountMinor),
      medianMinor: _median([for (final t in list) t.amountMinor]),
      lastAmountMinor: list.first.amountMinor,
      lastAt: list.first.occurredAt,
      categoryId: cat,
      categoryShare: filed.isEmpty ? 0 : catN / filed.length,
      filed: filed.length,
      accountId: acct,
      credit: credit ?? false,
      amounts: [for (final e in amounts.take(4)) e.key],
      txs: list,
    );
  });
  return out;
}

double _score(MerchantProfile p, DateTime now) {
  final days = now.difference(p.lastAt).inHours / 24;
  return p.count * 2 + 30 / (days < 1 ? 1 : days);
}

/// Merchants for what's typed (start of the name, then of a word, then anywhere), used often and lately first.
List<MerchantProfile> suggestMerchants(Map<String, MerchantProfile> profiles, String typed, DateTime now, {int n = 5}) {
  final q = merchantKey(typed);
  final all = profiles.values.toList();
  if (q.isEmpty) return (all..sort((a, b) => _score(b, now).compareTo(_score(a, now)))).take(n).toList();
  final ranked = <(MerchantProfile, int)>[];
  for (final p in all) {
    final rank = p.key.startsWith(q)
        ? 3
        : p.key.split(' ').any((w) => w.startsWith(q))
        ? 2
        : p.key.contains(q)
        ? 1
        : 0;
    if (rank > 0) ranked.add((p, rank));
  }
  ranked.sort((a, b) => a.$2 != b.$2 ? b.$2.compareTo(a.$2) : _score(b.$1, now).compareTo(_score(a.$1, now)));
  return [for (final r in ranked.take(n)) r.$1];
}

/// Merchants this amount was paid to before (exactly, or within 3% for 3+ visits), most visits first.
List<MerchantProfile> merchantsForAmount(Map<String, MerchantProfile> profiles, int amountMinor, {int n = 4}) {
  if (amountMinor <= 0) return const [];
  final out =
      profiles.values
          .where(
            (p) =>
                p.amounts.contains(amountMinor) ||
                (p.count >= 3 && (p.medianMinor - amountMinor).abs() <= p.medianMinor * 0.03),
          )
          .toList()
        ..sort((a, b) => b.count.compareTo(a.count));
  return out.take(n).toList();
}

final merchantProfilesProvider = Provider<Map<String, MerchantProfile>>((ref) {
  final txs = ref.watch(transactionsProvider).value ?? const <TxItem>[];
  return merchantProfiles(txs);
});
