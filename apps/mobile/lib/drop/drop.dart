import 'dart:async';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:speech_to_text/speech_to_text.dart';

import '../app/state.dart';
import '../app/today.dart';
import '../money/money.dart';
import '../sync/sync_client.dart';

const dropItem = 'drop.item';

class DropItemView {
  DropItemView(this.id, this.data);
  final String id;
  final Map<String, dynamic> data;
  String get kind => (data['kind'] as String?) ?? 'text';
  String get text => (data['text'] as String?) ?? '';
  String? get url => data['url'] as String?;
  String? get fileId => data['fileId'] as String?;
  String? get fileName => data['fileName'] as String?;
  String get status => (data['status'] as String?) ?? 'new';
  Map<String, dynamic>? get proposal => (data['proposal'] as Map?)?.cast<String, dynamic>();
  String? get problem => data['problem'] as String?;
  String? get resultRef => data['resultRef'] as String?;
  bool get open => !const {'done', 'kept', 'dismissed'}.contains(status);
  String get summary => [
    text,
    url,
    fileName,
  ].firstWhere((x) => x != null && x.isNotEmpty, orElse: () => (proposal?['title'] as String?) ?? 'Item')!;
}

final dropItemsProvider = StreamProvider<List<DropItemView>>(
  (ref) => ref
      .watch(syncProvider)
      .watch(dropItem)
      .map((rows) => [for (final r in rows) DropItemView(r.id, r.data)]..sort((a, b) => b.id.compareTo(a.id))),
);

final dropActionsProvider = Provider<DropActions>((ref) => DropActions(ref.watch(syncProvider), ref));

class DropActions {
  DropActions(this.sync, this.ref);
  final SyncClient sync;
  final Ref ref;
  static final _url = RegExp(r'^https?:\/\/\S+$', caseSensitive: false);

  Future<String> dropText(String text, {bool voice = false, String source = 'orb'}) {
    final t = text.trim();
    final link = _url.hasMatch(t);
    return _then(
      sync.upsert(dropItem, {
        'kind': link ? 'link' : (voice ? 'voice' : 'text'),
        'text': link ? '' : t,
        'url': link ? t : null,
        'source': source,
        'status': 'new',
      }),
    );
  }

  /// Uploads (encrypted at rest on the server) and drops it; needs a connection.
  Future<String> dropFile(
    Uint8List bytes, {
    required String name,
    required String mime,
    String caption = '',
    String source = 'orb',
  }) async {
    final f = await ref.read(apiProvider).upload(bytes, name: name, mime: mime);
    return _then(
      sync.upsert(dropItem, {
        'kind': mime.startsWith('image/') ? 'photo' : 'file',
        'fileId': f['id'],
        'fileName': f['name'],
        'text': caption,
        'source': source,
        'status': 'new',
      }),
    );
  }

  /// Creates what the (possibly changed) suggestion describes, then marks the item; a change is kept as a correction.
  Future<void> confirm(DropItemView item, Map<String, dynamic> p) async {
    String? ref0;
    switch (p['kind']) {
      case 'task':
        ref0 =
            '$todayTask:${await sync.upsert(todayTask, {'title': p['title'], 'notes': p['notes'] ?? '', 'dueDate': p['dueAt'] != null ? null : p['dueDate'], 'dueAt': p['dueAt'], 'durationMin': p['durationMin'], 'priority': p['priority'] ?? 0, 'source': 'drop'})}';
      case 'event':
        ref0 =
            'today.event:${await sync.upsert('today.event', {'title': p['title'], 'start': p['start'], 'end': p['end'], 'location': p['location'] ?? '', 'notes': p['notes'] ?? ''})}';
      case 'expense':
        final cats = [for (final r in await sync.watch(moneyCategory).first) CategoryItem(r.id, r.data)];
        final cat = cats.where((c) => c.name.toLowerCase() == '${p['category']}'.toLowerCase()).firstOrNull;
        ref0 =
            '$moneyTransaction:${await sync.upsert(moneyTransaction, {'amountMinor': ((p['amount'] as num) * 100).round(), 'currency': p['currency'] ?? 'INR', 'direction': p['direction'] ?? 'debit', 'merchant': p['merchant'] ?? '', 'categoryId': cat?.id, 'note': p['note'] ?? '', 'occurredAt': p['occurredAt'] ?? ref.read(clockProvider)().toUtc().toIso8601String(), 'source': item.kind == 'photo' ? 'receipt' : 'drop', 'receiptFileId': item.kind == 'photo' ? item.fileId : null, 'dropItemId': item.id})}';
    }
    final changed = _json(p) != _json(item.proposal ?? const {});
    await _then(
      sync.upsert(dropItem, {
        'status': p['kind'] == 'note' ? 'kept' : 'done',
        'resultRef': ref0,
        'correction': changed ? p : null,
      }, id: item.id),
    );
  }

