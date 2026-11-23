import 'package:flutter_test/flutter_test.dart';
import 'package:orvyn/vault/smart.dart';

// RFC 6238 appendix B: the ASCII secret "12345678901234567890" and its 32/64-byte versions (same as the web's tests)
const s1 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const s256 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA';
const s512 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA';

DateTime at(int s) => DateTime.fromMillisecondsSinceEpoch(s * 1000, isUtc: true);

void main() {
  test('one-time codes match the RFC 6238 vectors (spec 0015 AC2)', () async {
    expect(await totpCode(const Totp(secret: s1, digits: 8), at: at(59)), '94287082');
    expect(await totpCode(const Totp(secret: s1, digits: 8), at: at(1111111109)), '07081804');
    expect(await totpCode(const Totp(secret: s1, digits: 8), at: at(20000000000)), '65353130');
    expect(
      await totpCode(
        const Totp(secret: s256, digits: 8, algorithm: 'SHA256'),
        at: at(59),
      ),
      '46119246',
    );
    expect(
      await totpCode(
        const Totp(secret: s512, digits: 8, algorithm: 'SHA512'),
        at: at(59),
      ),
      '90693936',
    );
    expect(await totpCode(const Totp(secret: s1), at: at(59)), '287082');
    expect(totpLeft(const Totp(secret: s1), at: at(59)), 1);
  });

  test('otpauth links and bare secrets', () {
    final t = parseTotp('otpauth://totp/GitHub:asha%40example.test?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&digits=6')!;
    expect([t.secret, t.issuer, t.account, t.digits], ['JBSWY3DPEHPK3PXP', 'GitHub', 'asha@example.test', 6]);
    expect(parseTotp('jbsw y3dp ehpk 3pxp'), isNotNull);
    expect(parseTotp('not a secret!'), isNull);
  });

  test('paste anything: a card, a login, keys, codes, notes (spec 0015 A4)', () {
    expect(luhn('4111111111111111'), isTrue);
    expect(luhn('4111111111111112'), isFalse);
    final card = guess('HDFC 4111 1111 1111 1111\nexp 08/29 cvv 123\nASHA RAO')!;
    expect(card.kind, 'card');
    expect(card.title, 'HDFC Visa');
    expect(card.fields, {'number': '4111 1111 1111 1111', 'expiry': '08/29', 'cvv': '123', 'holder': 'ASHA RAO'});
    expect(card.found, 'Visa card ending 1111');

    final login = guess('netflix asha@example.test Hunter2!x')!;
    expect(
      [login.kind, login.title, login.fields['username'], login.fields['password']],
      ['login', 'Netflix', 'asha@example.test', 'Hunter2!x'],
    );
    final labelled = guess('https://www.irctc.co.in\nusername: asha_r\npassword: Tr@in2024')!;
    expect(labelled.fields, {'username': 'asha_r', 'password': 'Tr@in2024', 'url': 'https://www.irctc.co.in'});
    expect(siteName('https://accounts.google.com/signin'), 'Google');

    expect(guess('ghp_${'a' * 36}')!.fields['service'], 'GitHub');
    expect(guess('AKIAIOSFODNN7EXAMPLE')!.fields['service'], 'AWS');
    expect(guess('sk-ant-${'x' * 30}')!.fields['service'], 'Anthropic');

    final codes = guess('Google backup codes\n1234 5678\n2345 6789\n3456 7890\n4567 8901\n5678 9012\n6789 0123')!;
    expect([codes.kind, codes.title, codes.found], ['recovery', 'Google recovery codes', '6 recovery codes']);
    final otp = guess('otpauth://totp/Slack:me?secret=JBSWY3DPEHPK3PXP&issuer=Slack')!;
    expect([otp.kind, otp.title, otp.fields['username']], ['login', 'Slack', 'me']);
    expect(guess('Locker combination is left 3 times')!.kind, 'note');
  });

  test('strength and the main secret', () {
    expect(strength('password1').score, 0);
    expect(strength('Tr0ub4dor&3xQ!zz9').score, greaterThanOrEqualTo(3));
    expect(primarySecret('card', {'number': '4111 1111'})?.value, '41111111');
    expect(primarySecret('login', {'username': 'x'}), isNull);
  });
}
