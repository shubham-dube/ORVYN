import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:cryptography/cryptography.dart';

/// Chat encryption (ADR-0014), the same construction as packages/vault-crypto/src/chat.ts: a fresh key per message,
/// sealed to every device with X25519 + BLAKE2b + XChaCha20-Poly1305, signed with Ed25519. Both read
/// packages/vault-crypto/fixtures/chat-vectors.json and produce identical bytes for identical inputs.
const _sealLabel = 'orvyn-chat-seal-v1';
const _sigLabel = 'orvyn-chat-sig-v1';
final _aead = Xchacha20.poly1305Aead();
final _x = X25519();
final _ed = Ed25519();
final _rand = Random.secure();

class BadChatData implements Exception {
  BadChatData(this.message);
  final String message;
  @override
  String toString() => message;
}

String b64(List<int> b) => base64Url.encode(b).replaceAll('=', '');
Uint8List unb64(String s) => base64Url.decode(s.padRight((s.length + 3) ~/ 4 * 4, '='));
Uint8List _cat(List<List<int>> xs) => Uint8List.fromList([for (final x in xs) ...x]);
Uint8List _random(int n) => Uint8List.fromList(List.generate(n, (_) => _rand.nextInt(256)));

Future<Uint8List> _blake(List<int> data, int len) async =>
    Uint8List.fromList((await Blake2b(hashLengthInBytes: len).hash(data)).bytes);

/// A device's keys; the secrets stay on the device.
class DeviceKeys {
  const DeviceKeys({
    required this.boxPublic,
    required this.boxSecret,
    required this.signPublic,
    required this.signSecret,
  });
  final String boxPublic;
  final String boxSecret;
  final String signPublic;
  final String signSecret;

  Map<String, String> toJson() => {
    'boxPublic': boxPublic,
    'boxSecret': boxSecret,
    'signPublic': signPublic,
    'signSecret': signSecret,
  };
  factory DeviceKeys.fromJson(Map<String, dynamic> j) => DeviceKeys(
    boxPublic: j['boxPublic'] as String,
    boxSecret: j['boxSecret'] as String,
    signPublic: j['signPublic'] as String,
    signSecret: j['signSecret'] as String,
  );
}

Future<DeviceKeys> newDeviceKeys({List<int>? boxSeed, List<int>? signSeed}) async {
  // the raw seed is the secret we keep (X25519 clamps it the same way on every side)
  final seed = boxSeed ?? _random(32);
  final box = await _x.newKeyPairFromSeed(seed);
  final sign = await _ed.newKeyPairFromSeed(signSeed ?? _random(32));
  return DeviceKeys(
    boxPublic: b64((await box.extractPublicKey()).bytes),
    boxSecret: b64(seed),
    signPublic: b64((await sign.extractPublicKey()).bytes),
    signSecret: b64(await sign.extractPrivateKeyBytes()),
  );
}

/// A short fingerprint to compare in person.
Future<String> fingerprint(String boxPublic, String signPublic) async {
  final h = await _blake(_cat([unb64(boxPublic), unb64(signPublic)]), 10);
  final hex = h.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
  return [for (var i = 0; i < hex.length; i += 4) hex.substring(i, i + 4)].join(' ');
}

Future<Uint8List> _seal(List<int> key, List<int> plain, List<int> aad, List<int> nonce) async {
  final box = await _aead.encrypt(plain, secretKey: SecretKey(key), nonce: nonce, aad: aad);
  return _cat([box.cipherText, box.mac.bytes]);
}

Future<Uint8List> _open(List<int> key, List<int> ct, List<int> aad, List<int> nonce) async {
  if (ct.length < 16) throw BadChatData('short');
  try {
    final box = SecretBox(ct.sublist(0, ct.length - 16), nonce: nonce, mac: Mac(ct.sublist(ct.length - 16)));
    return Uint8List.fromList(await _aead.decrypt(box, secretKey: SecretKey(key), aad: aad));
  } on SecretBoxAuthenticationError {
    throw BadChatData('cannot open');
  }
}

Future<Uint8List> _shared(List<int> secret, List<int> remotePublic) async {
  final kp = await _x.newKeyPairFromSeed(secret);
  final s = await _x.sharedSecretKey(
    keyPair: kp,
    remotePublicKey: SimplePublicKey(remotePublic, type: KeyPairType.x25519),
  );
  return Uint8List.fromList(await s.extractBytes());
}

Future<Uint8List> _publicOf(List<int> secret) async =>
    Uint8List.fromList((await (await _x.newKeyPairFromSeed(secret)).extractPublicKey()).bytes);

