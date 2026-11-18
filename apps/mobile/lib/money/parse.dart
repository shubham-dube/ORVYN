import 'merchants.g.dart' as table;

/// Reading bank SMS and UPI/card app notifications on the phone (spec 0003 AC1, ADR-0012). The same rules as
/// packages/money/src/parse.ts, tested against the same fixtures (packages/money/fixtures/messages.json).
/// Raw messages never leave the phone: only the parsed transaction syncs (AC5).
class ParsedMessage {
  const ParsedMessage({
    required this.amountMinor,
    required this.direction,
    required this.rawMerchant,
    required this.merchant,
    required this.category,
    required this.last4,
    required this.refNo,
    required this.institution,
    required this.accountKind,
  });
  final int amountMinor;
  final String direction;
  final String rawMerchant;
  final String merchant;
  final String? category;
  final String? last4;
  final String? refNo;
  final String? institution;
  final String accountKind;

  Map<String, dynamic> toJson() => {
    'amountMinor': amountMinor,
    'direction': direction,
    'rawMerchant': rawMerchant,
    'merchant': merchant,
    'category': category,
    'last4': last4,
    'refNo': refNo,
    'institution': institution,
    'accountKind': accountKind,
  };

  /// What two sightings of one payment share (see findDuplicate).
  String? get dedupeKey => refNo == null ? null : 'ref:$refNo';
}

RegExp _i(String p) => RegExp(p, caseSensitive: false);

final _ignore = [
  _i(r'\bOTP\b|one[- ]time password|verification code|\bis your (?:code|password)\b'),
  _i(r'\bdeclined\b|\bhas failed\b|\bfailed\b|\bunsuccessful\b|\bwill be reversed\b'),
  _i(r'\brequested\b|\bcollect request\b|\bpayment request\b'),
  _i(r'^available balance|\bavl\.? bal(?:ance)? .*\bis\b'),
  _i(r'\bget up to\b|\bcashback offer\b|\bt&c apply\b|\bwon\b.*\bcashback\b|\bscratch\b'),
  _i(r'\bstatement\b.*\b(?:total|minimum) due\b|\bis due on\b|\bdue by\b'),
  _i(r'\bkyc\b'),
];

final _institutions = <(RegExp, String)>[
  (_i(r'\bhdfc\b'), 'HDFC'),
  (_i(r'\bicici\b'), 'ICICI'),
  (_i(r'\bsbi\b|state bank'), 'SBI'),
  (_i(r'\baxis\b'), 'Axis'),
  (_i(r'\bkotak\b'), 'Kotak'),
  (_i(r'\bamex\b|american express'), 'Amex'),
  (_i(r'\bidfc\b'), 'IDFC'),
  (_i(r'\byes bank\b'), 'Yes Bank'),
  (_i(r'\bindusind\b'), 'IndusInd'),
  (_i(r'\bau (?:small finance )?bank\b'), 'AU'),
  (_i(r'\brbl\b'), 'RBL'),
  (_i(r'\bfederal\b'), 'Federal'),
  (_i(r'\bbob\b|bank of baroda'), 'Bank of Baroda'),
  (_i(r'\bpnb\b|punjab national'), 'PNB'),
  (_i(r'\bcanara\b'), 'Canara'),
  (_i(r'\bunion bank\b'), 'Union Bank'),
];
const _apps = {'gpay': 'GPay', 'phonepe': 'PhonePe', 'paytm': 'Paytm'};

int _minor(String s) => (double.parse(s.replaceAll(',', '')) * 100).round();
const _amt = r'([\d,]+(?:\.\d{1,2})?)';
const _cur = r'(?:rs\.?|inr|₹)\s*';

int? _amountOf(String t) {
  final m = _i('$_cur$_amt').firstMatch(t) ?? _i(r'(?:debited|credited) by\s*(?:rs\.?|inr)?\s*' + _amt).firstMatch(t);
  if (m == null) return null;
  final v = _minor(m.group(1)!);
  return v > 0 ? v : null;
}

