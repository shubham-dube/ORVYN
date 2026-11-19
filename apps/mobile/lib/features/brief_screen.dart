import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../app/state.dart';
import '../design/controls.dart';
import '../design/glass.dart';
import '../design/theme.dart';
import '../design/toast.dart';
import '../money/money.dart' show formatMoney;
import 'common.dart';
import 'sheets.dart';

/// The Brief (spec 0009): today's look, and its settings.
final briefProvider = FutureProvider.autoDispose<Map<String, dynamic>>(
  (ref) => ref.read(apiProvider).get<Map<String, dynamic>>('/brief/today'),
);
final briefSettingsProvider = FutureProvider.autoDispose<Map<String, dynamic>>(
  (ref) => ref.read(apiProvider).get<Map<String, dynamic>>('/brief/settings'),
);

const _sectionName = {
  'agenda': 'Your day',
  'money': 'Money',
  'drop': 'Drop',
  'library': 'Running out',
  'work': 'From your tools',
  'mail': 'Mail',
};
const _sectionIcon = {
  'agenda': LucideIcons.calendarDays,
  'money': LucideIcons.wallet,
  'drop': LucideIcons.inbox,
  'library': LucideIcons.bookOpen,
  'work': LucideIcons.gitPullRequest,
  'mail': LucideIcons.mail,
};
const _sectionRoute = {
  'agenda': '/today',
  'money': '/money',
  'drop': '/drop',
  'library': '/library',
  'work': '/today',
  'mail': '/mail',
};
const _nudgeName = {
  'slipped': ('Things that slipped', '3 or more overdue tasks, with “Move to today”'),
  'budget': ('Budget drifting', 'A budget at 80% early in the month, or used up'),
  'payments': ('Payments waiting', '5 or more captured payments not looked at'),
  'drop': ('Drop piling up', '3 or more things waiting for a day'),
};

String _time(String iso) {
  final d = DateTime.parse(iso).toLocal();
  return '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
}

