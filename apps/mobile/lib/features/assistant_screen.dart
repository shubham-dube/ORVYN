import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../app/state.dart';
import '../design/glass.dart';
import '../design/orb.dart';
import '../design/theme.dart';
import '../design/toast.dart';
import 'common.dart';
import 'sheets.dart';

const _suggestions = [
  'What’s on tomorrow?',
  'How much did I spend on food this month?',
  'When does my insurance expire?',
  'Remind me to call mom at 6pm by alarm',
];

const _icons = {
  'create_task': LucideIcons.listPlus,
  'move_task': LucideIcons.moveRight,
  'complete_task': LucideIcons.circleCheck,
  'create_event': LucideIcons.calendarPlus,
  'add_expense': LucideIcons.wallet,
  'save_note': LucideIcons.fileText,
};

/// The Assistant on the phone (spec 0005): ask, see the answer with its sources, confirm what it proposes.
class AssistantScreen extends ConsumerStatefulWidget {
  const AssistantScreen({super.key, this.initial});

  /// a question to ask right away (from the Orb's command sheet)
  final String? initial;
  @override
  ConsumerState<AssistantScreen> createState() => _AssistantScreenState();
}

class _AssistantScreenState extends ConsumerState<AssistantScreen> {
  final _c = TextEditingController();
  final _scroll = ScrollController();
  String? _threadId;
  List<Map<String, dynamic>> _messages = [];
  String? _thinking;

  @override
  void initState() {
    super.initState();
    _c.addListener(() => setState(() {}));
    final q = widget.initial?.trim();
    if (q != null && q.isNotEmpty) WidgetsBinding.instance.addPostFrameCallback((_) => _send(q));
  }

