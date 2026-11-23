import 'dart:async';

import 'package:flutter/gestures.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';
import 'package:url_launcher/url_launcher.dart';

import '../app/state.dart';
import '../chat/chat_client.dart';
import '../core/files.dart';
import '../design/controls.dart';
import '../design/glass.dart';
import '../design/theme.dart';
import '../design/toast.dart';
import '../drop/drop.dart' show photoPickerProvider;
import 'common.dart';
import 'file_viewer.dart';
import 'money_ui.dart' show SheetCard, SheetRule;
import 'sheets.dart';

/// Chat (spec 0011 part A, spec 0015 C): kept on ORVYN's server, so every device has the whole history; live over
/// the socket; replies, reactions, edits, forwards, pins, photos and files.

const _quick = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const _moreEmoji = [
  '🔥',
  '🎉',
  '👏',
  '💯',
  '😍',
  '🤔',
  '😅',
  '🙌',
  '👀',
  '✅',
  '❌',
  '🥳',
  '😎',
  '🤝',
  '💪',
  '😴',
  '🍕',
  '☕',
];
const _groupGap = Duration(minutes: 5);

String _hm(String iso) {
  final d = DateTime.parse(iso).toLocal();
  return '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
}

String _day(String iso) {
  final d = DateTime.parse(iso).toLocal();
  final now = DateTime.now();
  final today = DateTime(now.year, now.month, now.day);
  final day = DateTime(d.year, d.month, d.day);
  if (day == today) return 'Today';
  if (day == today.subtract(const Duration(days: 1))) return 'Yesterday';
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const w = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return '${w[d.weekday - 1]}, ${d.day} ${m[d.month - 1]}${d.year != now.year ? ' ${d.year}' : ''}';
}

String _when(String iso) => _day(iso) == 'Today' ? _hm(iso) : _day(iso);

List<J> _members(J? c) => [for (final m in (c?['members'] as List? ?? const [])) Map<String, dynamic>.from(m as Map)];

String? _meId(WidgetRef ref) => switch (ref.read(sessionProvider)) {
  SignedIn(:final me) => me.id,
  _ => null,
};

