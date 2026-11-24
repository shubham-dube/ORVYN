import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../app/calendar.dart' show urlOpenerProvider;
import '../app/state.dart';
import '../design/controls.dart';
import '../design/glass.dart';
import '../design/theme.dart';
import '../design/toast.dart';
import '../money/money.dart' show formatMoney;
import 'common.dart';
import 'money_ui.dart' show SheetCard, SheetRule;
import 'sheets.dart';

typedef J = Map<String, dynamic>;

/// The Brief (spec 0009, spec 0016 B): your morning — the weather, what the AI made of the day, your three, the day
/// as a line with its free time, IPOs, money due and the markets.
final briefProvider = FutureProvider.autoDispose<J>((ref) => ref.read(apiProvider).get<J>('/brief/today'));
final briefSettingsProvider = FutureProvider.autoDispose<J>((ref) => ref.read(apiProvider).get<J>('/brief/settings'));

const _sectionName = {
  'weather': 'Weather',
  'focus': 'Your three for today',
  'agenda': 'Your day',
  'ipo': 'IPOs',
  'money': 'Money',
  'markets': 'Markets',
  'work': 'From your tools',
  'mail': 'Mail',
  'drop': 'Drop',
  'library': 'Running out',
  'yesterday': 'Yesterday',
};
const _sectionIcon = {
  'focus': LucideIcons.target,
  'agenda': LucideIcons.calendarDays,
  'ipo': LucideIcons.rocket,
  'money': LucideIcons.wallet,
  'markets': LucideIcons.chartLine,
  'drop': LucideIcons.inbox,
  'library': LucideIcons.bookOpen,
  'work': LucideIcons.gitPullRequest,
  'mail': LucideIcons.mail,
  'yesterday': LucideIcons.flame,
};
const _sectionRoute = {
  'focus': '/today',
  'agenda': '/today',
  'ipo': '/ipo',
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
  final h = d.hour % 12 == 0 ? 12 : d.hour % 12;
  return '$h:${d.minute.toString().padLeft(2, '0')}${d.hour < 12 ? ' am' : ' pm'}';
}

String _span(String a, String b) {
  final m = DateTime.parse(b).difference(DateTime.parse(a)).inMinutes;
  return m >= 60 ? '${m ~/ 60}h${m % 60 == 0 ? '' : ' ${m % 60}m'}' : '${m}m';
}

String _shortDay(String d) {
  const w = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  final x = DateTime.parse(d);
  return '${w[x.weekday - 1]} ${x.day} ${m[x.month - 1]}';
}

IconData skyIcon(num? code) {
  final c = code?.toInt();
  if (c == null) return LucideIcons.cloudSun;
  if (c == 0) return LucideIcons.sun;
  if (c <= 2) return LucideIcons.cloudSun;
  if (c == 3) return LucideIcons.cloud;
  if (c <= 48) return LucideIcons.cloudFog;
  if (c <= 57) return LucideIcons.cloudDrizzle;
  if (c <= 67 || (c >= 80 && c <= 82)) return LucideIcons.cloudRain;
  if (c <= 86) return LucideIcons.cloudSnow;
  return LucideIcons.cloudLightning;
}

class BriefScreen extends ConsumerWidget {
  const BriefScreen({super.key, this.openSettings = false});
  final bool openSettings;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final brief = ref.watch(briefProvider);
    final settings = ref.watch(briefSettingsProvider).value;
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

