import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../app/calendar.dart' show urlOpenerProvider;
import '../app/state.dart';
import '../app/today.dart';
import '../design/controls.dart';
import '../design/glass.dart';
import '../design/theme.dart';
import '../design/toast.dart';
import 'common.dart';
import 'connections.dart';
import 'sheets.dart';

// ------------------------------------------------------------------ data (spec 0008 B)

final githubWorkProvider = FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) async {
  final conns = await ref.watch(connectionsProvider.future);
  if (!conns.any((c) => c.provider == 'github')) return const [];
  final r = await ref.read(apiProvider).get<List<dynamic>>('/connections/github/work');
  return [for (final x in r) Map<String, dynamic>.from(x as Map)];
});

final mailProvider = FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) async {
  final r = await ref.read(apiProvider).get<List<dynamic>>('/connections/mail');
  return [for (final x in r) Map<String, dynamic>.from(x as Map)];
});

String _pad(int n) => n.toString().padLeft(2, '0');
String _day(DateTime d) => '${d.year}-${_pad(d.month)}-${_pad(d.day)}';
const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
String _short(DateTime d) => '${d.day} ${_months[d.month - 1]}';

ChoiceChip _chip(BuildContext context, String label, bool on, VoidCallback tap) {
  final l = context.orv;
  return ChoiceChip(
    label: Text(label),
    selected: on,
    showCheckmark: false,
    onSelected: (_) => tap(),
    selectedColor: l.accent.withValues(alpha: 0.16),
    side: BorderSide(color: on ? l.accent : l.c.edge),
    backgroundColor: Colors.transparent,
  );
}

// ------------------------------------------------------------------ connect a mailbox

/// Zoho (and Outlook, Yahoo, iCloud, any IMAP) with an app password. Read-only.
class MailboxSheet extends ConsumerStatefulWidget {
  const MailboxSheet({super.key});
  @override
  ConsumerState<MailboxSheet> createState() => _MailboxSheetState();
}

class _MailboxSheetState extends ConsumerState<MailboxSheet> {
  final _email = TextEditingController();
  final _pass = TextEditingController();
  final _host = TextEditingController();
  List<Map<String, dynamic>> _presets = const [];
  String _provider = 'zoho';
  bool _busy = false;
  String? _problem;

  @override
  void initState() {
    super.initState();
    for (final c in [_email, _pass, _host]) {
      c.addListener(() => setState(() {}));
    }
    ref.read(apiProvider).get<List<dynamic>>('/connections/providers').then((r) {
      final mail = r.cast<Map<dynamic, dynamic>>().where((p) => p['id'] == 'mail').firstOrNull;
      if (!mounted || mail == null) return;
      setState(
        () => _presets = [
          for (final p in (mail['mailProviders'] as List? ?? const [])) Map<String, dynamic>.from(p as Map),
        ],
      );
    }, onError: (_) {});
  }

  @override
  void dispose() {
    _email.dispose();
    _pass.dispose();
    _host.dispose();
    super.dispose();
  }

  bool get _ok =>
      RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(_email.text.trim()) &&
      _pass.text.trim().length >= 4 &&
      (_provider != 'custom' || _host.text.trim().length > 3);

  Future<void> _connect() async {
    setState(() {
      _busy = true;
      _problem = null;
    });
    final toaster = Toaster.of(context);
    try {
      final r = await ref.read(apiProvider).post<Map<String, dynamic>>('/connections/mail', {
        'provider': _provider,
        'email': _email.text.trim(),
        'password': _pass.text,
        if (_provider == 'custom') 'host': _host.text.trim(),
      });
      ref.invalidate(connectionsProvider);
      ref.invalidate(mailProvider);
      if (mounted) Navigator.of(context).pop();
      toaster.show('Mailbox connected', body: r['account'] as String?, tone: ToastTone.success);
    } catch (e) {
      setState(() => _problem = messageFor(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final preset = _presets.where((p) => p['id'] == _provider).firstOrNull;
    return StickySheet(
      title: 'Connect a mailbox',
      footer: Align(
        alignment: Alignment.centerRight,
        child: OrvButton(
          label: 'Connect',
          variant: ButtonVariant.primary,
          loading: _busy,
          onPressed: _ok ? _connect : null,
        ),
      ),
      children: [
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            for (final p in _presets)
              _chip(
                context,
                p['name'] as String,
                _provider == p['id'],
                () => setState(() => _provider = p['id'] as String),
              ),
          ],
        ),
        if (preset != null) ...[
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(color: l.c.field, borderRadius: BorderRadius.circular(OrvTokens.radiusMd)),
            child: Text(preset['help'] as String, style: OrvText.muted(l).copyWith(fontSize: 12.5)),
          ),
        ],
        const SizedBox(height: 10),
        OrvField(label: 'Email address', controller: _email, keyboardType: TextInputType.emailAddress),
        if (_provider == 'custom') ...[
          const SizedBox(height: 8),
          OrvField(label: 'IMAP host', controller: _host, hint: 'imap.example.com (port 993, TLS)'),
        ],
        const SizedBox(height: 8),
        OrvField(label: 'App password', controller: _pass, obscure: true, error: _problem),
        const SizedBox(height: 6),
        Text(
          'An app password made for ORVYN, not your normal one. ORVYN only reads: nothing is marked read, moved or sent.',
          style: OrvText.muted(l).copyWith(fontSize: 12),
        ),
      ],
    );
  }
}

