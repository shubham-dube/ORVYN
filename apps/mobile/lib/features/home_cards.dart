import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../app/calendar.dart';
import '../app/state.dart';
import '../app/today.dart';
import '../design/controls.dart';
import '../design/glass.dart';
import '../design/theme.dart';
import '../design/toast.dart';
import '../money/money.dart' show formatMoney;
import 'brief_screen.dart' show skyIcon;
import 'sheets.dart';
import 'tools.dart' show MailTaskSheet;

typedef J = Map<String, dynamic>;

/// Home in one call (spec 0017 A) and the smart inbox (spec 0017 B).
final homeProvider = FutureProvider.autoDispose<J>((ref) => ref.read(apiProvider).get<J>('/home'));
final inboxProvider = FutureProvider.autoDispose<J>((ref) => ref.read(apiProvider).get<J>('/inbox'));

String _hm(DateTime d) {
  final h = d.hour % 12 == 0 ? 12 : d.hour % 12;
  return '$h:${d.minute.toString().padLeft(2, '0')}${d.hour < 12 ? ' am' : ' pm'}';
}

String _mins(Duration d) {
  final m = d.inMinutes < 1 ? 1 : d.inMinutes;
  return m >= 60 ? '${m ~/ 60}h${m % 60 == 0 ? '' : ' ${m % 60}m'}' : '$m min';
}

String? joinUrl(String s) =>
    RegExp(r'https://(meet\.google\.com|[\w.-]*zoom\.us|teams\.microsoft\.com|teams\.live\.com)/\S+')
        .firstMatch(s)
        ?.group(0);

String _greeting(DateTime now) {
  final h = now.hour;
  return h < 5
      ? 'Good night'
      : (h < 12 ? 'Good morning' : (h < 17 ? 'Good afternoon' : (h < 22 ? 'Good evening' : 'Good night')));
}

