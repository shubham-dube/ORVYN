import { describe, expect, it } from 'vitest';
import { guess, luhn, parseTotp, siteName, strength, totpCode, totpLeft } from '../lib/vault-smart';

// RFC 6238 appendix B: the ASCII secret "12345678901234567890" (and its 32/64-byte versions)
const S1 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const S256 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA';
const S512 =
  'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA';

describe('one-time codes (RFC 6238, spec 0015 AC2)', () => {
  it('matches the RFC test vectors', async () => {
    const t = (secret: string, algorithm: 'SHA-1' | 'SHA-256' | 'SHA-512') => ({
      secret,
      digits: 8,
      period: 30,
      algorithm,
    });
    expect(await totpCode(t(S1, 'SHA-1'), 59_000)).toBe('94287082');
    expect(await totpCode(t(S1, 'SHA-1'), 1111111109_000)).toBe('07081804');
    expect(await totpCode(t(S1, 'SHA-1'), 20000000000_000)).toBe('65353130');
    expect(await totpCode(t(S256, 'SHA-256'), 59_000)).toBe('46119246');
    expect(await totpCode(t(S512, 'SHA-512'), 59_000)).toBe('90693936');
    expect(await totpCode({ ...t(S1, 'SHA-1'), digits: 6 }, 59_000)).toBe('287082');
    expect(totpLeft({ period: 30 }, 59_000)).toBe(1);
  });

  it('reads otpauth links and bare secrets', () => {
    expect(
      parseTotp('otpauth://totp/GitHub:asha%40example.test?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&digits=6'),
    ).toEqual({
      secret: 'JBSWY3DPEHPK3PXP',
      digits: 6,
      period: 30,
      algorithm: 'SHA-1',
      issuer: 'GitHub',
      account: 'asha@example.test',
    });
    expect(parseTotp('jbsw y3dp ehpk 3pxp')).toMatchObject({ digits: 6, period: 30 });
    expect(parseTotp('not a secret!')).toBeNull();
  });
});

describe('paste anything (spec 0015 A4)', () => {
  it('a card with expiry, CVV and name', () => {
    expect(luhn('4111111111111111')).toBe(true);
    expect(luhn('4111111111111112')).toBe(false);
    expect(guess('HDFC 4111 1111 1111 1111\nexp 08/29 cvv 123\nASHA RAO')).toEqual({
      kind: 'card',
      title: 'HDFC Visa',
      fields: { number: '4111 1111 1111 1111', expiry: '08/29', cvv: '123', holder: 'ASHA RAO' },
      notes: '',
      found: 'Visa card ending 1111',
    });
  });

  it('a login from an email and a password, or labels', () => {
    expect(guess('netflix asha@example.test Hunter2!x')).toMatchObject({
      kind: 'login',
      title: 'Netflix',
      fields: { username: 'asha@example.test', password: 'Hunter2!x' },
    });
    expect(guess('https://www.irctc.co.in\nusername: asha_r\npassword: Tr@in2024')).toMatchObject({
      kind: 'login',
      title: 'Irctc',
      fields: { username: 'asha_r', password: 'Tr@in2024', url: 'https://www.irctc.co.in' },
    });
    expect(siteName('https://accounts.google.com/signin')).toBe('Google');
  });

  it('API keys by their prefix', () => {
    expect(guess('ghp_' + 'a'.repeat(36))).toMatchObject({
      kind: 'apikey',
      title: 'GitHub key',
      fields: { service: 'GitHub' },
    });
    expect(guess('AKIAIOSFODNN7EXAMPLE')).toMatchObject({ kind: 'apikey', fields: { service: 'AWS' } });
    expect(guess('sk-ant-' + 'x'.repeat(30))).toMatchObject({ fields: { service: 'Anthropic' } });
  });

  it('recovery codes, otpauth links, and everything else as a note', () => {
    const codes = 'Google backup codes\n1234 5678\n2345 6789\n3456 7890\n4567 8901\n5678 9012\n6789 0123';
    expect(guess(codes)).toMatchObject({
      kind: 'recovery',
      title: 'Google recovery codes',
      found: '6 recovery codes',
    });
    expect(guess('otpauth://totp/Slack:me?secret=JBSWY3DPEHPK3PXP&issuer=Slack')).toMatchObject({
      kind: 'login',
      title: 'Slack',
      fields: { username: 'me' },
    });
    expect(guess('Locker combination is left 3 times')).toMatchObject({ kind: 'note' });
  });

  it('password strength', () => {
    expect(strength('password1').score).toBe(0);
    expect(strength('Tr0ub4dor&3xQ!zz9').score).toBeGreaterThanOrEqual(3);
  });
});