          final sections = [
            for (final raw in (b?['sections'] as List? ?? const [])) Map<String, dynamic>.from(raw as Map),
          ];
          final weather = sections.where((s) => s['kind'] == 'weather').firstOrNull;
          return RefreshIndicator(
            color: l.accent,
            onRefresh: () async {
              await ref.read(apiProvider).post<dynamic>('/brief/today/refresh');
              ref.invalidate(briefProvider);
            },
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 52, 16, 120),
              children: [
                if (b != null)
                  _Hero(b: b, weather: weather, onSettings: settingsSheet)
                else if (brief.hasError)
                  Text('Couldn’t build your Brief. Pull to try again.', style: OrvText.muted(l))
                else
                  const Padding(padding: EdgeInsets.only(top: 40), child: LinearProgressIndicator(minHeight: 2)),
                if (settings != null && settings['enabled'] != true) ...[
                  const SizedBox(height: 12),
                  Glass(
                    padding: const EdgeInsets.fromLTRB(14, 12, 10, 12),
                    child: Row(
                      children: [
                        Icon(LucideIcons.sunrise, color: l.accent),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            'Get this every morning as one quiet notification.',
                            style: OrvText.body(l).copyWith(fontSize: 14),
                          ),
                        ),
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
                if (settings != null && settings['place'] == null && (settings['sections'] as List).contains('weather'))
                  TextButton.icon(
                    onPressed: settingsSheet,
                    icon: const Icon(LucideIcons.cloudSun, size: 16),
                    label: const Text('Add your city for the weather'),
                  ),
                for (final s in sections)
                  if (s['kind'] != 'weather') _Section(section: s),
              ],
            ),
          );
        },
      ),
    );
  }
}