// ------------------------------------------------------------------ From your tools (Today)

/// ClickUp tasks and GitHub work, under the list: tick, change a day, add to ClickUp, close an issue.
class FromYourToolsSection extends ConsumerWidget {
  const FromYourToolsSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final conns = ref.watch(connectionsProvider).value ?? const [];
    final hasCu = conns.any((c) => c.provider == 'clickup');
    final hasGh = conns.any((c) => c.provider == 'github');
    if (!hasCu && !hasGh) return const SizedBox.shrink();
    final tasks = ref.watch(clickupTasksProvider).value ?? const [];
    final work = ref.watch(githubWorkProvider).value ?? const [];
    final toaster = Toaster.of(context);
    final api = ref.read(apiProvider);
    final open = ref.read(urlOpenerProvider);

    Future<void> setDue(Map<String, dynamic> t) async {
      final now = DateTime.now();
      final cur = t['due'] == null ? null : DateTime.parse(t['due'] as String).toLocal();
      final d = await showDatePicker(
        context: context,
        initialDate: cur ?? now,
        firstDate: now.subtract(const Duration(days: 365)),
        lastDate: now.add(const Duration(days: 365 * 3)),
      );
      if (d == null) return;
      try {
        await api.patch<dynamic>('/connections/clickup/tasks/${Uri.encodeComponent(t['id'] as String)}/due', {
          'connectionId': t['connectionId'],
          'dueDate': _day(d),
        });
        ref.invalidate(clickupTasksProvider);
        toaster.show('Due ${_short(d)} in ClickUp', tone: ToastTone.success);
      } catch (_) {
        toaster.show('ClickUp didn’t take it', tone: ToastTone.danger);
      }
    }

    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Glass(
        padding: const EdgeInsets.fromLTRB(14, 10, 6, 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(child: Text('FROM YOUR TOOLS', style: OrvText.label(l))),
                if (hasCu)
                  TextButton.icon(
                    icon: const Icon(LucideIcons.listPlus, size: 16),
                    label: const Text('Add to ClickUp'),
                    onPressed: () => showGlassSheet<void>(context, (_) => const ClickUpAddSheet()),
                  ),
              ],
            ),
            if (hasCu) ...[
              _SubHead(provider: 'clickup', text: 'ClickUp · ${tasks.length} open'),
              if (tasks.isEmpty) _Quiet('Nothing assigned to you.'),
              for (final t in tasks.take(10))
                _ToolRow(
                  leading: IconButton(
                    tooltip: 'Done: ${t['name']}',
                    icon: Icon(LucideIcons.circle, color: l.c.muted),
                    onPressed: () async {
                      try {
                        await api.post<dynamic>(
                          '/connections/clickup/tasks/${Uri.encodeComponent(t['id'] as String)}/complete',
                          {'connectionId': t['connectionId']},
                        );
                        ref.invalidate(clickupTasksProvider);
                        toaster.show('Closed in ClickUp', body: t['name'] as String, tone: ToastTone.success);
                      } catch (_) {
                        toaster.show('ClickUp didn’t take it', tone: ToastTone.danger);
                      }
                    },
                  ),
                  title: t['name'] as String,
                  sub:
                      '${t['list']} · ${t['status']}${t['due'] == null ? '' : ' · due ${_short(DateTime.parse(t['due'] as String).toLocal())}'}',
                  onTap: () => open(Uri.parse(t['url'] as String)),
                  trailing: IconButton(
                    tooltip: 'Change the due day',
                    icon: Icon(LucideIcons.calendarClock, size: 18, color: l.c.muted),
                    onPressed: () => setDue(t),
                  ),
                ),
            ],
            if (hasGh) ...[
              _SubHead(provider: 'github', text: 'GitHub · ${work.length} waiting'),
              if (work.isEmpty) _Quiet('No issues or reviews waiting for you.'),
              for (final w in work.take(10))
                _ToolRow(
                  leading: w['kind'] == 'issue'
                      ? IconButton(
                          tooltip: 'Close issue: ${w['title']}',
                          icon: Icon(LucideIcons.circleDot, color: l.c.muted),
                          onPressed: () async {
                            try {
                              await api.post<dynamic>('/connections/github/issues/close', {
                                'connectionId': w['connectionId'],
                                'repo': w['repo'],
                                'number': w['number'],
                              });
                              ref.invalidate(githubWorkProvider);
                              toaster.show(
                                'Issue closed on GitHub',
                                body: '${w['repo']} #${w['number']}',
                                tone: ToastTone.success,
                              );
                            } catch (_) {
                              toaster.show('GitHub didn’t take it', tone: ToastTone.danger);
                            }
                          },
                        )
                      : Padding(
                          padding: const EdgeInsets.all(12),
                          child: Icon(LucideIcons.gitPullRequest, size: 22, color: l.accent),
                        ),
                  title: w['title'] as String,
                  sub: '${w['kind'] == 'review' ? 'Review requested · ' : ''}${w['repo']} #${w['number']}',
                  onTap: () => open(Uri.parse(w['url'] as String)),
                ),
            ],
          ],
        ),
      ),
    );
  }
}

