import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../app/state.dart';
import '../chat/chat_client.dart';
import '../chat/chat_crypto.dart' show fingerprint;
import '../core/files.dart';
import '../design/controls.dart';
import '../design/glass.dart';
import '../design/theme.dart';
import '../design/toast.dart';
import 'common.dart';
import 'file_viewer.dart';
import 'sheets.dart';

typedef J = Map<String, dynamic>;

final conversationsProvider = FutureProvider.autoDispose<List<J>>((ref) async {
  final rt = ref.watch(realtimeProvider);
  final sub = rt.messages.listen((m) {
    if (['chat.message', 'chat.changed', 'chat.read'].contains(m['type'])) ref.invalidateSelf();
  });
  ref.onDispose(sub.cancel);
  return [for (final x in await ref.read(apiProvider).get<List<dynamic>>('/chat/conversations')) x as J];
});

String _name(J m) =>
    (m['name'] as String?)?.isNotEmpty == true ? m['name'] as String : (m['email'] as String).split('@').first;
String _time(String iso) {
  final d = DateTime.parse(iso).toLocal();
  return '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
}

/// Chat (spec 0011 part A): conversations, end-to-end encrypted on this phone.
class ChatListScreen extends ConsumerWidget {
  const ChatListScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final list = ref.watch(conversationsProvider);
    return OrvModule(
      module: 'chat',
      child: Builder(
        builder: (context) {
          final l = context.orv;
          return RefreshIndicator(
            color: l.accent,
            onRefresh: () async => ref.invalidate(conversationsProvider),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 56, 16, 120),
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    const Expanded(child: PageTitle('Chat', overline: 'End-to-end encrypted')),
                    Padding(
                      padding: const EdgeInsets.only(bottom: 16),
                      child: OrvButton(
                        label: 'New',
                        small: true,
                        variant: ButtonVariant.primary,
                        icon: LucideIcons.plus,
                        onPressed: () => showGlassSheet<void>(context, (_) => const _NewChatSheet()),
                      ),
                    ),
                  ],
                ),
                switch (list) {
                  AsyncData(:final value) when value.isEmpty => Text(
                    'No chats yet. Start one with someone on ORVYN.',
                    style: OrvText.muted(l),
                  ),
                  AsyncData(:final value) => Glass(
                    blur: false,
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    // the rows' ripples paint on this, not under the card
                    child: Material(
                      type: MaterialType.transparency,
                      child: Column(
                        children: [
                          for (final c in value)
                            ListTile(
                              contentPadding: const EdgeInsets.symmetric(horizontal: 4),
                              leading: c['kind'] == 'group'
                                  ? CircleAvatar(
                                      backgroundColor: l.accent.withValues(alpha: 0.16),
                                      child: Icon(LucideIcons.users, size: 18, color: l.accent),
                                    )
                                  : OrvAvatar(name: c['title'] as String, size: 40),
                              title: Text(
                                c['title'] as String,
                                style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600),
                              ),
                              subtitle: Text(
                                c['kind'] == 'group' ? '${(c['members'] as List).length} people' : 'Direct',
                                style: OrvText.muted(l).copyWith(fontSize: 12),
                              ),
                              trailing: (c['unread'] as int) > 0
                                  ? Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                                      decoration: BoxDecoration(
                                        color: l.accent,
                                        borderRadius: BorderRadius.circular(10),
                                      ),
                                      child: Text(
                                        '${c['unread']}',
                                        style: const TextStyle(
                                          fontFamily: fontFamily,
                                          color: Colors.white,
                                          fontSize: 12,
                                        ),
                                      ),
                                    )
                                  : (c['muted'] == true ? Icon(LucideIcons.bellOff, size: 15, color: l.c.faint) : null),
                              onTap: () => context.push('/chat/${c['id']}'),
                            ),
                        ],
                      ),
                    ),
                  ),
                  AsyncError() => Text('Couldn’t load chats.', style: OrvText.muted(l)),
                  _ => const LinearProgressIndicator(minHeight: 2),
                },
              ],
            ),
          );
        },
      ),
    );
  }
}

class _NewChatSheet extends ConsumerStatefulWidget {
  const _NewChatSheet();
  @override
  ConsumerState<_NewChatSheet> createState() => _NewChatSheetState();
}

class _NewChatSheetState extends ConsumerState<_NewChatSheet> {
  List<J>? _people;
  final _chosen = <String>{};
  final _title = TextEditingController();