/// The top: the date, the greeting, the clock, the weather and the Brief's one line.
class HomeHero extends ConsumerWidget {
  const HomeHero({super.key, required this.first});
  final String first;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final now = ref.watch(clockProvider)();
    final loc = MaterialLocalizations.of(context);
    final home = ref.watch(homeProvider).value;
    final brief = home?['brief'] as Map?;
    final w = brief?['weather'] as Map?;
    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.fromLTRB(18, 16, 18, 18),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(OrvTokens.radiusXl),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [l.accent.withValues(alpha: 0.24), l.accent.withValues(alpha: 0.04)],
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
                  loc.formatFullDate(now),
                  style: OrvText.muted(l).copyWith(fontSize: 12.5, fontWeight: FontWeight.w600),
                ),
              ),
              Text(
                _hm(now),
                style: OrvText.heading(l).copyWith(fontSize: 19, fontFeatures: const [FontFeature.tabularFigures()]),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            first.isEmpty ? _greeting(now) : '${_greeting(now)}, $first',
            style: OrvText.heading(l).copyWith(fontSize: 27, height: 1.15),
          ),
          if (w != null) ...[
            const SizedBox(height: 8),
            Row(
              children: [
                Icon(skyIcon(w['code'] as num?), size: 17, color: l.c.warning),
                const SizedBox(width: 6),
                Text(
                  '${w['now'] ?? w['high']}° · ${w['sky']} · ${w['place']}',
                  style: OrvText.body(l).copyWith(fontSize: 13),
                ),
              ],
            ),
          ],
          if (brief?['line'] != null) ...[
            const SizedBox(height: 10),
            GestureDetector(
              onTap: () => context.go('/brief'),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Padding(
                    padding: const EdgeInsets.only(top: 3),
                    child: Icon(LucideIcons.sparkles, size: 14, color: l.accent),
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(brief!['line'] as String, style: OrvText.body(l).copyWith(fontSize: 14.5, height: 1.4)),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// What's on now (with time left), or the next thing with a countdown — and Join when it has a link.
class NowNext extends ConsumerWidget {
  const NowNext({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final now = ref.watch(clockProvider)();
    final tasks = ref.watch(tasksProvider).value ?? const <TaskItem>[];
    final events = ref.watch(eventsProvider).value ?? const <EventItem>[];
    final cals = ref.watch(calendarsProvider).value ?? const <CalendarItem>[];
    final start = DateTime(now.year, now.month, now.day);
    final end = start.add(const Duration(days: 1));
    final hidden = {
      for (final c in cals)
        if (!c.visible) c.id,
    };
    final where = {for (final e in events) e.id: e.location};
    String loc(Instance i) => where[i.eventId] ?? '';
    final ev = expandEvents(
      events,
      start,
      end,
      hidden: hidden,
    ).where((e) => !e.allDay && e.start != null && e.end != null).toList();
    final current = ev.where((e) => !e.start!.isAfter(now) && e.end!.isAfter(now)).firstOrNull;
    final next = ev.where((e) => e.start!.isAfter(now)).firstOrNull;
    final task =
        (tasks
                .where((t) => t.completedAt == null && (t.scheduledStart ?? t.dueAt) != null)
                .map((t) => (t: t, at: (t.scheduledStart ?? t.dueAt)!.toLocal()))
                .where((x) => x.at.isAfter(now) && x.at.isBefore(end))
                .toList()
              ..sort((a, b) => a.at.compareTo(b.at)))
            .firstOrNull;
    if (current == null && next == null && task == null) return const SizedBox.shrink();
    Widget tile(String label, String title, String sub, int tone, String? link) => Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.fromLTRB(12, 10, 10, 10),
      decoration: BoxDecoration(
        color: tone == 0 ? l.c.success.withValues(alpha: 0.12) : l.c.track,
        borderRadius: BorderRadius.circular(18),
      ),
      child: Row(
        children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              color: tone == 0 ? l.c.success : (tone == 2 ? l.c.muted : null),
              gradient: tone == 1 ? l.accentGradient : null,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(tone == 2 ? LucideIcons.listTodo : LucideIcons.calendarClock, size: 18, color: Colors.white),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label.toUpperCase(),
                  style: OrvText.label(l).copyWith(fontSize: 10, color: tone == 0 ? l.c.success : l.c.muted),
                ),
                Text(
                  title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: OrvText.body(l).copyWith(fontWeight: FontWeight.w700),
                ),
                Text(sub, maxLines: 1, overflow: TextOverflow.ellipsis, style: OrvText.muted(l).copyWith(fontSize: 12)),
              ],
            ),
          ),
          if (link != null)
            OrvButton(
              label: 'Join',
              small: true,
              icon: LucideIcons.video,
              variant: ButtonVariant.primary,
              onPressed: () => ref.read(urlOpenerProvider)(Uri.parse(link)),
            ),
        ],
      ),
    );
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Column(
        children: [
          if (current != null)
            tile(
              'Now',
              current.title,
              'ends in ${_mins(current.end!.difference(now))}${loc(current).isEmpty ? '' : ' · ${loc(current)}'}',
              0,
              joinUrl(loc(current)),
            ),
          if (next != null)
            tile(
              next.start!.difference(now).inMinutes < 15 ? 'Starting soon' : 'Next',
              next.title,
              '${_hm(next.start!.toLocal())} · in ${_mins(next.start!.difference(now))}',
              1,
              next.start!.difference(now).inMinutes < 30 ? joinUrl(loc(next)) : null,
            ),
          if (current == null && task != null)
            tile('Next task', task.t.title, '${_hm(task.at)} · in ${_mins(task.at.difference(now))}', 2, null),
        ],
      ),
    );
  }
}

const _kindIcon = {
  'mail': LucideIcons.mail,
  'ipo': LucideIcons.rocket,
  'review': LucideIcons.gitPullRequest,
  'due': LucideIcons.circleDollarSign,
  'payments': LucideIcons.wallet,
  'overdue': LucideIcons.listTodo,
  'expiring': LucideIcons.fileClock,
  'drop': LucideIcons.inbox,
};