class _SubHead extends StatelessWidget {
  const _SubHead({required this.provider, required this.text});
  final String provider;
  final String text;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 6, bottom: 2),
    child: Row(
      children: [
        ProviderMark(provider: provider, size: 18),
        const SizedBox(width: 8),
        Text(text, style: OrvText.muted(context.orv).copyWith(fontSize: 12, fontWeight: FontWeight.w600)),
      ],
    ),
  );
}

class _Quiet extends StatelessWidget {
  const _Quiet(this.text);
  final String text;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 6),
    child: Text(text, style: OrvText.muted(context.orv)),
  );
}

class _ToolRow extends StatelessWidget {
  const _ToolRow({required this.leading, required this.title, required this.sub, required this.onTap, this.trailing});
  final Widget leading;
  final String title;
  final String sub;
  final VoidCallback onTap;
  final Widget? trailing;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return Row(
      children: [
        leading,
        Expanded(
          child: GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: onTap,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: OrvText.body(l), maxLines: 1, overflow: TextOverflow.ellipsis),
                Text(sub, style: OrvText.muted(l).copyWith(fontSize: 12), maxLines: 1, overflow: TextOverflow.ellipsis),
              ],
            ),
          ),
        ),
        ?trailing,
      ],
    );
  }
}

/// A new ClickUp task in a chosen list, assigned to me, with an optional day.
class ClickUpAddSheet extends ConsumerStatefulWidget {
  const ClickUpAddSheet({super.key});
  @override
  ConsumerState<ClickUpAddSheet> createState() => _ClickUpAddSheetState();
}

class _ClickUpAddSheetState extends ConsumerState<ClickUpAddSheet> {
  final _name = TextEditingController();
  List<Map<String, dynamic>>? _lists;
  Map<String, dynamic>? _list;
  DateTime? _due;
  bool _busy = false;
  String? _problem;

