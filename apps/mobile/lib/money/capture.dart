import 'dart:async';
import 'dart:io';

import 'package:drift/native.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import '../app/state.dart';
import '../core/api.dart';
import '../core/config.dart';
import '../core/push.dart';
import '../core/push_android.dart';
import '../core/session_store.dart';
import '../sync/db.dart';
import '../sync/sync_client.dart';
import 'money.dart';
import 'parse.dart';

/// One notification the Android listener kept (bank SMS through the SMS app, or GPay/PhonePe/Paytm).
/// It lives only in the phone's private queue until it is parsed here; then it's gone (AC5).
class Captured {
  const Captured({required this.source, this.app, this.title, required this.text, required this.at});
  final String source;
  final String? app;
  final String? title;
  final String text;
  final DateTime at;

  factory Captured.fromMap(Map<dynamic, dynamic> m) => Captured(
    source: m['source'] as String? ?? 'sms',
    app: m['app'] as String?,
    title: m['title'] as String?,
    text: m['text'] as String? ?? '',
    at: DateTime.fromMillisecondsSinceEpoch((m['at'] as num?)?.toInt() ?? 0),
  );
}

/// The Kotlin side (MoneyListener.kt): whether notification access is on, open its settings, read the queue and,
/// once parsed and saved, remove what was read.
abstract class CaptureChannel {
  Future<bool> enabled();
  Future<void> openSettings();
  Future<List<Captured>> pending();
  Future<void> ack(int count);

  /// the listener saw something new while ORVYN is open
  Stream<void> get arrived;
}

class AndroidCaptureChannel implements CaptureChannel {
  static const _ch = MethodChannel('orvyn/money_capture');
  final _arrived = StreamController<void>.broadcast();

  AndroidCaptureChannel() {
    _ch.setMethodCallHandler((call) async {
      if (call.method == 'arrived') _arrived.add(null);
    });
  }

  @override
  Stream<void> get arrived => _arrived.stream;

  @override
  Future<bool> enabled() async {
    try {
      return await _ch.invokeMethod<bool>('enabled') ?? false;
    } on MissingPluginException {
      return false;
    }
  }

  @override
  Future<void> openSettings() async {
    try {
      await _ch.invokeMethod<void>('openSettings');
    } on MissingPluginException {
      // not on Android
    }
  }

  @override
  Future<List<Captured>> pending() async {
    try {
      final list = await _ch.invokeListMethod<Map<dynamic, dynamic>>('pending') ?? const [];
      return [for (final m in list) Captured.fromMap(m)];
    } on MissingPluginException {
      return const [];
    }
  }

  @override
  Future<void> ack(int count) async {
    try {
      await _ch.invokeMethod<void>('ack', count);
    } on MissingPluginException {
      // not on Android
    }
  }
}

/// Read, save, then remove from the queue (a failure in between leaves it for next time).
Future<int> drainCaptured(SyncClient sync, CaptureChannel ch, {bool syncAfter = true}) async {
  final items = await ch.pending();
  if (items.isEmpty) return 0;
  final added = await processCaptured(sync, items, syncAfter: syncAfter);
  await ch.ack(items.length);
  return added;
}

final captureChannelProvider = Provider<CaptureChannel>((_) => AndroidCaptureChannel());

/// Turns captured notifications into transactions: parse on the phone, skip what isn't a payment, merge a second
/// sighting of the same payment (bank SMS + app), file it under the account it names (made on first sight) and the
/// starting category, mark it "new" (D20). Returns how many transactions were added.
Future<int> processCaptured(SyncClient sync, List<Captured> items, {bool syncAfter = true}) async {
  if (items.isEmpty) return 0;
  final txs = [for (final r in await sync.watch(moneyTransaction).first) TxItem(r.id, r.data)];
  final accounts = [for (final r in await sync.watch(moneyAccount).first) AccountItem(r.id, r.data)];
  final categories = [for (final r in await sync.watch(moneyCategory).first) CategoryItem(r.id, r.data)];
  final seen = [for (final t in txs) t.sighting];
  var added = 0;
  for (final c in items) {
    final m = parseMessage(source: c.source, app: c.app, title: c.title, text: c.text);
    if (m == null) continue;
    final source = c.source == 'notification' ? 'notification' : 'sms';
    final candidate = Sighting(
      amountMinor: m.amountMinor,
      direction: m.direction,
      occurredAt: c.at,
      dedupeKey: m.dedupeKey,
      source: source,
    );
    final dup = findDuplicate(candidate, seen);
    if (dup != null) {
      // the bank's message names the payee badly, the app well (or the other way round): keep the better one
      final had = txs.where((t) => t.id == dup.id).firstOrNull;
      if (had != null && had.merchant.isEmpty && m.merchant.isNotEmpty) {
        await sync.upsert(moneyTransaction, {'merchant': m.merchant, 'rawMerchant': m.rawMerchant}, id: had.id);
      }
      if (had != null && had.dedupeKey == null && m.dedupeKey != null) {
        await sync.upsert(moneyTransaction, {'dedupeKey': m.dedupeKey, 'refNo': m.refNo}, id: had.id);
      }
      continue;
    }
    final accountId = await _account(sync, accounts, m);
    final category = categories.where((x) => x.slug != null && x.slug == m.category).firstOrNull;
    final id = await sync.upsert(moneyTransaction, {
      'amountMinor': m.amountMinor,
      'direction': m.direction,
      'occurredAt': c.at.toUtc().toIso8601String(),
      'merchant': m.merchant,
      'rawMerchant': m.rawMerchant,
      'categoryId': category?.id,
      'accountId': accountId,
      'source': source,
      'dedupeKey': m.dedupeKey,
      'refNo': m.refNo,
      'reviewed': false,
      // money in isn't income until you say so (spec 0014); money out counts
      'counted': m.direction == 'debit',
    });
    seen.add(
      Sighting(
        id: id,
        amountMinor: m.amountMinor,
        direction: m.direction,
        occurredAt: c.at,
        dedupeKey: m.dedupeKey,
        source: source,
      ),
    );
    added++;
  }
  if (syncAfter) unawaited(sync.sync().catchError((Object _) {}));
  return added;
}