/// One ranked list of what waits on me, across every module, each with one tap to act.
class NeedsYouCard extends ConsumerWidget {
  const NeedsYouCard({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final home = ref.watch(homeProvider);
    final items = [for (final x in (home.value?['needsYou'] as List? ?? const [])) Map<String, dynamic>.from(x as Map)];
    final more = (home.value?['more'] as num?)?.toInt() ?? 0;
    final urgent = items.where((i) => i['urgency'] == 0).length;
    Future<void> act(J i) async {
      final api = ref.read(apiProvider);
      final toaster = Toaster.of(context);
      final id = i['id'] as String;
      final a = (i['act'] as Map?)?['kind'];
      unawaited(HapticFeedback.lightImpact());
      if (i['kind'] == 'mail' && a == 'done') {
        await api.post<dynamic>('/inbox/items/${id.substring(5)}/act', {'action': 'done'});
      } else if (i['kind'] == 'ipo') {
        await api.put<dynamic>('/ipo/issues/${id.substring(4)}/decision', {
          'decision': a == 'apply' ? 'applying' : 'applied',
        });
        toaster.show(a == 'apply' ? 'Added to Today' : 'Marked applied', tone: ToastTone.success);
      }
      ref.invalidate(homeProvider);
    }

    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Glass(
        level: GlassLevel.float,
        padding: const EdgeInsets.fromLTRB(14, 12, 8, 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Icon(LucideIcons.hand, size: 17, color: l.accent),
                const SizedBox(width: 8),
                Expanded(child: Text('Needs you', style: OrvText.heading(l).copyWith(fontSize: 16))),
                if (items.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(right: 6),
                    child: OrvBadge(
                      urgent > 0 ? '$urgent today' : '${items.length} waiting',
                      tone: urgent > 0 ? l.c.danger : l.accent,
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 6),
            if (home.isLoading && items.isEmpty) const LinearProgressIndicator(minHeight: 2),
            if (!home.isLoading && items.isEmpty)
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: l.c.success.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Row(
                  children: [
                    Icon(LucideIcons.checkCheck, color: l.c.success),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'Nothing is waiting on you. Enjoy the quiet.',
                        style: OrvText.body(l).copyWith(fontSize: 14),
                      ),
                    ),
                  ],
                ),
              ),
            for (final i in items)
              InkWell(
                borderRadius: BorderRadius.circular(14),
                onTap: () {
                  final url = i['url'] as String?;
                  if (url != null) {
                    unawaited(ref.read(urlOpenerProvider)(Uri.parse(url)));
                  } else {
                    final href = i['href'] as String;
                    href == '/mail' || href.startsWith('/ipo/') || href == '/prs'
                        ? context.push(href)
                        : context.go(href);
                  }
                },
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 7),
                  child: Row(
                    children: [
                      Container(
                        width: 4,
                        height: 34,
                        decoration: BoxDecoration(
                          color: i['urgency'] == 0 ? l.c.danger : (i['urgency'] == 1 ? l.c.warning : l.c.edge),
                          borderRadius: BorderRadius.circular(2),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Container(
                        width: 34,
                        height: 34,
                        decoration: BoxDecoration(
                          color: i['urgency'] == 0 ? l.c.danger.withValues(alpha: 0.12) : l.c.track,
                          borderRadius: BorderRadius.circular(11),
                        ),
                        child: Icon(
                          _kindIcon[i['kind']] ?? LucideIcons.dot,
                          size: 16,
                          color: i['urgency'] == 0 ? l.c.danger : l.c.muted,
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              i['title'] as String,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: OrvText.body(l).copyWith(fontWeight: FontWeight.w700, fontSize: 14),
                            ),
                            Text(
                              i['line'] as String,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: OrvText.muted(l).copyWith(fontSize: 12.5),
                            ),
                          ],
                        ),
                      ),
                      if (i['act'] != null && (i['act'] as Map)['kind'] != 'open')
                        TextButton(
                          key: Key('needs-${i['id']}'),
                          onPressed: () => act(i),
                          child: Text((i['act'] as Map)['label'] as String),
                        )
                      else
                        Padding(
                          padding: const EdgeInsets.only(right: 6),
                          child: Icon(LucideIcons.chevronRight, size: 17, color: l.c.faint),
                        ),
                    ],
                  ),
                ),
              ),
            if (more > 0)
              Padding(
                padding: const EdgeInsets.only(left: 4, top: 2),
                child: Text('and $more more', style: OrvText.muted(l).copyWith(fontSize: 12)),
              ),
          ],
        ),
      ),
    );
  }
}

