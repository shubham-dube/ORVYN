import 'dart:convert';
import 'dart:typed_data';

import '../core/api.dart';
import '../core/session_store.dart';
import 'chat_crypto.dart';

/// The phone side of Chat (spec 0011, ADR-0014): this device's keys live in secure storage and never leave it;
/// every message is encrypted here for every device of every member, and decrypted here. Same rules as the web's
/// apps/web/lib/chat.ts.
class ChatClient {
  ChatClient(this.api, this.store);
  final Api api;
  final SessionStore store;
  DeviceKeys? _keys;
  String? _for;
  static int _seq = 0;

  /// This device's keys: made once, kept on the phone, public halves registered with the server.
  Future<DeviceKeys> keys(String deviceId) async {
    if (_keys != null && _for == deviceId) return _keys!;
    final stored = await store.read('orvyn.chat.$deviceId');
    final k = stored != null ? DeviceKeys.fromJson(jsonDecode(stored) as Map<String, dynamic>) : await newDeviceKeys();
    if (stored == null) await store.write('orvyn.chat.$deviceId', jsonEncode(k.toJson()));
    await api.put<dynamic>('/chat/devices', {'boxPublic': k.boxPublic, 'signPublic': k.signPublic});
    _keys = k;
    _for = deviceId;
    return k;
  }

  Future<List<Map<String, dynamic>>> memberKeys(Iterable<String> userIds) async {
    final ids = userIds.toSet().toList()..sort();
    if (ids.isEmpty) return const [];
    final r = await api.get<List<dynamic>>('/chat/keys', query: {'userIds': ids.join(',')});
    return [for (final x in r) Map<String, dynamic>.from(x as Map)];
  }

  /// A time-ordered id (UUIDv7) made on the phone, so the signature covers it.
  static String newId() {
    final ms = DateTime.now().millisecondsSinceEpoch;
    final r = newDeviceRandom(10);
    final b = Uint8List(16);
    for (var i = 0; i < 6; i++) {
      b[i] = (ms >> (8 * (5 - i))) & 0xff;
    }
    b[6] = 0x70 | (r[0] & 0x0f);
    b[7] = r[1] ^ (_seq++ & 0xff);
    b[8] = 0x80 | (r[2] & 0x3f);
    for (var i = 9; i < 16; i++) {
      b[i] = r[i - 6];
    }
    final h = b.map((x) => x.toRadixString(16).padLeft(2, '0')).join();
    return '${h.substring(0, 8)}-${h.substring(8, 12)}-${h.substring(12, 16)}-${h.substring(16, 20)}-${h.substring(20)}';
  }

  Future<String> send(
    String deviceId,
    String conversationId,
    List<String> memberIds,
    Map<String, dynamic> payload, {
    List<String> files = const [],
  }) async {
    final me = await keys(deviceId);
    final devices = (await memberKeys(memberIds)).where((d) => d['active'] == true).toList();
    final id = newId();
    final sealed = await encryptMessage(
      payload,
      conversationId: conversationId,
      messageId: id,
      deviceId: deviceId,
      signSecret: me.signSecret,
      recipients: [for (final d in devices) Recipient(d['deviceId'] as String, d['boxPublic'] as String)],
    );
    await api.post<dynamic>('/chat/conversations/$conversationId/messages', {
      'id': id,
      ...sealed.toJson(),
      'files': files,
    });
    return id;
  }

  /// Encrypt a file on the phone, upload the opaque bytes, send the key inside the message.
  Future<String> sendFile(
    String deviceId,
    String conversationId,
    List<String> memberIds,
    List<int> bytes, {
    required String name,
    required String mime,
  }) async {
    final enc = await encryptFile(bytes);
    final up = await api.upload(enc.bytes, name: 'encrypted.bin', mime: 'application/octet-stream', purpose: 'chat');
    return send(
      deviceId,
      conversationId,
      memberIds,
      {
        't': 'file',
        'fileId': up['id'],
        'key': enc.key,
        'nonce': enc.nonce,
        'name': name,
        'mime': mime,
        'size': bytes.length,
      },
      files: [up['id'] as String],
    );
  }

  Future<Uint8List> openFile(String conversationId, Map<String, dynamic> p) async {
    final raw = await api.downloadPath('/chat/conversations/$conversationId/files/${p['fileId']}');
    return decryptFile(raw, p['key'] as String, p['nonce'] as String);
  }

  /// Decrypt a page (newest first from the server) into lines, oldest first, with reactions and edits folded in.
  Future<List<ChatLine>> read(String deviceId, List<Map<String, dynamic>> page) async {
    final me = await keys(deviceId);
    final signers = {
      for (final d in await memberKeys(page.map((m) => m['senderId'] as String)))
        d['deviceId'] as String: d['signPublic'] as String,
    };
    final lines = <ChatLine>[];
    final reacts = <({String target, String by, String? emoji})>[];
    final edits = <({String target, String by, String text})>[];
    for (final m in page.reversed) {
      final line = ChatLine(id: m['id'] as String, senderId: m['senderId'] as String, at: m['createdAt'] as String);
      if (m['kind'] == 'system') {
        lines.add(
          line
            ..kind = 'system'
            ..text = m['text'] as String?,
        );
        continue;
      }
      if (m['deletedAt'] != null) {
        lines.add(line..kind = 'deleted');
        continue;
      }
      try {
        final sign = signers[m['senderDeviceId']];
        if (m['sealedForMe'] == null || sign == null) throw BadChatData('not for this device');
        final p = Map<String, dynamic>.from(
          await decryptMessage(
            conversationId: m['conversationId'] as String,
            id: m['id'] as String,
            senderDeviceId: m['senderDeviceId'] as String,
            ciphertext: m['ciphertext'] as String,
            nonce: m['nonce'] as String,
            signature: m['signature'] as String,
            sealedForMe: m['sealedForMe'] as String,
            myBoxSecret: me.boxSecret,
            senderSignPublic: sign,
          ) as Map,
        );
        switch (p['t']) {
          case 'react':
            reacts.add((target: p['target'] as String, by: line.senderId, emoji: p['emoji'] as String?));
          case 'edit':
            edits.add((target: p['target'] as String, by: line.senderId, text: p['text'] as String));
          default:
            lines.add(line..payload = p);
        }
      } catch (_) {
        lines.add(line..kind = 'unreadable');
      }
    }
    final byId = {for (final l in lines) l.id: l};
    for (final e in edits) {
      final l = byId[e.target];
      if (l?.payload?['t'] == 'text' && l!.senderId == e.by) {
        l.payload = {...l.payload!, 'text': e.text};
        l.edited = true;
      }
    }
    final latest = <String, String?>{};
    for (final r in reacts) {
      latest['${r.target}|${r.by}'] = r.emoji;
    }
    latest.forEach((k, emoji) {
      if (emoji == null) return;
      final parts = k.split('|');
      final l = byId[parts[0]];
      if (l == null) return;
      (l.reactions[emoji] ??= []).add(parts[1]);
    });
    return lines;
  }
}

class ChatLine {
  ChatLine({required this.id, required this.senderId, required this.at});
  final String id;
  final String senderId;
  final String at;
  String kind = 'msg';
  String? text;
  Map<String, dynamic>? payload;
  bool edited = false;
  final Map<String, List<String>> reactions = {};
}