/// The top: the date, the greeting, the weather, and what the AI made of the day.
class _Hero extends StatelessWidget {
  const _Hero({required this.b, required this.weather, required this.onSettings});
  final J b;
  final J? weather;
  final VoidCallback onSettings;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final loc = MaterialLocalizations.of(context);
    final story = b['story'] as String?;
    final tip = b['tip'] as String?;
    final w = weather;
    return Container(
      padding: const EdgeInsets.fromLTRB(18, 16, 18, 18),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(OrvTokens.radiusXl),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [l.accent.withValues(alpha: 0.24), l.accent.withValues(alpha: 0.05)],
        ),
        border: Border.all(color: l.accent.withValues(alpha: 0.22)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  loc.formatFullDate(DateTime.parse('${b['day']}T12:00:00')),
                  style: OrvText.muted(l).copyWith(fontSize: 12.5, fontWeight: FontWeight.w600),
                ),
              ),
              IconButton(
                tooltip: 'Brief settings',
                visualDensity: VisualDensity.compact,
                icon: Icon(LucideIcons.settings2, size: 19, color: l.c.muted),
                onPressed: onSettings,
              ),
            ],
          ),
          Text(
            b['greeting'] as String? ?? 'Your Brief',
            style: OrvText.heading(l).copyWith(fontSize: 27, height: 1.15),
          ),
          if (w != null) ...[
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.fromLTRB(12, 10, 14, 10),
              decoration: BoxDecoration(color: l.c.glassStrong, borderRadius: BorderRadius.circular(18)),
              child: Row(
                children: [
                  Icon(skyIcon(w['code'] as num?), size: 30, color: l.c.warning),
                  const SizedBox(width: 10),
                  Text(
                    '${w['now'] ?? w['high']}°',
                    style: OrvText.heading(l)
                        .copyWith(fontSize: 24, fontFeatures: const [FontFeature.tabularFigures()]),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${w['sky']} · ${w['high']}°/${w['low']}°${(w['rain'] as num? ?? 0) >= 20 ? ' · ${w['rain']}% rain' : ''}',
                          style: OrvText.body(l).copyWith(fontSize: 13),
                        ),
                        Text(
                          [w['place'], if (w['sunset'] != null) 'sunset ${w['sunset']}'].join(' · '),
                          style: OrvText.muted(l).copyWith(fontSize: 11.5),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
          const SizedBox(height: 14),
          if (story != null) ...[
            Text(story, style: OrvText.body(l).copyWith(fontSize: 16, height: 1.45)),
            const SizedBox(height: 4),
            Row(
              children: [
                Icon(LucideIcons.sparkles, size: 11, color: l.c.faint),
                const SizedBox(width: 4),
                Text('Written by AI from your day', style: OrvText.muted(l).copyWith(fontSize: 11, color: l.c.faint)),
              ],
            ),
          ] else ...[
            Text(b['headline'] as String, style: OrvText.heading(l).copyWith(fontSize: 18)),
            const SizedBox(height: 2),
            Text(b['line'] as String, style: OrvText.muted(l)),
          ],
          if (tip != null) ...[
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.fromLTRB(10, 8, 12, 8),
              decoration: BoxDecoration(
                color: l.accent.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(14),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(LucideIcons.lightbulb, size: 16, color: l.accent),
                  const SizedBox(width: 8),
                  Expanded(child: Text(tip, style: OrvText.body(l).copyWith(fontSize: 13.5))),
                ],
              ),
            ),
          ],
          if (w?['advice'] != null) ...[
            const SizedBox(height: 8),
            Row(
              children: [
                Icon(LucideIcons.umbrella, size: 14, color: l.c.muted),
                const SizedBox(width: 6),
                Expanded(child: Text(w!['advice'] as String, style: OrvText.muted(l).copyWith(fontSize: 12.5))),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _Section extends ConsumerWidget {
  const _Section({required this.section});
  final J section;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
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
      case 'focus':
        final items = [for (final t in (section['items'] as List)) Map<String, dynamic>.from(t as Map)];
        if (items.isEmpty) {
          rows.add(Text('Nothing pressing. Pick something you’ve been putting off.', style: OrvText.muted(l)));
        }
        for (final (n, t) in items.indexed) {
          rows.add(_FocusRow(n: n + 1, t: t));
        }
        final free = [for (final f in (section['free'] as List)) f as Map];
        if (free.isNotEmpty) {
          rows.add(
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Wrap(
                spacing: 6,
                runSpacing: 6,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Text('Free:', style: OrvText.muted(l).copyWith(fontSize: 12)),
                  for (final f in free)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: l.c.success.withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Text(
                        '${_time(f['start'] as String)}–${_time(f['end'] as String)}',
                        style: OrvText.body(l).copyWith(fontSize: 11.5, color: l.c.success),
                      ),
                    ),
                ],
              ),
            ),
          );
        }
      case 'agenda':
        final events = (section['events'] as List).cast<Map<String, dynamic>>();
        final timed = events.where((e) => e['allDay'] != true && e['at'] != null).toList();
        final allDay = events.where((e) => e['allDay'] == true || e['at'] == null).toList();
        if (allDay.isNotEmpty) {
          rows.add(
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final e in allDay)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
                    decoration: BoxDecoration(color: l.c.track, borderRadius: BorderRadius.circular(12)),
                    child: Text(e['title'] as String, style: OrvText.body(l).copyWith(fontSize: 12)),
                  ),
              ],
            ),
          );
        }
        if (timed.isEmpty) rows.add(Text('No meetings. The day is yours.', style: OrvText.muted(l)));
        for (final (n, e) in timed.indexed) {
          final prev = n > 0 ? timed[n - 1] : null;
          if (prev?['until'] != null &&
              DateTime.parse(e['at'] as String).difference(DateTime.parse(prev!['until'] as String)).inMinutes >= 45) {
            rows.add(
              Padding(
                padding: const EdgeInsets.only(left: 20, top: 2, bottom: 2),
                child: Text(
                  'free ${_span(prev['until'] as String, e['at'] as String)}',
                  style: OrvText.body(l).copyWith(fontSize: 11.5, fontStyle: FontStyle.italic, color: l.c.success),
                ),
              ),
            );
          }
          rows.add(
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 5),
              child: Row(
                children: [
                  Container(
                    width: 10,
                    height: 10,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      border: Border.all(color: l.accent, width: 2),
                    ),
                  ),
                  const SizedBox(width: 10),
                  SizedBox(
                    width: 64,
                    child: Text(_time(e['at'] as String), style: OrvText.muted(l).copyWith(fontSize: 12.5)),
                  ),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          e['title'] as String,
                          style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600, fontSize: 14),
                        ),
                        if (e['location'] != null)
                          Text(
                            e['location'] as String,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: OrvText.muted(l).copyWith(fontSize: 12),
                          ),
                      ],
                    ),
                  ),
                  if (e['until'] != null)
                    Text(
                      _span(e['at'] as String, e['until'] as String),
                      style: OrvText.muted(l).copyWith(fontSize: 12, color: l.c.faint),
                    ),
                ],
              ),
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
      case 'ipo':
        for (final raw in (section['items'] as List)) {
          rows.add(_IpoRow(i: Map<String, dynamic>.from(raw as Map)));
        }
      case 'money':
        final inHand = section['inHandMinor'] as num?;
        if (inHand != null) {
          rows.add(Text('IN YOUR HAND', style: OrvText.label(l).copyWith(fontSize: 10.5, color: l.c.muted)));
          rows.add(
            Text(
              formatMoney(inHand.toInt()),
              style: OrvText.heading(l).copyWith(fontSize: 24, color: inHand < 0 ? l.c.danger : null),
            ),
          );
          rows.add(const SizedBox(height: 4));
        }
        rows.add(row('Yesterday', formatMoney((section['yesterdayMinor'] as num).toInt())));
        rows.add(row('This month', formatMoney((section['monthMinor'] as num).toInt())));
        final dues = [for (final d in (section['dues'] as List? ?? const [])) d as Map];
        if (dues.isNotEmpty) {
          rows.add(Divider(height: 14, color: l.c.edge));
          rows.add(Text('DUE SOON', style: OrvText.label(l).copyWith(fontSize: 10.5, color: l.c.muted)));
          for (final d in dues) {
            final pay = d['kind'] == 'pay';
            rows.add(
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(
                  children: [
                    Icon(
                      pay ? LucideIcons.arrowUpRight : LucideIcons.arrowDownLeft,
                      size: 15,
                      color: pay ? l.c.danger : l.c.success,
                    ),
                    const SizedBox(width: 8),
                    Expanded(child: Text(d['title'] as String, style: OrvText.body(l).copyWith(fontSize: 14))),
                    Text(
                      '${formatMoney((d['amountMinor'] as num).toInt())} · ${_shortDay(d['on'] as String)}',
                      style: OrvText.muted(l).copyWith(fontSize: 12.5),
                    ),
                  ],
                ),
              ),
            );
          }
        }
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
      case 'markets':
        rows.add(
          Row(
            children: [
              for (final m in (section['items'] as List).cast<Map<String, dynamic>>())
                Expanded(
                  child: Container(
                    margin: const EdgeInsets.only(right: 6),
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(color: l.c.track, borderRadius: BorderRadius.circular(14)),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(m['name'] as String, style: OrvText.muted(l).copyWith(fontSize: 12)),
                        Text(
                          (m['last'] as num).toStringAsFixed(2),
                          style: OrvText.body(l).copyWith(fontWeight: FontWeight.w700, fontSize: 15.5),
                        ),
                        Text(
                          '${(m['changePct'] as num) >= 0 ? '▲' : '▼'} ${(m['changePct'] as num).abs().toStringAsFixed(2)}%',
                          style: OrvText.body(l).copyWith(
                            fontSize: 12.5,
                            fontWeight: FontWeight.w600,
                            color: (m['changePct'] as num) >= 0 ? l.c.success : l.c.danger,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        );
      case 'drop':
        final n = section['waiting'] as int;
        rows.add(row('$n ${n == 1 ? 'thing waits' : 'things wait'} for a decision'));
      case 'library':
        for (final d in (section['expiring'] as List).cast<Map<String, dynamic>>()) {
          rows.add(row(d['title'] as String, d['days'] == 0 ? 'today' : 'in ${d['days']} d', l.c.warning));
        }
      case 'work':
        final tasks = [for (final t in (section['tasks'] as List? ?? const [])) Map<String, dynamic>.from(t as Map)];
        final gh = [for (final g in (section['github'] as List? ?? const [])) Map<String, dynamic>.from(g as Map)];
        for (final t in tasks) {
          rows.add(_WorkRow(t: t));
        }
        for (final g in gh) {
          rows.add(
            _WorkRow(
              t: {
                'name': '${g['kind'] == 'review' ? 'Review: ' : ''}${g['title']}',
                'status': '${(g['repo'] as String).split('/').last} #${g['number']}',
                'url': g['url'],
                'github': true,
              },
            ),
          );
        }
        final more = (section['clickup'] as int) - tasks.length;
        if (more > 0) rows.add(row('$more more open in ClickUp', null));
      case 'mail':
        for (final b in (section['boxes'] as List).cast<Map<String, dynamic>>()) {
          rows.add(row(b['account'] as String, '${b['unread']} unread'));
        }
      case 'yesterday':
        final done = section['done'] as int;
        final spent = (section['spentMinor'] as num).toInt();
        final streak = section['streak'] as int;
        rows.add(
          Text(
            '${done > 0 ? '$done ${done == 1 ? 'task' : 'tasks'} done' : 'A quiet day'}${spent > 0 ? ' · ${formatMoney(spent)} spent' : ''}',
            style: OrvText.body(l).copyWith(fontSize: 14.5),
          ),
        );
        if (streak >= 2) {
          rows.add(
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Row(
                children: [
                  Icon(LucideIcons.flame, size: 15, color: l.c.warning),
                  const SizedBox(width: 6),
                  Text(
                    '$streak days in a row with something done',
                    style: OrvText.body(l).copyWith(fontSize: 13, fontWeight: FontWeight.w600, color: l.c.warning),
                  ),
                ],
              ),
            ),
          );
        }
      default:
        return const SizedBox.shrink();
    }
    final route = _sectionRoute[kind];
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Glass(
        blur: false,
        padding: const EdgeInsets.fromLTRB(16, 10, 12, 14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Container(
                  width: 28,
                  height: 28,
                  decoration: BoxDecoration(
                    color: l.accent.withValues(alpha: 0.14),
                    borderRadius: BorderRadius.circular(9),
                  ),
                  child: Icon(_sectionIcon[kind], size: 15, color: l.accent),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(_sectionName[kind] ?? kind, style: OrvText.body(l).copyWith(fontWeight: FontWeight.w700)),
                ),
                if (route != null)
                  TextButton(
                    onPressed: () => kind == 'mail' || kind == 'ipo' ? context.push(route) : context.go(route),
                    child: const Text('Open'),
                  ),
              ],
            ),
            const SizedBox(height: 4),
            ...rows,
          ],
        ),
      ),
    );
  }
}