/// Seals a 32-byte key to one device: E ‖ nonce ‖ ciphertext.
Future<String> sealKey(List<int> key, String recipientBoxPublic, {List<int>? ephemeral, List<int>? nonce}) async {
  final r = unb64(recipientBoxPublic);
  final e = ephemeral ?? _random(32);
  final ePub = await _publicOf(e);
  final shared = await _shared(e, r);
  final w = await _blake(_cat([utf8.encode(_sealLabel), shared, ePub, r]), 32);
  final n = nonce ?? _random(24);
  return b64(
    _cat([
      ePub,
      n,
      await _seal(w, key, _cat([ePub, r]), n),
    ]),
  );
}

Future<Uint8List> openKey(String sealed, String myBoxSecret) async {
  final raw = unb64(sealed);
  if (raw.length < 32 + 24 + 16) throw BadChatData('short');
  final ePub = raw.sublist(0, 32);
  final n = raw.sublist(32, 56);
  final sk = unb64(myBoxSecret);
  final r = await _publicOf(sk);
  final shared = await _shared(sk, ePub);
  final w = await _blake(_cat([utf8.encode(_sealLabel), shared, ePub, r]), 32);
  return _open(w, raw.sublist(56), _cat([ePub, r]), n);
}

List<int> _contentAad(String conv, String id, String device) => utf8.encode('orvyn-chat-v1|$conv|$id|$device');

Future<Uint8List> _digest(String conv, String id, String device, List<int> nonce, List<int> ct) =>
    _blake(_cat([utf8.encode(_sigLabel), utf8.encode(conv), utf8.encode(id), utf8.encode(device), nonce, ct]), 32);

class Recipient {
  const Recipient(this.deviceId, this.boxPublic);
  final String deviceId;
  final String boxPublic;
}

class Sealed {
  const Sealed({required this.ciphertext, required this.nonce, required this.signature, required this.keys});
  final String ciphertext;
  final String nonce;
  final String signature;
  final List<({String deviceId, String sealed})> keys;
  Map<String, dynamic> toJson() => {
    'ciphertext': ciphertext,
    'nonce': nonce,
    'signature': signature,
    'keys': [
      for (final k in keys) {'deviceId': k.deviceId, 'sealed': k.sealed},
    ],
  };
}

/// Encrypts one message for every device. `fixed*` only for test vectors.
Future<Sealed> encryptMessage(
  Object? payload, {
  required String conversationId,
  required String messageId,
  required String deviceId,
  required String signSecret,
  required List<Recipient> recipients,
  List<int>? fixedKey,
  List<int>? fixedNonce,
  List<({List<int> ephemeral, List<int> nonce})>? fixedSeals,
}) async {
  final key = fixedKey ?? _random(32);
  final nonce = fixedNonce ?? _random(24);
  final ct = await _seal(
    key,
    utf8.encode(jsonEncode(payload)),
    _contentAad(conversationId, messageId, deviceId),
    nonce,
  );
  final signer = await _ed.newKeyPairFromSeed(unb64(signSecret));
  final sig = await _ed.sign(await _digest(conversationId, messageId, deviceId, nonce, ct), keyPair: signer);
  final keys = <({String deviceId, String sealed})>[];
  for (var i = 0; i < recipients.length; i++) {
    keys.add((
      deviceId: recipients[i].deviceId,
      sealed: await sealKey(
        key,
        recipients[i].boxPublic,
        ephemeral: fixedSeals?[i].ephemeral,
        nonce: fixedSeals?[i].nonce,
      ),
    ));
  }
  return Sealed(ciphertext: b64(ct), nonce: b64(nonce), signature: b64(sig.bytes), keys: keys);
}

/// Checks the sender's signature, opens this device's key, decrypts.
Future<Object?> decryptMessage({
  required String conversationId,
  required String id,
  required String senderDeviceId,
  required String ciphertext,
  required String nonce,
  required String signature,
  required String sealedForMe,
  required String myBoxSecret,
  required String senderSignPublic,
}) async {
  final ct = unb64(ciphertext);
  final n = unb64(nonce);
  final ok = await _ed.verify(
    await _digest(conversationId, id, senderDeviceId, n, ct),
    signature: Signature(
      unb64(signature),
      publicKey: SimplePublicKey(unb64(senderSignPublic), type: KeyPairType.ed25519),
    ),
  );
  if (!ok) throw BadChatData('bad signature');
  final key = await openKey(sealedForMe, myBoxSecret);
  return jsonDecode(utf8.decode(await _open(key, ct, _contentAad(conversationId, id, senderDeviceId), n)));
}

final _fileAad = utf8.encode('orvyn-chat-file-v1');

Future<({String key, String nonce, Uint8List bytes})> encryptFile(
  List<int> bytes, {
  List<int>? key,
  List<int>? nonce,
}) async {
  final k = key ?? _random(32);
  final n = nonce ?? _random(24);
  return (key: b64(k), nonce: b64(n), bytes: await _seal(k, bytes, _fileAad, n));
}

Future<Uint8List> decryptFile(List<int> bytes, String key, String nonce) =>
    _open(unb64(key), bytes, _fileAad, unb64(nonce));