// ------------------------------------------------------------------ the smart inbox's rows

const _cat = {
  'needs_reply': ('Needs a reply', LucideIcons.messageCircleReply),
  'action': ('To do', LucideIcons.squareCheck),
  'bill': ('Bill', LucideIcons.creditCard),
  'money': ('Money', LucideIcons.circleDollarSign),
  'security': ('Security', LucideIcons.shieldAlert),
  'travel': ('Travel', LucideIcons.plane),
  'delivery': ('Delivery', LucideIcons.truck),
  'event': ('Invite', LucideIcons.calendarDays),
  'work': ('Work', LucideIcons.briefcase),
  'update': ('Update', LucideIcons.info),
  'newsletter': ('Newsletter', LucideIcons.newspaper),
  'promotion': ('Promotion', LucideIcons.megaphone),
  'social': ('Social', LucideIcons.users),
};

Color catTone(OrvLook l, String c) => switch (c) {
  'bill' => l.c.danger,
  'security' => l.c.warning,
  'money' || 'delivery' => l.c.success,
  'newsletter' || 'promotion' || 'social' => l.c.faint,
  'work' || 'update' => l.c.muted,
  _ => l.accent,
};

Color accountTone(OrvLook l, String account, List<String> all) {
  final tones = [l.accent, l.c.success, l.c.warning, l.c.danger];
  final i = all.indexOf(account);
  return tones[(i < 0 ? 0 : i) % tones.length];
}

String _ago(String? iso) {
  if (iso == null) return '';
  final m = DateTime.now().difference(DateTime.parse(iso)).inMinutes;
  if (m < 60) return '${m < 1 ? 1 : m}m';
  if (m < 24 * 60) return '${(m / 60).round()}h';
  final d = DateTime.parse(iso).toLocal();
  return '${d.day}/${d.month}';
}

String dueWords(String d) {
  final now = DateTime.now();
  final n = DateTime.parse(d).difference(DateTime(now.year, now.month, now.day)).inDays;
  if (n < 0) return 'overdue';
  if (n == 0) return 'due today';
  if (n == 1) return 'due tomorrow';
  const w = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return 'due ${w[DateTime.parse(d).weekday - 1]} ${DateTime.parse(d).day}';
}

/// Mail swiped away: gone from every list at once, before the server's answer, so a swiped row never stays.
class SweptMail extends Notifier<Set<String>> {
  @override
  Set<String> build() => const {};
  void add(String id) => state = {...state, id};
  void remove(String id) => state = {...state}..remove(id);
}

final sweptMailProvider = NotifierProvider<SweptMail, Set<String>>(SweptMail.new);

/// One mail as the smart inbox shows it: who, what's in it for me, its kind, money and date — and actions.
class SmartMailRow extends ConsumerWidget {
  const SmartMailRow({super.key, required this.m, required this.accounts, this.compact = false});
  final J m;
  final List<String> accounts;
  final bool compact;

