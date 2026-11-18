import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:orvyn/vault/vault.dart';
import 'package:orvyn/vault/vault_crypto.dart';

import 'calendar_screen_test.dart' show seed, tapIt;
import 'support/fake_server.dart';
import 'support/harness.dart';

// The harness clock is Monday 16 Nov 2026, 09:30.
const _light = KdfParams(ops: 1, memKiB: 256);

Future<FakeSyncBackend> open(
  WidgetTester tester,
  AppHarness h,
  String module,
  void Function(FakeSyncBackend) seeds,
) async {
  final b = FakeSyncBackend()..attach(h.server);
  seeds(b);
  await h.pump(tester);
  // a tall phone, so the whole list is built
  tester.view.physicalSize = const Size(1080, 4800);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tapIt(tester, find.text(module).first);
  await settle(tester, 20);
  return b;
}

void main() {
  testWidgets('Library: search in plain words, what runs out, an amount to Money, and a note', (tester) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['library', 'money']));
    final b = await open(tester, h, 'Library', (b) {
      seed(b, 'library.doc', 'pan', {
        'title': 'PAN card',
        'category': 'Identity',
        'tags': ['pan'],
        'summary': 'Permanent Account Number',
        'status': 'ready',
      });
      seed(b, 'library.doc', 'ins', {
        'title': 'Star Health policy',
        'category': 'Insurance',
        'tags': ['health'],
        'summary': 'Family floater',
        'status': 'ready',
        'expiresOn': '2026-12-10',
        'keyDates': [
          {'label': 'Expires', 'date': '2026-12-10'},
        ],
        'amounts': [
          {'label': 'Premium due', 'amountMinor': 1850000, 'currency': 'INR'},
        ],
        'moneyState': 'suggested',
      });
    });
    expect(find.text('RUNNING OUT'), findsOneWidget);
    expect(find.text('Expires in 24 days'), findsWidgets);

    await tester.enterText(find.byKey(const Key('lib-search')), 'pan card');
    await settle(tester);
    expect(find.text('PAN card'), findsOneWidget);
    expect(find.text('Star Health policy'), findsNothing);
    await tester.enterText(find.byKey(const Key('lib-search')), 'health');
    await settle(tester);
    expect(find.text('Star Health policy'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('lib-search')), '');
    await settle(tester);

    // open the policy: the amount found becomes a transaction on a tap
    await tapIt(tester, find.text('Star Health policy').last);
    expect(find.textContaining('Premium due · ₹18,500'), findsOneWidget);
    await tapIt(tester, find.text('Add to Money'));
    expect(
      b.rows.values.where((r) => r['merchant'] == 'Star Health policy' && r['amountMinor'] == 1850000),
      hasLength(1),
    );
    expect(b.rows['library.doc/ins']!['moneyState'], 'added');
    await tapIt(tester, find.text('Save'));

    // a note is added for the server to read
    await tapIt(tester, find.byKey(const Key('lib-note')));
    await tester.enterText(find.byKey(const Key('note-title')), 'Renewal steps');
    await tester.enterText(find.byKey(const Key('note-text')), 'Carry the old passport');
    await tapIt(tester, find.text('Save note'));
    final note = b.rows.values.where((r) => r['kind'] == 'note').single;
    expect(note['status'], 'new');
    expect(note['text'], 'Carry the old passport');
    await finish(tester);
  });

  testWidgets(
    'Vault: set up with a recovery key, add a login, lock, wrong passphrase, unlock, recover — and the server never sees plaintext',
    (tester) async {
      final h = AppHarness()
        ..signedInAs(userJson(ent: ['vault']))
        ..extraOverrides.addAll([
          vaultKdfProvider.overrideWithValue(_light),
          vaultRunnerProvider.overrideWithValue(<T>(job) async => job()),
        ]);
      final b = await open(tester, h, 'Vault', (_) {});

      await tester.enterText(find.byKey(const Key('vault-pass')), 'correct horse battery staple');
      await tester.enterText(find.byKey(const Key('vault-pass2')), 'correct horse battery staple');
      await settle(tester);
      await tapIt(tester, find.text('Create my Vault'));
      final recovery = tester.widget<SelectableText>(find.byKey(const Key('recovery-key'))).data!;
      expect(recovery, matches(RegExp(r'^([0-9A-Z]{4}-){12}[0-9A-Z]{4}$')));
      // the key stays on screen until it is confirmed saved
      expect(find.text('Save your recovery key'), findsOneWidget);
      await tester.tap(find.byType(Switch));
      await settle(tester);
      await tapIt(tester, find.text('Open my Vault'));
      expect(
        find.text(
          'Your Vault is open and empty. Add a login, a card, an ID, an API key, recovery codes or a secure note.',
        ),
        findsOneWidget,
      );

      // a login, with a generated password
      await tapIt(tester, find.byKey(const Key('vault-new')));
      // the sheet's own fields (the page's search box sits behind it)
      final sheetFields = find.descendant(of: find.byType(BottomSheet), matching: find.byType(TextField));
      await tester.enterText(sheetFields.at(0), 'Bank of Example');
      await tester.enterText(sheetFields.at(1), 'me@example.test');
      await tapIt(tester, find.byTooltip('Generate a password'));
      await tapIt(tester, find.text('Save'));
      expect(find.text('Bank of Example'), findsOneWidget);

      // the server holds only ciphertext
      final sent = b.rows.values.map((r) => '$r').join('\n');
      for (final secret in ['Bank of Example', 'me@example.test', 'correct horse battery staple', recovery]) {
        expect(sent, isNot(contains(secret)));
      }
      expect(b.rows.keys.where((k) => k.startsWith('vault.item/')), hasLength(1));
      expect(b.rows.keys.where((k) => k.startsWith('vault.keys/')), hasLength(1));

      // open it: hidden until shown
      await tapIt(tester, find.text('Bank of Example'));
      expect(tester.widget<Text>(find.byKey(const Key('secret-Password'))).data, '••••••••••');
      await tapIt(tester, find.byTooltip('Show Password'));
      expect(tester.widget<Text>(find.byKey(const Key('secret-Password'))).data, hasLength(20));
      await tester.tapAt(const Offset(5, 5)); // close the sheet
      await settle(tester);

      // lock → a wrong passphrase is refused → the right one opens
      await tapIt(tester, find.text('Lock now'));
      expect(find.text('Vault is locked'), findsOneWidget);
      expect(find.text('Bank of Example'), findsNothing);
      await tester.enterText(find.byKey(const Key('vault-unlock')), 'wrong passphrase here');
      await settle(tester);
      await tapIt(tester, find.text('Unlock'));
      expect(find.text('That passphrase isn’t right.'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('vault-unlock')), 'correct horse battery staple');
      await settle(tester);
      await tapIt(tester, find.text('Unlock'));
      expect(find.text('Bank of Example'), findsOneWidget);

      // forgot the passphrase: the recovery key gets back in and sets a new one
      await tapIt(tester, find.text('Lock now'));
      await tapIt(tester, find.text('Forgot it? Use my recovery key'));
      await tester.enterText(find.widgetWithText(TextField, 'XXXX-XXXX-XXXX-…').first, recovery.toLowerCase());
      await tester.enterText(find.widgetWithText(TextField, 'At least 10 characters').first, 'a brand new passphrase');
      await settle(tester);
      await tapIt(tester, find.text('Open and set the passphrase'));
      expect(find.text('Bank of Example'), findsOneWidget);
      await tapIt(tester, find.text('Lock now'));
      await tester.enterText(find.byKey(const Key('vault-unlock')), 'a brand new passphrase');
      await settle(tester);
      await tapIt(tester, find.text('Unlock'));
      expect(find.text('Bank of Example'), findsOneWidget);
      await finish(tester);
    },
  );
}