  @override
  void initState() {
    super.initState();
    _name.addListener(() => setState(() {}));
    ref.read(apiProvider).get<List<dynamic>>('/connections/clickup/lists').then((r) {
      if (!mounted) return;
      setState(() {
        _lists = [for (final x in r) Map<String, dynamic>.from(x as Map)];
        _list = _lists!.firstOrNull;
      });
    }, onError: (_) => mounted ? setState(() => _lists = const []) : null);
  }

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _add() async {
    setState(() {
      _busy = true;
      _problem = null;
    });
    final toaster = Toaster.of(context);
    try {
      await ref.read(apiProvider).post<dynamic>('/connections/clickup/tasks', {
        'connectionId': _list!['connectionId'],
        'listId': _list!['id'],
        'name': _name.text.trim(),
        'dueDate': _due == null ? null : _day(_due!),
      });
      ref.invalidate(clickupTasksProvider);
      if (mounted) Navigator.of(context).pop();
      toaster.show('Added to ClickUp', body: _name.text.trim(), tone: ToastTone.success);
    } catch (e) {
      setState(() => _problem = messageFor(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return StickySheet(
      title: 'Add to ClickUp',
      footer: Align(
        alignment: Alignment.centerRight,
        child: OrvButton(
          label: 'Add',
          variant: ButtonVariant.primary,
          loading: _busy,
          onPressed: _name.text.trim().isEmpty || _list == null ? null : _add,
        ),
      ),
      children: [
        OrvField(label: 'Task', controller: _name, autofocus: true, error: _problem),
        const SizedBox(height: 10),
        Text('LIST', style: OrvText.label(l)),
        const SizedBox(height: 6),
        if (_lists == null)
          const LinearProgressIndicator(minHeight: 2)
        else
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final x in _lists!)
                _chip(context, '${x['space']} · ${x['name']}', identical(_list, x), () => setState(() => _list = x)),
            ],
          ),
        const SizedBox(height: 10),
        Row(
          children: [
            Expanded(child: Text(_due == null ? 'No due day' : 'Due ${_short(_due!)}', style: OrvText.body(l))),
            TextButton(
              onPressed: () async {
                final now = DateTime.now();
                final d = await showDatePicker(
                  context: context,
                  initialDate: _due ?? now,
                  firstDate: now.subtract(const Duration(days: 30)),
                  lastDate: now.add(const Duration(days: 365 * 3)),
                );
                if (d != null) setState(() => _due = d);
              },
              child: Text(_due == null ? 'Pick a day' : 'Change'),
            ),
          ],
        ),
      ],
    );
  }
}

// ------------------------------------------------------------------ mail on Home, and mail into tasks

/// Unread mail across Gmail and connected mailboxes; "Task" turns one into a task you confirm.
class MailSection extends ConsumerWidget {
  const MailSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final boxes = ref.watch(mailProvider).value ?? const [];
    if (boxes.isEmpty) return const SizedBox.shrink();
    final total = boxes.fold<int>(0, (a, b) => a + ((b['unread'] as num?)?.toInt() ?? 0));
    final items = [
      for (final b in boxes)
        for (final i in (b['items'] as List? ?? const []))
          {...Map<String, dynamic>.from(i as Map), 'account': b['account']},
    ].take(5).toList();
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Glass(
        padding: const EdgeInsets.fromLTRB(14, 12, 6, 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Icon(LucideIcons.mail, size: 15, color: l.accent),
                const SizedBox(width: 8),
                Expanded(child: Text('MAIL', style: OrvText.label(l))),
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: Text('$total unread', style: OrvText.muted(l).copyWith(fontSize: 12)),
                ),
              ],
            ),
            for (final b in boxes.where((b) => b['problem'] != null))
              Text(
                '${b['account']}: ${b['problem']}',
                style: OrvText.muted(l).copyWith(fontSize: 12, color: l.c.danger),
              ),
            if (items.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: Text('Nothing unread this week.', style: OrvText.muted(l)),
              ),
            for (final m in items)
              Row(
                children: [
                  Expanded(
                    child: GestureDetector(
                      behavior: HitTestBehavior.opaque,
                      onTap: m['url'] == null ? null : () => ref.read(urlOpenerProvider)(Uri.parse(m['url'] as String)),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(vertical: 6),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              m['subject'] as String,
                              style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                            Text(
                              (m['from'] as String).replaceAll(RegExp('<.*>'), '').trim(),
                              style: OrvText.muted(l).copyWith(fontSize: 12),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                  TextButton(
                    onPressed: () => showGlassSheet<void>(context, (_) => MailTaskSheet(mail: m)),
                    child: Text('Task', semanticsLabel: 'Make a task: ${m['subject']}'),
                  ),
                ],
              ),
          ],
        ),
      ),
    );
  }
}