/// One of "your three": what, when it would fit, and Plan it.
class _FocusRow extends ConsumerStatefulWidget {
  const _FocusRow({required this.n, required this.t});
  final int n;
  final J t;
  @override
  ConsumerState<_FocusRow> createState() => _FocusRowState();
}

class _FocusRowState extends ConsumerState<_FocusRow> {
  bool _busy = false;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final t = widget.t;
    final slot = t['slot'] as Map?;
    return Container(
      margin: const EdgeInsets.only(top: 6),
      padding: const EdgeInsets.fromLTRB(10, 9, 6, 9),
      decoration: BoxDecoration(color: l.c.track, borderRadius: BorderRadius.circular(14)),
      child: Row(
        children: [
          Container(
            width: 26,
            height: 26,
            alignment: Alignment.center,
            decoration: BoxDecoration(gradient: l.accentGradient, shape: BoxShape.circle),
            child: Text(
              '${widget.n}',
              style: const TextStyle(
                fontFamily: fontFamily,
                color: Colors.white,
                fontWeight: FontWeight.w700,
                fontSize: 13,
              ),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  t['title'] as String,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600, fontSize: 14),
                ),
                Text(
                  [
                    if (t['overdue'] == true) 'overdue',
                    if ((t['priority'] as num) >= 3) 'high',
                    slot == null
                        ? 'no free ${t['minutes']}-minute stretch left'
                        : '${_time(slot['start'] as String)}–${_time(slot['end'] as String)}',
                  ].join(' · '),
                  style: OrvText.muted(l).copyWith(fontSize: 12, color: t['overdue'] == true ? l.c.warning : null),
                ),
              ],
            ),
          ),
          if (t['planned'] == true)
            Padding(
              padding: const EdgeInsets.only(right: 6),
              child: Row(
                children: [
                  Icon(LucideIcons.check, size: 14, color: l.c.success),
                  const SizedBox(width: 3),
                  Text(
                    'Planned',
                    style: OrvText.body(l).copyWith(fontSize: 12, color: l.c.success, fontWeight: FontWeight.w600),
                  ),
                ],
              ),
            )
          else if (slot != null)
            TextButton.icon(
              key: Key('plan-${t['id']}'),
              onPressed: _busy
                  ? null
                  : () async {
                      final toaster = Toaster.of(context);
                      setState(() => _busy = true);
                      try {
                        await ref.read(apiProvider).post<dynamic>('/brief/plan', {
                          'taskId': t['id'],
                          'start': slot['start'],
                          'minutes': t['minutes'],
                        });
                        unawaited(HapticFeedback.lightImpact());
                        ref.invalidate(briefProvider);
                        toaster.show(
                          'Planned for ${_time(slot['start'] as String)}',
                          body: t['title'] as String,
                          tone: ToastTone.success,
                        );
                      } catch (e) {
                        toaster.show('Couldn’t plan it', body: messageFor(e), tone: ToastTone.danger);
                      } finally {
                        if (mounted) setState(() => _busy = false);
                      }
                    },
              icon: const Icon(LucideIcons.calendarClock, size: 15),
              label: const Text('Plan it'),
            ),
        ],
      ),
    );
  }
}

