import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:cryptography/cryptography.dart';

import '../chat/chat_crypto.dart' show b64, unb64;

/// Messages between this phone and my PC (ADR-0019), the same construction as packages/vault-crypto/src/pc.ts and the
/// PC: XChaCha20-Poly1305 under the key made at pairing, bound to the session, the direction and a counter.
final _aead = Xchacha20.poly1305Aead();
final _rand = Random.secure();

class BadPcMessage implements Exception {}

class PcPairing {
  const PcPairing({required this.id, required this.key, required this.name});
  final String id;
  final Uint8List key;
  final String name;

  Map<String, String> toJson() => {'id': id, 'key': b64(key), 'name': name};
  factory PcPairing.fromJson(Map<String, dynamic> j) =>
      PcPairing(id: j['id'] as String, key: unb64(j['key'] as String), name: j['name'] as String);

  /// The code the PC shows: on its own, or at the end of a link.
  static PcPairing? read(String text) {
    final m = RegExp(r'ORVYN-PC1\.([\w-]{16})\.([\w-]{43})\.([\w-]{1,200})').firstMatch(text);
    if (m == null) return null;
    try {
      final key = unb64(m[2]!);
      return key.length == 32 ? PcPairing(id: m[1]!, key: key, name: utf8.decode(unb64(m[3]!))) : null;
    } on FormatException {
      return null;
    }
  }
}

/// This phone's half of a session's name.
String pcNonce() => b64(List.generate(16, (_) => _rand.nextInt(256)));

List<int> _aad(String sid, String dir, int n) => utf8.encode('orvyn-pc-v1|$sid|$dir|$n');

Future<String> pcSeal(List<int> key, String sid, String dir, int n, String plain, {List<int>? nonce}) async {
  final non = nonce ?? List.generate(24, (_) => _rand.nextInt(256));
  final box = await _aead.encrypt(utf8.encode(plain), secretKey: SecretKey(key), nonce: non, aad: _aad(sid, dir, n));
  return 'm.$n.${b64([...non, ...box.cipherText, ...box.mac.bytes])}';
}

/// One side of a session: counts what it sends and what it opens, and keeps both in order.
class PcChannel {
  PcChannel(this._key, this._sid, {this.me = 'c'});
  final List<int> _key;
  final String _sid;
  final String me;
  int _sent = 0;
  int _opened = 0;
  Future<void> _sealing = Future.value();
  Future<void> _opening = Future.value();

  /// When everything given to [open] so far is opened.
  Future<void> get idle => _opening;

  /// [out] gets the messages in the order this was called.
  Future<void> seal(String plain, void Function(String frame) out) {
    final n = _sent++;
    return _sealing = _sealing.then((_) async => out(await pcSeal(_key, _sid, me, n, plain)));
  }

  /// The next message of the other side; anything else is refused.
  Future<void> open(String frame, void Function(String plain) got, void Function() bad) =>
      _opening = _opening.then((_) async {
        String plain;
        try {
          plain = await _open(frame);
        } catch (_) {
          return bad();
        }
        got(plain);
      });

  Future<String> _open(String frame) async {
    final p = frame.split('.');
    if (p.length != 3 || p[0] != 'm' || p[1] != '$_opened') throw BadPcMessage();
    final raw = unb64(p[2]);
    if (raw.length < 24 + 16) throw BadPcMessage();
    final box = SecretBox(
      raw.sublist(24, raw.length - 16),
      nonce: raw.sublist(0, 24),
      mac: Mac(raw.sublist(raw.length - 16)),
    );
    final plain = await _aead.decrypt(box, secretKey: SecretKey(_key), aad: _aad(_sid, me == 'c' ? 'p' : 'c', _opened));
    _opened++;
    return utf8.decode(plain);
  }
}