  @override
  void dispose() {
    _c.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _toEnd() => WidgetsBinding.instance.addPostFrameCallback((_) {
    if (_scroll.hasClients) {
      _scroll.animateTo(_scroll.position.maxScrollExtent, duration: OrvTokens.durationBase, curve: Curves.easeOut);
    }
  });

  Future<void> _send(String text) async {
    final t = text.trim();
    if (t.isEmpty || _thinking != null) return;
    unawaited(HapticFeedback.lightImpact());
    _c.clear();
    setState(() => _thinking = t);
    _toEnd();
    final toaster = Toaster.of(context);
    try {
      final r = await ref.read(apiProvider).post<Map<String, dynamic>>('/assistant/ask', {
        'text': t,
        'threadId': ?_threadId,
      });
      setState(() {
        _threadId = r['threadId'] as String;
        _messages = [for (final m in r['messages'] as List) Map<String, dynamic>.from(m as Map)];
      });
    } catch (e) {
      _c.text = t;
      toaster.show('The Assistant didn’t answer', body: messageFor(e), tone: ToastTone.danger);
    } finally {
      if (mounted) setState(() => _thinking = null);
      _toEnd();
    }
  }

  Future<void> _decide(Map<String, dynamic> m, int index, bool confirm) async {
    final toaster = Toaster.of(context);
    try {
      final r = await ref
          .read(apiProvider)
          .post<Map<String, dynamic>>(
            '/assistant/messages/${m['id']}/proposals/$index/${confirm ? 'confirm' : 'dismiss'}',
          );
      setState(() => _messages = [for (final x in _messages) x['id'] == r['id'] ? r : x]);
      final p = Map<String, dynamic>.from((r['proposals'] as List)[index] as Map);
      if (p['status'] == 'done') toaster.show('Done', body: p['summary'] as String, tone: ToastTone.success);
      if (p['status'] == 'failed') {
        toaster.show('That didn’t work', body: p['problem'] as String?, tone: ToastTone.danger);
      }
    } catch (e) {
      toaster.show('That didn’t work', body: messageFor(e), tone: ToastTone.danger);
    }
  }

  Future<void> _pickThread() async {
    final id = await showGlassSheet<String>(context, (_) => const _Threads());
    if (id == null) return;
    if (id == 'new') {
      setState(() {
        _threadId = null;
        _messages = [];
      });
      return;
    }
    final r = await ref.read(apiProvider).get<List<dynamic>>('/assistant/threads/$id');
    setState(() {
      _threadId = id;
      _messages = [for (final m in r) Map<String, dynamic>.from(m as Map)];
    });
    _toEnd();
  }

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionProvider);
    final name = session is SignedIn ? session.me.name.split(' ').first : '';
    final empty = _messages.isEmpty && _thinking == null;
    return OrvModule(
      module: 'assistant',
      child: Builder(
        builder: (context) {
          final l = context.orv;
          return Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 56, 16, 4),
                child: Row(
                  children: [
                    Expanded(child: Text('Assistant', style: OrvText.title(l))),
                    IconButton(
                      tooltip: 'Conversations',
                      icon: Icon(LucideIcons.history, color: l.c.muted),
                      onPressed: _pickThread,
                    ),
                  ],
                ),
              ),
              Expanded(
                child: empty
                    ? ListView(
                        padding: const EdgeInsets.fromLTRB(20, 30, 20, 20),
                        children: [
                          const Center(child: Orb(size: 64)),
                          const SizedBox(height: 18),
                          Text(
                            name.isEmpty ? 'How can I help?' : 'How can I help, $name?',
                            textAlign: TextAlign.center,
                            style: OrvText.heading(l).copyWith(fontSize: 22),
                          ),
                          const SizedBox(height: 6),
                          Text(
                            'I answer from your own Today, Money, Library and Drop. Anything I’d change waits for your tap.',
                            textAlign: TextAlign.center,
                            style: OrvText.muted(l),
                          ),
                          const SizedBox(height: 18),
                          Wrap(
                            alignment: WrapAlignment.center,
                            spacing: 8,
                            runSpacing: 8,
                            children: [
                              for (final s in _suggestions)
                                ActionChip(
                                  label: Text(s),
                                  onPressed: () => _send(s),
                                  backgroundColor: l.c.glassStrong,
                                  side: BorderSide(color: l.c.edge),
                                ),
                            ],
                          ),
                        ],
                      )
                    : ListView(
                        controller: _scroll,
                        padding: const EdgeInsets.fromLTRB(14, 8, 14, 16),
                        children: [
                          for (final m in _messages) _Message(m: m, onDecide: (i, c) => _decide(m, i, c)),
                          if (_thinking != null) ...[
                            _Bubble(text: _thinking!, mine: true),
                            Padding(
                              padding: const EdgeInsets.symmetric(vertical: 8),
                              child: Row(
                                children: [
                                  const Orb(size: 26, state: OrbState.thinking, label: 'Thinking'),
                                  const SizedBox(width: 10),
                                  Text('Looking through your things…', style: OrvText.muted(l)),
                                ],
                              ),
                            ),
                          ],
                        ],
                      ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 0, 12, 108),
                child: Glass(
                  level: GlassLevel.float,
                  padding: const EdgeInsets.fromLTRB(14, 2, 6, 2),
                  child: Row(
                    children: [
                      Expanded(
                        child: TextField(
                          key: const Key('assistant-input'),
                          controller: _c,
                          minLines: 1,
                          maxLines: 4,
                          maxLength: 2000,
                          textInputAction: TextInputAction.send,
                          onSubmitted: _send,
                          style: OrvText.body(l).copyWith(fontSize: 16),
                          decoration: InputDecoration(
                            counterText: '',
                            border: InputBorder.none,
                            hintText: 'Ask about your day, money or papers…',
                            hintStyle: OrvText.body(l).copyWith(color: l.c.faint, fontSize: 16),
                          ),
                        ),
                      ),
                      IconButton.filled(
                        tooltip: 'Send',
                        onPressed: _c.text.trim().isEmpty || _thinking != null ? null : () => _send(_c.text),
                        style: IconButton.styleFrom(backgroundColor: l.accent),
                        icon: const Icon(LucideIcons.arrowUp, color: Colors.white, size: 18),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.text, required this.mine});
  final String text;
  final bool mine;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4),
        constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.82),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          gradient: mine ? l.accentGradient : null,
          color: mine ? null : l.c.glassStrong,
          border: mine ? null : Border.all(color: l.c.edge),
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(18),
            topRight: const Radius.circular(18),
            bottomLeft: Radius.circular(mine ? 18 : 6),
            bottomRight: Radius.circular(mine ? 6 : 18),
          ),
        ),
        child: SelectableText(
          text,
          style: OrvText.body(l).copyWith(color: mine ? Colors.white : l.c.text, fontSize: 15, height: 1.4),
        ),
      ),
    );
  }
}

