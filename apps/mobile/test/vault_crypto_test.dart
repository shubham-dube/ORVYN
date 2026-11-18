import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:orvyn/vault/vault_crypto.dart';

/// The same vectors as packages/vault-crypto (fixtures/vectors.json): what the web wrote, the phone must read, and what
/// the phone writes with the same inputs must be byte-for-byte the same.
void main() {
  final v =
      jsonDecode(File('../../packages/vault-crypto/fixtures/vectors.json').readAsStringSync()) as Map<String, dynamic>;
  final kdf = KdfParams(ops: (v['kdf'] as Map)['ops'] as int, memKiB: (v['kdf'] as Map)['memKiB'] as int);
  final keys = VaultKeys(
    pass: (v['keys'] as Map)['pass'] as String,
    recovery: (v['keys'] as Map)['recovery'] as String,
  );
  final vaultKey = fromB64(v['vaultKey'] as String);
  final item = v['item'] as Map<String, dynamic>;

  test('opens the web’s passphrase wrap and recovery wrap to the same vault key', () async {
    expect(await unlock(keys, v['passphrase'] as String), vaultKey);
    expect(await unlockWithRecovery(keys, v['recoveryKeyText'] as String), vaultKey);
  });

  test('opens a re-wrapped passphrase and an item written by the web', () async {
    final re = v['rewrap'] as Map<String, dynamic>;
    expect(
      await unlock(VaultKeys(pass: re['pass'] as String, recovery: keys.recovery), re['newPassphrase'] as String),
      vaultKey,
    );
    expect(
      await decryptItem(vaultKey, item['id'] as String, item['blob'] as String),
      jsonDecode(item['plaintext'] as String),
    );
  });

  test('writes exactly what the web writes for the same inputs', () async {
    expect(
      await encryptBytesFixed(
        vaultKey,
        item['id'] as String,
        utf8.encode(item['plaintext'] as String),
        fromB64(item['nonce'] as String),
      ),
      item['blob'],
    );
    final re = v['rewrap'] as Map<String, dynamic>;
    expect(
      await rewrapPassphraseFixed(
        vaultKey,
        re['newPassphrase'] as String,
        kdf,
        fromB64(re['salt'] as String),
        fromB64(re['nonce'] as String),
      ),
      re['pass'],
    );
    final made = await keysFixed(
      vaultKey,
      fromB64(v['recoveryKeyBytes'] as String),
      v['passphrase'] as String,
      kdf,
      fromB64(v['salt'] as String),
      List.generate(24, (i) => (10 + i * 7) & 255),
      List.generate(24, (i) => (40 + i * 7) & 255),
    );
    expect(made.pass, keys.pass);
    expect(made.recovery, keys.recovery);
  });

  test('the recovery key text round-trips and is forgiving', () {
    expect(formatRecoveryKey(fromB64(v['recoveryKeyBytes'] as String)), v['recoveryKeyText']);
    expect(
      parseRecoveryKey((v['recoveryKeyText'] as String).toLowerCase().replaceAll('-', ' ')),
      fromB64(v['recoveryKeyBytes'] as String),
    );
    expect(() => parseRecoveryKey('short'), throwsA(isA<WrongRecoveryKey>()));
  });

  test('a passphrase typed in a different Unicode form opens the same vault (NFKC)', () async {
    // the vectors' passphrase contains "ünïcode" in composed form; open it with the decomposed form
    final decomposed = (v['passphrase'] as String).replaceAll('ü', 'u\u0308').replaceAll('ï', 'i\u0308');
    expect(decomposed, isNot(v['passphrase']));
    expect(await unlock(keys, decomposed), vaultKey);
  });

  const light = KdfParams(ops: 1, memKiB: 256);
  test('set up, unlock, refuse a wrong passphrase, recover, change — items untouched', () async {
    final made = await createVault('first', kdf: light);
    expect(await unlock(made.keys, 'first'), made.vaultKey);
    await expectLater(unlock(made.keys, 'First'), throwsA(isA<WrongPassphrase>()));
    final blob = await encryptItem(made.vaultKey, 'item-1', {'title': 'Card', 'number': '4111'});
    final reset = await resetPassphrase(made.keys, made.recoveryKey, 'second');
    expect(await unlock(reset.keys, 'second'), made.vaultKey);
    await expectLater(unlock(reset.keys, 'first'), throwsA(isA<WrongPassphrase>()));
    expect(await decryptItem(reset.vaultKey, 'item-1', blob), {'title': 'Card', 'number': '4111'});
    await expectLater(decryptItem(made.vaultKey, 'item-2', blob), throwsA(isA<BadVaultData>()));
    expect(made.keys.pass + made.keys.recovery, isNot(contains('first')));
  });

  test('generated passwords have every kind of character and differ each time', () {
    for (var i = 0; i < 20; i++) {
      final p = generatePassword(length: 24);
      expect(p, hasLength(24));
      expect(p, matches(RegExp('[a-z]')));
      expect(p, matches(RegExp('[A-Z]')));
      expect(p, matches(RegExp('[2-9]')));
      expect(p, matches(RegExp(r'[!@#$%^&*\-_=+?]')));
    }
    expect({for (var i = 0; i < 50; i++) generatePassword()}, hasLength(50));
  });
}