String? _directionOf(String t) {
  if (_i(
    r'\brefund\b|\breversal\b|\bcashback (?:of|credited)\b|\bpaid you\b|\breceived\b|\bdeposited\b|\bpayment of .* (?:has been )?received\b',
  ).hasMatch(t)) {
    return 'credit';
  }
  if (_i(
    r'\bdebited\b|\bspent\b|\bpaid\b|\bsent\b|\bwithdrawn\b|\bpurchase\b|\btransferred to\b|\btrf to\b|\bused for\b',
  ).hasMatch(t)) {
    return 'debit';
  }
  if (_i(r'\bcredited\b').hasMatch(t)) return 'credit';
  return null;
}

String? _last4Of(String t) {
  final m =
      _i(r'(?:a\/?c|acct|account|card)(?:\s*no\.?)?(?:\s*(?:ending|end))?[\s:]*(?:x+|\*+|\s)*\s*(\d{3,6})\b')
          .firstMatch(t) ??
      _i(r'\bending\s*(?:in\s*)?(\d{3,6})\b').firstMatch(t) ??
      _i(r'\b(?:x{2,}|\*{2,})\s*(\d{3,6})\b').firstMatch(t);
  return m?.group(1);
}

String? _refOf(String t) {
  final m =
      _i(r'UPI\/P2[AM]\/(\d{9,16})').firstMatch(t) ??
      _i(r'(?:upi(?:\s*ref(?:\s*no)?)?|ref(?:\s*no)?|refno|rrn|utr)[\s:.#-]*(\d{10,16})\b').firstMatch(t);
  return m?.group(1);
}

final _payee = <RegExp>[
  _i(r'UPI\/P2[AM]\/\d+\/(.+?)(?:\s+Not you\b|\s+Avl\b|$)'),
  _i(r'\bto VPA\s+([\w.-]+@[\w]+)'),
  _i(r'\bby A\/c linked to VPA\s+([\w.-]+@[\w]+)'),
  _i(r'\bNEFT Cr-[A-Z0-9]+-([^-]+?)-'),
  _i(r'\bRefund of .*?\bfrom\s+(.+?)\s+credited\b'),
  _i(r';\s*([^;.]+?)\s+credited\b'),
  _i(r'\btrf to\s+(.+?)\s+Ref'),
  _i(r'\bTransferred to\s+(?:Mr\.?|Ms\.?|Mrs\.?|Dr\.?)?\s*(.+?)\.\s'),
  _i(r'\bat\s+(ATM WDL .+?)\.(?:\s|$)'),
  RegExp(r'\bTo\s+(.+?)\s+On\s+\d'),
  _i(r'\d{2}:\d{2}:\d{2}\s+(.+?)\s+Avl\s+Lmt\b'),
  RegExp(r'\b(?:at|At)\s+(.+?)\s+(?:on|On)\s+\d'),
  _i(r'\bon\s+\d{1,2}-[A-Za-z]{3}-\d{2}\s+on\s+([^.]+)\.'),
  RegExp(r"\bat\s+([A-Z0-9][A-Z0-9 &.'*-]+?)(?:\s+on\b|\.|$)"),
  _i(r'^(.+?)\s+paid you\b'),
  _i(r'\b(?:paid|sent)\s+(?:rs\.?|inr|₹)?\s*[\d,.]+\s+to\s+(.+?)(?:\s+successfully)?\.?$'),
  _i(r'\b(?:paid|sent)\b.*?\bto\s+(.+?)(?:\s+successfully)?\.?$'),
  _i(r'\b(?:received|credited)\b.*?\bfrom\s+(.+?)(?:\.\s|\.$|\s+UPI\b|$)'),
  RegExp(r'\bfrom\s+([A-Z][A-Za-z .]+?)\.\s'),
];

String _payeeOf(String t) {
  for (final re in _payee) {
    final v = re.firstMatch(t)?.group(1)?.trim().replaceAll(RegExp(r'\s*[.,;]+$'), '');
    if (v != null && v.trim().isNotEmpty && !_i(r'^(?:your|a\/c|acct)\b').hasMatch(v)) return v;
  }
  return '';
}

String _titleCase(String s) => s
    .toLowerCase()
    .replaceAllMapped(RegExp(r"(^|[\s.&'-])([a-z])"), (m) => '${m.group(1)}${m.group(2)!.toUpperCase()}')
    .trim();

