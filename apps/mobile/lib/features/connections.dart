import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../app/calendar.dart' show urlOpenerProvider;
import '../app/state.dart';
import '../design/controls.dart';
import '../design/glass.dart';
import '../design/theme.dart';
import '../design/toast.dart';
import 'common.dart';
import 'sheets.dart';

/// One connected account (spec 0007 C2): Google (calendar, meet, gmail) or ClickUp (tasks), several of each.
class Connection {
  Connection(this.data);
  final Map<String, dynamic> data;
  String get id => data['id'] as String;
  String get provider => data['provider'] as String;
  String get account => data['account'] as String;
  String get status => data['status'] as String? ?? 'active';
  List<String> get capabilities => ((data['capabilities'] as List?) ?? const []).cast<String>();
}

final connectionsProvider = FutureProvider.autoDispose<List<Connection>>((ref) async {
  final r = await ref.read(apiProvider).get<List<dynamic>>('/connections');
  return [for (final x in r) Connection(Map<String, dynamic>.from(x as Map))];
});

final clickupTasksProvider = FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) async {
  final conns = await ref.watch(connectionsProvider.future);
  if (!conns.any((c) => c.provider == 'clickup')) return const [];
  final r = await ref.read(apiProvider).get<List<dynamic>>('/connections/clickup/tasks');
  return [for (final x in r) Map<String, dynamic>.from(x as Map)];
});

Future<void> openMeetingSheet(BuildContext context) => showGlassSheet<void>(context, (_) => const MeetingSheet());

const _capName = {'calendar': 'Calendar', 'meet': 'Meet', 'gmail': 'Gmail', 'tasks': 'Tasks'};

/// Settings → Connections: every account, Gmail per Google account, ClickUp by token.
class ConnectionsPanel extends ConsumerWidget {
  const ConnectionsPanel({super.key});

  Future<void> _google(WidgetRef ref, BuildContext context, {String? hint, bool gmail = false}) async {
    final toaster = Toaster.of(context);
    try {
      final r = await ref
          .read(apiProvider)
          .post<Map<String, dynamic>>(
            '/calendar/google/start?${[if (hint != null) 'hint=${Uri.encodeComponent(hint)}', if (gmail) 'gmail=1'].join('&')}',
          );
      await ref.read(urlOpenerProvider)(Uri.parse(r['url'] as String));
    } catch (e) {
      toaster.show('Couldn’t start connecting', body: messageFor(e), tone: ToastTone.danger);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final list = ref.watch(connectionsProvider);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        switch (list) {
          AsyncData(:final value) when value.isEmpty => Text('Nothing connected yet.', style: OrvText.muted(l)),
          AsyncData(:final value) => Column(
            children: [
              for (final c in value)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Row(
                    children: [
                      _Mark(provider: c.provider),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(c.account, style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600)),
                            Text(
                              c.capabilities.map((k) => _capName[k] ?? k).join(' · ') +
                                  (c.status == 'active' ? '' : ' · needs attention'),
                              style: OrvText.muted(l).copyWith(fontSize: 12),
                            ),
                          ],
                        ),
                      ),
                      if (c.provider == 'google' && !c.capabilities.contains('gmail'))
                        TextButton(
                          onPressed: () => _google(ref, context, hint: c.account, gmail: true),
                          child: const Text('Add Gmail'),
                        ),
                      if (c.provider != 'google')
                        IconButton(
                          tooltip: 'Disconnect ${c.account}',
                          icon: Icon(LucideIcons.trash2, size: 18, color: l.c.muted),
                          onPressed: () async {
                            await ref.read(apiProvider).delete<dynamic>('/connections/${c.id}');
                            ref.invalidate(connectionsProvider);
                          },
                        ),
                    ],
                  ),
                ),
            ],
          ),
          AsyncError() => Text('Couldn’t load your connections.', style: OrvText.muted(l)),
          _ => const LinearProgressIndicator(minHeight: 2),
        },
        const SizedBox(height: 10),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            OrvButton(
              label: 'Google account',
              icon: LucideIcons.plus,
              small: true,
              onPressed: () => _google(ref, context),
            ),
            OrvButton(
              label: 'ClickUp',
              icon: LucideIcons.plus,
              small: true,
              onPressed: () => showGlassSheet<void>(context, (_) => const _ClickUpTokenSheet()),
            ),
          ],
        ),
        const SizedBox(height: 6),
        Text('Coming: Outlook, Notion, GitHub, Slack.', style: OrvText.muted(l).copyWith(fontSize: 12)),
      ],
    );
  }
}

