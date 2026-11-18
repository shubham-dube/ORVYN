import 'dart:async';
import 'dart:isolate';

import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';

import '../app/state.dart';
import '../sync/sync_client.dart';
import 'vault_crypto.dart';

const vaultKeysEntity = 'vault.keys';
const vaultItemEntity = 'vault.item';

enum VaultStatus { loading, none, locked, unlocked }

const vaultKinds = ['login', 'card', 'id', 'apikey', 'recovery', 'note'];
const kindLabel = {
  'login': 'Login',
  'card': 'Card',
  'id': 'ID',
  'apikey': 'API key',
  'recovery': 'Recovery codes',
  'note': 'Secure note',
};

/// What each kind of item holds (all of it lives inside the encrypted blob; the server never sees any of this).
typedef VaultField = ({String key, String label, bool secret, bool multiline, bool generate, TextInputType? input});
VaultField _f(
  String key,
  String label, {
  bool secret = false,
  bool multiline = false,
  bool generate = false,
  TextInputType? input,
}) => (key: key, label: label, secret: secret, multiline: multiline, generate: generate, input: input);

final vaultFields = <String, List<VaultField>>{
  'login': [
    _f('username', 'Username or email', input: TextInputType.emailAddress),
    _f('password', 'Password', secret: true, generate: true),
    _f('url', 'Website', input: TextInputType.url),
    _f('totp', 'One-time code secret', secret: true),
  ],
  'card': [
    _f('holder', 'Name on card'),
    _f('number', 'Card number', secret: true, input: TextInputType.number),
    _f('expiry', 'Expiry (MM/YY)'),
    _f('cvv', 'CVV', secret: true, input: TextInputType.number),
    _f('pin', 'PIN', secret: true, input: TextInputType.number),
  ],
  'id': [_f('name', 'Name'), _f('number', 'Number', secret: true), _f('issued', 'Issued'), _f('expires', 'Expires')],
  'apikey': [_f('service', 'Service'), _f('key', 'Key', secret: true), _f('url', 'Website', input: TextInputType.url)],
  'recovery': [_f('service', 'Service'), _f('codes', 'Codes', secret: true, multiline: true)],
  'note': [_f('text', 'Note', secret: true, multiline: true)],
};

class OpenItem {
  OpenItem(this.id, this.payload);
  final String id;
  final Map<String, dynamic> payload;
  String get kind => (payload['kind'] as String?) ?? 'login';
  String get title => (payload['title'] as String?) ?? '';
  Map<String, String> get fields => {
    for (final e in ((payload['fields'] as Map?) ?? const {}).entries) '${e.key}': '${e.value}',
  };
  String get notes => (payload['notes'] as String?) ?? '';

  /// Things worth showing in the list without opening the item.
  String get subtitle {
    final f = fields;
    return switch (kind) {
      'login' => (f['username'] ?? '').isNotEmpty ? f['username']! : (f['url'] ?? ''),
      'card' =>
        (f['number'] ?? '').isNotEmpty
            ? '•••• ${f['number']!.replaceAll(RegExp(r'\D'), '').split('').reversed.take(4).toList().reversed.join()}'
            : (f['holder'] ?? ''),
      'id' => f['name'] ?? '',
      'apikey' || 'recovery' => f['service'] ?? '',
      _ => '',
    };
  }
}

class VaultState {
  const VaultState({
    this.status = VaultStatus.loading,
    this.items = const [],
    this.unreadable = 0,
    this.autoLockMin = 5,
  });
  final VaultStatus status;
  final List<OpenItem> items;
  final int unreadable;
  final int autoLockMin;
  VaultState copy({VaultStatus? status, List<OpenItem>? items, int? unreadable, int? autoLockMin}) => VaultState(
    status: status ?? this.status,
    items: items ?? this.items,
    unreadable: unreadable ?? this.unreadable,
    autoLockMin: autoLockMin ?? this.autoLockMin,
  );
}

/// Runs the slow key derivation off the UI thread (an isolate in the app; inline in tests).
typedef VaultRunner = Future<T> Function<T>(FutureOr<T> Function() job);
final vaultRunnerProvider = Provider<VaultRunner>(
  (ref) =>
      <T>(job) => Isolate.run<T>(job),
);

/// How hard the passphrase is stretched. Tests use a light setting; the app uses [defaultKdf].
final vaultKdfProvider = Provider<KdfParams>((ref) => defaultKdf);

final vaultProvider = NotifierProvider<VaultController, VaultState>(VaultController.new);

/// The Vault on this phone (ADR-0004). The vault key lives only in this object's memory while unlocked — never in
/// storage — and is wiped on lock, on auto-lock and when the app has been in the background too long.
class VaultController extends Notifier<VaultState> with WidgetsBindingObserver {
  VaultKeys? _keys;
  List<({String id, String blob})> _blobs = const [];
  Uint8List? _key;
  Timer? _timer;
  DateTime? _backgroundedAt;
  StreamSubscription<dynamic>? _kSub;
  StreamSubscription<dynamic>? _iSub;

  SyncClient get _sync => ref.read(syncProvider);

  @override
  VaultState build() {
    WidgetsBinding.instance.addObserver(this);
    final sync = ref.watch(syncProvider);
    _kSub = sync.watch(vaultKeysEntity).listen((rows) {
      final r = rows.firstOrNull;
      _keys = r == null || r.data['pass'] == null
          ? null
          : VaultKeys(pass: r.data['pass'] as String, recovery: r.data['recovery'] as String);
      state = state.copy(
        status: _keys == null ? VaultStatus.none : (_key != null ? VaultStatus.unlocked : VaultStatus.locked),
      );
    });
    _iSub = sync.watch(vaultItemEntity).listen((rows) {
      _blobs = [for (final r in rows) (id: r.id, blob: r.data['blob'] as String? ?? '')];
      unawaited(_decryptAll());
    });
    ref.onDispose(() {
      WidgetsBinding.instance.removeObserver(this);
      _kSub?.cancel();
      _iSub?.cancel();
      _timer?.cancel();
      _wipe();
    });
    return const VaultState();
  }