/// The account a message names ("HDFC ··1234", "HDFC card ··5678", "GPay"), made the first time it's seen.
Future<String?> _account(SyncClient sync, List<AccountItem> accounts, ParsedMessage m) async {
  if (m.institution == null && m.last4 == null) return null;
  final kind = m.accountKind;
  final found = accounts
      .where(
        (a) =>
            a.kind == kind &&
            (m.last4 != null ? a.last4 == m.last4 : a.institution == m.institution && a.last4 == null),
      )
      .firstOrNull;
  if (found != null) return found.id;
  final name = [m.institution ?? 'Bank', if (kind == 'card') 'card', if (m.last4 != null) '··${m.last4}'].join(' ');
  final id = await sync.upsert(moneyAccount, {
    'name': name,
    'kind': kind,
    'last4': m.last4,
    'institution': m.institution,
  });
  accounts.add(AccountItem(id, {'name': name, 'kind': kind, 'last4': m.last4, 'institution': m.institution}));
  return id;
}

/// While ORVYN runs: take the queue when the app opens, comes back, or the listener says something arrived.
final captureSyncProvider = Provider<void>((ref) {
  final session = ref.watch(sessionProvider);
  if (session is! SignedIn || !session.me.can('money')) return;
  final channel = ref.watch(captureChannelProvider);
  final sync = ref.watch(syncProvider);
  var busy = false;
  Future<void> run() async {
    if (busy) return;
    busy = true;
    try {
      await drainCaptured(sync, channel);
    } finally {
      busy = false;
    }
  }

  final sub = channel.arrived.listen((_) => unawaited(run()));
  final life = AppLifecycleListener(onResume: () => unawaited(run()));
  ref.onDispose(() {
    unawaited(sub.cancel());
    life.dispose();
  });
  unawaited(run());
});

/// Started by MoneyListener.kt when a payment notification arrives and ORVYN isn't open: parse the queue with the
/// stored session, sync, and finish. Nothing raw leaves the phone.
@pragma('vm:entry-point')
Future<void> moneyCaptureMain() async {
  WidgetsFlutterBinding.ensureInitialized();
  const done = MethodChannel('orvyn/money_capture_bg');
  try {
    final dir = await getApplicationSupportDirectory();
    final db = LocalDb(NativeDatabase(File(p.join(dir.path, 'orvyn.sqlite'))));
    final api = Api(baseUrl: Config.apiUrl, store: SecureSessionStore());
    final sync = SyncClient(db: db, api: api, node: 'b${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}');
    final added = await drainCaptured(sync, AndroidCaptureChannel(), syncAfter: false);
    // only what is new goes up: the server asks "what was it?" as soon as it has it
    await sync.pushOnly().timeout(const Duration(seconds: 20), onTimeout: () {}).catchError((Object _) {});
    // no connection: the server can't ask "what was it?" yet, so the phone says it has it, at once
    if (added > 0 && await sync.pendingCount() > 0) {
      await initShade();
      await AndroidShade().show(
        ShowPush(
          id: 'money-offline',
          title: added == 1 ? 'A payment is saved on this phone' : '$added payments are saved on this phone',
          body: 'No internet just now. ORVYN asks what ${added == 1 ? 'it was' : 'they were'} once you’re online.',
          url: '/money',
          module: 'money',
          priority: 'normal',
          actions: const [],
        ),
      );
    }
    await db.close();
  } catch (_) {
    // the queue is kept: whatever wasn't saved is read again next time
  } finally {
    await done.invokeMethod<void>('done').catchError((Object _) {});
  }
}
