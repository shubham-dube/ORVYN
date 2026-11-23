import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:path_provider/path_provider.dart';
import 'package:uuid/uuid.dart';

import '../core/api.dart';
import '../core/session_store.dart';
import 'chat_crypto.dart' show DeviceKeys, b64, openKey;

typedef J = Map<String, dynamic>;

/// The phone side of Chat (spec 0015 C, ADR-0016). Messages live on the server, so every device shows the same
/// history. This phone keeps the last page of each chat and anything not sent yet in a small file, so a chat opens
/// at once and nothing typed is lost. A phone that once held end-to-end keys (ADR-0014) uses them only to carry its
/// old messages over. Same rules as the web's apps/web/lib/chat.ts.
class ChatClient {
  ChatClient(this.api, this.store, {ChatCache? cache}) : cache = cache ?? FileChatCache();
  final Api api;
  final SessionStore store;
  final ChatCache cache;
  final _bytes = <String, Future<Uint8List>>{};

  static String newId() => const Uuid().v7();

  /// Send a message (or a retry of one: the same id is the same message).
  Future<J> send(
    String conversationId,
    String id, {
    String text = '',
    String? replyTo,
    List<J> attachments = const [],
    J? share,
    String? forwardOf,
  }) async => Map<String, dynamic>.from(
    await api.post<Map<String, dynamic>>('/chat/conversations/$conversationId/messages', {
      'id': id,
      'text': text,
      'replyTo': replyTo,
      'attachments': attachments,
      'share': share,
      'forwardOf': forwardOf,
    }),
  );

  /// Upload a photo or file for a chat; it is stored encrypted at rest like any file (ADR-0011).
  Future<J> upload(Uint8List bytes, {required String name, required String mime, int? w, int? h}) async {
    final up = await api.upload(bytes, name: name, mime: mime, purpose: 'chat-file');
    return {'fileId': up['id'], 'name': name, 'mime': mime, 'size': bytes.length, 'w': ?w, 'h': ?h};
  }

  /// An attachment's bytes (fetched once while the app runs).
  Future<Uint8List> attachment(String conversationId, String fileId) {
    if (_bytes.length > 60) _bytes.remove(_bytes.keys.first);
    final k = '$conversationId/$fileId';
    final f = _bytes[k] ??= api.downloadPath('/chat/conversations/$conversationId/files/$fileId');
    f.catchError((Object _) {
      _bytes.remove(k);
      return Uint8List(0);
    });
    return f;
  }

  /// Hand the server the keys of old sealed messages this phone can open, so they become ordinary messages on every
  /// device (the server checks each sender's signature first). Returns how many came over.
  Future<int> carryOver(String deviceId, String conversationId, List<J> page) async {
    final sealed = page.where((m) => m['v'] == 1 && m['sealedForMe'] != null).toList();
    if (sealed.isEmpty) return 0;
    final stored = await store.read('orvyn.chat.$deviceId');
    if (stored == null) return 0;
    final keys = DeviceKeys.fromJson(jsonDecode(stored) as J);
    final items = <J>[];
    for (final m in sealed) {
      try {
        items.add({'id': m['id'], 'key': b64(await openKey(m['sealedForMe'] as String, keys.boxSecret))});
      } catch (_) {
        // not for this phone after all
      }
    }
    if (items.isEmpty) return 0;
    final r = await api.post<J>('/chat/conversations/$conversationId/carry', {'items': items});
    return (r['carried'] as num?)?.toInt() ?? 0;
  }
}

/// What a phone keeps of a chat between launches: the newest page and the unsent messages.
abstract interface class ChatCache {
  Future<({List<J> messages, List<J> outbox})?> read(String conversationId);
  Future<void> write(String conversationId, List<J> messages, List<J> outbox);
  Future<List<J>?> readList();
  Future<void> writeList(List<J> conversations);
}

