import 'dart:async';
import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../app/state.dart';
import '../app/today.dart' show dayKey;
import '../money/money.dart';
import '../sync/sync_client.dart';

const libraryDocEntity = 'library.doc';

const libraryCategories = [
  'Identity',
  'Insurance',
  'Finance',
  'Tax',
  'Property',
  'Vehicle',
  'Health',
  'Education',
  'Work',
  'Travel',
  'Warranty',
  'Receipts',
  'Notes',
  'Other',
];

/// A document or note as the app reads it from the local mirror.
class DocItem {
  DocItem(this.id, this.data);
  final String id;
  final Map<String, dynamic> data;
  String get kind => (data['kind'] as String?) ?? 'file';
  String get title => (data['title'] as String?) ?? '';
  String get category => (data['category'] as String?) ?? 'Other';
  List<String> get tags => [for (final t in (data['tags'] as List?) ?? const []) t as String];
  String get summary => (data['summary'] as String?) ?? '';
  String get text => (data['text'] as String?) ?? '';
  String? get fileId => data['fileId'] as String?;
  String get fileName => (data['fileName'] as String?) ?? '';
  int get size => (data['size'] as num?)?.toInt() ?? 0;
  String get status => (data['status'] as String?) ?? 'ready';
  String? get problem => data['problem'] as String?;
  String? get expiresOn => data['expiresOn'] as String?;
  bool get remind => data['remind'] != false;
  String get moneyState => (data['moneyState'] as String?) ?? 'none';
  List<({String label, String date})> get keyDates => [
    for (final k in (data['keyDates'] as List?) ?? const [])
      (label: (k as Map)['label'] as String, date: k['date'] as String),
  ];
  List<({String label, int amountMinor, String currency})> get amounts => [
    for (final a in (data['amounts'] as List?) ?? const [])
      (
        label: (a as Map)['label'] as String,
        amountMinor: (a['amountMinor'] as num).toInt(),
        currency: (a['currency'] as String?) ?? 'INR',
      ),
  ];
  bool get working => status == 'new' || status == 'reading';
}

final docsProvider = StreamProvider<List<DocItem>>(
  (ref) => ref
      .watch(syncProvider)
      .watch(libraryDocEntity)
      .map((rows) => [for (final r in rows) DocItem(r.id, r.data)]..sort((a, b) => b.id.compareTo(a.id))),
);

String _norm(String s) => s.toLowerCase().replaceAll(RegExp('[̀-ͯ]'), '');

/// Plain-words search over what the person kept: every word must appear somewhere; where decides the order
/// (title, then tags and category, file name, summary, the document's own words). Same rules as @orvyn/library.
List<DocItem> searchDocs(List<DocItem> docs, String query) {
  final words = _norm(query).split(RegExp(r'[^\p{L}\p{N}]+', unicode: true)).where((w) => w.isNotEmpty).toList();
  if (words.isEmpty) return docs;
  final scored = <(DocItem, int)>[];
  for (final d in docs) {
    final title = _norm(d.title);
    final tags = _norm('${d.tags.join(' ')} ${d.category}');
    final file = _norm(d.fileName);
    final summary = _norm(d.summary);
    final text = _norm(d.text);
    var score = 0;
    var all = true;
    for (final w in words) {
      final s = title.contains(w)
          ? 100
          : tags.contains(w)
          ? 40
          : file.contains(w)
          ? 25
          : summary.contains(w)
          ? 10
          : text.contains(w)
          ? 3
          : 0;
      if (s == 0) {
        all = false;
        break;
      }
      score += s;
    }
    if (all) scored.add((d, score));
  }
  scored.sort((a, b) => a.$2 != b.$2 ? b.$2.compareTo(a.$2) : a.$1.title.compareTo(b.$1.title));
  return [for (final s in scored) s.$1];
}

enum Urgency { expired, soon, later, none }