  Future<void> _act(WidgetRef ref, BuildContext context, String action) async {
    final toaster = Toaster.of(context);
    unawaited(HapticFeedback.selectionClick());
    final r = await ref.read(apiProvider).post<J>('/inbox/items/${m['id']}/act', {'action': action});
    if (action == 'remind' && r['taskId'] != null) {
      toaster.show('Reminder set', body: 'A task for tomorrow at 9:00.', tone: ToastTone.success);
    }
    ref.invalidate(inboxProvider);
    ref.invalidate(homeProvider);
  }

  Future<void> _sender(WidgetRef ref, BuildContext context, String? rule) async {
    final toaster = Toaster.of(context);
    await ref.read(apiProvider).put<dynamic>('/inbox/senders', {'email': m['fromEmail'], 'rule': rule});
    toaster.show(
      rule == 'vip' ? '${m['fromName']} is VIP' : (rule == 'mute' ? '${m['fromName']} muted' : 'Back to normal'),
      body: rule == 'vip' ? 'Always in Important from now on.' : (rule == 'mute' ? 'Always in Everything else.' : null),
    );
    ref.invalidate(inboxProvider);
    ref.invalidate(homeProvider);
  }

  Future<void> _more(WidgetRef ref, BuildContext context) async {
    final choice = await showGlassSheet<String>(
      context,
      (ctx) => StickySheet(
        title: m['fromName'] as String? ?? 'Mail',
        footer: Text(m['fromEmail'] as String? ?? '', style: OrvText.muted(ctx.orv).copyWith(fontSize: 12)),
        children: [
          for (final (key, icon, label) in [
            if (m['url'] != null) ('open', LucideIcons.externalLink, 'Open in the mailbox'),
            ('task', LucideIcons.listPlus, 'Make a task'),
            ('remind', LucideIcons.alarmClock, 'Remind me tomorrow at 9'),
            (
              m['pinned'] == true ? 'unpin' : 'pin',
              m['pinned'] == true ? LucideIcons.pinOff : LucideIcons.pin,
              m['pinned'] == true ? 'Unpin' : 'Pin',
            ),
            if (m['sender'] != 'vip') ('vip', LucideIcons.star, 'Always important'),
            if (m['sender'] != 'mute') ('mute', LucideIcons.bellOff, 'Mute this sender'),
            if (m['sender'] != null) ('normal', LucideIcons.refreshCw, 'Treat normally'),
          ])
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: Icon(icon, size: 19),
              title: Text(label),
              onTap: () => Navigator.pop(ctx, key),
            ),
        ],
      ),
    );
    if (choice == null || !context.mounted) return;
    switch (choice) {
      case 'open':
        await ref.read(urlOpenerProvider)(Uri.parse(m['url'] as String));
      case 'task':
        await showGlassSheet<void>(
          context,
          (_) => MailTaskSheet(
            mail: {
              'id': m['id'],
              'from': '${m['fromName']} <${m['fromEmail']}>',
              'subject': m['subject'],
              'snippet': m['snippet'],
              'url': m['url'],
            },
          ),
        );
      case 'remind' || 'pin' || 'unpin':
        await _act(ref, context, choice);
      case 'vip' || 'mute':
        await _sender(ref, context, choice);
      case 'normal':
        await _sender(ref, context, null);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final cat = m['category'] as String;
    final (label, icon) = _cat[cat] ?? ('Mail', LucideIcons.mail);
    final tone = catTone(l, cat);
    final acc = accountTone(l, m['account'] as String, accounts);
    final name = (m['fromName'] as String?)?.isNotEmpty == true ? m['fromName'] as String : m['fromEmail'] as String;
    final amount = m['amountMinor'] as num?;
    final due = m['dueDate'] as String?;
    return Dismissible(
      key: ValueKey('mail-${m['id']}'),
      direction: DismissDirection.endToStart,
      background: Container(
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.only(right: 20),
        decoration: BoxDecoration(color: l.c.success.withValues(alpha: 0.18), borderRadius: BorderRadius.circular(16)),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(LucideIcons.check, color: l.c.success),
            const SizedBox(width: 6),
            Text(
              'Done',
              style: OrvText.body(l).copyWith(color: l.c.success, fontWeight: FontWeight.w700),
            ),
          ],
        ),
      ),
      onDismissed: (_) {
        final id = m['id'] as String;
        final swept = ref.read(sweptMailProvider.notifier)..add(id);
        // on failure it comes back
        _act(ref, context, 'done').catchError((Object _) => swept.remove(id));
      },
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: m['url'] == null
            ? () => _more(ref, context)
            : () => ref.read(urlOpenerProvider)(Uri.parse(m['url'] as String)),
        onLongPress: () => _more(ref, context),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 4),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Stack(
                clipBehavior: Clip.none,
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      gradient: LinearGradient(colors: [acc, acc.withValues(alpha: 0.65)]),
                    ),
                    child: Text(
                      name.characters.first.toUpperCase(),
                      style: const TextStyle(
                        fontFamily: fontFamily,
                        color: Colors.white,
                        fontWeight: FontWeight.w700,
                        fontSize: 15,
                      ),
                    ),
                  ),
                  if (m['sender'] == 'vip')
                    Positioned(right: -3, top: -3, child: Icon(LucideIcons.star, size: 13, color: l.c.warning)),
                ],
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: OrvText.body(l).copyWith(fontWeight: FontWeight.w700, fontSize: 14),
                          ),
                        ),
                        if (accounts.length > 1)
                          Container(
                            margin: const EdgeInsets.only(left: 6),
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                            decoration: BoxDecoration(
                              color: acc.withValues(alpha: 0.13),
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Text(
                              (m['account'] as String).split('@').first,
                              style: OrvText.body(l).copyWith(fontSize: 10.5, color: acc, fontWeight: FontWeight.w600),
                            ),
                          ),
                        const SizedBox(width: 6),
                        Text(
                          _ago(m['at'] as String?),
                          style: OrvText.muted(l).copyWith(fontSize: 11, color: l.c.faint),
                        ),
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(m['summary'] as String? ?? '', style: OrvText.body(l).copyWith(fontSize: 14, height: 1.3)),
                    if (!compact)
                      Text(
                        m['subject'] as String? ?? '',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: OrvText.muted(l).copyWith(fontSize: 12),
                      ),
                    const SizedBox(height: 5),
                    Wrap(
                      spacing: 5,
                      runSpacing: 4,
                      children: [
                        _chip(l, label, icon, tone),
                        if (amount != null) _chip(l, formatMoney(amount.toInt()), null, l.c.text),
                        if (due != null)
                          _chip(
                            l,
                            dueWords(due),
                            null,
                            dueWords(due) == 'due today' || dueWords(due) == 'overdue' ? l.c.danger : l.c.muted,
                          ),
                        if (m['pinned'] == true) Icon(LucideIcons.pin, size: 13, color: l.accent),
                      ],
                    ),
                  ],
                ),
              ),
              IconButton(
                tooltip: 'More for ${m['subject']}',
                visualDensity: VisualDensity.compact,
                icon: Icon(LucideIcons.ellipsis, size: 18, color: l.c.muted),
                onPressed: () => _more(ref, context),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _chip(OrvLook l, String text, IconData? icon, Color c) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
    decoration: BoxDecoration(color: c.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10)),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (icon != null) ...[Icon(icon, size: 11, color: c), const SizedBox(width: 3)],
        Text(
          text,
          style: OrvText.body(l).copyWith(fontSize: 11, fontWeight: FontWeight.w700, color: c),
        ),
      ],
    ),
  );
}