/// In the app's private files (not backed up to the cloud with other apps' data).
class FileChatCache implements ChatCache {
  Future<Directory?> _dir() async {
    try {
      final d = Directory('${(await getApplicationSupportDirectory()).path}/chat');
      if (!d.existsSync()) d.createSync(recursive: true);
      return d;
    } catch (_) {
      return null; // tests, or no storage: no cache
    }
  }

  Future<File?> _file(String name) async {
    final d = await _dir();
    return d == null ? null : File('${d.path}/$name.json');
  }

  @override
  Future<({List<J> messages, List<J> outbox})?> read(String conversationId) async {
    try {
      final f = await _file(conversationId);
      if (f == null || !f.existsSync()) return null;
      final j = jsonDecode(await f.readAsString()) as J;
      return (
        messages: [for (final m in j['messages'] as List) Map<String, dynamic>.from(m as Map)],
        outbox: [for (final m in (j['outbox'] as List? ?? const [])) Map<String, dynamic>.from(m as Map)],
      );
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> write(String conversationId, List<J> messages, List<J> outbox) async {
    try {
      final f = await _file(conversationId);
      await f?.writeAsString(jsonEncode({'messages': messages, 'outbox': outbox}));
    } catch (_) {}
  }

  @override
  Future<List<J>?> readList() async {
    try {
      final f = await _file('_list');
      if (f == null || !f.existsSync()) return null;
      return [for (final c in jsonDecode(await f.readAsString()) as List) Map<String, dynamic>.from(c as Map)];
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> writeList(List<J> conversations) async {
    try {
      await (await _file('_list'))?.writeAsString(jsonEncode(conversations));
    } catch (_) {}
  }
}

/// For tests: nothing is kept.
class MemoryChatCache implements ChatCache {
  final threads = <String, ({List<J> messages, List<J> outbox})>{};
  List<J>? list;
  @override
  Future<({List<J> messages, List<J> outbox})?> read(String conversationId) async => threads[conversationId];
  @override
  Future<void> write(String conversationId, List<J> messages, List<J> outbox) async =>
      threads[conversationId] = (messages: messages, outbox: outbox);
  @override
  Future<List<J>?> readList() async => list;
  @override
  Future<void> writeList(List<J> conversations) async => list = conversations;
}

// ------------------------------------------------------------------ words

String personName(J m) => (m['name'] as String?)?.isNotEmpty == true
    ? m['name'] as String
    : (m['email'] as String? ?? 'someone').split('@').first;

String? attachmentLabel(List<dynamic> a) {
  if (a.isEmpty) return null;
  final mimes = [for (final x in a) (x as Map)['mime'] as String? ?? ''];
  final photos = mimes.where((m) => m.startsWith('image/')).length;
  if (photos == a.length) return photos == 1 ? '📷 Photo' : '📷 $photos photos';
  if (a.length == 1 && mimes.first.startsWith('audio/')) return '🎤 Voice message';
  if (a.length == 1 && mimes.first.startsWith('video/')) return '🎬 Video';
  return a.length == 1 ? '📎 ${(a.first as Map)['name']}' : '📎 ${a.length} files';
}

String lastSeen(String? iso, {DateTime? now}) {
  if (iso == null) return 'offline';
  final d = DateTime.parse(iso).toLocal();
  final n = now ?? DateTime.now();
  final mins = n.difference(d).inMinutes;
  String hm(DateTime x) => '${x.hour.toString().padLeft(2, '0')}:${x.minute.toString().padLeft(2, '0')}';
  if (mins < 1) return 'last seen just now';
  if (mins < 60) return 'last seen $mins min ago';
  final today = DateTime(n.year, n.month, n.day);
  final day = DateTime(d.year, d.month, d.day);
  if (day == today) return 'last seen today at ${hm(d)}';
  if (day == today.subtract(const Duration(days: 1))) return 'last seen yesterday at ${hm(d)}';
  return 'last seen ${d.day}/${d.month}';
}

String sizeLabel(int n) => n < 1024
    ? '$n B'
    : n < 1024 * 1024
    ? '${(n / 1024).round()} KB'
    : '${(n / 1024 / 1024).toStringAsFixed(1)} MB';
