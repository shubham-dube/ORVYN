import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:orvyn/chat/chat_crypto.dart';

/// packages/vault-crypto/fixtures/chat-vectors.json: what the web sealed, the phone opens — and the phone, given the
/// same inputs, writes the very same bytes (ADR-0014, spec 0011 AC2).
void main() {
  final v = jsonDecode(
    File('../../packages/vault-crypto/fixtures/chat-vectors.json').readAsStringSync(),
  ) as Map<String, dynamic>;
  final devices = v['devices'] as Map<String, dynamic>;
  Map<String, dynamic> dev(String n) => devices[n] as Map<String, dynamic>;
  final sealed = v['sealed'] as Map<String, dynamic>;
  final keys = (sealed['keys'] as List).cast<Map<String, dynamic>>();

  test('device keys and fingerprints from the same seeds match', () async {
    List<int> bytes(int n, int start) => List.generate(n, (i) => (start + i * 7) & 255);
    final a = await newDeviceKeys(boxSeed: bytes(32, 1), signSeed: bytes(32, 2));
    expect(a.toJson(), dev('alice'));
    expect(await fingerprint(a.boxPublic, a.signPublic), (v['fingerprints'] as Map)['alice']);
  });

  test('the same message, sealed on the phone, is byte-for-byte the web’s', () async {
    final f = v['fixed'] as Map<String, dynamic>;
    final out = await encryptMessage(
      v['payload'],
      conversationId: v['conversationId'] as String,
      messageId: v['messageId'] as String,
      deviceId: v['senderDeviceId'] as String,
      signSecret: dev('alice')['signSecret'] as String,
      recipients: [
        Recipient('bob-phone', dev('bobPhone')['boxPublic'] as String),
        Recipient('bob-laptop', dev('bobLaptop')['boxPublic'] as String),
      ],
      fixedKey: unb64(f['key'] as String),
      fixedNonce: unb64(f['nonce'] as String),
      fixedSeals: [
        for (final s in (f['seals'] as List).cast<Map<String, dynamic>>())
          (ephemeral: unb64(s['ephemeral'] as String), nonce: unb64(s['nonce'] as String)),
      ],
    );
    expect(out.toJson(), sealed);
  });

  test('both of Bob’s devices open what the web sent; a forged one fails', () async {
    for (final (name, i) in [('bobPhone', 0), ('bobLaptop', 1)]) {
      final p = await decryptMessage(
        conversationId: v['conversationId'] as String,
        id: v['messageId'] as String,
        senderDeviceId: v['senderDeviceId'] as String,
        ciphertext: sealed['ciphertext'] as String,
        nonce: sealed['nonce'] as String,
        signature: sealed['signature'] as String,
        sealedForMe: keys[i]['sealed'] as String,
        myBoxSecret: dev(name)['boxSecret'] as String,
        senderSignPublic: dev('alice')['signPublic'] as String,
      );
      expect(p, v['payload']);
    }
    expect(
      () => decryptMessage(
        conversationId: 'moved',
        id: v['messageId'] as String,
        senderDeviceId: v['senderDeviceId'] as String,
        ciphertext: sealed['ciphertext'] as String,
        nonce: sealed['nonce'] as String,
        signature: sealed['signature'] as String,
        sealedForMe: keys[0]['sealed'] as String,
        myBoxSecret: dev('bobPhone')['boxSecret'] as String,
        senderSignPublic: dev('alice')['signPublic'] as String,
      ),
      throwsA(isA<BadChatData>()),
    );
  });

  test('a sealed key and a file from the web open on the phone', () async {
    final s = v['sealOnly'] as Map<String, dynamic>;
    expect(b64(await openKey(s['sealed'] as String, dev('bobPhone')['boxSecret'] as String)), s['key']);
    final file = v['file'] as Map<String, dynamic>;
    expect(
      utf8.decode(await decryptFile(unb64(file['bytes'] as String), file['key'] as String, file['nonce'] as String)),
      file['plain'],
    );
  });
}