/// Home: the catch-up and the three mails that matter most.
class InboxPreview extends ConsumerWidget {
  const InboxPreview({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final ib = ref.watch(homeProvider).value?['inbox'] as Map?;
    if (ib == null) return const SizedBox.shrink();
    final swept = ref.watch(sweptMailProvider);
    final top = [
      for (final x in (ib['top'] as List))
        if (!swept.contains((x as Map)['id'])) Map<String, dynamic>.from(x),
    ];
    final accounts = {for (final m in top) m['account'] as String}.toList();
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Glass(
        padding: const EdgeInsets.fromLTRB(14, 12, 8, 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Icon(LucideIcons.mail, size: 17, color: l.accent),
                const SizedBox(width: 8),
                Expanded(child: Text('Mail that matters', style: OrvText.heading(l).copyWith(fontSize: 16))),
                TextButton(onPressed: () => context.push('/mail'), child: Text('${ib['important']} important')),
              ],
            ),
            if (ib['catchUp'] != null)
              Container(
                margin: const EdgeInsets.only(top: 4, bottom: 4, right: 6),
                padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
                decoration: BoxDecoration(
                  color: l.accent.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Icon(LucideIcons.sparkles, size: 13, color: l.accent),
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        ib['catchUp'] as String,
                        style: OrvText.body(l).copyWith(fontSize: 13.5, height: 1.4),
                      ),
                    ),
                  ],
                ),
              ),
            for (final m in top) SmartMailRow(m: m, accounts: accounts, compact: true),
          ],
        ),
      ),
    );
  }
}