const _ipoWhen = {
  'closes': 'Last day',
  'opens': 'Opens today',
  'open': 'Open',
  'allotment': 'Allotment today',
  'listing': 'Lists today',
};

class _IpoRow extends ConsumerWidget {
  const _IpoRow({required this.i});
  final J i;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final pct = i['gmpPct'] as num?;
    final gain = i['gainPerLot'] as num?;
    final when = i['today'] as String;
    final hot = when == 'closes';
    return InkWell(
      onTap: () => context.push('/ipo/${i['id']}'),
      child: Container(
        margin: const EdgeInsets.only(top: 6),
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(color: l.c.track, borderRadius: BorderRadius.circular(14)),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(i['name'] as String, style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600, fontSize: 14)),
                  Text(
                    [
                      pct == null ? 'GMP —' : 'GMP ${pct.toStringAsFixed(0)}%',
                      if (i['lotAmount'] != null) 'lot ${formatMoney(((i['lotAmount'] as num) * 100).round())}',
                      if (gain != null) '${gain >= 0 ? '+' : '−'}₹${gain.abs().round()}/lot',
                    ].join(' · '),
                    style: OrvText.muted(l).copyWith(fontSize: 12),
                  ),
                ],
              ),
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: (hot ? l.c.danger : l.accent).withValues(alpha: 0.14),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    _ipoWhen[when] ?? when,
                    style: OrvText.body(l)
                        .copyWith(fontSize: 11.5, fontWeight: FontWeight.w700, color: hot ? l.c.danger : l.accent),
                  ),
                ),
                const SizedBox(height: 3),
                if (i['decision'] != null)
                  Text(
                    {
                          'applying': 'you’ll apply',
                          'applied': 'applied',
                          'allotted': 'allotted',
                          'not_allotted': 'not allotted',
                          'skipped': 'skipped',
                        }[i['decision']] ??
                        '${i['decision']}',
                    style: OrvText.body(l).copyWith(fontSize: 11.5, color: l.accent),
                  )
                else if (when == 'closes' || when == 'opens' || when == 'open')
                  GestureDetector(
                    onTap: () async {
                      final toaster = Toaster.of(context);
                      await ref.read(apiProvider).put<dynamic>('/ipo/issues/${i['id']}/decision', {
                        'decision': 'applying',
                      });
                      ref.invalidate(briefProvider);
                      toaster.show('Added to Today', body: 'Apply for ${i['name']}', tone: ToastTone.success);
                    },
                    child: Text(
                      'I’ll apply',
                      style: OrvText.body(l).copyWith(fontSize: 12, fontWeight: FontWeight.w700, color: l.accent),
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

/// When the Brief comes, what it carries, where the weather is, AI or not, and which nudges may come.
class BriefSettingsSheet extends ConsumerStatefulWidget {
  const BriefSettingsSheet({super.key, required this.value});
  final J value;
  @override
  ConsumerState<BriefSettingsSheet> createState() => _BriefSettingsSheetState();
}

class _BriefSettingsSheetState extends ConsumerState<BriefSettingsSheet> {
  late bool _enabled = widget.value['enabled'] == true;
  late String _at = widget.value['at'] as String? ?? '07:30';
  late bool _ai = widget.value['ai'] != false;
  late J? _place = widget.value['place'] == null ? null : Map<String, dynamic>.from(widget.value['place'] as Map);
  late final Set<String> _sections = {...(widget.value['sections'] as List).cast<String>()};
  late final J _n = Map<String, dynamic>.from(widget.value['nudges'] as Map);
  late bool _nudges = _n['enabled'] == true;
  late final Set<String> _kinds = {...(_n['kinds'] as List).cast<String>()};
  late int _max = (_n['max'] as num).toInt();
  final _q = TextEditingController();
  List<J> _found = const [];
  Timer? _soon;
  bool _busy = false;

  @override
  void dispose() {
    _q.dispose();
    _soon?.cancel();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _busy = true);
    final toaster = Toaster.of(context);
    try {
      await ref.read(apiProvider).put<dynamic>('/brief/settings', {
        'enabled': _enabled,
        'at': _at,
        'ai': _ai,
        'place': _place,
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
      unawaited(
        ref
            .read(apiProvider)
            .post<dynamic>('/brief/today/refresh')
            .then((_) => ref.invalidate(briefProvider), onError: (_) {}),
      );
      if (mounted) Navigator.of(context).pop();
      toaster.show(_enabled ? 'Your Brief comes at $_at' : 'Brief turned off', tone: ToastTone.success);
    } catch (e) {
      toaster.show('Couldn’t save', body: messageFor(e), tone: ToastTone.danger);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _label(OrvLook l, String t) => Padding(
    padding: const EdgeInsets.fromLTRB(4, 16, 4, 6),
    child: Text(t.toUpperCase(), style: OrvText.label(l)),
  );

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return StickySheet(
      title: 'Brief settings',
      footer: OrvButton(label: 'Save', variant: ButtonVariant.primary, expand: true, loading: _busy, onPressed: _save),
      children: [
        SheetCard(
          children: [
            OrvSwitchRow(
              label: 'Morning Brief at $_at',
              value: _enabled,
              onChanged: (v) => setState(() => _enabled = v),
            ),
            Row(
              children: [
                Expanded(child: Text('Time', style: OrvText.body(l).copyWith(fontSize: 14))),
                TextButton(
                  onPressed: () async {
                    final p = _at.split(':');
                    final t = await showTimePicker(
                      context: context,
                      initialTime: TimeOfDay(hour: int.parse(p[0]), minute: int.parse(p[1])),
                    );
                    if (t != null) {
                      setState(
                        () => _at = '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}',
                      );
                    }
                  },
                  child: Text(_at),
                ),
              ],
            ),
            const SheetRule(),
            OrvSwitchRow(label: 'Write it with AI', value: _ai, onChanged: (v) => setState(() => _ai = v)),
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Text(
                'A short opening and one tip, from the Brief’s facts. Those facts go to the AI provider; it only writes, it never changes anything.',
                style: OrvText.muted(l).copyWith(fontSize: 12),
              ),
            ),
          ],
        ),
        _label(l, 'Weather for'),
        if (_place != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Row(
              children: [
                Icon(LucideIcons.mapPin, size: 15, color: l.accent),
                const SizedBox(width: 6),
                Expanded(child: Text(_place!['name'] as String, style: OrvText.body(l))),
                TextButton(onPressed: () => setState(() => _place = null), child: const Text('Remove')),
              ],
            ),
          ),
        FocusRing(
          radius: 14,
          padding: const EdgeInsets.symmetric(horizontal: 8),
          child: TextField(
            key: const Key('brief-place'),
            controller: _q,
            style: OrvText.body(l),
            onChanged: (q) {
              _soon?.cancel();
              if (q.trim().length < 2) return setState(() => _found = const []);
              _soon = Timer(const Duration(milliseconds: 300), () async {
                try {
                  final r = await ref.read(apiProvider).get<List<dynamic>>('/brief/places', query: {'q': q.trim()});
                  if (mounted) setState(() => _found = [for (final x in r) x as J]);
                } catch (_) {}
              });
            },
            decoration:
                bareInput(
                  l,
                  hint: _place == null ? 'Your city, e.g. Bengaluru' : 'Change the place…',
                  fontSize: 15,
                  padding: const EdgeInsets.symmetric(vertical: 10),
                ).copyWith(
                  prefixIcon: Icon(LucideIcons.search, size: 16, color: l.c.faint),
                  prefixIconConstraints: const BoxConstraints(minWidth: 30),
                ),
          ),
        ),
        for (final p in _found)
          InkWell(
            onTap: () => setState(() {
              _place = p;
              _found = const [];
              _q.clear();
            }),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 6),
              child: Text(p['name'] as String, style: OrvText.body(l).copyWith(fontSize: 14)),
            ),
          ),
        _label(l, 'What it carries'),
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
        _label(l, 'Nudges during the day'),
        SheetCard(
          children: [
            OrvSwitchRow(
              label: 'Nudges, between the Brief and 8 pm',
              value: _nudges,
              onChanged: (v) => setState(() => _nudges = v),
            ),
            for (final e in _nudgeName.entries)
              InkWell(
                onTap: !_nudges
                    ? null
                    : () => setState(() => _kinds.contains(e.key) ? _kinds.remove(e.key) : _kinds.add(e.key)),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              e.value.$1,
                              style: OrvText.body(l).copyWith(fontSize: 14, color: _nudges ? null : l.c.faint),
                            ),
                            Text(e.value.$2, style: OrvText.muted(l).copyWith(fontSize: 12)),
                          ],
                        ),
                      ),
                      Checkbox(
                        value: _kinds.contains(e.key),
                        onChanged: !_nudges
                            ? null
                            : (v) => setState(() => v == true ? _kinds.add(e.key) : _kinds.remove(e.key)),
                      ),
                    ],
                  ),
                ),
              ),
            Row(
              children: [
                Expanded(child: Text('At most a day', style: OrvText.body(l).copyWith(fontSize: 14))),
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
            const SizedBox(height: 8),
          ],
        ),
      ],
    );
  }
}