/// ORVYN fills the task from the mail (its own parser first); the person edits and saves. Nothing is made without Save.
class MailTaskSheet extends ConsumerStatefulWidget {
  const MailTaskSheet({super.key, required this.mail});
  final Map<String, dynamic> mail;
  @override
  ConsumerState<MailTaskSheet> createState() => _MailTaskSheetState();
}

class _MailTaskSheetState extends ConsumerState<MailTaskSheet> {
  final _title = TextEditingController();
  final _notes = TextEditingController();
  String? _dueDate;
  String? _dueAt;
  bool _loaded = false;
  bool _smart = false;
  bool _smartBusy = false;

  @override
  void initState() {
    super.initState();
    _title.addListener(() => setState(() {}));
    _ask(false);
  }

  @override
  void dispose() {
    _title.dispose();
    _notes.dispose();
    super.dispose();
  }

  Future<void> _ask(bool smart) async {
    final m = widget.mail;
    try {
      final r = await ref.read(apiProvider).post<Map<String, dynamic>>('/connections/mail/task', {
        'subject': m['subject'],
        'from': m['from'],
        'snippet': m['snippet'] ?? '',
        'url': m['url'],
        'smart': smart,
      });
      if (!mounted) return;
      if (smart && r['smart'] != true) Toaster.of(context).show('The AI is off or paused; kept ORVYN’s own reading');
      setState(() {
        _title.text = r['title'] as String;
        _notes.text = r['notes'] as String? ?? '';
        _dueDate = r['dueDate'] as String?;
        _dueAt = r['dueAt'] as String?;
        _smart = r['smart'] == true;
        _loaded = true;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        if (!_loaded) {
          _title.text = m['subject'] as String;
          _notes.text = 'From: ${m['from']}';
        }
        _loaded = true;
      });
    }
  }

  Future<void> _save() async {
    await ref.read(todayActionsProvider).addParsed({
      'title': _title.text.trim(),
      'dueDate': _dueAt == null ? _dueDate : null,
      'dueAt': _dueAt,
      'notes': _notes.text,
    }, source: 'email');
    if (!mounted) return;
    Toaster.of(context).show('Task added', body: _title.text.trim(), tone: ToastTone.success);
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final due = _dueAt != null
        ? DateTime.parse(_dueAt!).toLocal()
        : _dueDate != null
        ? DateTime.parse(_dueDate!)
        : null;
    return StickySheet(
      title: 'Make a task',
      footer: Align(
        alignment: Alignment.centerRight,
        child: OrvButton(
          label: 'Save task',
          variant: ButtonVariant.primary,
          onPressed: !_loaded || _title.text.trim().isEmpty ? null : _save,
        ),
      ),
      children: [
        Text(widget.mail['subject'] as String, style: OrvText.muted(l), maxLines: 2, overflow: TextOverflow.ellipsis),
        const SizedBox(height: 10),
        if (!_loaded)
          const LinearProgressIndicator(minHeight: 2)
        else ...[
          OrvField(label: 'Task', controller: _title),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(child: Text(due == null ? 'No due day' : 'Due ${_short(due)}', style: OrvText.body(l))),
              TextButton(
                onPressed: () async {
                  final now = DateTime.now();
                  final d = await showDatePicker(
                    context: context,
                    initialDate: due ?? now,
                    firstDate: now.subtract(const Duration(days: 30)),
                    lastDate: now.add(const Duration(days: 365 * 3)),
                  );
                  if (d != null) {
                    setState(() {
                      _dueDate = _day(d);
                      _dueAt = null;
                    });
                  }
                },
                child: Text(due == null ? 'Pick a day' : 'Change'),
              ),
            ],
          ),
          const SizedBox(height: 8),
          OrvField(label: 'Notes', controller: _notes, maxLines: 3),
          const SizedBox(height: 8),
          Row(
            children: [
              TextButton.icon(
                icon: _smartBusy
                    ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(LucideIcons.sparkles, size: 16),
                label: Text(_smart ? 'Read by AI' : 'Read it smarter'),
                onPressed: _smart || _smartBusy
                    ? null
                    : () async {
                        setState(() => _smartBusy = true);
                        await _ask(true);
                        if (mounted) setState(() => _smartBusy = false);
                      },
              ),
              Expanded(
                child: Text('Cheapest model; you still decide.', style: OrvText.muted(l).copyWith(fontSize: 12)),
              ),
            ],
          ),
        ],
      ],
    );
  }
}