/// Open IPOs with their countdown, and the markets.
class LiveCard extends ConsumerWidget {
  const LiveCard({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final home = ref.watch(homeProvider).value;
    final ipos = [for (final x in (home?['ipos'] as List? ?? const [])) Map<String, dynamic>.from(x as Map)];
    final markets = [for (final x in (home?['markets'] as List? ?? const [])) Map<String, dynamic>.from(x as Map)];
    if (ipos.isEmpty && markets.isEmpty) return const SizedBox.shrink();
    final now = DateTime.now();
    final today = '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Glass(
        padding: const EdgeInsets.fromLTRB(14, 12, 12, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Icon(LucideIcons.rocket, size: 17, color: l.accent),
                const SizedBox(width: 8),
                Expanded(child: Text('Live', style: OrvText.heading(l).copyWith(fontSize: 16))),
                TextButton(onPressed: () => context.go('/ipo'), child: const Text('IPO desk')),
              ],
            ),
            if (markets.isNotEmpty)
              Row(
                children: [
                  for (final m in markets)
                    Expanded(
                      child: Container(
                        margin: const EdgeInsets.only(right: 6, bottom: 8),
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(color: l.c.track, borderRadius: BorderRadius.circular(14)),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(m['name'] as String, style: OrvText.muted(l).copyWith(fontSize: 11.5)),
                            Text(
                              (m['last'] as num).toStringAsFixed(2),
                              style: OrvText.body(l).copyWith(fontWeight: FontWeight.w700),
                            ),
                            Text(
                              '${(m['changePct'] as num) >= 0 ? '▲' : '▼'} ${(m['changePct'] as num).abs().toStringAsFixed(2)}%',
                              style: OrvText.body(
                                l,
                              ).copyWith(fontSize: 12, color: (m['changePct'] as num) >= 0 ? l.c.success : l.c.danger),
                            ),
                          ],
                        ),
                      ),
                    ),
                ],
              ),
            for (final i in ipos)
              InkWell(
                onTap: () => context.push('/ipo/${i['id']}'),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(i['name'] as String, style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600)),
                            Text(
                              [
                                i['closeDate'] == today ? 'Last day · 5 pm' : 'Open',
                                if (i['gmpPct'] != null) 'GMP ${(i['gmpPct'] as num).toStringAsFixed(0)}%',
                                if (i['decision'] == 'applying') 'you’ll apply',
                              ].join(' · '),
                              style: OrvText.muted(l)
                                  .copyWith(fontSize: 12, color: i['closeDate'] == today ? l.c.danger : null),
                            ),
                          ],
                        ),
                      ),
                      Icon(LucideIcons.chevronRight, size: 16, color: l.c.faint),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