/// Home: the greeting, the weather and the day in a sentence; one tap to the whole thing.
class BriefCard extends ConsumerWidget {
  const BriefCard({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final b = ref.watch(briefProvider).value;
    if (b == null) return const SizedBox.shrink();
    final w = [
      for (final s in (b['sections'] as List? ?? const []))
        if ((s as Map)['kind'] == 'weather') s,
    ].firstOrNull;
    return OrvModule(
      module: 'brief',
      child: Builder(
        builder: (context) {
          final l = context.orv;
          final story = b['story'] as String?;
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
                        child: Icon(
                          w == null ? LucideIcons.sunrise : skyIcon(w['code'] as num?),
                          size: 19,
                          color: Colors.white,
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              '${b['greeting'] ?? b['headline']}${w == null ? '' : ' · ${w['now'] ?? w['high']}°'}',
                              style: OrvText.body(l).copyWith(fontWeight: FontWeight.w700),
                            ),
                            Text(
                              story ?? b['line'] as String,
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

/// A task I'm working on (a working status in ClickUp, as Today shows it) or a GitHub review; tap opens it.
class _WorkRow extends ConsumerWidget {
  const _WorkRow({required this.t});
  final Map<String, dynamic> t;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final hex = t['statusColor'] as String?;
    final tone = hex != null && RegExp(r'^#[0-9a-fA-F]{6}$').hasMatch(hex)
        ? Color(int.parse('FF${hex.substring(1)}', radix: 16))
        : l.accent;
    final due = t['due'] == null ? null : DateTime.tryParse(t['due'] as String)?.toLocal();
    final overdue = t['overdue'] == true;
    final url = t['url'] as String?;
    return InkWell(
      borderRadius: BorderRadius.circular(OrvTokens.radiusSm),
      onTap: url == null ? null : () => ref.read(urlOpenerProvider)(Uri.parse(url)),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(
          children: [
            if (t['github'] == true)
              Icon(LucideIcons.gitPullRequest, size: 14, color: l.c.muted)
            else
              Container(
                width: 8,
                height: 8,
                decoration: BoxDecoration(color: tone, shape: BoxShape.circle),
              ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    t['name'] as String,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: OrvText.body(l).copyWith(fontSize: 14.5, fontWeight: FontWeight.w600),
                  ),
                  Text(
                    [t['status'], if (t['list'] != null) t['list']].join(' · '),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: OrvText.muted(l).copyWith(fontSize: 12),
                  ),
                ],
              ),
            ),
            if (due != null)
              Text(
                overdue ? 'overdue' : MaterialLocalizations.of(context).formatShortMonthDay(due),
                style: OrvText.muted(l).copyWith(
                  fontSize: 12,
                  color: overdue ? l.c.danger : null,
                  fontWeight: overdue ? FontWeight.w700 : null,
                ),
              ),
          ],
        ),
      ),
    );
  }
}