class BriefScreen extends ConsumerWidget {
  const BriefScreen({super.key, this.openSettings = false});
  final bool openSettings;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final brief = ref.watch(briefProvider);
    final settings = ref.watch(briefSettingsProvider).value;
    final loc = MaterialLocalizations.of(context);
    return OrvModule(
      module: 'brief',
      child: Builder(
        builder: (context) {
          final l = context.orv;
          final b = brief.value;
          void settingsSheet() {
            if (settings == null) return;
            showGlassSheet<void>(context, (_) => BriefSettingsSheet(value: settings));
          }

          return RefreshIndicator(
            color: l.accent,
            onRefresh: () async {
              await ref.read(apiProvider).post<dynamic>('/brief/today/refresh');
              ref.invalidate(briefProvider);
            },
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 56, 16, 120),
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Expanded(child: PageTitle('Brief', overline: loc.formatFullDate(DateTime.now()))),
                    Padding(
                      padding: const EdgeInsets.only(bottom: 14),
                      child: IconButton(
                        tooltip: 'Brief settings',
                        icon: Icon(LucideIcons.settings2, color: l.c.muted),
                        onPressed: settingsSheet,
                      ),
                    ),
                  ],
                ),
                if (b != null)
                  Glass(
                    level: GlassLevel.float,
                    padding: const EdgeInsets.all(18),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(LucideIcons.sunrise, color: l.accent),
                        const SizedBox(height: 8),
                        Text(b['headline'] as String, style: OrvText.heading(l).copyWith(fontSize: 21)),
                        const SizedBox(height: 4),
                        Text(b['line'] as String, style: OrvText.muted(l)),
                      ],
                    ),
                  )
                else if (brief.hasError)
                  Text('Couldn’t build your Brief. Pull to try again.', style: OrvText.muted(l))
                else
                  const LinearProgressIndicator(minHeight: 2),
                if (settings != null && settings['enabled'] != true) ...[
                  const SizedBox(height: 12),
                  Glass(
                    padding: const EdgeInsets.fromLTRB(14, 12, 10, 12),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            'Get this every morning as one quiet notification, and only the nudges that matter.',
                            style: OrvText.body(l).copyWith(fontSize: 14),
                          ),
                        ),
                        const SizedBox(width: 8),
                        OrvButton(
                          label: 'Turn it on',
                          small: true,
                          variant: ButtonVariant.primary,
                          onPressed: settingsSheet,
                        ),
                      ],
                    ),
                  ),
                ],
                for (final raw in (b?['sections'] as List? ?? const []))
                  _Section(section: Map<String, dynamic>.from(raw as Map)),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.section});
  final Map<String, dynamic> section;

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final kind = section['kind'] as String;
    Widget row(String left, [String? right, Color? tone]) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Expanded(child: Text(left, style: OrvText.body(l).copyWith(fontSize: 14.5))),
          if (right != null) Text(right, style: OrvText.muted(l).copyWith(fontSize: 13, color: tone)),
        ],
      ),
    );
    final rows = <Widget>[];
    switch (kind) {
      case 'agenda':
        final events = (section['events'] as List).cast<Map<String, dynamic>>();
        if (events.isEmpty) rows.add(row('No meetings'));
        for (final e in events) {
          rows.add(
            row(
              e['title'] as String,
              e['allDay'] == true || e['at'] == null
                  ? 'all day'
                  : '${_time(e['at'] as String)}${e['until'] == null ? '' : '–${_time(e['until'] as String)}'}',
            ),
          );
        }
        rows.add(Divider(height: 14, color: l.c.edge));
        rows.add(
          Text(
            '${section['dueToday']} due today${(section['overdue'] as int) > 0 ? ' · ${section['overdue']} overdue' : ''}',
            style: OrvText.muted(l).copyWith(fontSize: 12.5),
          ),
        );
        for (final t in (section['top'] as List).cast<Map<String, dynamic>>()) {
          rows.add(row(t['title'] as String, t['overdue'] == true ? 'overdue' : null, l.c.warning));
        }
      case 'money':
        rows.add(row('Yesterday', formatMoney((section['yesterdayMinor'] as num).toInt())));
        rows.add(row('This month', formatMoney((section['monthMinor'] as num).toInt())));
        for (final b in (section['budgets'] as List).cast<Map<String, dynamic>>()) {
          final spent = (b['spentMinor'] as num).toInt(), amount = (b['amountMinor'] as num).toInt();
          rows.add(
            row(
              '${b['name']} budget',
              '${(spent * 100 / amount).round()}% of ${formatMoney(amount)}',
              spent >= amount ? l.c.danger : l.c.warning,
            ),
          );
        }
        if ((section['toReview'] as int) > 0) rows.add(row('${section['toReview']} payments to look at'));
      case 'drop':
        final n = section['waiting'] as int;
        rows.add(row('$n ${n == 1 ? 'thing waits' : 'things wait'} for a decision'));
      case 'library':
        for (final d in (section['expiring'] as List).cast<Map<String, dynamic>>()) {
          rows.add(row(d['title'] as String, d['days'] == 0 ? 'today' : 'in ${d['days']} d', l.c.warning));
        }
      case 'work':
        if ((section['reviews'] as int) > 0) rows.add(row('Reviews waiting for you', '${section['reviews']}'));
        if ((section['issues'] as int) > 0) rows.add(row('GitHub issues assigned', '${section['issues']}'));
        if ((section['clickup'] as int) > 0) rows.add(row('ClickUp tasks', '${section['clickup']}'));
      case 'mail':
        for (final b in (section['boxes'] as List).cast<Map<String, dynamic>>()) {
          rows.add(row(b['account'] as String, '${b['unread']} unread'));
        }
    }
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Glass(
        blur: false,
        padding: const EdgeInsets.fromLTRB(16, 12, 12, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Icon(_sectionIcon[kind], size: 16, color: l.accent),
                const SizedBox(width: 8),
                Expanded(child: Text(_sectionName[kind]!.toUpperCase(), style: OrvText.label(l))),
                TextButton(
                  onPressed: () =>
                      kind == 'mail' ? context.push(_sectionRoute[kind]!) : context.go(_sectionRoute[kind]!),
                  child: const Text('Open'),
                ),
              ],
            ),
            ...rows,
          ],
        ),
      ),
    );
  }
}

/// When the Brief comes, what it carries and which nudges may come; saved together.
class BriefSettingsSheet extends ConsumerStatefulWidget {
  const BriefSettingsSheet({super.key, required this.value});
  final Map<String, dynamic> value;
  @override
  ConsumerState<BriefSettingsSheet> createState() => _BriefSettingsSheetState();
}

class _BriefSettingsSheetState extends ConsumerState<BriefSettingsSheet> {
  late bool _enabled = widget.value['enabled'] == true;
  late String _at = widget.value['at'] as String? ?? '07:30';
  late final Set<String> _sections = {...(widget.value['sections'] as List).cast<String>()};
  late final Map<String, dynamic> _n = Map<String, dynamic>.from(widget.value['nudges'] as Map);
  late bool _nudges = _n['enabled'] == true;
  late final Set<String> _kinds = {...(_n['kinds'] as List).cast<String>()};
  late int _max = (_n['max'] as num).toInt();
  bool _busy = false;

