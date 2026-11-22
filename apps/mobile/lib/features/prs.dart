import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../app/calendar.dart' show urlOpenerProvider;
import '../app/state.dart';
import '../design/controls.dart';
import '../design/theme.dart';
import '../design/toast.dart';
import 'common.dart';
import 'connections.dart';
import 'sheets.dart';
import 'today_kit.dart';
import 'tools.dart' show githubWorkProvider;

typedef J = Map<String, dynamic>;

/// My pull requests (spec 0012 G): open ones with reviews and checks, merged and closed ones of the last 30 days.
final githubPrsProvider = FutureProvider.autoDispose<List<J>>((ref) async {
  ref.keepAlive();
  final conns = await ref.watch(connectionsProvider.future);
  if (!conns.any((c) => c.provider == 'github')) return const [];
  final r = await ref.read(apiProvider).get<List<dynamic>>('/connections/github/prs');
  return [for (final x in r) J.from(x as Map)];
});

String _age(String iso, DateTime now) {
  final d = now.difference(DateTime.parse(iso));
  if (d.inDays >= 1) return '${d.inDays}d';
  if (d.inHours >= 1) return '${d.inHours}h';
  return '${d.inMinutes.clamp(1, 59)}m';
}

/// A one-line summary for Today: "3 open · 1 approved · 1 needs changes".
String prSummary(List<J> prs) {
  final open = prs.where((p) => p['state'] == 'open').toList();
  final approved = open.where((p) => p['review'] == 'approved').length;
  final changes = open.where((p) => p['review'] == 'changes').length;
  final failing = open.where((p) => p['checks'] == 'failing').length;
  return [
    '${open.length} open',
    if (approved > 0) '$approved approved',
    if (changes > 0) '$changes need changes',
    if (failing > 0) '$failing failing checks',
  ].join(' · ');
}

class PrsScreen extends ConsumerStatefulWidget {
  const PrsScreen({super.key});
  @override
  ConsumerState<PrsScreen> createState() => _PrsScreenState();
}

class _PrsScreenState extends ConsumerState<PrsScreen> {
  String _tab = 'open';