  Future<void> keep(DropItemView i) => _then(sync.upsert(dropItem, {'status': 'kept'}, id: i.id));
  Future<void> dismiss(DropItemView i) => _then(sync.upsert(dropItem, {'status': 'dismissed'}, id: i.id));
  Future<void> retry(DropItemView i) => _then(sync.upsert(dropItem, {'status': 'new'}, id: i.id));

  static String _json(Map<String, dynamic> m) =>
      (m.entries.toList()..sort((a, b) => a.key.compareTo(b.key))).toString();

  Future<T> _then<T>(Future<T> f) async {
    final r = await f;
    unawaited(sync.sync().catchError((Object _) {}));
    return r;
  }
}

// ------------------------------------------------------------------ the device: photos, voice, the share sheet

typedef PickedFile = ({Uint8List bytes, String name, String mime});

/// A photo from the camera or the gallery (the system picker; no storage permission).
final photoPickerProvider = Provider<Future<PickedFile?> Function({required bool camera})>(
  (_) => ({required bool camera}) async {
    final x = await ImagePicker().pickImage(
      source: camera ? ImageSource.camera : ImageSource.gallery,
      maxWidth: 2000,
      imageQuality: 85,
    );
    if (x == null) return null;
    return (bytes: await x.readAsBytes(), name: x.name, mime: x.mimeType ?? 'image/jpeg');
  },
);

/// Speech turned into words on the phone (Android's recogniser); only the words are dropped (spec 0003).
abstract class Speech {
  Future<String?> listen();
}

class DeviceSpeech implements Speech {
  final _s = SpeechToText();
  @override
  Future<String?> listen() async {
    if (!await _s.initialize()) return null;
    final done = Completer<String?>();
    await _s.listen(
      onResult: (r) {
        if (r.finalResult && !done.isCompleted) done.complete(r.recognizedWords);
      },
      listenOptions: SpeechListenOptions(
        localeId: 'en_IN',
        partialResults: false,
        listenFor: const Duration(seconds: 30),
        pauseFor: const Duration(seconds: 3),
      ),
    );
    return done.future.timeout(const Duration(seconds: 35), onTimeout: () => null);
  }
}

final speechProvider = Provider<Speech>((_) => DeviceSpeech());

/// Something shared to ORVYN from another app (text, a link, an image).
class Shared {
  const Shared({this.text, this.path, this.mime, this.name});
  final String? text;
  final String? path;
  final String? mime;
  final String? name;
}

abstract class ShareChannel {
  Future<Shared?> take();
  Stream<void> get arrived;
}

class AndroidShareChannel implements ShareChannel {
  static const _ch = MethodChannel('orvyn/share');
  final _arrived = StreamController<void>.broadcast();
  AndroidShareChannel() {
    _ch.setMethodCallHandler((c) async {
      if (c.method == 'shared') _arrived.add(null);
    });
  }
  @override
  Stream<void> get arrived => _arrived.stream;
  @override
  Future<Shared?> take() async {
    try {
      final m = await _ch.invokeMapMethod<String, dynamic>('take');
      if (m == null) return null;
      return Shared(
        text: m['text'] as String?,
        path: m['path'] as String?,
        mime: m['mime'] as String?,
        name: m['name'] as String?,
      );
    } on MissingPluginException {
      return null;
    }
  }
}

final shareChannelProvider = Provider<ShareChannel>((_) => AndroidShareChannel());

/// A share becomes a Drop item (a shared image is uploaded first, then its temporary copy deleted).
Future<bool> dropShared(DropActions drop, Shared s) async {
  if (s.path != null) {
    final f = File(s.path!);
    try {
      await drop.dropFile(
        await f.readAsBytes(),
        name: s.name ?? 'shared',
        mime: s.mime ?? 'image/jpeg',
        caption: s.text ?? '',
        source: 'share',
      );
    } finally {
      if (await f.exists()) await f.delete();
    }
    return true;
  }
  if ((s.text ?? '').trim().isNotEmpty) {
    await drop.dropText(s.text!, source: 'share');
    return true;
  }
  return false;
}