  @override
  void initState() {
    super.initState();
    _title.addListener(() => setState(() {}));
    ref.read(apiProvider).get<List<dynamic>>('/chat/people').then((r) {
      if (mounted) setState(() => _people = [for (final x in r) x as J]);
    });
  }

  @override
  void dispose() {
    _title.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final group = _chosen.length > 1;
    return StickySheet(
      title: 'New chat',
      footer: Align(
        alignment: Alignment.centerRight,
        child: OrvButton(
          label: 'Start',
          variant: ButtonVariant.primary,
          onPressed: _chosen.isEmpty || (group && _title.text.trim().isEmpty)
              ? null
              : () async {
                  final c = await ref.read(apiProvider).post<J>('/chat/conversations', {
                    'kind': group ? 'group' : 'direct',
                    'memberIds': _chosen.toList(),
                    'title': _title.text.trim(),
                  });
                  ref.invalidate(conversationsProvider);
                  if (!context.mounted) return;
                  Navigator.of(context).pop();
                  await context.push('/chat/${c['id']}');
                },
        ),
      ),
      children: [
        if (group) ...[OrvField(label: 'Group name', controller: _title), const SizedBox(height: 8)],
        if (_people == null) const LinearProgressIndicator(minHeight: 2),
        if (_people?.isEmpty ?? false) Text('Nobody else has Chat yet.', style: OrvText.muted(l)),
        for (final p in _people ?? const <J>[])
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(_name(p), style: OrvText.body(l)),
            subtitle: Text(p['email'] as String, style: OrvText.muted(l).copyWith(fontSize: 12)),
            value: _chosen.contains(p['id']),
            onChanged: (v) => setState(() => v == true ? _chosen.add(p['id'] as String) : _chosen.remove(p['id'])),
          ),
      ],
    );
  }
}

/// One conversation: decrypt, show, reply, react, edit, delete, send files.
class ChatThreadScreen extends ConsumerStatefulWidget {
  const ChatThreadScreen({super.key, required this.id});
  final String id;
  @override
  ConsumerState<ChatThreadScreen> createState() => _ChatThreadScreenState();
}

class _ChatThreadScreenState extends ConsumerState<ChatThreadScreen> {
  J? _conv;
  List<ChatLine>? _lines;
  final _text = TextEditingController();
  ChatLine? _reply;
  ChatLine? _editing;
  String? _typing;
  bool _busy = false;
  StreamSubscription<Map<String, dynamic>>? _sub;
  DateTime _lastTyping = DateTime(2000);

  String? get _deviceId => switch (ref.read(sessionProvider)) {
    SignedIn(:final deviceId) => deviceId,
    _ => null,
  };
  String? get _me => switch (ref.read(sessionProvider)) {
    SignedIn(:final me) => me.id,
    _ => null,
  };
  ChatClient get _chat => ref.read(chatClientProvider);

  @override
  void initState() {
    super.initState();
    _text.addListener(() => setState(() {}));
    _sub = ref.read(realtimeProvider).messages.listen((m) {
      if (m['conversationId'] != widget.id) return;
      if (m['type'] == 'chat.message' || m['type'] == 'chat.changed' || m['type'] == 'chat.read') unawaited(_load());
      if (m['type'] == 'chat.typing') {
        setState(() => _typing = m['userId'] as String?);
        Timer(const Duration(seconds: 4), () => mounted ? setState(() => _typing = null) : null);
      }
    });
    unawaited(_load());
  }

  @override
  void dispose() {
    _sub?.cancel();
    _text.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final api = ref.read(apiProvider);
    final c = await api.get<J>('/chat/conversations/${widget.id}');
    final page = [
      for (final x in await api.get<List<dynamic>>('/chat/conversations/${widget.id}/messages', query: {'limit': 100}))
        x as J,
    ];
    final lines = await _chat.read(_deviceId!, page);
    if (!mounted) return;
    setState(() {
      _conv = c;
      _lines = lines;
    });
    if ((c['unread'] as int) > 0) unawaited(api.post<dynamic>('/chat/conversations/${widget.id}/read'));
  }

  List<String> get _memberIds => [for (final m in (_conv!['members'] as List).cast<J>()) m['id'] as String];
  String _who(String id) {
    final m = (_conv?['members'] as List? ?? const []).cast<J>().where((x) => x['id'] == id).firstOrNull;
    return m == null ? 'Someone' : _name(m);
  }