  Future<void> _refresh() async {
    try {
      final r = await ref.read(apiProvider).get<List<dynamic>>('/connections/github/prs', query: {'fresh': '1'});
      if (r.isNotEmpty || mounted) ref.invalidate(githubPrsProvider);
    } catch (_) {}
    ref.invalidate(githubWorkProvider);
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(githubPrsProvider);
    final all = async.value ?? const <J>[];
    final reviews = (ref.watch(githubWorkProvider).value ?? const <J>[]).where((w) => w['kind'] == 'review').toList();
    final now = ref.watch(clockProvider)();
    final open = all.where((p) => p['state'] == 'open').toList();
    final done = all.where((p) => p['state'] != 'open').toList()
      ..sort((a, b) => (b['closedAt'] as String? ?? '').compareTo(a['closedAt'] as String? ?? ''));

    return OrvModule(
      module: 'today',
      child: Builder(
        builder: (context) {
          final l = context.orv;
          return Scaffold(
            body: SafeArea(
              child: RefreshIndicator(
                color: l.accent,
                onRefresh: _refresh,
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 60),
                  children: [
                    Row(
                      children: [
                        IconButton(
                          onPressed: () => context.canPop() ? context.pop() : context.go('/today'),
                          icon: Icon(LucideIcons.arrowLeft, color: l.c.text),
                          tooltip: 'Back',
                        ),
                        const ProviderMark(provider: 'github', size: 26),
                        const SizedBox(width: 10),
                        Expanded(child: PageTitle('Pull requests', overline: async.hasValue ? prSummary(all) : null)),
                        Padding(
                          padding: const EdgeInsets.only(bottom: 10),
                          child: IconButton(
                            tooltip: 'Notifications for pull requests',
                            icon: Icon(LucideIcons.bellRing, size: 19, color: l.c.muted),
                            onPressed: () => showGlassSheet<void>(context, (_) => const PrPingsSheet()),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Container(
                      padding: const EdgeInsets.all(3),
                      decoration: BoxDecoration(
                        color: l.c.track,
                        borderRadius: BorderRadius.circular(OrvTokens.radiusFull),
                      ),
                      child: Row(
                        children: [
                          for (final (v, name, n) in [
                            ('open', 'Mine · open', open.length),
                            ('review', 'To review', reviews.length),
                            ('done', 'Merged · closed', done.length),
                          ])
                            Expanded(
                              child: GestureDetector(
                                onTap: () {
                                  HapticFeedback.selectionClick();
                                  setState(() => _tab = v);
                                },
                                child: AnimatedContainer(
                                  duration: OrvTokens.durationFast,
                                  height: 36,
                                  alignment: Alignment.center,
                                  decoration: BoxDecoration(
                                    color: _tab == v ? l.c.glassStrong : Colors.transparent,
                                    borderRadius: BorderRadius.circular(OrvTokens.radiusFull),
                                  ),
                                  child: Text(
                                    n > 0 ? '$name  $n' : name,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: OrvText.muted(l).copyWith(
                                      fontSize: 13,
                                      fontWeight: _tab == v ? FontWeight.w700 : FontWeight.w500,
                                      color: _tab == v ? l.c.text : l.c.muted,
                                    ),
                                  ),
                                ),
                              ),
                            ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 12),
                    if (async.isLoading && !async.hasValue)
                      const GroupCard(children: [SkeletonRows(count: 4)])
                    else if (async.hasError && !async.hasValue)
                      GroupCard(
                        children: [
                          Text('GitHub didn’t answer.', style: OrvText.body(l)),
                          const SizedBox(height: 8),
                          Align(
                            alignment: Alignment.centerLeft,
                            child: OrvButton(label: 'Try again', small: true, onPressed: _refresh),
                          ),
                        ],
                      )
                    else
                      GroupCard(
                        children: switch (_tab) {
                          'open' => [
                            if (open.isEmpty) _empty(l, 'No open pull requests. Nice and clear.'),
                            for (final p in open) PrRow(pr: p, now: now),
                          ],
                          'review' => [
                            if (reviews.isEmpty) _empty(l, 'Nobody is waiting on your review.'),
                            for (final w in reviews)
                              PrRow(
                                pr: {...w, 'state': 'open', 'review': null, 'checks': null},
                                now: now,
                                review: true,
                              ),
                          ],
                          _ => [
                            if (done.isEmpty) _empty(l, 'Nothing merged or closed in the last 30 days.'),
                            for (final p in done) PrRow(pr: p, now: now),
                          ],
                        },
                      ),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _empty(OrvLook l, String s) => Padding(
    padding: const EdgeInsets.all(8),
    child: Text(s, style: OrvText.muted(l)),
  );
}

class PrRow extends ConsumerWidget {
  const PrRow({super.key, required this.pr, required this.now, this.review = false});
  final J pr;
  final DateTime now;
  final bool review;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    const violet = Color(0xFF8B5CF6);
    final state = pr['state'] as String? ?? 'open';
    final (icon, tone) = switch (state) {
      'merged' => (LucideIcons.gitMerge, violet),
      'closed' => (LucideIcons.gitPullRequestClosed, l.c.faint),
      _ when pr['draft'] == true => (LucideIcons.gitPullRequestDraft, l.c.faint),
      _ => (LucideIcons.gitPullRequest, l.c.success),
    };
    final rv = pr['review'] as String?;
    final ck = pr['checks'] as String?;
    Widget badge(String text, Color c, IconData i) => Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: c.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(OrvTokens.radiusFull),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(i, size: 11, color: c),
          const SizedBox(width: 4),
          Text(
            text,
            style: OrvText.muted(l).copyWith(fontSize: 11, fontWeight: FontWeight.w700, color: c),
          ),
        ],
      ),
    );
    final when = state == 'open'
        ? pr['updatedAt'] as String?
        : (pr['closedAt'] as String? ?? pr['updatedAt'] as String?);
    return InkWell(
      borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
      onTap: () => ref.read(urlOpenerProvider)(Uri.parse(pr['url'] as String)),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 10),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Icon(icon, size: 19, color: tone),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    pr['title'] as String? ?? '',
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 4),
                  Wrap(
                    spacing: 6,
                    runSpacing: 4,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      Text(
                        '${pr['repo']} #${pr['number']}',
                        style: OrvText.muted(l).copyWith(fontSize: 12, fontFamily: monoFamily),
                      ),
                      if (state == 'merged') badge('Merged', violet, LucideIcons.gitMerge),
                      if (state == 'closed') badge('Closed', l.c.faint, LucideIcons.x),
                      if (pr['draft'] == true && state == 'open') badge('Draft', l.c.faint, LucideIcons.pencil),
                      if (review) badge('Your review', l.accent, LucideIcons.eye),
                      if (rv == 'approved') badge('Approved', l.c.success, LucideIcons.check),
                      if (rv == 'changes') badge('Changes requested', l.c.danger, LucideIcons.messageSquareWarning),
                      if (rv == 'pending' && state == 'open' && pr['draft'] != true)
                        badge('Waiting for review', l.c.warning, LucideIcons.hourglass),
                      if (ck == 'failing') badge('Checks failing', l.c.danger, LucideIcons.circleX),
                      if (ck == 'running') badge('Checks running', l.c.warning, LucideIcons.loader),
                      if (ck == 'passing') badge('Checks pass', l.c.success, LucideIcons.circleCheck),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(width: 6),
            if (when != null) Text(_age(when, now), style: OrvText.muted(l).copyWith(fontSize: 12, color: l.c.faint)),
          ],
        ),
      ),
    );
  }
}

/// Which changes to my PRs ping me (defaults: merged and changes requested on, approved off).
class PrPingsSheet extends ConsumerStatefulWidget {
  const PrPingsSheet({super.key});
  @override
  ConsumerState<PrPingsSheet> createState() => _PrPingsSheetState();
}

class _PrPingsSheetState extends ConsumerState<PrPingsSheet> {
  final _p = {'merged': true, 'changes': true, 'approved': false};
  bool _busy = false;

  Future<void> _save() async {
    setState(() => _busy = true);
    final toaster = Toaster.of(context);
    try {
      final conns = await ref.read(connectionsProvider.future);
      for (final c in conns.where((c) => c.provider == 'github')) {
        await ref.read(apiProvider).put<dynamic>('/connections/github/settings', {'connectionId': c.id, 'pings': _p});
      }
      if (mounted) Navigator.of(context).pop();
      toaster.show('Saved', tone: ToastTone.success);
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
      title: 'Ping me when my PR…',
      footer: Align(
        alignment: Alignment.centerRight,
        child: OrvButton(label: 'Save', variant: ButtonVariant.primary, loading: _busy, onPressed: _save),
      ),
      children: [
        OrvSwitchRow(label: 'is merged', value: _p['merged']!, onChanged: (v) => setState(() => _p['merged'] = v)),
        const SizedBox(height: 8),
        OrvSwitchRow(
          label: 'needs changes',
          subtitle: 'A reviewer asked for changes',
          value: _p['changes']!,
          onChanged: (v) => setState(() => _p['changes'] = v),
        ),
        const SizedBox(height: 8),
        OrvSwitchRow(
          label: 'is approved',
          value: _p['approved']!,
          onChanged: (v) => setState(() => _p['approved'] = v),
        ),
        const SizedBox(height: 10),
        Text(
          'ORVYN looks every 15 minutes. One ping per change, never twice.',
          style: OrvText.muted(l).copyWith(fontSize: 12),
        ),
      ],
    );
  }
}