class _Message extends StatelessWidget {
  const _Message({required this.m, required this.onDecide});
  final Map<String, dynamic> m;
  final void Function(int index, bool confirm) onDecide;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final mine = m['role'] == 'user';
    final proposals = [for (final p in (m['proposals'] as List? ?? const [])) Map<String, dynamic>.from(p as Map)];
    final sources = (m['sources'] as List? ?? const []).cast<String>();
    return Column(
      crossAxisAlignment: mine ? CrossAxisAlignment.end : CrossAxisAlignment.start,
      children: [
        _Bubble(text: m['text'] as String, mine: mine),
        for (final p in proposals)
          Container(
            margin: const EdgeInsets.only(top: 4, bottom: 4),
            padding: const EdgeInsets.fromLTRB(10, 8, 6, 8),
            decoration: BoxDecoration(
              color: l.c.glassStrong,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: l.c.edge),
            ),
            child: Row(
              children: [
                Container(
                  width: 34,
                  height: 34,
                  decoration: BoxDecoration(gradient: l.accentGradient, borderRadius: BorderRadius.circular(10)),
                  child: Icon(
                    _icons[(p['proposal'] as Map)['type']] ?? LucideIcons.check,
                    size: 17,
                    color: Colors.white,
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    p['summary'] as String,
                    style: OrvText.body(l).copyWith(fontSize: 14, fontWeight: FontWeight.w500),
                  ),
                ),
                switch (p['status']) {
                  'open' => Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      IconButton(
                        tooltip: 'Not now',
                        icon: Icon(LucideIcons.x, size: 18, color: l.c.muted),
                        onPressed: () => onDecide(p['index'] as int, false),
                      ),
                      FilledButton(
                        style: FilledButton.styleFrom(backgroundColor: l.accent),
                        onPressed: () => onDecide(p['index'] as int, true),
                        child: const Text('Confirm'),
                      ),
                    ],
                  ),
                  'done' => Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: Text('done', style: OrvText.muted(l).copyWith(color: l.c.success)),
                  ),
                  'failed' => Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: Text(
                      (p['problem'] as String?) ?? 'failed',
                      style: OrvText.muted(l).copyWith(color: l.c.danger),
                    ),
                  ),
                  _ => Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: Text('dismissed', style: OrvText.muted(l)),
                  ),
                },
              ],
            ),
          ),
        if (sources.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Wrap(
              spacing: 4,
              children: [
                for (final s in sources)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(color: l.c.track, borderRadius: BorderRadius.circular(10)),
                    child: Text(s, style: OrvText.muted(l).copyWith(fontSize: 11)),
                  ),
              ],
            ),
          ),
      ],
    );
  }
}

final _threadsProvider = FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) async {
  final r = await ref.read(apiProvider).get<List<dynamic>>('/assistant/threads');
  return [for (final t in r) Map<String, dynamic>.from(t as Map)];
});

class _Threads extends ConsumerWidget {
  const _Threads();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final list = ref.watch(_threadsProvider).value ?? const [];
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Conversations', style: OrvText.heading(l)),
          ListTile(
            leading: Icon(LucideIcons.plus, color: l.accent),
            title: const Text('New conversation'),
            onTap: () => Navigator.of(context).pop('new'),
          ),
          for (final t in list.take(20))
            ListTile(
              title: Text(t['title'] as String, maxLines: 1, overflow: TextOverflow.ellipsis),
              onTap: () => Navigator.of(context).pop(t['id'] as String),
              trailing: IconButton(
                tooltip: 'Delete ${t['title']}',
                icon: Icon(LucideIcons.trash2, size: 16, color: l.c.muted),
                onPressed: () async {
                  await ref.read(apiProvider).delete<dynamic>('/assistant/threads/${t['id']}');
                  ref.invalidate(_threadsProvider);
                },
              ),
            ),
        ],
      ),
    );
  }
}

/// `/assistant?q=…`
Widget assistantRoute(GoRouterState s) => AssistantScreen(initial: s.uri.queryParameters['q']);