  Future<void> _save() async {
    setState(() => _busy = true);
    final toaster = Toaster.of(context);
    try {
      await ref.read(apiProvider).put<dynamic>('/brief/settings', {
        'enabled': _enabled,
        'at': _at,
        'sections': [
          for (final k in _sectionName.keys)
            if (_sections.contains(k)) k,
        ],
        'nudges': {
          'enabled': _nudges,
          'kinds': [
            for (final k in _nudgeName.keys)
              if (_kinds.contains(k)) k,
          ],
          'max': _max,
        },
      });
      ref.invalidate(briefSettingsProvider);
      if (mounted) Navigator.of(context).pop();
      toaster.show(_enabled ? 'Your Brief comes at $_at' : 'Brief turned off', tone: ToastTone.success);
    } catch (e) {
      toaster.show('Couldn’t save', body: messageFor(e), tone: ToastTone.danger);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return StickySheet(
      title: 'Brief settings',
      footer: Row(
        children: [
          Expanded(child: Text('No AI; nothing leaves the server.', style: OrvText.muted(l).copyWith(fontSize: 12))),
          OrvButton(label: 'Save', variant: ButtonVariant.primary, loading: _busy, onPressed: _save),
        ],
      ),
      children: [
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: Text('Morning Brief', style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600)),
          subtitle: Text(
            'One notification at $_at. Replaces Today’s morning summary.',
            style: OrvText.muted(l).copyWith(fontSize: 12),
          ),
          value: _enabled,
          onChanged: (v) => setState(() => _enabled = v),
        ),
        Row(
          children: [
            Expanded(child: Text('Time', style: OrvText.body(l))),
            TextButton(
              onPressed: () async {
                final p = _at.split(':');
                final t = await showTimePicker(
                  context: context,
                  initialTime: TimeOfDay(hour: int.parse(p[0]), minute: int.parse(p[1])),
                );
                if (t != null) {
                  setState(() => _at = '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}');
                }
              },
              child: Text(_at),
            ),
          ],
        ),
        const SizedBox(height: 6),
        Text('WHAT IT CARRIES', style: OrvText.label(l)),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            for (final e in _sectionName.entries)
              FilterChip(
                label: Text(e.value),
                selected: _sections.contains(e.key),
                showCheckmark: false,
                onSelected: (v) => setState(() => v ? _sections.add(e.key) : _sections.remove(e.key)),
                selectedColor: l.accent.withValues(alpha: 0.16),
                side: BorderSide(color: _sections.contains(e.key) ? l.accent : l.c.edge),
                backgroundColor: Colors.transparent,
              ),
          ],
        ),
        const SizedBox(height: 12),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: Text('Nudges during the day', style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600)),
          subtitle: Text('Between your Brief time and 8 pm.', style: OrvText.muted(l).copyWith(fontSize: 12)),
          value: _nudges,
          onChanged: (v) => setState(() => _nudges = v),
        ),
        for (final e in _nudgeName.entries)
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            dense: true,
            title: Text(e.value.$1, style: OrvText.body(l).copyWith(fontSize: 14)),
            subtitle: Text(e.value.$2, style: OrvText.muted(l).copyWith(fontSize: 12)),
            value: _kinds.contains(e.key),
            onChanged: !_nudges ? null : (v) => setState(() => v == true ? _kinds.add(e.key) : _kinds.remove(e.key)),
          ),
        Row(
          children: [
            Expanded(child: Text('At most a day', style: OrvText.body(l))),
            for (final n in [1, 2, 3])
              Padding(
                padding: const EdgeInsets.only(left: 6),
                child: ChoiceChip(
                  label: Text('$n'),
                  selected: _max == n,
                  showCheckmark: false,
                  onSelected: !_nudges ? null : (_) => setState(() => _max = n),
                  selectedColor: l.accent.withValues(alpha: 0.16),
                  side: BorderSide(color: _max == n ? l.accent : l.c.edge),
                  backgroundColor: Colors.transparent,
                ),
              ),
          ],
        ),
      ],
    );
  }
}

/// Home: the Brief's headline, one tap to the whole thing.
class BriefCard extends ConsumerWidget {
  const BriefCard({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final b = ref.watch(briefProvider).value;
    if (b == null) return const SizedBox.shrink();
    return OrvModule(
      module: 'brief',
      child: Builder(
        builder: (context) {
          final l = context.orv;
          return Padding(
            padding: const EdgeInsets.only(top: 12),
            child: Semantics(
              button: true,
              label: 'Open your Brief',
              excludeSemantics: true,
              child: GestureDetector(
                onTap: () => context.go('/brief'),
                child: Glass(
                  padding: const EdgeInsets.all(16),
                  child: Row(
                    children: [
                      Container(
                        width: 38,
                        height: 38,
                        decoration: BoxDecoration(gradient: l.accentGradient, borderRadius: BorderRadius.circular(11)),
                        child: const Icon(LucideIcons.sunrise, size: 19, color: Colors.white),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(b['headline'] as String, style: OrvText.body(l).copyWith(fontWeight: FontWeight.w700)),
                            Text(
                              b['line'] as String,
                              style: OrvText.muted(l).copyWith(fontSize: 12.5),
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ],
                        ),
                      ),
                      Icon(LucideIcons.chevronRight, size: 18, color: l.c.faint),
                    ],
                  ),
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}