/// The face of a chat: a letter (or people, for a group) on the accent, with a green dot when they're online.
class _Face extends StatelessWidget {
  const _Face({required this.title, required this.group, this.online = false, this.size = 44});
  final String title;
  final bool group;
  final bool online;
  final double size;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        children: [
          Container(
            width: size,
            height: size,
            decoration: BoxDecoration(shape: BoxShape.circle, gradient: l.accentGradient),
            alignment: Alignment.center,
            child: group
                ? Icon(LucideIcons.users, size: size * 0.42, color: Colors.white)
                : Text(
                    title.isEmpty ? '?' : title.characters.first.toUpperCase(),
                    style: TextStyle(
                      fontFamily: fontFamily,
                      color: Colors.white,
                      fontSize: size * 0.4,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
          ),
          if (online)
            Positioned(
              right: 0,
              bottom: 0,
              child: Container(
                width: size * 0.3,
                height: size * 0.3,
                decoration: BoxDecoration(
                  color: l.c.success,
                  shape: BoxShape.circle,
                  border: Border.all(color: l.c.glassStrong, width: 2),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

// ------------------------------------------------------------------ the list

class ChatListScreen extends ConsumerStatefulWidget {
  const ChatListScreen({super.key});
  @override
  ConsumerState<ChatListScreen> createState() => _ChatListScreenState();
}

class _ChatListScreenState extends ConsumerState<ChatListScreen> {
  List<J>? _list;
  final _typing = <String, String>{};
  final _search = TextEditingController();
  StreamSubscription<J>? _sub;
  Timer? _soon;

  @override
  void initState() {
    super.initState();
    unawaited(
      ref.read(chatClientProvider).cache.readList().then((c) {
        if (mounted && _list == null && c != null) setState(() => _list = c);
      }),
    );
    unawaited(_load());
    _sub = ref.read(realtimeProvider).messages.listen((m) {
      switch (m['type']) {
        case 'chat.message' || 'chat.changed' || 'chat.read' || 'chat.hidden':
          _soon?.cancel();
          _soon = Timer(const Duration(milliseconds: 250), _load);
        case 'chat.typing':
          final c = m['conversationId'] as String;
          setState(() => _typing[c] = m['userId'] as String);
          Timer(const Duration(seconds: 4), () {
            if (mounted) setState(() => _typing.remove(c));
          });
        case 'chat.presence':
          setState(() {
            for (final c in _list ?? const <J>[]) {
              for (final p in (c['members'] as List)) {
                if ((p as Map)['id'] == m['userId']) {
                  p['online'] = m['online'];
                  p['lastSeenAt'] = m['lastSeenAt'];
                }
              }
            }
          });
      }
    });
  }

  @override
  void dispose() {
    _sub?.cancel();
    _soon?.cancel();
    _search.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final r = [for (final x in await ref.read(apiProvider).get<List<dynamic>>('/chat/conversations')) x as J];
      if (!mounted) return;
      setState(() => _list = r);
      unawaited(ref.read(chatClientProvider).cache.writeList(r));
    } catch (_) {
      if (mounted && _list == null) setState(() => _list = const []);
    }
  }

  Future<void> _rowActions(J c) async {
    final api = ref.read(apiProvider);
    final pinned = c['pinned'] == true;
    final muted = c['muted'] == true;
    final choice = await showGlassSheet<String>(
      context,
      (ctx) => StickySheet(
        title: c['title'] as String,
        footer: const SizedBox.shrink(),
        children: [
          SheetCard(
            children: [
              _ActionRow(
                icon: pinned ? LucideIcons.pinOff : LucideIcons.pin,
                label: pinned ? 'Unpin' : 'Pin to the top',
                onTap: () => Navigator.pop(ctx, 'pin'),
              ),
              const SheetRule(),
              _ActionRow(
                icon: muted ? LucideIcons.bell : LucideIcons.bellOff,
                label: muted ? 'Unmute' : 'Mute',
                onTap: () => Navigator.pop(ctx, 'mute'),
              ),
              if ((c['unread'] as int? ?? 0) > 0) ...[
                const SheetRule(),
                _ActionRow(
                  icon: LucideIcons.checkCheck,
                  label: 'Mark as read',
                  onTap: () => Navigator.pop(ctx, 'read'),
                ),
              ],
            ],
          ),
        ],
      ),
    );
    final id = c['id'] as String;
    switch (choice) {
      case 'pin':
        await api.put<dynamic>('/chat/conversations/$id/pinned', {'pinned': !pinned});
      case 'mute':
        await api.put<dynamic>('/chat/conversations/$id/mute', {'muted': !muted});
      case 'read':
        await api.post<dynamic>('/chat/conversations/$id/read');
    }
    if (choice != null) await _load();
  }

  @override
  Widget build(BuildContext context) {
    final me = _meId(ref);
    final q = _search.text.trim().toLowerCase();
    final shown = [
      for (final c in _list ?? const <J>[])
        if (q.isEmpty ||
            '${c['title']} ${_members(c).map(personName).join(' ')} ${(c['last'] as Map?)?['text'] ?? ''}'
                .toLowerCase()
                .contains(q))
          c,
    ];
    final unread = (_list ?? const <J>[]).where((c) => (c['unread'] as int? ?? 0) > 0 && c['muted'] != true).length;
    return OrvModule(
      module: 'chat',
      child: Builder(
        builder: (context) {
          final l = context.orv;
          return RefreshIndicator(
            color: l.accent,
            onRefresh: _load,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 56, 16, 120),
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Expanded(
                      child: PageTitle(
                        'Chat',
                        overline: unread > 0 ? '$unread with new messages' : 'On every device you sign in to',
                      ),
                    ),
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
                if ((_list ?? const []).length > 4) ...[
                  FocusRing(
                    radius: 22,
                    padding: const EdgeInsets.symmetric(horizontal: 8),
                    child: TextField(
                      controller: _search,
                      onChanged: (_) => setState(() {}),
                      style: OrvText.body(l),
                      decoration:
                          bareInput(
                            l,
                            hint: 'Search chats',
                            fontSize: 15,
                            padding: const EdgeInsets.symmetric(vertical: 10),
                          ).copyWith(
                            prefixIcon: Icon(LucideIcons.search, size: 16, color: l.c.faint),
                            prefixIconConstraints: const BoxConstraints(minWidth: 30),
                          ),
                    ),
                  ),
                  const SizedBox(height: 10),
                ],
                if (_list == null)
                  const LinearProgressIndicator(minHeight: 2)
                else if (_list!.isEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 40),
                    child: Column(
                      children: [
                        Container(
                          width: 64,
                          height: 64,
                          decoration: BoxDecoration(shape: BoxShape.circle, gradient: l.accentGradient),
                          child: const Icon(LucideIcons.messageCircle, color: Colors.white, size: 28),
                        ),
                        const SizedBox(height: 12),
                        Text(
                          'No chats yet. Start one with someone on ORVYN.',
                          style: OrvText.muted(l),
                          textAlign: TextAlign.center,
                        ),
                      ],
                    ),
                  )
                else
                  Glass(
                    blur: false,
                    padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
                    child: Material(
                      type: MaterialType.transparency,
                      child: Column(
                        children: [
                          for (final c in shown)
                            _ListRow(c: c, me: me, typing: _typing[c['id']], onLongPress: () => _rowActions(c)),
                          if (shown.isEmpty)
                            Padding(
                              padding: const EdgeInsets.all(16),
                              child: Text('No chat matches.', style: OrvText.muted(l)),
                            ),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _ListRow extends StatelessWidget {
  const _ListRow({required this.c, required this.me, required this.typing, required this.onLongPress});
  final J c;
  final String? me;
  final String? typing;
  final VoidCallback onLongPress;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final group = c['kind'] == 'group';
    final members = _members(c);
    final other = group ? null : members.where((m) => m['id'] != me).firstOrNull;
    final last = c['last'] == null ? null : Map<String, dynamic>.from(c['last'] as Map);
    final unread = c['unread'] as int? ?? 0;
    final muted = c['muted'] == true;
    String who(String id) => personName(members.firstWhere((m) => m['id'] == id, orElse: () => {'email': 'someone'}));
    final preview = typing != null
        ? (group ? '${who(typing!)} is typing…' : 'typing…')
        : last == null
        ? 'Say hello 👋'
        : last['deleted'] == true
        ? 'Message deleted'
        : [
            if (last['kind'] == 'msg' && last['senderId'] == me)
              'You: '
            else if (last['kind'] == 'msg' && group)
              '${who(last['senderId'] as String)}: ',
            [last['attachment'], last['text']].where((x) => x != null && '$x'.isNotEmpty).join(' '),
          ].join();
    return InkWell(
      borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
      onTap: () => context.push('/chat/${c['id']}'),
      onLongPress: () {
        unawaited(HapticFeedback.mediumImpact());
        onLongPress();
      },
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 9),
        child: Row(
          children: [
            _Face(title: c['title'] as String, group: group, online: other?['online'] == true),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          c['title'] as String,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: OrvText.body(l).copyWith(fontWeight: unread > 0 ? FontWeight.w700 : FontWeight.w600),
                        ),
                      ),
                      if (muted)
                        Padding(
                          padding: const EdgeInsets.only(left: 4),
                          child: Icon(LucideIcons.bellOff, size: 13, color: l.c.faint),
                        ),
                      const SizedBox(width: 6),
                      Text(
                        last != null
                            ? _when(last['at'] as String)
                            : (c['lastAt'] != null ? _when(c['lastAt'] as String) : ''),
                        style: OrvText.muted(l).copyWith(
                          fontSize: 11.5,
                          color: unread > 0 && !muted ? l.accent : l.c.faint,
                          fontWeight: unread > 0 ? FontWeight.w700 : FontWeight.w400,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 2),
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          preview,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: OrvText.muted(l).copyWith(
                            fontSize: 13,
                            color: typing != null ? l.accent : (unread > 0 ? l.c.text : l.c.muted),
                          ),
                        ),
                      ),
                      if (c['pinned'] == true)
                        Padding(
                          padding: const EdgeInsets.only(left: 4),
                          child: Icon(LucideIcons.pin, size: 13, color: l.c.faint),
                        ),
                      if (unread > 0)
                        Container(
                          margin: const EdgeInsets.only(left: 6),
                          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                          constraints: const BoxConstraints(minWidth: 20),
                          decoration: BoxDecoration(
                            color: muted ? l.c.faint : l.accent,
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: Text(
                            unread > 99 ? '99+' : '$unread',
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                              fontFamily: fontFamily,
                              color: Colors.white,
                              fontSize: 11.5,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ActionRow extends StatelessWidget {
  const _ActionRow({required this.icon, required this.label, required this.onTap, this.danger = false});
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool danger;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final c = danger ? l.c.danger : l.c.text;
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 13, horizontal: 4),
        child: Row(
          children: [
            Icon(icon, size: 18, color: danger ? c : l.c.muted),
            const SizedBox(width: 14),
            Text(
              label,
              style: OrvText.body(l).copyWith(color: c, fontWeight: FontWeight.w500),
            ),
          ],
        ),
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
  final _q = TextEditingController();

  @override
  void initState() {
    super.initState();
    _title.addListener(() => setState(() {}));
    _q.addListener(() => setState(() {}));
    ref
        .read(apiProvider)
        .get<List<dynamic>>('/chat/people')
        .then(
          (r) {
            if (mounted) setState(() => _people = [for (final x in r) x as J]);
          },
          onError: (_) {
            if (mounted) setState(() => _people = const []);
          },
        );
  }

  @override
  void dispose() {
    _title.dispose();
    _q.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final group = _chosen.length > 1;
    final q = _q.text.trim().toLowerCase();
    final shown = [
      for (final p in _people ?? const <J>[])
        if ('${p['name']} ${p['email']}'.toLowerCase().contains(q)) p,
    ];
    return StickySheet(
      title: 'New chat',
      footer: OrvButton(
        label: group ? 'Make the group (${_chosen.length + 1})' : 'Start chatting',
        icon: LucideIcons.messageCircle,
        variant: ButtonVariant.primary,
        expand: true,
        onPressed: _chosen.isEmpty || (group && _title.text.trim().isEmpty)
            ? null
            : () async {
                final c = await ref.read(apiProvider).post<J>('/chat/conversations', {
                  'kind': group ? 'group' : 'direct',
                  'memberIds': _chosen.toList(),
                  'title': _title.text.trim(),
                });
                if (!context.mounted) return;
                Navigator.of(context).pop();
                await context.push('/chat/${c['id']}');
              },
      ),
      children: [
        AnimatedSize(
          duration: OrvTokens.durationBase,
          child: group
              ? Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: OrvField(label: 'Group name', hint: 'Goa trip', controller: _title),
                )
              : const SizedBox(width: double.infinity),
        ),
        if (_chosen.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final p in (_people ?? const <J>[]).where((p) => _chosen.contains(p['id'])))
                  InputChip(
                    label: Text(personName(p)),
                    onDeleted: () => setState(() => _chosen.remove(p['id'])),
                    backgroundColor: l.accent.withValues(alpha: 0.12),
                    side: BorderSide.none,
                  ),
              ],
            ),
          ),
        FocusRing(
          radius: 14,
          padding: const EdgeInsets.symmetric(horizontal: 8),
          child: TextField(
            controller: _q,
            style: OrvText.body(l),
            decoration:
                bareInput(
                  l,
                  hint: 'Find someone',
                  fontSize: 15,
                  padding: const EdgeInsets.symmetric(vertical: 10),
                ).copyWith(
                  prefixIcon: Icon(LucideIcons.search, size: 16, color: l.c.faint),
                  prefixIconConstraints: const BoxConstraints(minWidth: 30),
                ),
          ),
        ),
        const SizedBox(height: 6),
        if (_people == null) const LinearProgressIndicator(minHeight: 2),
        if (_people?.isEmpty ?? false)
          Padding(
            padding: const EdgeInsets.all(8),
            child: Text('Nobody else has Chat yet.', style: OrvText.muted(l)),
          ),
        for (final p in shown)
          InkWell(
            borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
            onTap: () =>
                setState(() => _chosen.contains(p['id']) ? _chosen.remove(p['id']) : _chosen.add(p['id'] as String)),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
              child: Row(
                children: [
                  _Face(title: personName(p), group: false, online: p['online'] == true, size: 40),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(personName(p), style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600)),
                        Text(p['email'] as String, style: OrvText.muted(l).copyWith(fontSize: 12)),
                      ],
                    ),
                  ),
                  AnimatedContainer(
                    duration: OrvTokens.durationFast,
                    width: 22,
                    height: 22,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: _chosen.contains(p['id']) ? l.accent : Colors.transparent,
                      border: Border.all(color: _chosen.contains(p['id']) ? l.accent : l.c.edge, width: 1.5),
                    ),
                    child: _chosen.contains(p['id'])
                        ? const Icon(LucideIcons.check, size: 14, color: Colors.white)
                        : null,
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

// ------------------------------------------------------------------ one conversation

/// What is being sent from this phone and isn't confirmed yet.
class _Draft {
  _Draft({required this.text, this.replyTo, this.files = const []});
  final String text;
  final String? replyTo;
  final List<LocalFile> files;
  List<J>? attachments;
  J toJson() => {'text': text, 'replyTo': replyTo};
}

class ChatThreadScreen extends ConsumerStatefulWidget {
  const ChatThreadScreen({super.key, required this.id});
  final String id;
  @override
  ConsumerState<ChatThreadScreen> createState() => _ChatThreadScreenState();
}

class _ChatThreadScreenState extends ConsumerState<ChatThreadScreen> with WidgetsBindingObserver {
  J? _conv;
  List<J>? _msgs;
  bool _more = true;
  bool _loadingOlder = false;
  final _text = TextEditingController();
  final _focus = FocusNode();
  final _scroll = ScrollController();
  final _searchText = TextEditingController();
  final _pending = <String, _Draft>{};
  final _keys = <String, GlobalKey>{};
  final _files = <LocalFile>[];
  final _local = <String, LocalFile>{}; // fileId (local) → bytes, for photos while they upload
  final _typing = <String>{};
  J? _reply;
  J? _editing;
  bool _searching = false;
  List<J>? _hits;
  String? _flash;
  String? _firstUnread;
  int _below = 0;
  bool _atBottom = true;
  StreamSubscription<J>? _sub;
  DateTime _lastTyping = DateTime(2000);
  Timer? _saveSoon;
  Timer? _searchSoon;
  bool _resumed = true;

  ChatClient get _chat => ref.read(chatClientProvider);
  String? get _me => _meId(ref);
  String? get _deviceId => switch (ref.read(sessionProvider)) {
    SignedIn(:final deviceId) => deviceId,
    _ => null,
  };

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _text.addListener(() => setState(() {}));
    _scroll.addListener(_onScroll);
    unawaited(_fromCache());
    unawaited(_load());
    _sub = ref.read(realtimeProvider).messages.listen(_onEvent);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    _resumed = s == AppLifecycleState.resumed;
    if (_resumed && ((_conv?['unread'] as int?) ?? 0) > 0) _markRead();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _sub?.cancel();
    _saveSoon?.cancel();
    _searchSoon?.cancel();
    _text.dispose();
    _focus.dispose();
    _scroll.dispose();
    _searchText.dispose();
    super.dispose();
  }

  // ---------------------------------------------------------------- data

  Future<void> _fromCache() async {
    final c = await _chat.cache.read(widget.id);
    if (c == null || !mounted || _msgs != null) return;
    setState(() {
      _msgs = [
        ...c.messages,
        for (final o in c.outbox) {...o, 'local': 'failed'},
      ];
      for (final o in c.outbox) {
        _pending[o['id'] as String] = _Draft(text: o['text'] as String? ?? '', replyTo: o['replyTo'] as String?);
      }
    });
  }

  void _save() {
    _saveSoon?.cancel();
    _saveSoon = Timer(const Duration(milliseconds: 600), () {
      final msgs = _msgs;
      if (msgs == null) return;
      final real = msgs.where((m) => m['local'] == null).toList();
      final outbox = [
        for (final m in msgs)
          if (m['local'] != null && (_pending[m['id']]?.files.isEmpty ?? true)) {...m, ...?_pending[m['id']]?.toJson()},
      ];
      unawaited(_chat.cache.write(widget.id, real.length > 80 ? real.sublist(real.length - 80) : real, outbox));
    });
  }

  Future<void> _load() async {
    final api = ref.read(apiProvider);
    try {
      final c = await api.get<J>('/chat/conversations/${widget.id}');
      var page = [
        for (final x in await api.get<List<dynamic>>('/chat/conversations/${widget.id}/messages', query: {'limit': 60}))
          x as J,
      ];
      final dev = _deviceId;
      if (dev != null && page.any((m) => m['v'] == 1 && m['sealedForMe'] != null)) {
        final n = await _chat.carryOver(dev, widget.id, page).catchError((Object _) => 0);
        if (n > 0) {
          page = [
            for (final x in await api.get<List<dynamic>>(
              '/chat/conversations/${widget.id}/messages',
              query: {'limit': 60},
            ))
              x as J,
          ];
        }
      }
      if (!mounted) return;
      final me = _me;
      final myRead = _members(c).where((m) => m['id'] == me).firstOrNull?['lastReadAt'] as String? ?? '';
      final sorted = page.reversed.toList();
      setState(() {
        _conv = c;
        if ((c['unread'] as int? ?? 0) > 0) {
          _firstUnread ??=
              (sorted
                      .where(
                        (m) =>
                            m['kind'] == 'msg' &&
                            m['senderId'] != me &&
                            (m['createdAt'] as String).compareTo(myRead) > 0,
                      )
                      .firstOrNull?['id'])
                  as String?;
        }
        _msgs = [...sorted, ...?_msgs?.where((m) => m['local'] != null)];
        _more = page.length == 60;
      });
      _save();
      if ((c['unread'] as int? ?? 0) > 0) _markRead();
      // what was left unsent last time goes now
      for (final id in _pending.keys.toList()) {
        if (_msgs!.any((m) => m['id'] == id && m['local'] == 'failed')) unawaited(_deliver(id));
      }
    } catch (_) {
      if (mounted && _msgs == null) setState(() => _msgs = const []);
    }
  }

  Future<bool> _older() async {
    final msgs = _msgs;
    if (_loadingOlder || !_more || msgs == null || msgs.isEmpty) return false;
    final oldest = msgs.where((m) => m['local'] == null).firstOrNull;
    if (oldest == null) return false;
    _loadingOlder = true;
    try {
      final page = [
        for (final x
            in await ref
                .read(apiProvider)
                .get<List<dynamic>>(
                  '/chat/conversations/${widget.id}/messages',
                  query: {'limit': 60, 'before': oldest['id']},
                ))
          x as J,
      ];
      if (!mounted) return false;
      setState(() {
        _more = page.length == 60;
        _msgs = [...page.reversed, ...msgs];
      });
      return page.isNotEmpty;
    } finally {
      _loadingOlder = false;
    }
  }

  void _markRead() {
    unawaited(
      ref.read(apiProvider).post<dynamic>('/chat/conversations/${widget.id}/read').then((_) {}, onError: (_) {}),
    );
    if (_conv != null) _conv!['unread'] = 0;
  }

  void _upsert(J m) {
    final list = [...?_msgs];
    final i = list.indexWhere((x) => x['id'] == m['id']);
    if (i >= 0) {
      list[i] = m;
    } else {
      list.add(m);
      list.sort((a, b) => (a['createdAt'] as String).compareTo(b['createdAt'] as String));
    }
    setState(() => _msgs = list);
    _save();
  }

  void _onEvent(J m) {
    if (!mounted) return;
    if (m['type'] == 'chat.presence') {
      setState(() {
        for (final p in _members(_conv)) {
          if (p['id'] == m['userId']) {
            final list = (_conv!['members'] as List).cast<Map<String, dynamic>>();
            final x = list.firstWhere((y) => y['id'] == m['userId']);
            x['online'] = m['online'];
            x['lastSeenAt'] = m['lastSeenAt'];
          }
        }
      });
      return;
    }
    if (m['conversationId'] != widget.id) return;
    switch (m['type']) {
      case 'chat.message':
        final msg = m['message'];
        if (msg is Map) {
          final j = Map<String, dynamic>.from(msg);
          final mine = j['senderId'] == _me;
          _upsert(j);
          if (!mine) {
            setState(() => _typing.remove(j['senderId']));
            if (_resumed) _markRead();
            if (!_atBottom && j['deletedAt'] == null && j['editedAt'] == null) setState(() => _below++);
          }
          if (_atBottom || mine) _toBottom();
        } else {
          unawaited(_load());
        }
      case 'chat.hidden':
        setState(() => _msgs = [...?_msgs?.where((x) => x['id'] != m['messageId'])]);
      case 'chat.changed':
        unawaited(_load());
      case 'chat.read' || 'chat.delivered':
        setState(() {
          for (final x in (_conv?['members'] as List? ?? const []).cast<Map<String, dynamic>>()) {
            if (x['id'] == m['userId']) {
              x['lastDeliveredAt'] = m['at'];
              if (m['type'] == 'chat.read') x['lastReadAt'] = m['at'];
            }
          }
        });
      case 'chat.typing':
        final u = m['userId'] as String;
        setState(() => _typing.add(u));
        Timer(const Duration(seconds: 4), () {
          if (mounted) setState(() => _typing.remove(u));
        });
    }
  }

  void _onScroll() {
    final p = _scroll.position;
    final bottom = p.pixels < 80;
    if (bottom != _atBottom || (bottom && _below > 0)) {
      setState(() {
        _atBottom = bottom;
        if (bottom) _below = 0;
      });
    }
    if (p.pixels > p.maxScrollExtent - 300) unawaited(_older());
  }

  void _toBottom() => WidgetsBinding.instance.addPostFrameCallback((_) {
    if (_scroll.hasClients) unawaited(_scroll.animateTo(0, duration: OrvTokens.durationBase, curve: Curves.easeOut));
  });

  Future<void> _jump(String id) async {
    for (var i = 0; i < 25 && !(_msgs?.any((m) => m['id'] == id) ?? false); i++) {
      if (!await _older()) break;
    }
    await Future<void>.delayed(const Duration(milliseconds: 50));
    final ctx = _keys[id]?.currentContext;
    if (ctx != null && ctx.mounted) {
      await Scrollable.ensureVisible(
        ctx,
        alignment: 0.5,
        duration: const Duration(milliseconds: 350),
        curve: Curves.easeOutCubic,
      );
    }
    setState(() => _flash = id);
    Timer(const Duration(milliseconds: 1600), () {
      if (mounted && _flash == id) setState(() => _flash = null);
    });
  }

  String _who(String id) {
    if (id == _me) return 'You';
    final m = _members(_conv).where((x) => x['id'] == id).firstOrNull;
    return m == null ? 'Someone' : personName(m);
  }

  // ---------------------------------------------------------------- sending

  Future<void> _deliver(String id) async {
    final d = _pending[id];
    if (d == null) return;
    final cur = _msgs?.where((m) => m['id'] == id).firstOrNull;
    if (cur != null) _upsert({...cur, 'local': 'sending'});
    try {
      if (d.files.isNotEmpty && d.attachments == null) {
        d.attachments = [for (final f in d.files) await _chat.upload(f.bytes, name: f.name, mime: f.mime)];
      }
      final saved = await _chat.send(
        widget.id,
        id,
        text: d.text,
        replyTo: d.replyTo,
        attachments: d.attachments ?? const [],
      );
      _pending.remove(id);
      if (mounted) _upsert(saved);
    } catch (_) {
      final now = _msgs?.where((m) => m['id'] == id).firstOrNull;
      if (mounted && now != null) _upsert({...now, 'local': 'failed'});
    }
  }

  Future<void> _submit() async {
    final t = _text.text.trim();
    final api = ref.read(apiProvider);
    if (_editing != null) {
      if (t.isEmpty) return;
      final target = _editing!;
      setState(() {
        _editing = null;
        _text.clear();
      });
      _upsert({...target, 'text': t, 'editedAt': DateTime.now().toUtc().toIso8601String()});
      try {
        _upsert(await api.patch<J>('/chat/messages/${target['id']}', {'text': t}));
      } catch (_) {
        _upsert(target);
      }
      return;
    }
    if (t.isEmpty && _files.isEmpty) return;
    unawaited(HapticFeedback.lightImpact());
    final id = ChatClient.newId();
    final files = [..._files];
    final reply = _reply;
    final draft = _Draft(text: t, replyTo: reply?['id'] as String?, files: files);
    _pending[id] = draft;
    final attachments = <J>[];
    for (var i = 0; i < files.length; i++) {
      final fid = 'local-$id-$i';
      _local[fid] = files[i];
      attachments.add({'fileId': fid, 'name': files[i].name, 'mime': files[i].mime, 'size': files[i].bytes.length});
    }
    _upsert({
      'id': id,
      'conversationId': widget.id,
      'senderId': _me,
      'kind': 'msg',
      'v': 2,
      'text': t,
      'attachments': attachments,
      'share': null,
      'replyTo': reply == null
          ? null
          : {
              'id': reply['id'],
              'senderId': reply['senderId'],
              'text': reply['text'] ?? '',
              'attachment': attachmentLabel(reply['attachments'] as List? ?? const []),
              'deleted': false,
            },
      'reactions': <dynamic>[],
      'forwarded': false,
      'editedAt': null,
      'deletedAt': null,
      'createdAt': DateTime.now().toUtc().toIso8601String(),
      'local': 'sending',
    });
    setState(() {
      _text.clear();
      _files.clear();
      _reply = null;
      _atBottom = true;
    });
    _toBottom();
    await _deliver(id);
  }

  Future<void> _attach() async {
    final l = context.orv;
    final choice = await showGlassSheet<String>(
      context,
      (ctx) => StickySheet(
        title: 'Send',
        footer: const SizedBox.shrink(),
        children: [
          Row(
            children: [
              for (final (key, icon, label, colour) in [
                ('gallery', LucideIcons.image, 'Photo', 'violet'),
                ('camera', LucideIcons.camera, 'Camera', 'coral'),
                ('file', LucideIcons.fileText, 'File', 'sky'),
              ])
                Expanded(
                  child: InkWell(
                    borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
                    onTap: () => Navigator.pop(ctx, key),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      child: Column(
                        children: [
                          Container(
                            width: 54,
                            height: 54,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: OrvTokens.labels[colour]!.dark.withValues(alpha: l.dark ? 0.25 : 0.35),
                            ),
                            child: Icon(
                              icon,
                              color: l.dark ? OrvTokens.labels[colour]!.dark : OrvTokens.labels[colour]!.light,
                            ),
                          ),
                          const SizedBox(height: 6),
                          Text(label, style: OrvText.body(l).copyWith(fontSize: 13)),
                        ],
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
    LocalFile? f;
    if (choice == 'gallery' || choice == 'camera') {
      final p = await ref.read(photoPickerProvider)(camera: choice == 'camera');
      if (p != null) f = (bytes: p.bytes, name: p.name, mime: p.mime);
    } else if (choice == 'file') {
      f = await ref.read(anyFilePickerProvider)();
    }
    if (f == null || !mounted) return;
    if (f.bytes.length > 25 * 1024 * 1024) {
      Toaster.of(context).show('Files can be up to 25 MB', tone: ToastTone.danger);
      return;
    }
    setState(() => _files.add(f!));
    _focus.requestFocus();
  }

  // ---------------------------------------------------------------- one message's actions

  Future<void> _react(J m, String emoji) async {
    final me = _me!;
    final reactions = [for (final r in (m['reactions'] as List? ?? const [])) Map<String, dynamic>.from(r as Map)];
    final mine = reactions.where((r) => (r['by'] as List).contains(me)).firstOrNull?['emoji'] == emoji;
    final next = [
      for (final r in reactions)
        if ((r['by'] as List).where((u) => u != me).isNotEmpty)
          {...r, 'by': (r['by'] as List).where((u) => u != me).toList()},
    ];
    if (!mine) {
      final g = next.where((r) => r['emoji'] == emoji).firstOrNull;
      if (g != null) {
        g['by'] = [...(g['by'] as List), me];
      } else {
        next.add({
          'emoji': emoji,
          'by': [me],
        });
      }
    }
    unawaited(HapticFeedback.selectionClick());
    _upsert({...m, 'reactions': next});
    try {
      await ref.read(apiProvider).put<dynamic>('/chat/messages/${m['id']}/reaction', {'emoji': mine ? null : emoji});
    } catch (_) {
      _upsert(m);
    }
  }

  Future<void> _actions(J m) async {
    unawaited(HapticFeedback.mediumImpact());
    final mine = m['senderId'] == _me;
    final text = m['text'] as String? ?? '';
    final pinned = (_conv?['pinnedMessage'] as Map?)?['id'] == m['id'];
    var showMore = false;
    final choice = await showGlassSheet<String>(
      context,
      (ctx) => StatefulBuilder(
        builder: (ctx, setSheet) {
          final l = ctx.orv;
          return StickySheet(
            title: mine ? 'Your message' : 'From ${_who(m['senderId'] as String)}',
            footer: const SizedBox.shrink(),
            children: [
              Container(
                padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 4),
                decoration: BoxDecoration(
                  color: l.c.field,
                  borderRadius: BorderRadius.circular(28),
                  border: Border.all(color: l.c.edge),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                  children: [
                    for (final e in _quick)
                      InkWell(
                        borderRadius: BorderRadius.circular(20),
                        onTap: () => Navigator.pop(ctx, 'react:$e'),
                        child: Padding(
                          padding: const EdgeInsets.all(5),
                          child: Text(e, style: const TextStyle(fontSize: 26)),
                        ),
                      ),
                    IconButton(
                      tooltip: 'More reactions',
                      icon: Icon(showMore ? LucideIcons.chevronUp : LucideIcons.plus, color: l.c.muted),
                      onPressed: () => setSheet(() => showMore = !showMore),
                    ),
                  ],
                ),
              ),
              if (showMore)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Wrap(
                    alignment: WrapAlignment.center,
                    children: [
                      for (final e in _moreEmoji)
                        InkWell(
                          borderRadius: BorderRadius.circular(12),
                          onTap: () => Navigator.pop(ctx, 'react:$e'),
                          child: Padding(
                            padding: const EdgeInsets.all(7),
                            child: Text(e, style: const TextStyle(fontSize: 22)),
                          ),
                        ),
                    ],
                  ),
                ),
              const SizedBox(height: 12),
              SheetCard(
                children: [
                  _ActionRow(icon: LucideIcons.reply, label: 'Reply', onTap: () => Navigator.pop(ctx, 'reply')),
                  if (text.isNotEmpty) ...[
                    const SheetRule(),
                    _ActionRow(icon: LucideIcons.copy, label: 'Copy', onTap: () => Navigator.pop(ctx, 'copy')),
                  ],
                  const SheetRule(),
                  _ActionRow(icon: LucideIcons.forward, label: 'Forward', onTap: () => Navigator.pop(ctx, 'forward')),
                  const SheetRule(),
                  _ActionRow(
                    icon: pinned ? LucideIcons.pinOff : LucideIcons.pin,
                    label: pinned ? 'Unpin' : 'Pin',
                    onTap: () => Navigator.pop(ctx, 'pin'),
                  ),
                  if (mine && text.isNotEmpty && m['forwarded'] != true) ...[
                    const SheetRule(),
                    _ActionRow(icon: LucideIcons.pencil, label: 'Edit', onTap: () => Navigator.pop(ctx, 'edit')),
                  ],
                ],
              ),
              const SizedBox(height: 10),
              SheetCard(
                children: [
                  _ActionRow(
                    icon: LucideIcons.eyeOff,
                    label: 'Delete for me',
                    danger: true,
                    onTap: () => Navigator.pop(ctx, 'hide'),
                  ),
                  if (mine) ...[
                    const SheetRule(),
                    _ActionRow(
                      icon: LucideIcons.trash2,
                      label: 'Delete for everyone',
                      danger: true,
                      onTap: () => Navigator.pop(ctx, 'delete'),
                    ),
                  ],
                ],
              ),
            ],
          );
        },
      ),
    );
    if (choice == null || !mounted) return;
    final api = ref.read(apiProvider);
    final toaster = Toaster.of(context);
    if (choice.startsWith('react:')) return _react(m, choice.substring(6));
    switch (choice) {
      case 'reply':
        setState(() {
          _reply = m;
          _editing = null;
        });
        _focus.requestFocus();
      case 'copy':
        await Clipboard.setData(ClipboardData(text: text));
        toaster.show('Copied');
      case 'forward':
        await showGlassSheet<void>(context, (_) => _ForwardSheet(message: m));
      case 'pin':
        final c = await api.put<J>('/chat/conversations/${widget.id}/pin', {'messageId': pinned ? null : m['id']});
        if (mounted) setState(() => _conv = c);
      case 'edit':
        setState(() {
          _editing = m;
          _reply = null;
          _text.text = text;
        });
        _focus.requestFocus();
      case 'hide':
        setState(() => _msgs = [...?_msgs?.where((x) => x['id'] != m['id'])]);
        await api.post<dynamic>('/chat/messages/${m['id']}/hide');
      case 'delete':
        _upsert({
          ...m,
          'deletedAt': DateTime.now().toUtc().toIso8601String(),
          'text': null,
          'attachments': <dynamic>[],
          'reactions': <dynamic>[],
        });
        await api.delete<dynamic>('/chat/messages/${m['id']}');
    }
  }

  // ---------------------------------------------------------------- the screen

  String _tick(J m) {
    final local = m['local'] as String?;
    if (local != null) return local;
    final others = _members(_conv).where((p) => p['id'] != _me).toList();
    if (others.isEmpty) return 'sent';
    final at = m['createdAt'] as String;
    bool past(Object? v) => v is String && v.compareTo(at) >= 0;
    if (others.every((p) => past(p['lastReadAt']))) return 'read';
    if (others.every((p) => past(p['lastDeliveredAt']) || p['online'] == true)) return 'delivered';
    return 'sent';
  }

  @override
  Widget build(BuildContext context) {
    final conv = _conv;
    final msgs = _msgs;
    return OrvModule(
      module: 'chat',
      child: Builder(
        builder: (context) {
          final l = context.orv;
          final me = _me;
          final group = conv?['kind'] == 'group';
          final others = _members(conv).where((m) => m['id'] != me).toList();
          final other = group ? null : others.firstOrNull;
          final status = _typing.isNotEmpty
              ? (group ? '${_typing.map(_who).join(', ')} ${_typing.length > 1 ? 'are' : 'is'} typing…' : 'typing…')
              : other != null
              ? (other['online'] == true ? 'online' : lastSeen(other['lastSeenAt'] as String?))
              : group
              ? '${others.length + 1} people · ${others.where((p) => p['online'] == true).length} online'
              : '';
          final pinned = conv?['pinnedMessage'] == null
              ? null
              : Map<String, dynamic>.from(conv!['pinnedMessage'] as Map);
          return Scaffold(
            backgroundColor: Colors.transparent,
            body: SafeArea(
              child: Column(
                children: [
                  // header
                  Padding(
                    padding: const EdgeInsets.fromLTRB(2, 4, 4, 4),
                    child: Row(
                      children: [
                        IconButton(
                          tooltip: 'Back',
                          icon: Icon(LucideIcons.arrowLeft, color: l.c.text),
                          onPressed: () => context.canPop() ? context.pop() : context.go('/chat'),
                        ),
                        Expanded(
                          child: InkWell(
                            borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
                            onTap: conv == null
                                ? null
                                : () => showGlassSheet<void>(
                                    context,
                                    (_) => _InfoSheet(conv: conv, msgs: msgs ?? const [], onChanged: _load),
                                  ),
                            child: Row(
                              children: [
                                _Face(
                                  title: conv?['title'] as String? ?? '',
                                  group: group,
                                  online: other?['online'] == true,
                                  size: 40,
                                ),
                                const SizedBox(width: 10),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        conv?['title'] as String? ?? '',
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: OrvText.heading(l).copyWith(fontSize: 16.5),
                                      ),
                                      AnimatedSwitcher(
                                        duration: OrvTokens.durationBase,
                                        child: Text(
                                          status,
                                          key: ValueKey(status),
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                          style: OrvText.muted(l).copyWith(
                                            fontSize: 12,
                                            color: _typing.isNotEmpty || other?['online'] == true
                                                ? l.accent
                                                : l.c.muted,
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                        if (conv?['splitGroupId'] != null)
                          IconButton(
                            tooltip: 'Split',
                            icon: Icon(LucideIcons.receipt, color: l.c.muted, size: 20),
                            onPressed: () => context.push('/split/${conv!['splitGroupId']}'),
                          ),
                        IconButton(
                          tooltip: 'Search in this chat',
                          icon: Icon(_searching ? LucideIcons.x : LucideIcons.search, color: l.c.muted, size: 20),
                          onPressed: () => setState(() {
                            _searching = !_searching;
                            _hits = null;
                            _searchText.clear();
                          }),
                        ),
                      ],
                    ),
                  ),
                  if (_searching)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
                      child: FocusRing(
                        radius: 22,
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                        child: TextField(
                          key: const Key('chat-search'),
                          controller: _searchText,
                          autofocus: true,
                          style: OrvText.body(l),
                          onChanged: (q) {
                            _searchSoon?.cancel();
                            if (q.trim().length < 2) return setState(() => _hits = null);
                            _searchSoon = Timer(const Duration(milliseconds: 250), () async {
                              final r = await ref
                                  .read(apiProvider)
                                  .get<List<dynamic>>(
                                    '/chat/conversations/${widget.id}/search',
                                    query: {'q': q.trim()},
                                  );
                              if (mounted) setState(() => _hits = [for (final x in r) x as J]);
                            });
                          },
                          decoration:
                              bareInput(
                                l,
                                hint: 'Search messages',
                                fontSize: 15,
                                padding: const EdgeInsets.symmetric(vertical: 10),
                              ).copyWith(
                                prefixIcon: Icon(LucideIcons.search, size: 16, color: l.c.faint),
                                prefixIconConstraints: const BoxConstraints(minWidth: 30),
                              ),
                        ),
                      ),
                    ),
                  if (pinned != null && !_searching)
                    InkWell(
                      onTap: () => _jump(pinned['id'] as String),
                      child: Container(
                        padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                        decoration: BoxDecoration(
                          color: l.accent.withValues(alpha: 0.07),
                          border: Border(
                            top: BorderSide(color: l.c.edge),
                            bottom: BorderSide(color: l.c.edge),
                          ),
                        ),
                        child: Row(
                          children: [
                            Icon(LucideIcons.pin, size: 15, color: l.accent),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    'Pinned',
                                    style: OrvText.body(l)
                                        .copyWith(fontSize: 11.5, fontWeight: FontWeight.w700, color: l.accent),
                                  ),
                                  Text(
                                    [
                                      pinned['attachment'],
                                      pinned['text'],
                                    ].where((x) => x != null && '$x'.isNotEmpty).join(' '),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: OrvText.body(l).copyWith(fontSize: 13),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                    )
                  else
                    Divider(height: 1, color: l.c.edge),
                  Expanded(
                    child: _searching && _hits != null
                        ? _SearchResults(
                            hits: _hits!,
                            q: _searchText.text.trim(),
                            who: _who,
                            onTap: (id) {
                              setState(() {
                                _searching = false;
                                _hits = null;
                              });
                              unawaited(_jump(id));
                            },
                          )
                        : msgs == null
                        ? const Center(child: CircularProgressIndicator())
                        : Stack(
                            children: [
                              _thread(context, msgs, group),
                              if (!_atBottom)
                                Positioned(
                                  right: 14,
                                  bottom: 12,
                                  child: _JumpDown(
                                    count: _below,
                                    onTap: () => unawaited(
                                      _scroll.animateTo(
                                        0,
                                        duration: const Duration(milliseconds: 300),
                                        curve: Curves.easeOut,
                                      ),
                                    ),
                                  ),
                                ),
                            ],
                          ),
                  ),
                  _composer(context),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _thread(BuildContext context, List<J> msgs, bool group) {
    final l = context.orv;
    final me = _me;
    final children = <Widget>[];
    String? prevDay;
    for (var i = 0; i < msgs.length; i++) {
      final m = msgs[i];
      final day = _day(m['createdAt'] as String);
      if (day != prevDay) {
        prevDay = day;
        children.add(
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 10),
            child: Center(
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                decoration: BoxDecoration(
                  color: l.c.glassStrong,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: l.c.edge),
                ),
                child: Text(day, style: OrvText.muted(l).copyWith(fontSize: 11.5)),
              ),
            ),
          ),
        );
      }
      if (m['id'] == _firstUnread) {
        children.add(
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Row(
              children: [
                Expanded(child: Divider(color: l.accent.withValues(alpha: 0.5))),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 10),
                  child: Text(
                    'New messages',
                    style: OrvText.body(l).copyWith(fontSize: 11.5, fontWeight: FontWeight.w700, color: l.accent),
                  ),
                ),
                Expanded(child: Divider(color: l.accent.withValues(alpha: 0.5))),
              ],
            ),
          ),
        );
      }
      final key = _keys.putIfAbsent(m['id'] as String, GlobalKey.new);
      if (m['kind'] == 'system') {
        children.add(
          Padding(
            key: key,
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Center(
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
                decoration: BoxDecoration(color: l.c.track, borderRadius: BorderRadius.circular(14)),
                child: Text(
                  m['text'] as String? ?? '',
                  textAlign: TextAlign.center,
                  style: OrvText.muted(l).copyWith(fontSize: 12),
                ),
              ),
            ),
          ),
        );
        continue;
      }
      final prev = i > 0 ? msgs[i - 1] : null;
      final next = i + 1 < msgs.length ? msgs[i + 1] : null;
      bool joined(J? a, J b) =>
          a != null &&
          a['kind'] == 'msg' &&
          a['senderId'] == b['senderId'] &&
          _day(a['createdAt'] as String) == _day(b['createdAt'] as String) &&
          DateTime.parse(b['createdAt'] as String).difference(DateTime.parse(a['createdAt'] as String)).abs() <
              _groupGap;
      children.add(
        _Bubble(
          key: key,
          m: m,
          conversationId: widget.id,
          mine: m['senderId'] == me,
          group: group,
          joinPrev: joined(prev, m),
          joinNext: next != null && joined(m, next),
          me: me ?? '',
          who: _who,
          tick: _tick(m),
          flash: _flash == m['id'],
          local: _local,
          onActions: () => _actions(m),
          onReact: (e) => _react(m, e),
          onReply: () {
            unawaited(HapticFeedback.selectionClick());
            setState(() {
              _reply = m;
              _editing = null;
            });
            _focus.requestFocus();
          },
          onQuote: (id) => _jump(id),
          onRetry: () => _deliver(m['id'] as String),
        ),
      );
    }
    if (_typing.isNotEmpty) children.add(const _TypingDots());
    if (msgs.isEmpty) {
      children.add(
        Padding(
          padding: const EdgeInsets.only(top: 80),
          child: Column(
            children: [
              const Text('👋', style: TextStyle(fontSize: 40)),
              const SizedBox(height: 8),
              Text('Say hello to ${_conv?['title'] ?? ''}.', style: OrvText.muted(l)),
            ],
          ),
        ),
      );
    }
    return SingleChildScrollView(
      controller: _scroll,
      reverse: true,
      padding: const EdgeInsets.fromLTRB(10, 8, 10, 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_more)
            Padding(
              padding: const EdgeInsets.all(8),
              child: Center(
                child: SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2, color: l.c.faint),
                ),
              ),
            ),
          ...children,
        ],
      ),
    );
  }

  Widget _composer(BuildContext context) {
    final l = context.orv;
    final banner = _editing ?? _reply;
    final canSend = _text.text.trim().isNotEmpty || _files.isNotEmpty;
    return Container(
      decoration: BoxDecoration(
        border: Border(top: BorderSide(color: l.c.edge)),
      ),
      padding: const EdgeInsets.fromLTRB(6, 6, 8, 8),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          AnimatedSize(
            duration: OrvTokens.durationBase,
            child: banner == null
                ? const SizedBox(width: double.infinity)
                : Container(
                    margin: const EdgeInsets.fromLTRB(4, 0, 0, 6),
                    padding: const EdgeInsets.fromLTRB(10, 6, 0, 6),
                    decoration: BoxDecoration(
                      color: l.c.field,
                      borderRadius: BorderRadius.circular(12),
                      border: Border(left: BorderSide(color: l.accent, width: 3)),
                    ),
                    child: Row(
                      children: [
                        Icon(_editing != null ? LucideIcons.pencil : LucideIcons.reply, size: 15, color: l.accent),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                _editing != null
                                    ? 'Editing your message'
                                    : 'Replying to ${_who(banner['senderId'] as String)}',
                                style: OrvText.body(l)
                                    .copyWith(fontSize: 12, fontWeight: FontWeight.w700, color: l.accent),
                              ),
                              Text(
                                [
                                  attachmentLabel(banner['attachments'] as List? ?? const []),
                                  banner['text'],
                                ].where((x) => x != null && '$x'.isNotEmpty).join(' '),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: OrvText.muted(l).copyWith(fontSize: 12.5),
                              ),
                            ],
                          ),
                        ),
                        IconButton(
                          tooltip: 'Cancel',
                          icon: const Icon(LucideIcons.x, size: 16),
                          onPressed: () => setState(() {
                            if (_editing != null) _text.clear();
                            _editing = null;
                            _reply = null;
                          }),
                        ),
                      ],
                    ),
                  ),
          ),
          if (_files.isNotEmpty)
            SizedBox(
              height: 76,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.fromLTRB(4, 0, 4, 6),
                children: [
                  for (final (i, f) in _files.indexed)
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: Stack(
                        clipBehavior: Clip.none,
                        children: [
                          ClipRRect(
                            borderRadius: BorderRadius.circular(12),
                            child: f.mime.startsWith('image/')
                                ? Image.memory(f.bytes, width: 68, height: 68, fit: BoxFit.cover)
                                : Container(
                                    width: 110,
                                    height: 68,
                                    color: l.c.field,
                                    padding: const EdgeInsets.all(8),
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      mainAxisAlignment: MainAxisAlignment.center,
                                      children: [
                                        Text(
                                          f.name,
                                          maxLines: 2,
                                          overflow: TextOverflow.ellipsis,
                                          style: OrvText.body(l).copyWith(fontSize: 11.5),
                                        ),
                                        Text(
                                          sizeLabel(f.bytes.length),
                                          style: OrvText.muted(l).copyWith(fontSize: 10.5),
                                        ),
                                      ],
                                    ),
                                  ),
                          ),
                          Positioned(
                            right: -6,
                            top: -6,
                            child: InkWell(
                              onTap: () => setState(() => _files.removeAt(i)),
                              child: Container(
                                width: 20,
                                height: 20,
                                decoration: BoxDecoration(color: l.c.text, shape: BoxShape.circle),
                                child: Icon(LucideIcons.x, size: 12, color: l.c.glassStrong),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              IconButton(
                tooltip: 'Attach a photo or file',
                icon: Icon(LucideIcons.plus, color: l.c.muted),
                onPressed: _conv == null ? null : _attach,
              ),
              Expanded(
                child: FocusRing(
                  radius: 22,
                  padding: const EdgeInsets.symmetric(horizontal: 14),
                  child: TextField(
                    key: const Key('chat-text'),
                    controller: _text,
                    focusNode: _focus,
                    minLines: 1,
                    maxLines: 6,
                    textCapitalization: TextCapitalization.sentences,
                    style: OrvText.body(l),
                    onChanged: (v) {
                      if (v.isNotEmpty && DateTime.now().difference(_lastTyping).inSeconds > 3) {
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
                      hint: _files.isNotEmpty ? 'Add a caption' : 'Message',
                      fontSize: 15,
                      padding: const EdgeInsets.symmetric(vertical: 11),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 6),
              Semantics(
                button: true,
                label: _editing != null ? 'Save edit' : 'Send',
                child: GestureDetector(
                  onTap: canSend && _conv != null ? _submit : null,
                  child: AnimatedContainer(
                    duration: OrvTokens.durationBase,
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      gradient: canSend ? l.accentGradient : null,
                      color: canSend ? null : l.c.track,
                    ),
                    child: AnimatedSwitcher(
                      duration: OrvTokens.durationFast,
                      child: Icon(
                        _editing != null ? LucideIcons.check : LucideIcons.sendHorizontal,
                        key: ValueKey(_editing != null),
                        size: 19,
                        color: canSend ? Colors.white : l.c.faint,
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _JumpDown extends StatelessWidget {
  const _JumpDown({required this.count, required this.onTap});
  final int count;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return Semantics(
      button: true,
      label: 'Jump to the latest',
      child: GestureDetector(
        onTap: onTap,
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            Glass(
              level: GlassLevel.float,
              radius: 22,
              padding: const EdgeInsets.all(10),
              child: Icon(LucideIcons.chevronsDown, size: 20, color: l.c.text),
            ),
            if (count > 0)
              Positioned(
                right: -4,
                top: -6,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                  decoration: BoxDecoration(color: l.accent, borderRadius: BorderRadius.circular(10)),
                  child: Text(
                    '$count',
                    style: const TextStyle(
                      fontFamily: fontFamily,
                      color: Colors.white,
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _TypingDots extends StatefulWidget {
  const _TypingDots();
  @override
  State<_TypingDots> createState() => _TypingDotsState();
}

class _TypingDotsState extends State<_TypingDots> with SingleTickerProviderStateMixin {
  late final _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 900))..repeat();
  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.only(top: 6),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(color: l.c.field, borderRadius: BorderRadius.circular(18)),
        child: AnimatedBuilder(
          animation: _c,
          builder: (_, _) => Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              for (var i = 0; i < 3; i++)
                Container(
                  margin: const EdgeInsets.symmetric(horizontal: 2),
                  width: 6,
                  height: 6,
                  transform: Matrix4.translationValues(0, -3 * (0.5 - ((_c.value * 3 - i) % 3 / 3 - 0.5).abs()) * 2, 0),
                  decoration: BoxDecoration(color: l.c.muted, shape: BoxShape.circle),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

// ------------------------------------------------------------------ a message

class _Bubble extends ConsumerStatefulWidget {
  const _Bubble({
    super.key,
    required this.m,
    required this.conversationId,
    required this.mine,
    required this.group,
    required this.joinPrev,
    required this.joinNext,
    required this.me,
    required this.who,
    required this.tick,
    required this.flash,
    required this.local,
    required this.onActions,
    required this.onReact,
    required this.onReply,
    required this.onQuote,
    required this.onRetry,
  });
  final J m;
  final String conversationId;
  final bool mine;
  final bool group;
  final bool joinPrev;
  final bool joinNext;
  final String me;
  final String Function(String) who;
  final String tick;
  final bool flash;
  final Map<String, LocalFile> local;
  final VoidCallback onActions;
  final ValueChanged<String> onReact;
  final VoidCallback onReply;
  final ValueChanged<String> onQuote;
  final VoidCallback onRetry;
  @override
  ConsumerState<_Bubble> createState() => _BubbleState();
}

class _BubbleState extends ConsumerState<_Bubble> {
  double _dx = 0;

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final m = widget.m;
    final mine = widget.mine;
    final gone = m['deletedAt'] != null;
    final sealed = m['v'] == 1 && !gone;
    final text = m['text'] as String? ?? '';
    final atts = [for (final a in (m['attachments'] as List? ?? const [])) Map<String, dynamic>.from(a as Map)];
    final photos = atts.where((a) => (a['mime'] as String? ?? '').startsWith('image/')).toList();
    final docs = atts.where((a) => !(a['mime'] as String? ?? '').startsWith('image/')).toList();
    final share = m['share'] == null ? null : Map<String, dynamic>.from(m['share'] as Map);
    final reply = m['replyTo'] == null ? null : Map<String, dynamic>.from(m['replyTo'] as Map);
    final reactions = [for (final r in (m['reactions'] as List? ?? const [])) Map<String, dynamic>.from(r as Map)];
    final onlyEmoji =
        text.isNotEmpty &&
        atts.isEmpty &&
        share == null &&
        reply == null &&
        text.runes.length <= 8 &&
        RegExp(r'^(?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{200D}\u{FE0F}\s])+$', unicode: true).hasMatch(text);
    final fg = mine ? Colors.white : l.c.text;
    final soft = mine ? Colors.white.withValues(alpha: 0.78) : l.c.muted;
    const r = Radius.circular(20);
    const tight = Radius.circular(6);
    final radius = BorderRadius.only(
      topLeft: !mine && widget.joinPrev ? tight : r,
      bottomLeft: !mine && widget.joinNext ? tight : r,
      topRight: mine && widget.joinPrev ? tight : r,
      bottomRight: mine && widget.joinNext ? tight : r,
    );
    final maxW = MediaQuery.sizeOf(context).width * 0.78;

    Widget content;
    if (gone) {
      content = Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(LucideIcons.ban, size: 14, color: soft),
          const SizedBox(width: 6),
          Text(
            mine ? 'You deleted this message' : 'This message was deleted',
            style: TextStyle(fontStyle: FontStyle.italic, color: soft, fontSize: 14),
          ),
        ],
      );
    } else if (sealed) {
      content = Text(
        'An older private message. Open this chat once on the phone it was sent to and it comes over.',
        style: TextStyle(fontStyle: FontStyle.italic, color: soft, fontSize: 13.5),
      );
    } else {
      content = Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (photos.isNotEmpty) _Photos(conversationId: widget.conversationId, photos: photos, local: widget.local),
          for (final a in docs) _FileCard(conversationId: widget.conversationId, a: a, mine: mine, local: widget.local),
          if (share != null) _ShareCard(s: share, mine: mine),
          if (text.isNotEmpty)
            Padding(
              padding: EdgeInsets.fromLTRB(photos.isNotEmpty ? 6 : 0, photos.isNotEmpty ? 6 : 0, 0, 0),
              child: _Linked(
                text: text,
                style: onlyEmoji
                    ? const TextStyle(fontSize: 38)
                    : OrvText.body(l).copyWith(color: fg, fontSize: 15, height: 1.3),
                link: mine ? Colors.white : l.accent,
              ),
            ),
        ],
      );
    }

    final meta = Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (m['editedAt'] != null)
          Text('edited · ', style: TextStyle(fontSize: 10.5, color: onlyEmoji ? l.c.faint : soft)),
        Text(_hm(m['createdAt'] as String), style: TextStyle(fontSize: 10.5, color: onlyEmoji ? l.c.faint : soft)),
        if (mine && !gone) ...[
          const SizedBox(width: 3),
          switch (widget.tick) {
            'sending' => Icon(LucideIcons.clock3, size: 12, color: soft, semanticLabel: 'Sending'),
            'failed' => Icon(LucideIcons.circleAlert, size: 13, color: l.c.danger, semanticLabel: 'Not sent'),
            'sent' => Icon(LucideIcons.check, size: 13, color: soft, semanticLabel: 'Sent'),
            'delivered' => Icon(LucideIcons.checkCheck, size: 13, color: soft, semanticLabel: 'Delivered'),
            _ => Icon(
              LucideIcons.checkCheck,
              size: 14,
              color: onlyEmoji ? l.accent : Colors.white,
              weight: 800,
              semanticLabel: 'Read',
            ),
          },
        ],
      ],
    );

    final bubble = AnimatedContainer(
      duration: OrvTokens.durationBase,
      constraints: BoxConstraints(maxWidth: maxW),
      padding: onlyEmoji
          ? const EdgeInsets.symmetric(horizontal: 2)
          : (photos.isNotEmpty && text.isEmpty ? const EdgeInsets.all(3) : const EdgeInsets.fromLTRB(12, 8, 12, 6)),
      decoration: onlyEmoji
          ? null
          : BoxDecoration(
              gradient: mine ? l.accentGradient : null,
              color: mine ? null : l.c.field,
              borderRadius: radius,
              border: widget.flash
                  ? Border.all(color: l.accent, width: 2)
                  : (mine ? null : Border.all(color: l.c.edge)),
              boxShadow: mine
                  ? [BoxShadow(color: l.accent.withValues(alpha: 0.18), blurRadius: 10, offset: const Offset(0, 3))]
                  : null,
            ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (widget.group && !mine && !widget.joinPrev && !onlyEmoji)
            Padding(
              padding: EdgeInsets.fromLTRB(photos.isNotEmpty && text.isEmpty ? 8 : 0, 0, 0, 2),
              child: Text(
                widget.who(m['senderId'] as String),
                style: TextStyle(fontFamily: fontFamily, fontSize: 12, fontWeight: FontWeight.w700, color: l.accent),
              ),
            ),
          if (m['forwarded'] == true)
            Padding(
              padding: const EdgeInsets.only(bottom: 2),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(LucideIcons.forward, size: 12, color: soft),
                  const SizedBox(width: 4),
                  Text(
                    'Forwarded',
                    style: TextStyle(fontSize: 11.5, fontStyle: FontStyle.italic, color: soft),
                  ),
                ],
              ),
            ),
          if (reply != null && !gone)
            GestureDetector(
              onTap: () => widget.onQuote(reply['id'] as String),
              child: Container(
                margin: const EdgeInsets.only(bottom: 4),
                padding: const EdgeInsets.fromLTRB(8, 4, 8, 4),
                decoration: BoxDecoration(
                  color: mine ? Colors.white.withValues(alpha: 0.16) : l.c.glassStrong,
                  borderRadius: BorderRadius.circular(10),
                  border: Border(left: BorderSide(color: mine ? Colors.white : l.accent, width: 3)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      widget.who(reply['senderId'] as String),
                      style: TextStyle(
                        fontFamily: fontFamily,
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        color: mine ? Colors.white : l.accent,
                      ),
                    ),
                    Text(
                      reply['deleted'] == true
                          ? 'Deleted message'
                          : [reply['attachment'], reply['text']].where((x) => x != null && '$x'.isNotEmpty).join(' '),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontFamily: fontFamily, fontSize: 12.5, color: soft),
                    ),
                  ],
                ),
              ),
            ),
          content,
          Align(
            alignment: Alignment.centerRight,
            widthFactor: 1,
            child: Padding(
              padding: EdgeInsets.only(
                top: 2,
                right: photos.isNotEmpty && text.isEmpty ? 6 : 0,
                bottom: photos.isNotEmpty && text.isEmpty ? 4 : 0,
              ),
              child: meta,
            ),
          ),
        ],
      ),
    );

    final withReactions = Column(
      crossAxisAlignment: mine ? CrossAxisAlignment.end : CrossAxisAlignment.start,
      children: [
        bubble,
        if (reactions.isNotEmpty)
          Transform.translate(
            offset: const Offset(0, -6),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8),
              child: Wrap(
                spacing: 4,
                children: [
                  for (final r in reactions)
                    GestureDetector(
                      onTap: () => widget.onReact(r['emoji'] as String),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: l.c.glassStrong,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: (r['by'] as List).contains(widget.me) ? l.accent : l.c.edge),
                        ),
                        child: Text(
                          '${r['emoji']}${(r['by'] as List).length > 1 ? ' ${(r['by'] as List).length}' : ''}',
                          semanticsLabel:
                              '${r['emoji']} by ${(r['by'] as List).map((u) => widget.who(u as String)).join(', ')}',
                          style: TextStyle(fontFamily: fontFamily, fontSize: 13, color: l.c.text),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
      ],
    );

    final row = Row(
      mainAxisAlignment: mine ? MainAxisAlignment.end : MainAxisAlignment.start,
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        if (widget.group && !mine)
          SizedBox(
            width: 32,
            child: widget.joinNext
                ? null
                : Padding(
                    padding: const EdgeInsets.only(bottom: 4),
                    child: _Face(title: widget.who(m['senderId'] as String), group: false, size: 26),
                  ),
          ),
        if (widget.tick == 'failed')
          IconButton(
            tooltip: 'Send again',
            icon: Icon(LucideIcons.rotateCw, size: 18, color: l.c.danger),
            onPressed: widget.onRetry,
          ),
        Flexible(child: withReactions),
      ],
    );

    return Padding(
      padding: EdgeInsets.only(top: widget.joinPrev ? 2 : 8),
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onLongPress: gone || sealed || m['local'] != null ? null : widget.onActions,
        onDoubleTap: gone || sealed || m['local'] != null ? null : () => widget.onReact('❤️'),
        // swipe right to reply
        onHorizontalDragUpdate: gone || sealed || m['local'] != null
            ? null
            : (d) => setState(() => _dx = (_dx + d.delta.dx).clamp(0, 80)),
        onHorizontalDragEnd: (_) {
          if (_dx > 56) widget.onReply();
          setState(() => _dx = 0);
        },
        child: Stack(
          alignment: Alignment.centerLeft,
          children: [
            if (_dx > 4)
              Opacity(
                opacity: (_dx / 56).clamp(0, 1),
                child: Padding(
                  padding: const EdgeInsets.only(left: 4),
                  child: Icon(LucideIcons.reply, color: l.accent, size: 20),
                ),
              ),
            AnimatedContainer(
              duration: _dx == 0 ? OrvTokens.durationBase : Duration.zero,
              transform: Matrix4.translationValues(_dx, 0, 0),
              child: row,
            ),
          ],
        ),
      ),
    );
  }
}

/// Words with links you can open.
class _Linked extends StatelessWidget {
  const _Linked({required this.text, required this.style, required this.link});
  final String text;
  final TextStyle style;
  final Color link;
  @override
  Widget build(BuildContext context) {
    final re = RegExp(r'https?://[^\s<]+[^\s<.,;:!?)\]]');
    final spans = <InlineSpan>[];
    var at = 0;
    for (final m in re.allMatches(text)) {
      if (m.start > at) spans.add(TextSpan(text: text.substring(at, m.start)));
      final url = m.group(0)!;
      spans.add(
        TextSpan(
          text: url,
          style: TextStyle(color: link, decoration: TextDecoration.underline, decorationColor: link),
          recognizer: TapGestureRecognizer()
            ..onTap = () => unawaited(launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication)),
        ),
      );
      at = m.end;
    }
    if (at < text.length) spans.add(TextSpan(text: text.substring(at)));
    return Text.rich(TextSpan(style: style, children: spans));
  }
}

class _Photos extends StatelessWidget {
  const _Photos({required this.conversationId, required this.photos, required this.local});
  final String conversationId;
  final List<J> photos;
  final Map<String, LocalFile> local;
  @override
  Widget build(BuildContext context) {
    if (photos.length == 1) {
      final a = photos.first;
      final w = (a['w'] as num?)?.toDouble();
      final h = (a['h'] as num?)?.toDouble();
      return ConstrainedBox(
        constraints: const BoxConstraints(maxHeight: 320, minWidth: 160),
        child: AspectRatio(
          aspectRatio: w != null && h != null && h > 0 ? (w / h).clamp(0.6, 1.8) : 4 / 3,
          child: _Photo(conversationId: conversationId, a: a, local: local),
        ),
      );
    }
    final shown = photos.take(4).toList();
    return SizedBox(
      width: 240,
      child: GridView.count(
        crossAxisCount: 2,
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        mainAxisSpacing: 3,
        crossAxisSpacing: 3,
        children: [
          for (final (i, a) in shown.indexed)
            Stack(
              fit: StackFit.expand,
              children: [
                _Photo(conversationId: conversationId, a: a, local: local),
                if (i == 3 && photos.length > 4)
                  Container(
                    decoration: BoxDecoration(color: Colors.black54, borderRadius: BorderRadius.circular(14)),
                    alignment: Alignment.center,
                    child: Text(
                      '+${photos.length - 4}',
                      style: const TextStyle(
                        fontFamily: fontFamily,
                        color: Colors.white,
                        fontSize: 20,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
              ],
            ),
        ],
      ),
    );
  }
}

class _Photo extends ConsumerWidget {
  const _Photo({required this.conversationId, required this.a, required this.local});
  final String conversationId;
  final J a;
  final Map<String, LocalFile> local;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final id = a['fileId'] as String;
    final kept = local[id];
    final bytes = kept != null ? Future.value(kept.bytes) : ref.read(chatClientProvider).attachment(conversationId, id);
    return ClipRRect(
      borderRadius: BorderRadius.circular(16),
      child: FutureBuilder(
        future: bytes,
        builder: (context, snap) {
          final b = snap.data;
          if (b == null || b.isEmpty) {
            return Container(
              color: l.c.track,
              child: snap.hasError ? Icon(LucideIcons.imageOff, color: l.c.faint) : null,
            );
          }
          return GestureDetector(
            onTap: () => Navigator.of(context).push(
              PageRouteBuilder<void>(
                opaque: false,
                barrierColor: Colors.black,
                pageBuilder: (_, _, _) => _Viewer(
                  bytes: b,
                  name: a['name'] as String? ?? 'photo.jpg',
                  mime: a['mime'] as String? ?? 'image/jpeg',
                ),
              ),
            ),
            child: Image.memory(b, fit: BoxFit.cover, gaplessPlayback: true),
          );
        },
      ),
    );
  }
}

class _Viewer extends ConsumerWidget {
  const _Viewer({required this.bytes, required this.name, required this.mime});
  final List<int> bytes;
  final String name;
  final String mime;
  @override
  Widget build(BuildContext context, WidgetRef ref) => Scaffold(
    backgroundColor: Colors.black,
    body: SafeArea(
      child: Stack(
        children: [
          Positioned.fill(
            child: InteractiveViewer(maxScale: 5, child: Center(child: Image.memory(Uint8List.fromList(bytes)))),
          ),
          Positioned(
            top: 4,
            left: 4,
            child: IconButton(
              tooltip: 'Close',
              icon: const Icon(LucideIcons.x, color: Colors.white),
              onPressed: () => Navigator.pop(context),
            ),
          ),
          Positioned(
            top: 4,
            right: 4,
            child: IconButton(
              tooltip: 'Open in another app',
              icon: const Icon(LucideIcons.share2, color: Colors.white),
              onPressed: () => openBytes(context, ref, bytes: Uint8List.fromList(bytes), name: name, mime: mime),
            ),
          ),
        ],
      ),
    ),
  );
}

class _FileCard extends ConsumerWidget {
  const _FileCard({required this.conversationId, required this.a, required this.mine, required this.local});
  final String conversationId;
  final J a;
  final bool mine;
  final Map<String, LocalFile> local;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final name = a['name'] as String? ?? 'file';
    final mime = a['mime'] as String? ?? '';
    final ext = name.contains('.') ? name.split('.').last.toUpperCase() : 'FILE';
    return InkWell(
      borderRadius: BorderRadius.circular(14),
      onTap: () async {
        final id = a['fileId'] as String;
        final bytes = local[id]?.bytes ?? await ref.read(chatClientProvider).attachment(conversationId, id);
        if (context.mounted) await openBytes(context, ref, bytes: bytes, name: name, mime: mime);
      },
      child: Container(
        margin: const EdgeInsets.only(bottom: 4),
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(
          color: mine ? Colors.white.withValues(alpha: 0.16) : l.c.glassStrong,
          borderRadius: BorderRadius.circular(14),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 40,
              height: 40,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: mine ? Colors.white.withValues(alpha: 0.25) : l.accent.withValues(alpha: 0.14),
                borderRadius: BorderRadius.circular(10),
              ),
              child: mime.startsWith('audio/')
                  ? Icon(LucideIcons.music, size: 18, color: mine ? Colors.white : l.accent)
                  : Text(
                      ext.length > 4 ? ext.substring(0, 4) : ext,
                      style: TextStyle(
                        fontFamily: fontFamily,
                        fontSize: 10.5,
                        fontWeight: FontWeight.w800,
                        color: mine ? Colors.white : l.accent,
                      ),
                    ),
            ),
            const SizedBox(width: 10),
            Flexible(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontFamily: fontFamily,
                      fontSize: 13.5,
                      fontWeight: FontWeight.w600,
                      color: mine ? Colors.white : l.c.text,
                    ),
                  ),
                  Text(
                    '${sizeLabel((a['size'] as num?)?.toInt() ?? 0)} · tap to open',
                    style: TextStyle(fontFamily: fontFamily, fontSize: 11.5, color: mine ? Colors.white70 : l.c.muted),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ShareCard extends StatelessWidget {
  const _ShareCard({required this.s, required this.mine});
  final J s;
  final bool mine;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final kind = s['kind'] as String;
    return InkWell(
      onTap: () => context.push(switch (kind) {
        'split' => '/split/${s['id']}',
        'ipo' => '/ipo/${s['id']}',
        'doc' => '/library',
        _ => '/today',
      }),
      child: Container(
        margin: const EdgeInsets.only(bottom: 4),
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: mine ? Colors.white.withValues(alpha: 0.16) : l.c.glassStrong,
          borderRadius: BorderRadius.circular(14),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              {'task': 'TASK', 'ipo': 'IPO', 'doc': 'DOCUMENT', 'split': 'SPLIT'}[kind] ?? kind.toUpperCase(),
              style: TextStyle(
                fontFamily: fontFamily,
                fontSize: 10.5,
                fontWeight: FontWeight.w800,
                letterSpacing: 0.6,
                color: mine ? Colors.white70 : l.accent,
              ),
            ),
            Text(
              s['title'] as String? ?? '',
              style: TextStyle(
                fontFamily: fontFamily,
                fontSize: 14.5,
                fontWeight: FontWeight.w700,
                color: mine ? Colors.white : l.c.text,
              ),
            ),
            if (s['line'] != null)
              Text(
                s['line'] as String,
                style: TextStyle(fontFamily: fontFamily, fontSize: 12.5, color: mine ? Colors.white70 : l.c.muted),
              ),
          ],
        ),
      ),
    );
  }
}

class _SearchResults extends StatelessWidget {
  const _SearchResults({required this.hits, required this.q, required this.who, required this.onTap});
  final List<J> hits;
  final String q;
  final String Function(String) who;
  final ValueChanged<String> onTap;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    if (hits.isEmpty) return Center(child: Text('Nothing found.', style: OrvText.muted(l)));
    return ListView.separated(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      itemCount: hits.length,
      separatorBuilder: (_, _) => Divider(height: 1, color: l.c.edge),
      itemBuilder: (_, i) {
        final h = hits[i];
        final text = [
          attachmentLabel(h['attachments'] as List? ?? const []),
          h['text'],
        ].where((x) => x != null && '$x'.isNotEmpty).join(' ');
        final at = text.toLowerCase().indexOf(q.toLowerCase());
        return InkWell(
          onTap: () => onTap(h['id'] as String),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 4),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        who(h['senderId'] as String),
                        style: OrvText.body(l).copyWith(fontSize: 12.5, fontWeight: FontWeight.w700),
                      ),
                    ),
                    Text(_when(h['createdAt'] as String), style: OrvText.muted(l).copyWith(fontSize: 11.5)),
                  ],
                ),
                const SizedBox(height: 2),
                Text.rich(
                  TextSpan(
                    style: OrvText.body(l).copyWith(fontSize: 14),
                    children: at < 0
                        ? [TextSpan(text: text)]
                        : [
                            TextSpan(text: text.substring(0, at)),
                            TextSpan(
                              text: text.substring(at, at + q.length),
                              style: TextStyle(
                                backgroundColor: l.accent.withValues(alpha: 0.25),
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            TextSpan(text: text.substring(at + q.length)),
                          ],
                  ),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

// ------------------------------------------------------------------ sheets: forward, details

class _ForwardSheet extends ConsumerStatefulWidget {
  const _ForwardSheet({required this.message});
  final J message;
  @override
  ConsumerState<_ForwardSheet> createState() => _ForwardSheetState();
}

class _ForwardSheetState extends ConsumerState<_ForwardSheet> {
  List<J>? _list;
  final _chosen = <String>{};
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    ref.read(apiProvider).get<List<dynamic>>('/chat/conversations').then((r) {
      if (mounted) setState(() => _list = [for (final x in r) x as J]);
    });
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return StickySheet(
      title: 'Forward to…',
      footer: OrvButton(
        label: _chosen.length > 1 ? 'Send to ${_chosen.length} chats' : 'Send',
        icon: LucideIcons.forward,
        variant: ButtonVariant.primary,
        expand: true,
        loading: _busy,
        onPressed: _chosen.isEmpty
            ? null
            : () async {
                final nav = Navigator.of(context);
                final toaster = Toaster.of(context);
                setState(() => _busy = true);
                try {
                  for (final c in _chosen) {
                    await ref
                        .read(chatClientProvider)
                        .send(c, ChatClient.newId(), forwardOf: widget.message['id'] as String);
                  }
                  toaster.show(
                    _chosen.length == 1 ? 'Forwarded' : 'Forwarded to ${_chosen.length} chats',
                    tone: ToastTone.success,
                  );
                  nav.pop();
                } catch (e) {
                  toaster.show('Couldn’t forward it', body: messageFor(e), tone: ToastTone.danger);
                } finally {
                  if (mounted) setState(() => _busy = false);
                }
              },
      ),
      children: [
        if (_list == null) const LinearProgressIndicator(minHeight: 2),
        for (final c in _list ?? const <J>[])
          InkWell(
            borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
            onTap: () =>
                setState(() => _chosen.contains(c['id']) ? _chosen.remove(c['id']) : _chosen.add(c['id'] as String)),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
              child: Row(
                children: [
                  _Face(title: c['title'] as String, group: c['kind'] == 'group', size: 38),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(c['title'] as String, style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600)),
                  ),
                  Icon(
                    _chosen.contains(c['id']) ? LucideIcons.circleCheck : LucideIcons.circle,
                    color: _chosen.contains(c['id']) ? l.accent : l.c.faint,
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

class _InfoSheet extends ConsumerStatefulWidget {
  const _InfoSheet({required this.conv, required this.msgs, required this.onChanged});
  final J conv;
  final List<J> msgs;
  final Future<void> Function() onChanged;
  @override
  ConsumerState<_InfoSheet> createState() => _InfoSheetState();
}

class _InfoSheetState extends ConsumerState<_InfoSheet> {
  late bool _muted = widget.conv['muted'] == true;
  late bool _pinned = widget.conv['pinned'] == true;
  late final _title = TextEditingController(text: widget.conv['title'] as String);
  List<J>? _people;

  String get _id => widget.conv['id'] as String;

  @override
  void initState() {
    super.initState();
    if (_admin) {
      ref.read(apiProvider).get<List<dynamic>>('/chat/people').then((r) {
        if (mounted) setState(() => _people = [for (final x in r) x as J]);
      });
    }
  }

  bool get _admin => widget.conv['kind'] == 'group' && widget.conv['adminId'] == _meId(ref);

  @override
  void dispose() {
    _title.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final api = ref.read(apiProvider);
    final me = _meId(ref);
    final members = _members(widget.conv);
    final photos = [
      for (final m in widget.msgs.reversed)
        if (m['deletedAt'] == null && m['local'] == null)
          for (final a in (m['attachments'] as List? ?? const []))
            if (((a as Map)['mime'] as String? ?? '').startsWith('image/')) Map<String, dynamic>.from(a),
    ].take(9).toList();
    final lastMine = widget.msgs.reversed
        .where((m) => m['senderId'] == me && m['kind'] == 'msg' && m['local'] == null)
        .firstOrNull;
    final outside = [
      for (final p in _people ?? const <J>[])
        if (!members.any((m) => m['id'] == p['id'])) p,
    ];
    return StickySheet(
      title: widget.conv['title'] as String,
      footer: Text(
        'Kept on ORVYN’s server, encrypted at rest, so it’s on every device you sign in to.',
        style: OrvText.muted(l).copyWith(fontSize: 11.5),
        textAlign: TextAlign.center,
      ),
      children: [
        if (_admin) ...[
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Expanded(
                child: OrvField(label: 'Group name', controller: _title),
              ),
              const SizedBox(width: 8),
              OrvButton(
                label: 'Rename',
                small: true,
                onPressed: () async {
                  await api.put<dynamic>('/chat/conversations/$_id/title', {'title': _title.text.trim()});
                  await widget.onChanged();
                },
              ),
            ],
          ),
          const SizedBox(height: 12),
        ],
        SheetCard(
          children: [
            OrvSwitchRow(
              label: 'Mute notifications',
              value: _muted,
              onChanged: (v) async {
                setState(() => _muted = v);
                await api.put<dynamic>('/chat/conversations/$_id/mute', {'muted': v});
              },
            ),
            const SheetRule(),
            OrvSwitchRow(
              label: 'Pin to the top of Chats',
              value: _pinned,
              onChanged: (v) async {
                setState(() => _pinned = v);
                await api.put<dynamic>('/chat/conversations/$_id/pinned', {'pinned': v});
              },
            ),
          ],
        ),
        if (photos.isNotEmpty) ...[
          const SizedBox(height: 16),
          const SectionLabel('Photos'),
          const SizedBox(height: 8),
          GridView.count(
            crossAxisCount: 3,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 4,
            crossAxisSpacing: 4,
            children: [for (final a in photos) _Photo(conversationId: _id, a: a, local: const {})],
          ),
        ],
        const SizedBox(height: 16),
        SectionLabel('${members.length} people'),
        const SizedBox(height: 6),
        for (final m in members)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Row(
              children: [
                _Face(title: personName(m), group: false, online: m['id'] != me && m['online'] == true, size: 38),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Text(
                            m['id'] == me ? 'You' : personName(m),
                            style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600),
                          ),
                          if (m['id'] == widget.conv['adminId']) ...[const SizedBox(width: 6), const OrvBadge('admin')],
                        ],
                      ),
                      Text(
                        [
                          if (m['id'] == me)
                            m['email'] as String
                          else
                            (m['online'] == true ? 'online' : lastSeen(m['lastSeenAt'] as String?)),
                          if (lastMine != null &&
                              m['id'] != me &&
                              (m['lastReadAt'] as String? ?? '').compareTo(lastMine['createdAt'] as String) >= 0)
                            'read your last message',
                        ].join(' · '),
                        style: OrvText.muted(l).copyWith(fontSize: 12),
                      ),
                    ],
                  ),
                ),
                if (_admin && m['id'] != me)
                  TextButton(
                    onPressed: () async {
                      await api.delete<dynamic>('/chat/conversations/$_id/members/${m['id']}');
                      await widget.onChanged();
                      if (context.mounted) Navigator.pop(context);
                    },
                    child: const Text('Remove'),
                  ),
              ],
            ),
          ),
        if (_admin && outside.isNotEmpty) ...[
          const SizedBox(height: 12),
          const SectionLabel('Add people'),
          const SizedBox(height: 6),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final p in outside)
                ActionChip(
                  avatar: const Icon(LucideIcons.userPlus, size: 14),
                  label: Text(personName(p)),
                  onPressed: () async {
                    await api.post<dynamic>('/chat/conversations/$_id/members', {
                      'userIds': [p['id']],
                    });
                    await widget.onChanged();
                    if (context.mounted) Navigator.pop(context);
                  },
                ),
            ],
          ),
        ],
        if (widget.conv['kind'] == 'group') ...[
          const SizedBox(height: 14),
          TextButton.icon(
            style: TextButton.styleFrom(foregroundColor: l.c.danger),
            icon: const Icon(LucideIcons.logOut, size: 16),
            label: const Text('Leave the group'),
            onPressed: () async {
              await api.delete<dynamic>('/chat/conversations/$_id/members/$me');
              if (context.mounted) {
                Navigator.pop(context);
                context.go('/chat');
              }
            },
          ),
        ],
      ],
    );
  }
}
