import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:cryptography/cryptography.dart';
import 'package:unorm_dart/unorm_dart.dart' as unorm;

/// The Vault's cryptography (ADR-0004, D24): Argon2id → key-encryption key, a random vault key, XChaCha20-Poly1305 per
/// item, a recovery key shown once. Same formats as packages/vault-crypto; both read its fixtures/vectors.json.
/// Everything runs on the device; the server only ever stores the strings this produces.
class KdfParams {
  const KdfParams({required this.ops, required this.memKiB});
  final int ops;
  final int memKiB;
}

/// 32 MiB, 3 passes.
const defaultKdf = KdfParams(ops: 3, memKiB: 32 * 1024);

/// What the server stores for a person's vault keys: two atomic strings.
class VaultKeys {
  const VaultKeys({required this.pass, required this.recovery});
  final String pass;
  final String recovery;
}

class WrongPassphrase implements Exception {
  @override
  String toString() => 'wrong passphrase';
}

class WrongRecoveryKey implements Exception {
  @override
  String toString() => 'wrong recovery key';
}

class BadVaultData implements Exception {
  BadVaultData(this.message);
  final String message;
  @override
  String toString() => message;
}

const _v = 'v1';
const _aadPass = 'orvyn-vault-wrap-v1|pass';
const _aadRecovery = 'orvyn-vault-wrap-v1|recovery';
String _aadItem(String id) => 'orvyn-vault-item-v1|$id';

final _aead = Xchacha20.poly1305Aead();

String _b64(List<int> b) => base64Url.encode(b).replaceAll('=', '');
Uint8List _unb64(String s) => Uint8List.fromList(base64Url.decode(base64Url.normalize(s)));

Uint8List _random(int n) {
  final r = Random.secure();
  return Uint8List.fromList([for (var i = 0; i < n; i++) r.nextInt(256)]);
}

Future<String> _seal(List<int> key, List<int> plain, String aad, [List<int>? nonce]) async {
  final n = nonce ?? _random(24);
  final box = await _aead.encrypt(plain, secretKey: SecretKey(key), nonce: n, aad: utf8.encode(aad));
  return '$_v.${_b64(n)}.${_b64([...box.cipherText, ...box.mac.bytes])}';
}

Future<Uint8List> _open(List<int> key, String blob, String aad) async {
  final parts = blob.split('.');
  if (parts.length != 3 || parts[0] != _v) throw BadVaultData('unknown format');
  final raw = _unb64(parts[2]);
  if (raw.length < 16) throw BadVaultData('could not decrypt');
  try {
    final box = SecretBox(
      raw.sublist(0, raw.length - 16),
      nonce: _unb64(parts[1]),
      mac: Mac(raw.sublist(raw.length - 16)),
    );
    return Uint8List.fromList(await _aead.decrypt(box, secretKey: SecretKey(key), aad: utf8.encode(aad)));
  } on SecretBoxAuthenticationError {
    throw BadVaultData('could not decrypt');
  }
}

Future<Uint8List> _derive(String passphrase, List<int> salt, KdfParams kdf) async {
  final k = await Argon2id(
    memory: kdf.memKiB,
    parallelism: 1,
    iterations: kdf.ops,
    hashLength: 32,
  ).deriveKeyFromPassword(password: _nfkc(passphrase), nonce: salt);
  return Uint8List.fromList(await k.extractBytes());
}

/// Passphrases are normalised (NFKC) the same way on every device, so a passphrase typed on one keyboard opens on another.
String _nfkc(String s) => unorm.nfkc(s);

const _crockford = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/// 32 bytes → 52 characters in groups of four.
String formatRecoveryKey(List<int> bytes) {
  var bits = 0, acc = 0;
  final out = StringBuffer();
  for (final b in bytes) {
    acc = ((acc << 8) | b) & 0xFFFFFF;
    bits += 8;
    while (bits >= 5) {
      out.write(_crockford[(acc >> (bits - 5)) & 31]);
      bits -= 5;
    }
  }
  if (bits > 0) out.write(_crockford[(acc << (5 - bits)) & 31]);
  final s = out.toString();
  return [for (var i = 0; i < s.length; i += 4) s.substring(i, min(i + 4, s.length))].join('-');
}

/// Back to bytes; forgiving about case, spaces, dashes and look-alike letters (I, L → 1; O → 0).
Uint8List parseRecoveryKey(String text) {
  final clean = text
      .toUpperCase()
      .replaceAll(RegExp(r'[\s-]'), '')
      .replaceAll(RegExp('[IL]'), '1')
      .replaceAll('O', '0');
  if (clean.length != 52) throw WrongRecoveryKey();
  var bits = 0, acc = 0;
  final out = <int>[];
  for (final ch in clean.split('')) {
    final i = _crockford.indexOf(ch);
    if (i < 0) throw WrongRecoveryKey();
    acc = (acc << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.add((acc >> (bits - 8)) & 255);
      bits -= 8;
      acc &= (1 << bits) - 1;
    }
  }
  return Uint8List.fromList(out.take(32).toList());
}

Future<String> _wrapPass(
  List<int> vaultKey,
  String passphrase,
  KdfParams kdf, {
  List<int>? salt,
  List<int>? nonce,
}) async {
  final s = salt ?? _random(16);
  final kek = await _derive(passphrase, s, kdf);
  return jsonEncode({
    'v': 1,
    'salt': _b64(s),
    'ops': kdf.ops,
    'memKiB': kdf.memKiB,
    'wrap': await _seal(kek, vaultKey, _aadPass, nonce),
  });
}