/// How long until it runs out, from the person's today (YYYY-MM-DD). `soon` = within 30 days.
({int? days, Urgency urgency}) expiry(String? expiresOn, String today) {
  if (expiresOn == null) return (days: null, urgency: Urgency.none);
  final days = DateTime.parse('${expiresOn}T00:00:00Z').difference(DateTime.parse('${today}T00:00:00Z')).inDays;
  return (days: days, urgency: days < 0 ? Urgency.expired : (days <= 30 ? Urgency.soon : Urgency.later));
}

String expiryLabel(int? days) {
  if (days == null) return '';
  if (days == 0) return 'Expires today';
  if (days == 1) return 'Expires tomorrow';
  if (days == -1) return 'Expired yesterday';
  return days > 0 ? 'Expires in $days days' : 'Expired ${-days} days ago';
}

/// Documents that run out first (or already have).
List<DocItem> expiringSoon(List<DocItem> docs, String today, {int withinDays = 60}) =>
    docs.where((d) => d.expiresOn != null && expiry(d.expiresOn, today).days! <= withinDays).toList()
      ..sort((a, b) => a.expiresOn!.compareTo(b.expiresOn!));

String formatBytes(int n) => n < 1024
    ? '$n B'
    : n < 1024 * 1024
    ? '${(n / 1024).toStringAsFixed(n < 10240 ? 1 : 0)} KB'
    : '${(n / 1024 / 1024).toStringAsFixed(1)} MB';

final libraryActionsProvider = Provider<LibraryActions>((ref) => LibraryActions(ref.watch(syncProvider), ref));

class LibraryActions {
  LibraryActions(this.sync, this.ref);
  final SyncClient sync;
  final Ref ref;

  Future<String> addNote({String title = '', required String text}) => _then(
    sync.upsert(libraryDocEntity, {
      'kind': 'note',
      'title': title.trim(),
      'text': text,
      'category': 'Notes',
      'status': 'new',
      'source': 'android',
    }),
  );

  /// Uploads (encrypted at rest on the server) and adds it; needs a connection.
  Future<String> addFile(Uint8List bytes, {required String name, required String mime}) async {
    final api = ref.read(apiProvider);
    final f = await api.upload(bytes, name: name, mime: mime, purpose: 'library');
    return _then(
      sync.upsert(libraryDocEntity, {
        'kind': 'file',
        'fileId': f['id'],
        'fileName': name.length > 200 ? name.substring(0, 200) : name,
        'mime': mime,
        'size': bytes.length,
        'status': 'new',
        'source': 'android',
      }),
    );
  }

  /// A photo from the camera or the gallery.
  Future<String?> addPhoto({required bool camera}) async {
    final x = await ImagePicker().pickImage(
      source: camera ? ImageSource.camera : ImageSource.gallery,
      maxWidth: 2400,
      imageQuality: 85,
    );
    if (x == null) return null;
    return addFile(await x.readAsBytes(), name: x.name, mime: x.mimeType ?? 'image/jpeg');
  }

  Future<void> update(String id, Map<String, dynamic> fields) => _then(sync.upsert(libraryDocEntity, fields, id: id));
  Future<void> remove(String id) => _then(sync.remove(libraryDocEntity, id));
  Future<void> reread(String id) => update(id, {'status': 'new'});

  /// An amount the model found → a transaction (a tap on the person's side).
  Future<void> addToMoney(DocItem d, int index) async {
    final a = d.amounts[index];
    await ref.read(moneyActionsProvider).add({
      'amountMinor': a.amountMinor,
      'currency': a.currency,
      'direction': 'debit',
      'merchant': d.title,
      'note': a.label,
      'occurredAt': ref.read(clockProvider)().toUtc().toIso8601String(),
    });
    await update(d.id, {'moneyState': 'added'});
  }

  String today() => dayKey(ref.read(clockProvider)());

  Future<T> _then<T>(Future<T> f) async {
    final r = await f;
    unawaited(sync.sync().catchError((Object _) {}));
    return r;
  }
}