/// "spotify.upi@hdfcbank" → (Spotify, subscriptions); "PRIYA SHARMA" → (Priya Sharma, null).
({String merchant, String? category}) cleanMerchant(String raw) {
  var s = raw.trim();
  if (s.isEmpty) return (merchant: '', category: null);
  for (final (re, name, cat) in table.known) {
    if (re.hasMatch(s)) return (merchant: name, category: cat.isEmpty ? null : cat);
  }
  final vpa = RegExp(r'^([\w.-]+)@[\w]+$').firstMatch(s);
  if (vpa != null) {
    s = vpa
        .group(1)!
        .replaceAll(_i(r'[._-](?:upi|ok\w*|pay|razorpay|ybl|axl|ibl)$'), '')
        .replaceAll(RegExp(r'[._-]+'), ' ');
  }
  for (var i = 0; i < 3; i++) {
    for (final re in table.noise) {
      s = s.replaceAll(re, '').trim();
    }
  }
  s = s.replaceAll(RegExp(r'\s{2,}'), ' ').replaceAll(RegExp(r'[*#]+'), ' ').trim();
  return (merchant: _titleCase(s), category: null);
}

/// A transaction from one message, or null when it isn't one (OTPs, offers, declines, reminders…).
ParsedMessage? parseMessage({required String source, String? app, String? title, required String text}) {
  final t = text.replaceAll(RegExp(r'\s+'), ' ').trim();
  if (t.isEmpty || _ignore.any((re) => re.hasMatch(t)) || _ignore.any((re) => re.hasMatch(title ?? ''))) return null;
  final amount = _amountOf(t);
  final direction = _directionOf(t);
  if (amount == null || direction == null) return null;
  final fromApp = source == 'notification' ? app : null;
  final isCard = fromApp == null && _i(r'\bcard\b').hasMatch(t);
  String? institution = fromApp != null ? _apps[fromApp] : null;
  if (fromApp == null) {
    for (final (re, name) in _institutions) {
      if (re.hasMatch(t)) {
        institution = name;
        break;
      }
    }
  }
  final raw = _payeeOf(t);
  var (:merchant, :category) = cleanMerchant(raw);
  if (_i(r'\brefund\b').hasMatch(t)) {
    category = 'refunds';
  } else if (direction == 'credit' && _i(r'\bsalary\b').hasMatch(t)) {
    category = 'salary';
  }
  if (raw.isEmpty && _i(r'\bcredit card\b').hasMatch(t) && _i(r'\bpayment of\b').hasMatch(t)) {
    merchant = 'Card bill payment';
  }
  if (direction == 'credit' && category != null && category != 'refunds' && category != 'salary') category = null;
  return ParsedMessage(
    amountMinor: amount,
    direction: direction,
    rawMerchant: raw,
    merchant: merchant,
    category: category,
    last4: fromApp != null ? null : _last4Of(t),
    refNo: _refOf(t),
    institution: institution,
    accountKind: fromApp != null ? 'upi' : (isCard ? 'card' : 'bank'),
  );
}

/// A transaction already recorded, as findDuplicate needs it.
class Sighting {
  const Sighting({
    this.id,
    required this.amountMinor,
    required this.direction,
    required this.occurredAt,
    required this.dedupeKey,
    required this.source,
  });
  final String? id;
  final int amountMinor;
  final String direction;
  final DateTime occurredAt;
  final String? dedupeKey;
  final String source;
}

/// Same rules as findDuplicate in TypeScript: the same key, or the same amount and direction within 10 minutes
/// from a different kind of source (bank SMS vs app notification) — unless both carry different references.
Sighting? findDuplicate(Sighting c, Iterable<Sighting> existing) {
  if (c.dedupeKey != null) {
    for (final e in existing) {
      if (e.dedupeKey == c.dedupeKey) return e;
    }
  }
  final window = c.source == 'statement' ? const Duration(hours: 36) : const Duration(minutes: 10);
  for (final e in existing) {
    if (e.amountMinor == c.amountMinor &&
        e.direction == c.direction &&
        e.source != c.source &&
        e.occurredAt.difference(c.occurredAt).abs() <= window &&
        !(c.dedupeKey != null && e.dedupeKey != null && c.dedupeKey != e.dedupeKey)) {
      return e;
    }
  }
  return null;
}
