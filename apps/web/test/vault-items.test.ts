import { describe, expect, it } from 'vitest';
import { loginsFromCsv, parseCsvRows, subtitle } from '../lib/vault-items';

describe('vault items and CSV import', () => {
  it('reads quotes, commas and newlines inside quotes', () => {
    expect(parseCsvRows('a,b\n"x, y","line1\nline2"\n"he said ""hi""",z\r\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'line1\nline2'],
      ['he said "hi"', 'z'],
    ]);
  });
  it('imports a Chrome export', () => {
    const csv =
      'name,url,username,password,note\nGitHub,https://github.com/login,me@x.test,s3cret,work\n,https://mail.example.test/,me,pw2,\n,,,,\n';
    const r = loginsFromCsv(csv);
    expect(r.items.map((i) => [i.title, i.fields.username, i.fields.password, i.notes])).toEqual([
      ['GitHub', 'me@x.test', 's3cret', 'work'],
      ['mail.example.test', 'me', 'pw2', ''],
    ]);
  });
  it('imports a Bitwarden export, skipping what is not a login', () => {
    const csv =
      'folder,favorite,type,name,notes,fields,reminder,login_uri,login_username,login_password,login_totp\n,,login,Bank,,,,https://bank.test,me,pw,\n,,note,A note,hello,,,,,,\n';
    const r = loginsFromCsv(csv);
    expect(r.items).toHaveLength(1);
    expect(r.skipped).toBe(1);
    expect(r.items[0]!.fields).toMatchObject({ username: 'me', password: 'pw', url: 'https://bank.test' });
  });
  it('shows a card by its last digits only', () => {
    expect(
      subtitle({
        kind: 'card',
        title: 'HDFC',
        fields: { number: '4111 1111 1111 1234' },
        notes: '',
        updatedAt: '',
      }),
    ).toBe('•••• 1234');
  });
});