  void _wipe() {
    _key?.fillRange(0, _key!.length, 0);
    _key = null;
  }

  Future<void> _decryptAll() async {
    final vk = _key;
    if (vk == null) return;
    final out = <OpenItem>[];
    var bad = 0;
    for (final b in _blobs) {
      try {
        out.add(OpenItem(b.id, await decryptItem(vk, b.id, b.blob)));
      } catch (_) {
        bad++;
      }
    }
    if (_key == null) return; // locked meanwhile
    out.sort((a, b) => a.title.toLowerCase().compareTo(b.title.toLowerCase()));
    state = state.copy(items: out, unreadable: bad);
  }

  void _opened(Uint8List key) {
    _key = key;
    state = state.copy(status: VaultStatus.unlocked);
    touch();
    unawaited(_decryptAll());
  }

  /// Any use of the Vault restarts the auto-lock clock.
  void touch() {
    _timer?.cancel();
    if (state.status != VaultStatus.unlocked || state.autoLockMin == 0) return;
    _timer = Timer(Duration(minutes: state.autoLockMin), lock);
  }

  void setAutoLock(int minutes) {
    state = state.copy(autoLockMin: minutes);
    touch();
  }

  void lock() {
    _timer?.cancel();
    _wipe();
    state = VaultState(status: _keys == null ? VaultStatus.none : VaultStatus.locked, autoLockMin: state.autoLockMin);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused) {
      _backgroundedAt = DateTime.now();
    } else if (state == AppLifecycleState.resumed && _backgroundedAt != null) {
      final away = DateTime.now().difference(_backgroundedAt!);
      _backgroundedAt = null;
      // leaving the app counts toward the auto-lock; "never" still locks after an hour away
      final limit = this.state.autoLockMin == 0 ? const Duration(hours: 1) : Duration(minutes: this.state.autoLockMin);
      if (this.state.status == VaultStatus.unlocked && away >= limit) lock();
    }
  }

  /// First-time setup; returns the recovery key, to be shown once.
  Future<String> setup(String passphrase) async {
    final kdf = ref.read(vaultKdfProvider);
    final made = await ref.read(vaultRunnerProvider)(() => createVault(passphrase, kdf: kdf));
    await _sync.upsert(vaultKeysEntity, {'pass': made.keys.pass, 'recovery': made.keys.recovery}, id: _ownerId());
    _keys = made.keys;
    _opened(made.vaultKey);
    unawaited(_sync.sync().catchError((Object _) {}));
    return made.recoveryKey;
  }

  String _ownerId() {
    final s = ref.read(sessionProvider);
    return (s as dynamic).me.id as String;
  }

  Future<void> unlockWith(String passphrase) async {
    final k = _keys;
    if (k == null) throw StateError('no vault');
    _opened(await ref.read(vaultRunnerProvider)(() => unlock(k, passphrase)));
  }

  Future<void> recover(String recoveryKey, String newPassphrase) async {
    final k = _keys;
    if (k == null) throw StateError('no vault');
    final kdf = ref.read(vaultKdfProvider);
    final r = await ref.read(vaultRunnerProvider)(() async {
      final vk = await unlockWithRecovery(k, recoveryKey);
      return (vk: vk, pass: await rewrapPassphrase(vk, newPassphrase, kdf: kdf));
    });
    await _sync.upsert(vaultKeysEntity, {'pass': r.pass}, id: _ownerId());
    _keys = VaultKeys(pass: r.pass, recovery: k.recovery);
    _opened(r.vk);
    unawaited(_sync.sync().catchError((Object _) {}));
  }

  Future<void> changePassphrase(String oldPassphrase, String newPassphrase) async {
    final k = _keys;
    if (k == null) throw StateError('no vault');
    final kdf = ref.read(vaultKdfProvider);
    final pass = await ref.read(vaultRunnerProvider)(() async {
      final vk = await unlock(k, oldPassphrase);
      return rewrapPassphrase(vk, newPassphrase, kdf: kdf);
    });
    await _sync.upsert(vaultKeysEntity, {'pass': pass}, id: _ownerId());
    _keys = VaultKeys(pass: pass, recovery: k.recovery);
    unawaited(_sync.sync().catchError((Object _) {}));
  }

  Future<String> saveItem(String? id, Map<String, dynamic> payload) async {
    final vk = _key;
    if (vk == null) throw StateError('locked');
    touch();
    final itemId = id ?? _newId();
    final blob = await encryptItem(vk, itemId, {...payload, 'updatedAt': DateTime.now().toUtc().toIso8601String()});
    await _sync.upsert(vaultItemEntity, {'blob': blob}, id: itemId);
    unawaited(_sync.sync().catchError((Object _) {}));
    return itemId;
  }

  Future<void> removeItem(String id) async {
    touch();
    await _sync.remove(vaultItemEntity, id);
    unawaited(_sync.sync().catchError((Object _) {}));
  }

  /// Copy, and clear the clipboard again after 30 seconds.
  Future<void> copySecret(String text) async {
    touch();
    await Clipboard.setData(ClipboardData(text: text));
    Timer(const Duration(seconds: 30), () => Clipboard.setData(const ClipboardData(text: '')));
  }

  String _newId() => const Uuid().v7();
}
