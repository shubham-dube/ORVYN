import 'dart:math' as math;
import 'dart:typed_data';

import 'package:cryptography/cryptography.dart';

/// Vault helpers that run only on this phone (spec 0015 A, D-0015-6): live one-time codes (RFC 6238) and "paste
/// anything" — recognising a card, a login, an API key, recovery codes or an otpauth link by their patterns. Nothing
/// here leaves the phone or reaches the AI. Same rules as the web's lib/vault-smart.ts.

// ------------------------------------------------------------------ one-time codes

const _b32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

Uint8List base32(String s) {
  final clean = s.toUpperCase().replaceAll(RegExp(r'[\s=-]'), '');
  final out = <int>[];
  var bits = 0;
  var value = 0;
  for (final c in clean.split('')) {
    final i = _b32.indexOf(c);
    if (i < 0) throw const FormatException('not base32');
    value = ((value << 5) | i) & 0xffffffff;
    bits += 5;
    if (bits >= 8) {
      out.add((value >> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8List.fromList(out);
}

class Totp {
  const Totp({
    required this.secret,
    this.digits = 6,
    this.period = 30,
    this.algorithm = 'SHA1',
    this.issuer,
    this.account,
  });
  final String secret;
  final int digits;
  final int period;

  /// SHA1, SHA256 or SHA512
  final String algorithm;
  final String? issuer;
  final String? account;
}

/// A secret as people paste it: a bare base32 secret or a whole otpauth:// link.
Totp? parseTotp(String input) {
  final s = input.trim();
  if (s.isEmpty) return null;
  if (RegExp(r'^otpauth://totp/', caseSensitive: false).hasMatch(s)) {
    try {
      final u = Uri.parse(s);
      final secret = u.queryParameters['secret'] ?? '';
      base32(secret);
      final label = Uri.decodeComponent(u.path.replaceFirst(RegExp(r'^/+'), ''));
      final i = label.indexOf(':');
      final a = i >= 0 ? label.substring(0, i).trim() : null;
      final b = i >= 0 ? label.substring(i + 1).trim() : label.trim();
      final alg = (u.queryParameters['algorithm'] ?? 'SHA1').toUpperCase();
      return Totp(
        secret: secret,
        digits: int.tryParse(u.queryParameters['digits'] ?? '') ?? 6,
        period: int.tryParse(u.queryParameters['period'] ?? '') ?? 30,
        algorithm: alg == 'SHA256' || alg == 'SHA512' ? alg : 'SHA1',
        issuer: u.queryParameters['issuer'] ?? a,
        account: b.isEmpty ? null : b,
      );
    } catch (_) {
      return null;
    }
  }
  try {
    if (base32(s).length < 10) return null;
  } catch (_) {
    return null;
  }
  return Totp(secret: s);
}

/// The code for a moment (RFC 6238 / RFC 4226 dynamic truncation).
Future<String> totpCode(Totp t, {DateTime? at}) async {
  final ms = (at ?? DateTime.now()).millisecondsSinceEpoch;
  var counter = ms ~/ 1000 ~/ t.period;
  final msg = Uint8List(8);
  for (var i = 7; i >= 0; i--) {
    msg[i] = counter & 0xff;
    counter = counter >> 8;
  }
  final hmac = switch (t.algorithm) {
    'SHA256' => Hmac.sha256(),
    'SHA512' => Hmac.sha512(),
    _ => Hmac.sha1(),
  };
  final mac = await hmac.calculateMac(msg, secretKey: SecretKey(base32(t.secret)));
  final h = mac.bytes;
  final o = h.last & 0x0f;
  final bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return (bin % math.pow(10, t.digits).toInt()).toString().padLeft(t.digits, '0');
}

/// Seconds left on the current code.
int totpLeft(Totp t, {DateTime? at}) => t.period - ((at ?? DateTime.now()).millisecondsSinceEpoch ~/ 1000) % t.period;

// ------------------------------------------------------------------ paste anything

class Guess {
  const Guess({required this.kind, required this.title, required this.fields, required this.found});
  final String kind;
  final String title;
  final Map<String, String> fields;

  /// what was recognised, in words ("Visa card ending 4242")
  final String found;
}

bool luhn(String digits) {
  var sum = 0;
  var alt = false;
  for (var i = digits.length - 1; i >= 0; i--) {
    var n = digits.codeUnitAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return digits.length >= 13 && sum % 10 == 0;
}

String cardBrand(String n) {
  if (n.startsWith('4')) return 'Visa';
  if (RegExp(r'^(5[1-5]|2[2-7])').hasMatch(n)) return 'Mastercard';
  if (RegExp(r'^3[47]').hasMatch(n)) return 'Amex';
  if (RegExp(r'^(60|65|81|82|508|353|356)').hasMatch(n)) return 'RuPay';
  if (RegExp(r'^(36|30|38)').hasMatch(n)) return 'Diners';
  return 'Card';
}

final _keys = <(RegExp, String)>[
  (RegExp(r'\bsk-ant-[A-Za-z0-9_-]{20,}'), 'Anthropic'),
  (RegExp(r'\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}'), 'OpenAI'),
  (RegExp(r'\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}'), 'Stripe'),
  (RegExp(r'\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{40,}'), 'GitHub'),
  (RegExp(r'\bglpat-[A-Za-z0-9_-]{20,}'), 'GitLab'),
  (RegExp(r'\bAKIA[0-9A-Z]{16}\b'), 'AWS'),
  (RegExp(r'\bxox[bpas]-[A-Za-z0-9-]{10,}'), 'Slack'),
  (RegExp(r'\bAIza[0-9A-Za-z_-]{35}\b'), 'Google'),
  (RegExp(r'\brzp_(?:live|test)_[A-Za-z0-9]{10,}'), 'Razorpay'),
];

final _email = RegExp(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}');
final _url = RegExp(
  r'\b(?:https?://)?(?:[a-z0-9-]+\.)+(?:com|in|org|net|io|app|dev|co|ai|me|gov|edu|xyz)(?:/\S*)?',
  caseSensitive: false,
);

/// "netflix.com" → "Netflix"; "https://accounts.google.com/x" → "Google".
String siteName(String url) {
  final host = url
      .replaceFirst(RegExp(r'^https?://', caseSensitive: false), '')
      .split(RegExp(r'[/?#]'))
      .first
      .toLowerCase();
  final parts = host
      .split('.')
      .where((p) => p.isNotEmpty && !['www', 'accounts', 'login', 'app', 'my', 'secure', 'auth'].contains(p))
      .toList();
  if (parts.isEmpty) return '';
  final main = parts.length > 2 && ['co', 'com', 'gov', 'org', 'net'].contains(parts[parts.length - 2])
      ? parts[parts.length - 3]
      : parts.length >= 2
      ? parts[parts.length - 2]
      : parts.first;
  return main.isEmpty ? '' : '${main[0].toUpperCase()}${main.substring(1)}';
}

String? _label(String text, String names) =>
    RegExp('(?:^|\\n|\\s)(?:$names)\\s*[:=-]\\s*(\\S[^\\n]*)', caseSensitive: false).firstMatch(text)?.group(1)?.trim();

/// Understands what was pasted, on this phone only.
Guess? guess(String input) {
  final text = input.trim();
  if (text.isEmpty) return null;

  // a one-time code link
  final link = RegExp(r'otpauth://totp/\S+', caseSensitive: false).firstMatch(text)?.group(0);
  if (link != null) {
    final t = parseTotp(link);
    if (t != null) {
      return Guess(
        kind: 'login',
        title: t.issuer ?? 'Login',
        fields: {'totp': link, if (t.account != null) 'username': t.account!},
        found: 'One-time codes${t.issuer != null ? ' for ${t.issuer}' : ''}',
      );
    }
  }

  // a card: a number that passes Luhn
  for (final m in RegExp(r'\b(?:\d[ -]?){13,19}\b').allMatches(text)) {
    final digits = m.group(0)!.replaceAll(RegExp(r'\D'), '');
    if (!luhn(digits)) continue;
    final rest = text.replaceFirst(m.group(0)!, ' ');
    final exp = RegExp(r'\b(0[1-9]|1[0-2])\s*/\s*(\d{4}|\d{2})\b').firstMatch(rest);
    final afterExp = exp == null ? rest : rest.replaceFirst(exp.group(0)!, ' ');
    final cvv =
        RegExp(
          r'(?:cvv|cvc|cvv2|security code)\W{0,3}(\d{3,4})\b',
          caseSensitive: false,
        ).firstMatch(afterExp)?.group(1) ??
        RegExp(r'(?:^|\s)(\d{3,4})(?:\s|$)').firstMatch(afterExp)?.group(1);
    final pin = RegExp(r'\bpin\W{0,3}(\d{4,6})\b', caseSensitive: false).firstMatch(afterExp)?.group(1);
    final holder = afterExp
        .split(RegExp(r'\n|,'))
        .map((l) => l.replaceAll(RegExp(r'(?:name|card ?holder)\s*[:=-]?', caseSensitive: false), '').trim())
        .where(
          (l) =>
              RegExp(r"^[A-Za-z][A-Za-z .']{2,40}$").hasMatch(l) &&
              l.contains(' ') &&
              !RegExp(r'cvv|cvc|exp|valid|pin', caseSensitive: false).hasMatch(l),
        )
        .firstOrNull;
    final brand = cardBrand(digits);
    final bank = RegExp(
      r'\b(HDFC|ICICI|SBI|Axis|Kotak|IDFC|Yes Bank|AU|IndusInd|RBL|HSBC|Citi|Amex|OneCard|Federal)\b',
      caseSensitive: false,
    ).firstMatch(text)?.group(1);
    return Guess(
      kind: 'card',
      title: [?bank, brand].join(' '),
      fields: {
        'number': digits.replaceAllMapped(RegExp(r'(\d{4})(?=\d)'), (x) => '${x.group(1)} '),
        if (exp != null) 'expiry': '${exp.group(1)}/${exp.group(2)!.substring(exp.group(2)!.length - 2)}',
        if (cvv != null && cvv != pin) 'cvv': cvv,
        'pin': ?pin,
        if (holder != null) 'holder': holder.toUpperCase(),
      },
      found: '$brand card ending ${digits.substring(digits.length - 4)}',
    );
  }

  // an API key
  for (final (re, service) in _keys) {
    final k = re.firstMatch(text)?.group(0);
    if (k == null) continue;
    final url = _url.firstMatch(text.replaceFirst(k, ' '))?.group(0);
    return Guess(
      kind: 'apikey',
      title: '$service key',
      fields: {'service': service, 'key': k, 'url': ?url},
      found: '$service API key',
    );
  }

  // recovery codes: five or more code-shaped lines (or words)
  final tokens = text.split(RegExp(r'[\n,;]+|\s{2,}')).map((x) => x.trim()).where((x) => x.isNotEmpty).toList();
  final codeLike = [
    for (final t in tokens)
      if (RegExp(r'^(?:\d+[.)]\s*)?[A-Za-z0-9]{4,10}(?:[- ][A-Za-z0-9]{4,10}){0,3}$').hasMatch(t) &&
          RegExp(r'\d').hasMatch(t))
        t,
  ];
  if (codeLike.length >= 5 && codeLike.length >= tokens.length - 2) {
    final service = tokens
        .where((t) => !codeLike.contains(t) && RegExp('[A-Za-z]{3,}').hasMatch(t))
        .firstOrNull
        ?.replaceAll(RegExp(r'recovery|backup|codes?|:', caseSensitive: false), '')
        .trim();
    final named = service != null && service.isNotEmpty;
    return Guess(
      kind: 'recovery',
      title: named ? '$service recovery codes' : 'Recovery codes',
      fields: {
        'codes': codeLike.map((c) => c.replaceFirst(RegExp(r'^\d+[.)]\s*'), '')).join('\n'),
        if (named) 'service': service,
      },
      found: '${codeLike.length} recovery codes',
    );
  }

  // a login: an email or a labelled username, and a password
  final email = _email.firstMatch(text)?.group(0);
  final user = _label(text, 'username|user|login|id|user id|email') ?? email;
  final labelledPass = _label(text, 'password|pass|pwd|pw|passcode');
  final url = _url.firstMatch(email == null ? text : text.replaceFirst(email, ' '))?.group(0);
  if (user != null || labelledPass != null) {
    var password = labelledPass;
    var title = url != null ? siteName(url) : '';
    if (password == null || title.isEmpty) {
      final left = text
          .replaceAll(
            RegExp(
              r'(?:username|user|login|password|pass|pwd|pw|passcode|email|site|website|url)\s*[:=-]',
              caseSensitive: false,
            ),
            ' ',
          )
          .split(RegExp(r'\s+'))
          .where((w) => w.isNotEmpty && w != user && w != email && w != url && w != labelledPass)
          .toList();
      if (title.isEmpty && left.length > 1 && RegExp(r'^[A-Za-z][A-Za-z0-9 .&-]{1,30}$').hasMatch(left.first)) {
        title = left.removeAt(0);
      }
      if (password == null && left.isNotEmpty) password = left.last;
    }
    if (title.isEmpty && email != null) title = siteName(email.split('@')[1]);
    title = title.isEmpty ? 'Login' : '${title[0].toUpperCase()}${title.substring(1)}';
    return Guess(
      kind: 'login',
      title: title,
      fields: {
        'username': ?user,
        'password': ?password,
        if (url != null) 'url': url.startsWith(RegExp('https?:')) ? url : 'https://$url',
      },
      found: password != null ? 'Login for $title' : 'Account for $title',
    );
  }

  // anything else: a secure note
  final first = text.split('\n').first;
  return Guess(
    kind: 'note',
    title: first.length > 40 ? first.substring(0, 40) : first,
    fields: {'text': text},
    found: 'A secure note',
  );
}

/// How strong a password looks (0–4), and in words.
({int score, String label}) strength(String p) {
  if (p.isEmpty) return (score: 0, label: '');
  var pool = 0;
  if (RegExp('[a-z]').hasMatch(p)) pool += 26;
  if (RegExp('[A-Z]').hasMatch(p)) pool += 26;
  if (RegExp(r'\d').hasMatch(p)) pool += 10;
  if (RegExp('[^A-Za-z0-9]').hasMatch(p)) pool += 32;
  final bits = p.length * (math.log(math.max(pool, 1)) / math.ln2);
  final common = RegExp(r'^(password|123456|qwerty|letmein|welcome|admin|iloveyou)', caseSensitive: false).hasMatch(p);
  final score = common ? 0 : (bits < 36 ? 1 : (bits < 60 ? 2 : (bits < 90 ? 3 : 4)));
  return (score: score, label: const ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'][score]);
}

/// The main secret of an item, for one-tap copy from the list.
({String label, String value})? primarySecret(String kind, Map<String, String> f) {
  ({String label, String value})? pick(String k, String label) =>
      (f[k] ?? '').isEmpty ? null : (label: label, value: f[k]!);
  return switch (kind) {
    'login' => pick('password', 'Password'),
    'card' => (f['number'] ?? '').isEmpty ? null : (label: 'Card number', value: f['number']!.replaceAll(' ', '')),
    'apikey' => pick('key', 'Key'),
    'recovery' => pick('codes', 'Codes'),
    'id' => pick('number', 'Number'),
    _ => pick('text', 'Note'),
  };
}