/// First-time setup: a new vault key, wrapped by the passphrase and by a fresh recovery key (shown once, to print).
Future<({VaultKeys keys, Uint8List vaultKey, String recoveryKey})> createVault(
  String passphrase, {
  KdfParams kdf = defaultKdf,
}) async {
  final vk = _random(32);
  final rk = _random(32);
  return (
    keys: VaultKeys(pass: await _wrapPass(vk, passphrase, kdf), recovery: await _seal(rk, vk, _aadRecovery)),
    vaultKey: vk,
    recoveryKey: formatRecoveryKey(rk),
  );
}

Map<String, dynamic> _readPass(VaultKeys keys) {
  try {
    final p = jsonDecode(keys.pass) as Map<String, dynamic>;
    if (p['v'] != 1 || p['salt'] == null || p['wrap'] == null) throw const FormatException();
    return p;
  } catch (_) {
    throw BadVaultData('unreadable vault keys');
  }
}

/// Open the vault with the passphrase. A wrong one throws [WrongPassphrase].
Future<Uint8List> unlock(VaultKeys keys, String passphrase) async {
  final p = _readPass(keys);
  try {
    final kek = await _derive(
      passphrase,
      _unb64(p['salt'] as String),
      KdfParams(ops: p['ops'] as int, memKiB: p['memKiB'] as int),
    );
    return await _open(kek, p['wrap'] as String, _aadPass);
  } on BadVaultData {
    throw WrongPassphrase();
  }
}

/// Open the vault with the recovery key.
Future<Uint8List> unlockWithRecovery(VaultKeys keys, String recoveryKey) async {
  final rk = parseRecoveryKey(recoveryKey);
  try {
    return await _open(rk, keys.recovery, _aadRecovery);
  } on BadVaultData {
    throw WrongRecoveryKey();
  }
}

/// A new passphrase for the same vault key (items are not re-encrypted). Returns the new `pass` string.
Future<String> rewrapPassphrase(List<int> vaultKey, String newPassphrase, {KdfParams kdf = defaultKdf}) =>
    _wrapPass(vaultKey, newPassphrase, kdf);

/// Reference-vector hook: wrap with a fixed salt and nonce.
Future<String> rewrapPassphraseFixed(
  List<int> vaultKey,
  String newPassphrase,
  KdfParams kdf,
  List<int> salt,
  List<int> nonce,
) => _wrapPass(vaultKey, newPassphrase, kdf, salt: salt, nonce: nonce);

Future<VaultKeys> changePassphrase(VaultKeys keys, String oldPassphrase, String newPassphrase) async {
  final vk = await unlock(keys, oldPassphrase);
  return VaultKeys(pass: await rewrapPassphrase(vk, newPassphrase), recovery: keys.recovery);
}

Future<({VaultKeys keys, Uint8List vaultKey})> resetPassphrase(
  VaultKeys keys,
  String recoveryKey,
  String newPassphrase,
) async {
  final vk = await unlockWithRecovery(keys, recoveryKey);
  return (keys: VaultKeys(pass: await rewrapPassphrase(vk, newPassphrase), recovery: keys.recovery), vaultKey: vk);
}

/// Encrypt an item (any JSON) under the vault key, bound to its id.
Future<String> encryptItem(List<int> vaultKey, String itemId, Object payload) =>
    _seal(vaultKey, utf8.encode(jsonEncode(payload)), _aadItem(itemId));

Future<Map<String, dynamic>> decryptItem(List<int> vaultKey, String itemId, String blob) async =>
    jsonDecode(utf8.decode(await _open(vaultKey, blob, _aadItem(itemId)))) as Map<String, dynamic>;

/// Reference-vector hook: the plaintext bytes with a fixed nonce.
Future<String> encryptBytesFixed(List<int> vaultKey, String itemId, List<int> plain, List<int> nonce) =>
    _seal(vaultKey, plain, _aadItem(itemId), nonce);

/// Reference-vector hook: seal with fixed nonces, as createVault does with a fixed vault key.
Future<VaultKeys> keysFixed(
  List<int> vaultKey,
  List<int> recoveryKey,
  String passphrase,
  KdfParams kdf,
  List<int> salt,
  List<int> passNonce,
  List<int> recoveryNonce,
) async => VaultKeys(
  pass: await _wrapPass(vaultKey, passphrase, kdf, salt: salt, nonce: passNonce),
  recovery: await _seal(recoveryKey, vaultKey, _aadRecovery, recoveryNonce),
);

Uint8List fromB64(String s) => _unb64(s);
String toB64(List<int> b) => _b64(b);

/// A random password from the device's secure generator.
String generatePassword({int length = 20, bool symbols = true, bool digits = true}) {
  final n = length.clamp(8, 128);
  final sets = [
    'abcdefghijkmnopqrstuvwxyz',
    'ABCDEFGHJKLMNPQRSTUVWXYZ',
    if (digits) '23456789',
    if (symbols) r'!@#$%^&*-_=+?',
  ];
  final all = sets.join();
  final r = Random.secure();
  final out = [for (final s in sets) s[r.nextInt(s.length)]];
  while (out.length < n) {
    out.add(all[r.nextInt(all.length)]);
  }
  out.shuffle(r);
  return out.join();
}