  Future<void> _send() async {
    final t = _text.text.trim();
    if (t.isEmpty) return;
    setState(() => _busy = true);
    final toaster = Toaster.of(context);
    try {
      await _chat.send(
        _deviceId!,
        widget.id,
        _memberIds,
        _editing != null
            ? {'t': 'edit', 'target': _editing!.id, 'text': t}
            : {'t': 'text', 'text': t, 'replyTo': _reply?.id},
      );
      _text.clear();
      _reply = null;
      _editing = null;
      await _load();
    } catch (e) {
      toaster.show('Not sent — try again', body: messageFor(e), tone: ToastTone.danger);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _actions(ChatLine line) async {
    final mine = line.senderId == _me;
    final choice = await showGlassSheet<String>(
      context,
      (ctx) => StickySheet(
        title: 'Message',
        footer: const SizedBox.shrink(),
        children: [
          Wrap(
            spacing: 8,
            children: [
              for (final e in const ['👍', '❤️', '😂', '😮', '🙏', '🎉'])
                TextButton(
                  onPressed: () => Navigator.of(ctx).pop('react:$e'),
                  child: Text(e, style: const TextStyle(fontSize: 22)),
                ),
            ],
          ),
          ListTile(
            leading: const Icon(LucideIcons.cornerUpLeft),
            title: const Text('Reply'),
            onTap: () => Navigator.of(ctx).pop('reply'),
          ),
          if (mine && line.payload?['t'] == 'text')
            ListTile(
              leading: const Icon(LucideIcons.pencil),
              title: const Text('Edit'),
              onTap: () => Navigator.of(ctx).pop('edit'),
            ),
          if (mine)
            ListTile(
              leading: const Icon(LucideIcons.trash2),
              title: const Text('Delete for everyone'),
              onTap: () => Navigator.of(ctx).pop('delete'),
            ),
        ],
      ),
    );
    if (choice == null || !mounted) return;
    if (choice.startsWith('react:')) {
      final e = choice.substring(6);
      final has = line.reactions[e]?.contains(_me) ?? false;
      await _chat.send(_deviceId!, widget.id, _memberIds, {'t': 'react', 'target': line.id, 'emoji': has ? null : e});
      await _load();
    } else if (choice == 'reply') {
      setState(() => _reply = line);
    } else if (choice == 'edit') {
      setState(() {
        _editing = line;
        _text.text = line.payload?['text'] as String? ?? '';
      });
    } else if (choice == 'delete') {
      await ref.read(apiProvider).delete<dynamic>('/chat/messages/${line.id}');
      await _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    final conv = _conv;
    final lines = _lines;
    return OrvModule(
      module: 'chat',
      child: Builder(
        builder: (context) {
          final l = context.orv;
          final me = _me;
          final others = (conv?['members'] as List? ?? const []).cast<J>().where((m) => m['id'] != me).toList();
          final lastMine = lines?.lastWhere(
            (x) => x.senderId == me && x.kind == 'msg',
            orElse: () => ChatLine(id: '', senderId: '', at: ''),
          );
          final readAll =
              lastMine != null &&
              lastMine.id.isNotEmpty &&
              others.isNotEmpty &&
              others.every((m) => m['lastReadAt'] != null && (m['lastReadAt'] as String).compareTo(lastMine.at) >= 0);
          final byId = {for (final x in lines ?? const <ChatLine>[]) x.id: x};
          return Scaffold(
            body: SafeArea(
              child: Column(
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(4, 4, 8, 4),
                    child: Row(
                      children: [
                        IconButton(
                          tooltip: 'Back',
                          icon: Icon(LucideIcons.arrowLeft, color: l.c.text),
                          onPressed: () => context.canPop() ? context.pop() : context.go('/chat'),
                        ),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(conv?['title'] as String? ?? '', style: OrvText.heading(l).copyWith(fontSize: 17)),
                              Text(
                                _typing != null ? '${_who(_typing!)} is typing…' : '🔒 End-to-end encrypted',
                                style: OrvText.muted(l).copyWith(fontSize: 12),
                              ),
                            ],
                          ),
                        ),
                        if (conv?['splitGroupId'] != null)
                          TextButton(
                            onPressed: () => context.push('/split/${conv!['splitGroupId']}'),
                            child: const Text('Split'),
                          ),
                        IconButton(
                          tooltip: 'Chat details',
                          icon: Icon(LucideIcons.info, color: l.c.muted),
                          onPressed: conv == null
                              ? null
                              : () => showGlassSheet<void>(context, (_) => _InfoSheet(conv: conv)),
                        ),
                      ],
                    ),
                  ),
                  Divider(height: 1, color: l.c.edge),
                  Expanded(
                    child: lines == null
                        ? const Center(child: CircularProgressIndicator())
                        : ListView(
                            reverse: true,
                            padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
                            children: [
                              if (lastMine != null && lastMine.id.isNotEmpty)
                                Align(
                                  alignment: Alignment.centerRight,
                                  child: Text(
                                    readAll ? '✓✓ Read' : '✓ Sent',
                                    style: OrvText.muted(l).copyWith(fontSize: 11),
                                  ),
                                ),
                              for (final line in lines.reversed)
                                _Bubble(
                                  line: line,
                                  mine: line.senderId == me,
                                  group: conv?['kind'] == 'group',
                                  who: _who,
                                  replyTo: line.payload?['replyTo'] == null ? null : byId[line.payload!['replyTo']],
                                  conversationId: widget.id,
                                  onLongPress: line.kind == 'msg' ? () => _actions(line) : null,
                                ),
                            ],
                          ),
                  ),
                  if (_reply != null || _editing != null)
                    Container(
                      color: l.c.field,
                      padding: const EdgeInsets.fromLTRB(14, 6, 4, 6),
                      child: Row(
                        children: [
                          Expanded(
                            child: Text(
                              _editing != null
                                  ? 'Editing'
                                  : 'Replying to ${_who(_reply!.senderId)}: ${_reply!.payload?['text'] ?? 'attachment'}',
                              style: OrvText.muted(l).copyWith(fontSize: 12.5),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          IconButton(
                            tooltip: 'Cancel',
                            icon: const Icon(LucideIcons.x, size: 16),
                            onPressed: () => setState(() {
                              _reply = null;
                              _editing = null;
                              _text.clear();
                            }),
                          ),
                        ],
                      ),
                    ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(6, 6, 8, 8),
                    child: Row(
                      children: [
                        IconButton(
                          tooltip: 'Attach a file',
                          icon: Icon(LucideIcons.paperclip, color: l.c.muted),
                          onPressed: _busy || conv == null
                              ? null
                              : () async {
                                  final f = await ref.read(anyFilePickerProvider)();
                                  if (f == null) return;
                                  setState(() => _busy = true);
                                  try {
                                    await _chat.sendFile(
                                      _deviceId!,
                                      widget.id,
                                      _memberIds,
                                      f.bytes,
                                      name: f.name,
                                      mime: f.mime,
                                    );
                                    await _load();
                                  } finally {
                                    if (mounted) setState(() => _busy = false);
                                  }
                                },
                        ),
                        Expanded(
                          child: FocusRing(
                            radius: 22,
                            padding: const EdgeInsets.symmetric(horizontal: 14),
                            child: TextField(
                              key: const Key('chat-text'),
                              controller: _text,
                              minLines: 1,
                              maxLines: 5,
                              style: OrvText.body(l),
                              onChanged: (_) {
                                if (DateTime.now().difference(_lastTyping).inSeconds > 3) {
                                  _lastTyping = DateTime.now();
                                  unawaited(
                                    ref
                                        .read(apiProvider)
                                        .post<dynamic>('/chat/conversations/${widget.id}/typing')
                                        .then((_) {}, onError: (_) {}),
                                  );
                                }
                              },
                              decoration: bareInput(
                                l,
                                hint: 'Message',
                                fontSize: 15,
                                padding: const EdgeInsets.symmetric(vertical: 11),
                              ),
                            ),
                          ),
                        ),
                        IconButton(
                          tooltip: 'Send',
                          icon: Icon(LucideIcons.arrowUp, color: _text.text.trim().isEmpty ? l.c.faint : l.accent),
                          onPressed: _busy || _text.text.trim().isEmpty || conv == null ? null : _send,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}

class _Bubble extends ConsumerWidget {
  const _Bubble({
    required this.line,
    required this.mine,
    required this.group,
    required this.who,
    required this.replyTo,
    required this.conversationId,
    required this.onLongPress,
  });
  final ChatLine line;
  final bool mine;
  final bool group;
  final String Function(String) who;
  final ChatLine? replyTo;
  final String conversationId;
  final VoidCallback? onLongPress;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    if (line.kind == 'system') {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Text(line.text ?? '', textAlign: TextAlign.center, style: OrvText.muted(l).copyWith(fontSize: 12)),
      );
    }
    final p = line.payload;
    final fg = mine ? Colors.white : l.c.text;
    Widget body;
    if (line.kind == 'deleted') {
      body = Text(
        'This message was deleted',
        style: TextStyle(fontStyle: FontStyle.italic, color: fg),
      );
    } else if (line.kind == 'unreadable') {
      body = Text(
        'Can’t be read on this device (sent before it joined)',
        style: TextStyle(fontStyle: FontStyle.italic, color: fg),
      );
    } else if (p?['t'] == 'file') {
      body = TextButton.icon(
        style: TextButton.styleFrom(foregroundColor: fg, padding: EdgeInsets.zero),
        icon: const Icon(LucideIcons.download, size: 16),
        label: Text(p!['name'] as String),
        onPressed: () async {
          final bytes = await ref.read(chatClientProvider).openFile(conversationId, p);
          if (context.mounted) {
            await openBytes(context, ref, bytes: bytes, name: p['name'] as String, mime: p['mime'] as String);
          }
        },
      );
    } else if (p?['t'] == 'share') {
      final r = p!['ref'] as J;
      body = GestureDetector(
        onTap: () => context.push(
          r['kind'] == 'split'
              ? '/split/${r['id']}'
              : r['kind'] == 'ipo'
              ? '/ipo/${r['id']}'
              : '/',
        ),
        child: Text(
          '${r['kind'] == 'split' ? 'Split' : r['kind']}: ${r['title']}',
          style: TextStyle(color: fg, fontWeight: FontWeight.w700),
        ),
      );
    } else {
      body = Text(p?['text'] as String? ?? '', style: OrvText.body(l).copyWith(color: fg));
    }
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: GestureDetector(
        onLongPress: onLongPress,
        child: Container(
          margin: const EdgeInsets.symmetric(vertical: 3),
          constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.78),
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 6),
          decoration: BoxDecoration(
            gradient: mine ? l.accentGradient : null,
            color: mine ? null : l.c.field,
            borderRadius: BorderRadius.circular(18),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (!mine && group)
                Text(
                  who(line.senderId),
                  style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: l.accent),
                ),
              if (replyTo != null)
                Container(
                  margin: const EdgeInsets.only(bottom: 4),
                  padding: const EdgeInsets.only(left: 8),
                  decoration: BoxDecoration(
                    border: Border(left: BorderSide(color: fg.withValues(alpha: 0.6), width: 2)),
                  ),
                  child: Text(
                    '${who(replyTo!.senderId)}: ${replyTo!.payload?['text'] ?? 'attachment'}',
                    style: TextStyle(fontSize: 12, color: fg.withValues(alpha: 0.8)),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              body,
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (line.reactions.isNotEmpty)
                    Text(
                      '${line.reactions.entries.map((e) => '${e.key}${e.value.length > 1 ? e.value.length : ''}').join(' ')}  ',
                      style: const TextStyle(fontSize: 12),
                    ),
                  Text(
                    '${line.edited ? 'edited · ' : ''}${_time(line.at)}',
                    style: TextStyle(fontSize: 10.5, color: fg.withValues(alpha: 0.7)),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _InfoSheet extends ConsumerStatefulWidget {
  const _InfoSheet({required this.conv});
  final J conv;
  @override
  ConsumerState<_InfoSheet> createState() => _InfoSheetState();
}

class _InfoSheetState extends ConsumerState<_InfoSheet> {
  Map<String, List<String>> _prints = {};
  late bool _muted = widget.conv['muted'] == true;

  @override
  void initState() {
    super.initState();
    final ids = [for (final m in (widget.conv['members'] as List).cast<J>()) m['id'] as String];
    ref.read(chatClientProvider).memberKeys(ids).then((ks) async {
      final out = <String, List<String>>{};
      for (final k in ks.where((k) => k['active'] == true)) {
        (out[k['userId'] as String] ??= []).add(await fingerprint(k['boxPublic'] as String, k['signPublic'] as String));
      }
      if (mounted) setState(() => _prints = out);
    });
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return StickySheet(
      title: widget.conv['title'] as String,
      footer: Text('Compare device codes in person to be sure.', style: OrvText.muted(l).copyWith(fontSize: 12)),
      children: [
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: Text('Mute notifications', style: OrvText.body(l)),
          value: _muted,
          onChanged: (v) async {
            setState(() => _muted = v);
            await ref.read(apiProvider).put<dynamic>('/chat/conversations/${widget.conv['id']}/mute', {'muted': v});
          },
        ),
        for (final m in (widget.conv['members'] as List).cast<J>())
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(_name(m), style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600)),
            subtitle: Text(
              (_prints[m['id']] ?? const ['no device yet']).join(' · '),
              style: OrvText.muted(l).copyWith(fontSize: 11.5, fontFamily: 'GeistMono'),
            ),
          ),
      ],
    );
  }
}