class _Mark extends StatelessWidget {
  const _Mark({required this.provider});
  final String provider;
  @override
  Widget build(BuildContext context) {
    final colors = switch (provider) {
      'google' => const [Color(0xFF4285F4), Color(0xFF34A853)],
      'clickup' => const [Color(0xFF7B68EE), Color(0xFFFD71AF)],
      _ => const [Color(0xFF64748B), Color(0xFF334155)],
    };
    return Container(
      width: 34,
      height: 34,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(10),
        gradient: LinearGradient(colors: colors),
      ),
      child: Text(
        provider.isEmpty ? '?' : provider[0].toUpperCase(),
        style: const TextStyle(fontFamily: fontFamily, color: Colors.white, fontWeight: FontWeight.w700),
      ),
    );
  }
}

class _ClickUpTokenSheet extends ConsumerStatefulWidget {
  const _ClickUpTokenSheet();
  @override
  ConsumerState<_ClickUpTokenSheet> createState() => _ClickUpTokenSheetState();
}

class _ClickUpTokenSheetState extends ConsumerState<_ClickUpTokenSheet> {
  final _c = TextEditingController();
  bool _busy = false;
  String? _problem;

  @override
  void initState() {
    super.initState();
    _c.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  Future<void> _connect() async {
    setState(() {
      _busy = true;
      _problem = null;
    });
    final toaster = Toaster.of(context);
    try {
      final r = await ref.read(apiProvider).post<Map<String, dynamic>>('/connections/clickup', {
        'token': _c.text.trim(),
      });
      ref.invalidate(connectionsProvider);
      if (mounted) Navigator.of(context).pop();
      toaster.show('ClickUp connected', body: r['account'] as String?, tone: ToastTone.success);
    } catch (e) {
      setState(() => _problem = 'ClickUp didn’t accept that token. Copy it again from ClickUp.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return StickySheet(
      title: 'Connect ClickUp',
      footer: Align(
        alignment: Alignment.centerRight,
        child: OrvButton(
          label: 'Connect',
          variant: ButtonVariant.primary,
          loading: _busy,
          onPressed: _c.text.trim().length < 10 ? null : _connect,
        ),
      ),
      children: [
        OrvField(label: 'Personal API token', controller: _c, autofocus: true),
        const SizedBox(height: 6),
        Text(
          _problem ?? 'ClickUp → avatar → Settings → Apps → API Token (starts with pk_). Sealed on the server.',
          style: OrvText.muted(l).copyWith(fontSize: 12, color: _problem == null ? null : l.c.danger),
        ),
      ],
    );
  }
}

/// Schedule a meeting with a Google Meet link; Google emails the invitations (spec 0007 C2).
class MeetingSheet extends ConsumerStatefulWidget {
  const MeetingSheet({super.key});
  @override
  ConsumerState<MeetingSheet> createState() => _MeetingSheetState();
}

class _MeetingSheetState extends ConsumerState<MeetingSheet> {
  final _title = TextEditingController();
  final _who = TextEditingController();
  final _people = <String>[];
  late DateTime _start = () {
    final n = ref.read(clockProvider)().add(const Duration(hours: 1));
    return DateTime(
      n.year,
      n.month,
      n.day,
      n.hour,
      n.minute < 30 ? 30 : 0,
    ).add(n.minute < 30 ? Duration.zero : const Duration(hours: 1));
  }();
  int _minutes = 30;
  bool _meet = true;
  String? _accountId;
  bool _busy = false;
  Map<String, dynamic>? _done;

  static final _email = RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$');

  @override
  void initState() {
    super.initState();
    _title.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _title.dispose();
    _who.dispose();
    super.dispose();
  }

  void _add(String raw) {
    final found = raw.split(RegExp(r'[\s,;]+')).map((x) => x.trim().toLowerCase()).where(_email.hasMatch);
    setState(() {
      for (final f in found) {
        if (!_people.contains(f)) _people.add(f);
      }
      _who.clear();
    });
  }

  Future<void> _submit() async {
    if (_who.text.trim().isNotEmpty) _add(_who.text);
    setState(() => _busy = true);
    final toaster = Toaster.of(context);
    try {
      final r = await ref.read(apiProvider).post<Map<String, dynamic>>('/calendar/meetings', {
        'accountId': _accountId,
        'title': _title.text.trim(),
        'start': _start.toUtc().toIso8601String(),
        'end': _start.add(Duration(minutes: _minutes)).toUtc().toIso8601String(),
        'timeZone': 'Asia/Kolkata',
        'attendees': _people,
        'meet': _meet,
      });
      setState(() => _done = r);
    } catch (e) {
      toaster.show('Couldn’t schedule it', body: messageFor(e), tone: ToastTone.danger);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final loc = MaterialLocalizations.of(context);
    final conns = ref.watch(connectionsProvider);
    final accounts = (conns.value ?? const <Connection>[]).where((c) => c.capabilities.contains('meet')).toList();
    if (_accountId == null && accounts.isNotEmpty) _accountId = accounts.first.id;

    if (conns.hasValue && accounts.isEmpty) {
      return Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Schedule a meeting', style: OrvText.heading(l)),
            const SizedBox(height: 8),
            Text(
              'Connect a Google account first (Settings → Connections) — then ORVYN makes the Meet link and Google '
              'sends the invitations.',
              style: OrvText.muted(l),
            ),
          ],
        ),
      );
    }

    if (_done != null) {
      final link = _done!['meetUrl'] as String?;
      return StickySheet(
        title: 'Meeting scheduled',
        footer: Align(
          alignment: Alignment.centerRight,
          child: OrvButton(label: 'Done', variant: ButtonVariant.primary, onPressed: () => Navigator.of(context).pop()),
        ),
        children: [
          Text('Google is emailing the invitations.', style: OrvText.muted(l)),
          if (link != null) ...[
            const SizedBox(height: 12),
            Glass(
              padding: const EdgeInsets.all(12),
              child: SelectableText(link, style: OrvText.body(l).copyWith(fontFamily: 'GeistMono', fontSize: 13)),
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              children: [
                OrvButton(
                  label: 'Copy link',
                  icon: LucideIcons.copy,
                  small: true,
                  onPressed: () async {
                    await Clipboard.setData(ClipboardData(text: link));
                    if (context.mounted) Toaster.of(context).show('Meet link copied', tone: ToastTone.success);
                  },
                ),
                OrvButton(
                  label: 'Join',
                  icon: LucideIcons.video,
                  small: true,
                  onPressed: () => ref.read(urlOpenerProvider)(Uri.parse(link)),
                ),
              ],
            ),
          ],
        ],
      );
    }

    ChoiceChip chip(String label, bool on, VoidCallback tap) => ChoiceChip(
      label: Text(label),
      selected: on,
      showCheckmark: false,
      onSelected: (_) => setState(tap),
      selectedColor: l.accent.withValues(alpha: 0.16),
      side: BorderSide(color: on ? l.accent : l.c.edge),
      backgroundColor: Colors.transparent,
    );

    return StickySheet(
      title: 'Schedule a meeting',
      footer: Row(
        children: [
          Expanded(
            child: Text(
              accounts.length == 1 ? 'From ${accounts.first.account}' : 'Google sends the invitations',
              style: OrvText.muted(l).copyWith(fontSize: 12),
              overflow: TextOverflow.ellipsis,
            ),
          ),
          OrvButton(
            label: 'Schedule',
            icon: LucideIcons.video,
            variant: ButtonVariant.primary,
            loading: _busy,
            onPressed: _title.text.trim().isEmpty || _accountId == null ? null : _submit,
          ),
        ],
      ),
      children: [
        OrvField(label: 'What', controller: _title),
        const SizedBox(height: 12),
        Row(
          children: [
            OrvButton(
              small: true,
              icon: LucideIcons.calendar,
              label: loc.formatMediumDate(_start),
              onPressed: () async {
                final d = await showDatePicker(
                  context: context,
                  initialDate: _start,
                  firstDate: DateTime.now().subtract(const Duration(days: 1)),
                  lastDate: DateTime.now().add(const Duration(days: 730)),
                );
                if (d != null) setState(() => _start = DateTime(d.year, d.month, d.day, _start.hour, _start.minute));
              },
            ),
            const SizedBox(width: 8),
            OrvButton(
              small: true,
              icon: LucideIcons.clock,
              label: loc.formatTimeOfDay(TimeOfDay.fromDateTime(_start)),
              onPressed: () async {
                final t = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(_start));
                if (t != null) {
                  setState(() => _start = DateTime(_start.year, _start.month, _start.day, t.hour, t.minute));
                }
              },
            ),
          ],
        ),
        const SizedBox(height: 10),
        Wrap(
          spacing: 6,
          children: [
            for (final m in const [15, 30, 45, 60, 90])
              chip(m < 60 ? '$m min' : (m == 60 ? '1 h' : '1½ h'), _minutes == m, () => _minutes = m),
          ],
        ),
        const SizedBox(height: 12),
        const SectionLabel('Who'),
        const SizedBox(height: 4),
        Wrap(
          spacing: 6,
          runSpacing: 4,
          children: [
            for (final p in _people)
              InputChip(
                label: Text(p),
                onDeleted: () => setState(() => _people.remove(p)),
                deleteButtonTooltipMessage: 'Remove $p',
              ),
          ],
        ),
        TextField(
          key: const Key('meeting-who'),
          controller: _who,
          keyboardType: TextInputType.emailAddress,
          textInputAction: TextInputAction.next,
          onChanged: (v) {
            if (RegExp(r'[,;\s]$').hasMatch(v)) _add(v);
          },
          onSubmitted: _add,
          style: OrvText.body(l),
          decoration: InputDecoration(
            hintText: 'raj@example.com',
            hintStyle: OrvText.muted(l).copyWith(color: l.c.faint),
            border: InputBorder.none,
          ),
        ),
        const SizedBox(height: 4),
        OrvSwitchRow(label: 'Add a Google Meet link', value: _meet, onChanged: (v) => setState(() => _meet = v)),
        if (accounts.length > 1) ...[
          const SizedBox(height: 8),
          const SectionLabel('From account'),
          Wrap(
            spacing: 6,
            children: [for (final a in accounts) chip(a.account, _accountId == a.id, () => _accountId = a.id)],
          ),
        ],
      ],
    );
  }
}

/// Today: open ClickUp tasks assigned to the person; tick closes them in ClickUp.
class ClickUpSection extends ConsumerWidget {
  const ClickUpSection({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final tasks = ref.watch(clickupTasksProvider).value;
    if (tasks == null || tasks.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Glass(
        padding: const EdgeInsets.fromLTRB(14, 12, 8, 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('FROM CLICKUP  ${tasks.length}', style: OrvText.label(l)),
            for (final t in tasks.take(10))
              Row(
                children: [
                  IconButton(
                    tooltip: 'Done: ${t['name']}',
                    icon: Icon(LucideIcons.circle, color: l.c.muted),
                    onPressed: () async {
                      final toaster = Toaster.of(context);
                      try {
                        await ref.read(apiProvider).post<dynamic>(
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
                  Expanded(
                    child: GestureDetector(
                      onTap: () => ref.read(urlOpenerProvider)(Uri.parse(t['url'] as String)),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(t['name'] as String, style: OrvText.body(l)),
                          Text('${t['list']} · ${t['status']}', style: OrvText.muted(l).copyWith(fontSize: 12)),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
          ],
        ),
      ),
    );
  }
}
