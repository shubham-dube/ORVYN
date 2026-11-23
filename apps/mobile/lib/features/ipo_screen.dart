import 'dart:async';
import 'dart:math' as math;

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
import 'money_ui.dart' show Segment, SheetCard, SheetRule;
import 'sheets.dart';

// ------------------------------------------------------------------ data (spec 0010)

typedef J = Map<String, dynamic>;

class IpoWhen extends Notifier<String> {
  @override
  String build() => 'current';
  void set(String v) => state = v;
}

final ipoWhenProvider = NotifierProvider<IpoWhen, String>(IpoWhen.new);
final ipoIssuesProvider = FutureProvider.autoDispose<J>((ref) {
  final when = ref.watch(ipoWhenProvider);
  final show = ref.watch(ipoShowProvider);
  return ref.read(apiProvider).get<J>('/ipo/issues', query: {'when': when, 'type': ?show});
});
final ipoIssueProvider = FutureProvider.autoDispose.family<J, String>(
  (ref, id) => ref.read(apiProvider).get<J>('/ipo/issues/$id'),
);
final poolSummaryProvider = FutureProvider.autoDispose<J>((ref) => ref.read(apiProvider).get<J>('/ipo/pool/summary'));
final poolPartnersProvider = FutureProvider.autoDispose<List<J>>(
  (ref) async => [for (final x in await ref.read(apiProvider).get<List<dynamic>>('/ipo/pool/partners')) x as J],
);
final poolSourcesProvider = FutureProvider.autoDispose<List<J>>(
  (ref) async => [for (final x in await ref.read(apiProvider).get<List<dynamic>>('/ipo/pool/sources')) x as J],
);
final poolRoundProvider = FutureProvider.autoDispose.family<J, String>(
  (ref, id) => ref.read(apiProvider).get<J>('/ipo/pool/rounds/$id'),
);

String _rs(num? n) => n == null ? '—' : '₹${_group(n.round())}';
String _group(int n) {
  final s = n.abs().toString();
  if (s.length <= 3) return '${n < 0 ? '-' : ''}$s';
  final last3 = s.substring(s.length - 3);
  var rest = s.substring(0, s.length - 3);
  final parts = <String>[];
  while (rest.length > 2) {
    parts.insert(0, rest.substring(rest.length - 2));
    rest = rest.substring(0, rest.length - 2);
  }
  if (rest.isNotEmpty) parts.insert(0, rest);
  return '${n < 0 ? '-' : ''}${parts.join(',')},$last3';
}

String _m(num minor) => formatMoney(minor.toInt());
String _chance(num? p) => p == null
    ? '—'
    : p >= 0.995
    ? '100%'
    : p < 0.01
    ? '<1%'
    : '${(p * 100).round()}%';
String _times(num? t) => t == null ? '—' : '$t×';
String _day(String? d) {
  if (d == null) return '—';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  final p = d.split('-');
  return '${int.parse(p[2])} ${months[int.parse(p[1]) - 1]}';
}

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

// ------------------------------------------------------------------ the screen: Desk | My Pool

class IpoScreen extends ConsumerStatefulWidget {
  const IpoScreen({super.key, this.pool = false});
  final bool pool;
  @override
  ConsumerState<IpoScreen> createState() => _IpoScreenState();
}

class _IpoScreenState extends ConsumerState<IpoScreen> {
  late bool _pool = widget.pool;

  @override
  Widget build(BuildContext context) {
    return OrvModule(
      module: 'ipo',
      child: Builder(
        builder: (context) {
          final l = context.orv;
          return RefreshIndicator(
            color: l.accent,
            onRefresh: () async {
              ref.invalidate(ipoIssuesProvider);
              ref.invalidate(poolSummaryProvider);
              ref.invalidate(poolPartnersProvider);
              ref.invalidate(poolSourcesProvider);
            },
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 56, 16, 120),
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    const Expanded(child: PageTitle('IPO desk', overline: 'GMP, demand, odds — and what you’ll do')),
                    if (!_pool)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 14),
                        child: IconButton(
                          tooltip: 'IPO desk & notifications',
                          icon: Icon(LucideIcons.bellRing, color: l.c.muted),
                          onPressed: () => showGlassSheet<void>(context, (_) => const IpoSettingsSheet()),
                        ),
                      ),
                  ],
                ),
                Wrap(
                  spacing: 6,
                  children: [
                    _chip(context, 'Desk', !_pool, () => setState(() => _pool = false)),
                    _chip(context, 'My Pool', _pool, () => setState(() => _pool = true)),
                  ],
                ),
                const SizedBox(height: 10),
                if (_pool) const _PoolBody() else const _DeskBody(),
              ],
            ),
          );
        },
      ),
    );
  }
}

// ------------------------------------------------------------------ the desk (spec 0016 A)

String _crore(num? n) => n == null ? '—' : '₹${_group(n.round())} cr';
String _signed(num? n) => n == null ? '—' : '${n >= 0 ? '+' : '−'}₹${_group(n.abs().round())}';
String _today() {
  final n = DateTime.now();
  return '${n.year}-${n.month.toString().padLeft(2, '0')}-${n.day.toString().padLeft(2, '0')}';
}

int _daysTo(String d) => DateTime.parse('${d}T00:00:00').difference(DateTime.parse('${_today()}T00:00:00')).inDays;
String _weekday(String d) => const ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][DateTime.parse(d).weekday - 1];

/// "Closes today · 5 pm", "Opens Mon", "Lists Thu"… and how urgent it is (0 hot, 1 live, 2 soon, 3 quiet).
(String, int) ipoMoment(J i) {
  final status = i['status'] as String;
  final open = i['openDate'] as String?;
  final close = i['closeDate'] as String?;
  final allot = i['allotmentDate'] as String?;
  final list = i['listingDate'] as String?;
  if (status == 'open' && close != null) {
    final n = _daysTo(close);
    if (n <= 0) return ('Closes today · 5 pm', 0);
    if (n == 1) return ('Closes tomorrow', 1);
    return ('Open · closes ${_weekday(close)}', 1);
  }
  if (status == 'upcoming') {
    if (open == null) return ('Dates soon', 3);
    final n = _daysTo(open);
    if (n <= 0) return ('Opens today', 0);
    if (n == 1) return ('Opens tomorrow', 2);
    return (n < 7 ? 'Opens ${_weekday(open)}' : 'Opens ${_day(open)}', 2);
  }
  if (status == 'closed') {
    if (allot != null && _daysTo(allot) == 0) return ('Allotment today', 0);
    if (list != null) return (_daysTo(list) == 0 ? 'Lists today' : 'Lists ${_weekday(list)}', 2);
    return ('Closed', 3);
  }
  final g = i['listingGainPct'] as num?;
  return (g == null ? 'Listed' : 'Listed ${g >= 0 ? '+' : ''}${g.toStringAsFixed(1)}%', 3);
}

class _MomentPill extends StatelessWidget {
  const _MomentPill({required this.i});
  final J i;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final (text, tone) = ipoMoment(i);
    final c = switch (tone) {
      0 => l.c.danger,
      1 => l.c.success,
      2 => l.accent,
      _ => l.c.muted,
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(
        color: c.withValues(alpha: tone == 3 ? 0.1 : 0.14),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (tone <= 1) ...[
            Container(
              width: 6,
              height: 6,
              decoration: BoxDecoration(color: c, shape: BoxShape.circle),
            ),
            const SizedBox(width: 5),
          ],
          Text(
            text,
            style: OrvText.body(l).copyWith(fontSize: 11.5, fontWeight: FontWeight.w700, color: c),
          ),
        ],
      ),
    );
  }
}

/// The company's logo, or its first letter on the accent.
class IpoLogo extends StatelessWidget {
  const IpoLogo({super.key, required this.i, this.size = 44});
  final J i;
  final double size;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final logo = i['logo'] as String?;
    final letter = Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(gradient: l.accentGradient, borderRadius: BorderRadius.circular(size * 0.3)),
      child: Text(
        (i['name'] as String? ?? '?').characters.first,
        style: TextStyle(
          fontFamily: fontFamily,
          color: Colors.white,
          fontSize: size * 0.42,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
    if (logo == null) return letter;
    return Container(
      width: size,
      height: size,
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(size * 0.3),
        border: Border.all(color: l.c.edge),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(size * 0.25),
        child: Image.network(logo, fit: BoxFit.contain, errorBuilder: (_, _, _) => letter),
      ),
    );
  }
}

class _Tile extends StatelessWidget {
  const _Tile({required this.k, required this.v, this.sub, this.tone});
  final String k;
  final String v;
  final String? sub;
  final Color? tone;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return Container(
      padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
      decoration: BoxDecoration(color: l.c.track.withValues(alpha: 0.7), borderRadius: BorderRadius.circular(14)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(k.toUpperCase(), style: OrvText.label(l).copyWith(fontSize: 9.5, color: l.c.muted, letterSpacing: 0.8)),
          const SizedBox(height: 2),
          Text(
            v,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: OrvText.body(l).copyWith(
              fontSize: 16.5,
              fontWeight: FontWeight.w700,
              color: tone,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
          if (sub != null && sub!.isNotEmpty)
            Text(sub!, maxLines: 1, overflow: TextOverflow.ellipsis, style: OrvText.muted(l).copyWith(fontSize: 11)),
        ],
      ),
    );
  }
}

/// How many times a category is subscribed: a bar on a log scale with 1× marked.
class _DemandBar extends StatelessWidget {
  const _DemandBar({required this.label, required this.x, this.strong = false});
  final String label;
  final num? x;
  final bool strong;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final v = x;
    if (v == null) return const SizedBox.shrink();
    final w = ((math.log(math.max(v.toDouble(), 0.1)) / math.ln10 + 1) / 3).clamp(0.02, 1.0);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2.5),
      child: Row(
        children: [
          SizedBox(
            width: 68,
            child: Text(
              label,
              style: OrvText.muted(l)
                  .copyWith(fontSize: 12, fontWeight: strong ? FontWeight.w700 : null, color: strong ? l.c.text : null),
            ),
          ),
          Expanded(
            child: LayoutBuilder(
              builder: (_, c) => Stack(
                children: [
                  Container(
                    height: 7,
                    decoration: BoxDecoration(color: l.c.track, borderRadius: BorderRadius.circular(4)),
                  ),
                  AnimatedContainer(
                    duration: OrvTokens.durationBase,
                    height: 7,
                    width: c.maxWidth * w,
                    decoration: BoxDecoration(
                      color: v >= 1 ? l.c.success : l.c.warning,
                      borderRadius: BorderRadius.circular(4),
                    ),
                  ),
                  Positioned(
                    left: c.maxWidth / 3,
                    top: 0,
                    bottom: 0,
                    child: Container(width: 1, color: l.c.edge),
                  ),
                ],
              ),
            ),
          ),
          SizedBox(
            width: 58,
            child: Text(
              _times(v),
              textAlign: TextAlign.right,
              style: OrvText.body(l).copyWith(fontSize: 12.5, fontWeight: FontWeight.w700),
            ),
          ),
        ],
      ),
    );
  }
}

const _decisionLabel = {
  'applying': 'You’ll apply',
  'skipped': 'Skipped',
  'applied': 'Applied',
  'allotted': 'Allotted 🎉',
  'not_allotted': 'Not allotted',
};

/// I'll apply · Skip; then what was decided, and the next step (Applied ✓, Got it, Not this time).
class _DecisionBar extends ConsumerStatefulWidget {
  const _DecisionBar({required this.i, this.big = false});
  final J i;
  final bool big;
  @override
  ConsumerState<_DecisionBar> createState() => _DecisionBarState();
}

class _DecisionBarState extends ConsumerState<_DecisionBar> {
  bool _busy = false;

  Future<void> _go(String? d) async {
    final toaster = Toaster.of(context);
    final id = widget.i['id'] as String;
    setState(() => _busy = true);
    try {
      await ref.read(apiProvider).put<dynamic>('/ipo/issues/$id/decision', {'decision': d});
      unawaited(HapticFeedback.lightImpact());
      if (d == 'applying') {
        toaster.show(
          'Added to Today',
          body:
              'Apply for ${widget.i['name']} by ${_day(widget.i['closeDate'] as String?)}. You’ll be reminded that morning.',
          tone: ToastTone.success,
        );
      }
      ref.invalidate(ipoIssuesProvider);
      ref.invalidate(ipoIssueProvider(id));
    } catch (e) {
      toaster.show('That didn’t work', body: messageFor(e), tone: ToastTone.danger);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final i = widget.i;
    final d = i['decision'] as String?;
    final live = i['status'] == 'open' || i['status'] == 'upcoming';
    if (d == null) {
      if (!live) return const SizedBox.shrink();
      return Row(
        children: [
          if (widget.big)
            Expanded(
              child: Text('Will you apply?', style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600)),
            ),
          OrvButton(
            key: Key('ipo-apply-${i['id']}'),
            label: 'I’ll apply',
            small: true,
            icon: LucideIcons.hand,
            variant: ButtonVariant.primary,
            loading: _busy,
            onPressed: () => _go('applying'),
          ),
          const SizedBox(width: 6),
          OrvButton(
            label: 'Skip',
            small: true,
            variant: ButtonVariant.ghost,
            onPressed: _busy ? null : () => _go('skipped'),
          ),
        ],
      );
    }
    final quiet = d == 'skipped' || d == 'not_allotted';
    final next = d == 'applying'
        ? [('applied', 'Applied ✓')]
        : d == 'applied' && (i['status'] == 'closed' || i['status'] == 'listed')
        ? [('allotted', 'Got it 🎉'), ('not_allotted', 'Not this time')]
        : <(String, String)>[];
    return Wrap(
      spacing: 6,
      runSpacing: 6,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
          decoration: BoxDecoration(
            color: (quiet ? l.c.muted : l.accent).withValues(alpha: 0.13),
            borderRadius: BorderRadius.circular(20),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                d == 'applying' ? LucideIcons.calendarCheck : (quiet ? LucideIcons.circleX : LucideIcons.circleCheck),
                size: 14,
                color: quiet ? l.c.muted : l.accent,
              ),
              const SizedBox(width: 5),
              Text(
                '${_decisionLabel[d] ?? d}${d == 'applying' && i['closeDate'] != null ? ' · by ${_day(i['closeDate'] as String?)}' : ''}',
                style: OrvText.body(l)
                    .copyWith(fontSize: 12, fontWeight: FontWeight.w700, color: quiet ? l.c.muted : l.accent),
              ),
            ],
          ),
        ),
        for (final (v, label) in next)
          OrvButton(
            label: label,
            small: true,
            variant: v == 'not_allotted' ? ButtonVariant.ghost : ButtonVariant.primary,
            loading: _busy,
            onPressed: () => _go(v),
          ),
        if (widget.big) TextButton(onPressed: _busy ? null : () => _go(null), child: const Text('Undo')),
      ],
    );
  }
}

class IpoShow extends Notifier<String?> {
  @override
  String? build() => null;
  void set(String? v) => state = v;
}

/// mainboard | sme | all; null until the server says what this person chose last (spec 0016 A1)
final ipoShowProvider = NotifierProvider<IpoShow, String?>(IpoShow.new);

class _DeskBody extends ConsumerWidget {
  const _DeskBody();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final when = ref.watch(ipoWhenProvider);
    final data = ref.watch(ipoIssuesProvider);
    final issues = [for (final x in (data.value?['issues'] as List? ?? const [])) x as J];
    final feed = data.value?['feed'] as J?;
    final show = ref.watch(ipoShowProvider) ?? data.value?['show'] as String? ?? 'mainboard';
    final today = _today();
    final last = issues.where((i) => i['status'] == 'open' && i['closeDate'] == today).toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Segment<String>(
          value: when,
          dense: true,
          options: const [
            ('current', 'Open & soon', null, null),
            ('closed', 'Awaiting', null, null),
            ('listed', 'Listed', null, null),
          ],
          onChanged: (v) => ref.read(ipoWhenProvider.notifier).set(v),
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: Segment<String>(
                value: show,
                dense: true,
                options: const [
                  ('mainboard', 'Mainboard', null, null),
                  ('sme', 'SME', null, null),
                  ('all', 'All', null, null),
                ],
                onChanged: (v) async {
                  ref.read(ipoShowProvider.notifier).set(v);
                  // remembered on every device: SME on or off
                  final api = ref.read(apiProvider);
                  final s = await api.get<J>('/ipo/settings');
                  if ((s['showSme'] == true) != (v != 'mainboard')) {
                    await api.put<dynamic>('/ipo/settings', {...s, 'showSme': v != 'mainboard'});
                  }
                },
              ),
            ),
          ],
        ),
        if (last.isNotEmpty)
          Container(
            margin: const EdgeInsets.only(top: 10),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
            decoration: BoxDecoration(
              color: l.c.danger.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
            ),
            child: Row(
              children: [
                Container(
                  width: 7,
                  height: 7,
                  decoration: BoxDecoration(color: l.c.danger, shape: BoxShape.circle),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Last day: ${last.map((i) => i['name']).join(', ')} — bids close at 5 pm.',
                    style: OrvText.body(l).copyWith(fontSize: 13, fontWeight: FontWeight.w600),
                  ),
                ),
              ],
            ),
          ),
        if (feed != null && feed['ready'] != true)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              'No market feed connected yet — figures are typed in by hand (web: Add by hand).',
              style: OrvText.muted(l).copyWith(fontSize: 12.5),
            ),
          ),
        if (data.isLoading && issues.isEmpty)
          const Padding(padding: EdgeInsets.only(top: 12), child: LinearProgressIndicator(minHeight: 2)),
        if (!data.isLoading && issues.isEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 16),
            child: Text('Nothing here right now.', style: OrvText.muted(l)),
          ),
        for (final i in issues) _IssueCard(i: i),
        if (feed?['credit'] != null)
          Padding(
            padding: const EdgeInsets.only(top: 12),
            child: GestureDetector(
              onTap: () => ref.read(urlOpenerProvider)(Uri.parse(feed['credit'] as String)),
              child: Text(
                'Data: ${feed!['name']} · GMP is unofficial · not investment advice',
                style: OrvText.muted(l).copyWith(fontSize: 11.5, decoration: TextDecoration.underline),
              ),
            ),
          ),
      ],
    );
  }
}

/// One IPO as a card: the four numbers that decide it, when, how hot, and what you'll do.
class _IssueCard extends ConsumerWidget {
  const _IssueCard({required this.i});
  final J i;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final sub = i['subscription'] as J?;
    final gmp = i['gmp'] as num?;
    final lot =
        (i['minInvestment'] as num?) ??
        (i['priceMax'] != null && i['lotSize'] != null ? (i['priceMax'] as num) * (i['lotSize'] as num) : null);
    final gain = i['gainPerLot'] as num?;
    final size = i['issueSizeCr'] as num?;
    final status = i['status'] as String;
    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Semantics(
        button: true,
        label: 'Open ${i['name']}',
        child: GestureDetector(
          onTap: () => context.push('/ipo/${i['id']}'),
          child: Glass(
            blur: false,
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    IpoLogo(i: i, size: 42),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            i['name'] as String,
                            style: OrvText.body(l).copyWith(fontWeight: FontWeight.w700, fontSize: 15.5),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          Text(
                            [
                              i['type'] == 'sme' ? 'SME' : 'Mainboard',
                              if (i['priceMax'] != null)
                                '₹${i['priceMin'] != null && i['priceMin'] != i['priceMax'] ? '${i['priceMin']}–' : ''}${i['priceMax']}',
                            ].join(' · '),
                            style: OrvText.muted(l)
                                .copyWith(fontSize: 12, color: i['type'] == 'sme' ? l.c.warning : null),
                          ),
                        ],
                      ),
                    ),
                    if (i['starred'] == true)
                      Padding(
                        padding: const EdgeInsets.only(right: 6),
                        child: Icon(LucideIcons.star, size: 15, color: l.c.warning),
                      ),
                    _MomentPill(i: i),
                  ],
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: _Tile(
                        k: 'Issue size',
                        v: _crore(size),
                        sub: size == null ? null : (size >= 5000 ? 'Large' : (size >= 1000 ? 'Mid-size' : 'Small')),
                      ),
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      child: _Tile(
                        k: 'GMP',
                        v: gmp == null ? '—' : '${gmp > 0 ? '+' : (gmp < 0 ? '−' : '')}₹${gmp.abs()}',
                        sub: gmp == null ? 'not reported' : '${(i['gmpPct'] as num?)?.toStringAsFixed(1)}%',
                        tone: gmp == null ? null : (gmp > 0 ? l.c.success : (gmp < 0 ? l.c.danger : null)),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                Row(
                  children: [
                    Expanded(
                      child: _Tile(
                        k: '1 lot',
                        v: _rs(lot),
                        sub: i['lotSize'] == null ? null : '${i['lotSize']} shares',
                      ),
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      child: _Tile(
                        k: status == 'listed' ? 'Listed' : 'Dates',
                        v: status == 'listed'
                            ? _day(i['listingDate'] as String?)
                            : i['openDate'] == null
                            ? 'Soon'
                            : '${_day(i['openDate'] as String?)}–${i['closeDate'] == null ? '' : int.parse((i['closeDate'] as String).substring(8))}',
                        sub: status == 'listed'
                            ? _rs(i['listingPrice'] as num?)
                            : (i['listingDate'] == null ? null : 'lists ${_day(i['listingDate'] as String?)}'),
                      ),
                    ),
                  ],
                ),
                if (sub != null && status != 'upcoming' && (sub['retail'] != null || sub['total'] != null)) ...[
                  const SizedBox(height: 8),
                  _DemandBar(label: 'Retail', x: sub['retail'] as num?, strong: true),
                  _DemandBar(label: 'Total', x: sub['total'] as num?),
                ],
                const SizedBox(height: 8),
                Row(
                  children: [
                    if (gain != null && status != 'listed') ...[
                      Icon(
                        gain >= 0 ? LucideIcons.trendingUp : LucideIcons.trendingDown,
                        size: 15,
                        color: gain >= 0 ? l.c.success : l.c.danger,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        '${_signed(gain)} a lot',
                        style: OrvText.body(l).copyWith(
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                          color: gain >= 0 ? l.c.success : l.c.danger,
                        ),
                      ),
                      const SizedBox(width: 10),
                    ],
                    Expanded(
                      child: Text(
                        i['verdict'] as String? ?? '',
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: OrvText.muted(l).copyWith(fontSize: 12.5),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                _DecisionBar(i: i),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// ------------------------------------------------------------------ one IPO

class _Sparkline extends CustomPainter {
  _Sparkline(this.points, this.color);
  final List<double> points;
  final Color color;
  @override
  void paint(Canvas canvas, Size size) {
    if (points.length < 2) return;
    final lo = points.reduce(math.min);
    final hi = points.reduce(math.max);
    Offset at(int n) => Offset(
      n / (points.length - 1) * size.width,
      size.height - ((points[n] - lo) / (hi - lo == 0 ? 1 : hi - lo)) * (size.height - 10) - 5,
    );
    final line = Path()..moveTo(at(0).dx, at(0).dy);
    for (var n = 1; n < points.length; n++) {
      line.lineTo(at(n).dx, at(n).dy);
    }
    final area = Path.from(line)
      ..lineTo(size.width, size.height)
      ..lineTo(0, size.height)
      ..close();
    canvas.drawPath(
      area,
      Paint()
        ..shader = LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [color.withValues(alpha: 0.28), color.withValues(alpha: 0)],
        ).createShader(Offset.zero & size),
    );
    canvas.drawPath(
      line,
      Paint()
        ..color = color
        ..strokeWidth = 2.2
        ..style = PaintingStyle.stroke
        ..strokeJoin = StrokeJoin.round
        ..strokeCap = StrokeCap.round,
    );
    canvas.drawCircle(at(points.length - 1), 4, Paint()..color = color);
  }

  @override
  bool shouldRepaint(_Sparkline o) => o.points != points || o.color != color;
}

class IpoDetailScreen extends ConsumerWidget {
  const IpoDetailScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final d = ref.watch(ipoIssueProvider(id)).value;
    return OrvModule(
      module: 'ipo',
      child: Builder(
        builder: (context) {
          final l = context.orv;
          if (d == null) return const Scaffold(body: Center(child: CircularProgressIndicator()));
          final gmp = d['gmp'] as num?;
          final up = (gmp ?? 0) >= 0;
          final lot =
              (d['minInvestment'] as num?) ??
              (d['priceMax'] != null && d['lotSize'] != null ? (d['priceMax'] as num) * (d['lotSize'] as num) : null);
          final gain = d['gainPerLot'] as num?;
          final x = d['details'] as J?;
          return Scaffold(
            body: SafeArea(
              child: RefreshIndicator(
                color: l.accent,
                onRefresh: () async => ref.invalidate(ipoIssueProvider(id)),
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 40),
                  children: [
                    Row(
                      children: [
                        IconButton(
                          tooltip: 'Back',
                          icon: Icon(LucideIcons.arrowLeft, color: l.c.text),
                          onPressed: () => context.canPop() ? context.pop() : context.go('/ipo'),
                        ),
                        const Spacer(),
                        IconButton(
                          tooltip: d['starred'] == true ? 'Unstar' : 'Star',
                          icon: Icon(LucideIcons.star, color: d['starred'] == true ? l.c.warning : l.c.muted),
                          onPressed: () async {
                            await ref.read(apiProvider).put<dynamic>('/ipo/issues/$id/star', {
                              'on': d['starred'] != true,
                            });
                            ref.invalidate(ipoIssueProvider(id));
                            ref.invalidate(ipoIssuesProvider);
                          },
                        ),
                        IconButton(
                          tooltip: 'Type figures',
                          icon: Icon(LucideIcons.pencilLine, color: l.c.muted),
                          onPressed: () => showGlassSheet<void>(context, (_) => _FiguresSheet(d: d)),
                        ),
                      ],
                    ),
                    // the hero
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(OrvTokens.radiusLg),
                        gradient: LinearGradient(
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                          colors: [l.accent.withValues(alpha: 0.2), l.accent.withValues(alpha: 0.04)],
                        ),
                        border: Border.all(color: l.accent.withValues(alpha: 0.22)),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              IpoLogo(i: d, size: 56),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    _MomentPill(i: d),
                                    const SizedBox(height: 6),
                                    Text(d['name'] as String, style: OrvText.heading(l).copyWith(fontSize: 21)),
                                    Text(
                                      [
                                        d['type'] == 'sme' ? 'SME' : 'Mainboard',
                                        ?d['listingOn'] as String?,
                                      ].join(' · '),
                                      style: OrvText.muted(l).copyWith(fontSize: 12.5),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 10),
                          Text(
                            d['priceMax'] == null
                                ? 'Price soon'
                                : '₹${d['priceMin'] != null && d['priceMin'] != d['priceMax'] ? '${d['priceMin']}–' : ''}${d['priceMax']} a share'
                                      '${d['lotSize'] != null ? ' · ${d['lotSize']} a lot' : ''}',
                            style: OrvText.body(l).copyWith(fontSize: 14),
                          ),
                          const SizedBox(height: 12),
                          Row(
                            children: [
                              Expanded(
                                child: _Tile(k: 'Issue size', v: _crore(d['issueSizeCr'] as num?)),
                              ),
                              const SizedBox(width: 6),
                              Expanded(
                                child: _Tile(
                                  k: '1 lot',
                                  v: _rs(lot),
                                  sub: d['lotSize'] == null ? null : '${d['lotSize']} shares',
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 6),
                          Row(
                            children: [
                              Expanded(
                                child: _Tile(
                                  k: 'GMP',
                                  v: gmp == null ? '—' : '${up ? '+' : '−'}₹${gmp.abs()}',
                                  sub: gmp == null ? 'not reported' : '${(d['gmpPct'] as num?)?.toStringAsFixed(1)}%',
                                  tone: gmp == null ? null : (up ? l.c.success : l.c.danger),
                                ),
                              ),
                              const SizedBox(width: 6),
                              Expanded(
                                child: _Tile(
                                  k: 'A lot may make',
                                  v: _signed(gain),
                                  sub: 'at today’s GMP',
                                  tone: gain == null ? null : (gain >= 0 ? l.c.success : l.c.danger),
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 12),
                    // your plan
                    Glass(
                      blur: false,
                      padding: const EdgeInsets.all(14),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Icon(LucideIcons.sparkles, size: 17, color: l.accent),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  d['verdict'] as String? ?? '',
                                  style: OrvText.body(l).copyWith(fontSize: 14),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 10),
                          _DecisionBar(i: d, big: true),
                          if (d['decision'] == 'applying')
                            Padding(
                              padding: const EdgeInsets.only(top: 6),
                              child: Text(
                                'A task in Today is due on the last day, with a reminder that morning. Bids close at 5 pm; approve the UPI mandate the same day.',
                                style: OrvText.muted(l).copyWith(fontSize: 12),
                              ),
                            ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 12),
                    _GmpCard(d: d),
                    const SizedBox(height: 12),
                    _DemandCard(d: d),
                    const SizedBox(height: 12),
                    _Timeline(d: d),
                    const SizedBox(height: 12),
                    _Facts(d: d, lot: lot),
                    const SizedBox(height: 12),
                    _Odds(d: d),
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        if (d['roundId'] != null)
                          OrvButton(
                            label: 'Open your round',
                            variant: ButtonVariant.primary,
                            icon: LucideIcons.users,
                            onPressed: () => context.push('/ipo/pool/rounds/${d['roundId']}'),
                          )
                        else if (d['status'] == 'open' || d['status'] == 'upcoming')
                          OrvButton(
                            label: 'Apply from my accounts',
                            icon: LucideIcons.users,
                            onPressed: () => showGlassSheet<void>(
                              context,
                              (_) => StartRoundSheet(issueId: id, issueName: d['name'] as String),
                            ),
                          ),
                      ],
                    ),
                    if (x != null) _Company(x: x),
                    const SizedBox(height: 12),
                    GestureDetector(
                      onTap: d['sourceUrl'] == null
                          ? null
                          : () => ref.read(urlOpenerProvider)(Uri.parse(d['sourceUrl'] as String)),
                      child: Text(
                        d['sourceUrl'] == null
                            ? 'Typed in by hand · GMP is unofficial · not investment advice'
                            : 'Data: ${d['source']} · GMP is unofficial · not investment advice',
                        style: OrvText.muted(l).copyWith(
                          fontSize: 11.5,
                          decoration: d['sourceUrl'] == null ? null : TextDecoration.underline,
                        ),
                      ),
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
}

Widget _fact(OrvLook l, String k, String v) => Column(
  crossAxisAlignment: CrossAxisAlignment.start,
  children: [
    Text(k.toUpperCase(), style: OrvText.label(l).copyWith(fontSize: 10, color: l.c.muted)),
    const SizedBox(height: 2),
    Text(v, style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600, fontSize: 14)),
  ],
);

class _GmpCard extends StatelessWidget {
  const _GmpCard({required this.d});
  final J d;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final gmp = d['gmp'] as num?;
    final up = (gmp ?? 0) >= 0;
    final pts = [
      for (final h in (d['history'] as List? ?? const []))
        if ((h as J)['gmp'] != null) (h['gmp'] as num).toDouble(),
    ];
    final updated = d['gmpUpdatedAt'] as String?;
    return Glass(
      blur: false,
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(child: Text('GREY-MARKET PREMIUM', style: OrvText.label(l))),
              OrvBadge('unofficial', tone: l.c.warning),
            ],
          ),
          const SizedBox(height: 4),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                gmp == null ? '—' : '${up ? '+' : '−'}₹${gmp.abs()}',
                style: OrvText.heading(l)
                    .copyWith(fontSize: 28, color: gmp == null ? null : (up ? l.c.success : l.c.danger)),
              ),
              const SizedBox(width: 10),
              Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Text(
                  '${(d['gmpPct'] as num?)?.toStringAsFixed(1) ?? '—'}% · est. ${_rs(d['estListingPrice'] as num?)}',
                  style: OrvText.muted(l).copyWith(fontSize: 13),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          if (pts.length > 1)
            SizedBox(height: 64, child: CustomPaint(painter: _Sparkline(pts, l.accent)))
          else
            Text('The trend shows after a few refreshes.', style: OrvText.muted(l).copyWith(fontSize: 12)),
          const SizedBox(height: 6),
          Text(
            [
              if (updated != null)
                'Updated ${_day(updated.substring(0, 10))} ${updated.substring(11, 16)} UTC'
              else
                'Not reported yet',
              if ((d['manual'] as List? ?? const []).contains('gmp')) 'typed in',
              if (d['sauda'] != null) 'sauda ₹${_group((d['sauda'] as num).round())}',
            ].join(' · '),
            style: OrvText.muted(l).copyWith(fontSize: 11.5),
          ),
        ],
      ),
    );
  }
}

class _DemandCard extends StatelessWidget {
  const _DemandCard({required this.d});
  final J d;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final s = d['subscription'] as J?;
    return Glass(
      blur: false,
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('HOW HOT IS IT', style: OrvText.label(l)),
          const SizedBox(height: 8),
          if (s == null)
            Text('No figures yet — they come once bidding starts.', style: OrvText.muted(l))
          else ...[
            _DemandBar(label: 'Retail', x: s['retail'] as num?, strong: true),
            _DemandBar(label: 'Small HNI', x: s['snii'] as num?),
            _DemandBar(label: 'Big HNI', x: s['bnii'] as num?),
            if (s['snii'] == null) _DemandBar(label: 'NII', x: s['nii'] as num?),
            _DemandBar(label: 'QIB', x: s['qib'] as num?),
            _DemandBar(label: 'Employee', x: s['employee'] as num?),
            _DemandBar(label: 'Total', x: s['total'] as num?, strong: true),
          ],
        ],
      ),
    );
  }
}

/// Open → close → allotment → refund → demat → listing, with today marked.
class _Timeline extends StatelessWidget {
  const _Timeline({required this.d});
  final J d;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final steps = [
      ('Opens', d['openDate'] as String?),
      ('Closes', d['closeDate'] as String?),
      ('Allotment', d['allotmentDate'] as String?),
      ('Refunds', d['refundDate'] as String?),
      ('In demat', (d['details'] as J?)?['creditToDematDate'] as String?),
      ('Listing', d['listingDate'] as String?),
    ].where((s) => s.$2 != null).toList();
    if (steps.isEmpty) return const SizedBox.shrink();
    final today = _today();
    final next = steps.indexWhere((s) => s.$2!.compareTo(today) >= 0);
    return Glass(
      blur: false,
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('WHEN', style: OrvText.label(l)),
          const SizedBox(height: 10),
          for (final (n, (k, v)) in steps.indexed)
            IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  SizedBox(
                    width: 22,
                    child: Column(
                      children: [
                        Container(
                          width: 18,
                          height: 18,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: v!.compareTo(today) < 0 ? l.accent : Colors.transparent,
                            border: Border.all(
                              color: v.compareTo(today) < 0 || n == next ? l.accent : l.c.edge,
                              width: 2,
                            ),
                          ),
                          child: v.compareTo(today) < 0
                              ? const Icon(LucideIcons.check, size: 11, color: Colors.white)
                              : (n == next
                                    ? Center(
                                        child: Container(
                                          width: 6,
                                          height: 6,
                                          decoration: BoxDecoration(color: l.accent, shape: BoxShape.circle),
                                        ),
                                      )
                                    : null),
                        ),
                        if (n < steps.length - 1)
                          Expanded(child: Container(width: 2, color: v.compareTo(today) < 0 ? l.accent : l.c.edge)),
                      ],
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Row(
                        children: [
                          Expanded(
                            child: Text(
                              k,
                              style: OrvText.body(l).copyWith(
                                fontSize: 14,
                                fontWeight: n == next ? FontWeight.w700 : FontWeight.w500,
                                color: n == next ? l.accent : null,
                              ),
                            ),
                          ),
                          Text(
                            '${_weekday(v)}, ${_day(v)}',
                            style: OrvText.muted(l).copyWith(fontSize: 13, color: n == next ? l.accent : null),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _Facts extends StatelessWidget {
  const _Facts({required this.d, required this.lot});
  final J d;
  final num? lot;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final cells = [
      (
        'Price band',
        d['priceMax'] == null
            ? '—'
            : '₹${d['priceMin'] != null && d['priceMin'] != d['priceMax'] ? '${d['priceMin']}–' : ''}${d['priceMax']}',
      ),
      ('Min. investment', _rs(lot)),
      ('Face value', d['faceValue'] == null ? '—' : '₹${d['faceValue']}'),
      ('Est. listing', _rs(d['estListingPrice'] as num?)),
      ('Listing at', d['listingOn'] as String? ?? '—'),
      ('Sale', d['saleType'] as String? ?? '—'),
      if (d['status'] == 'listed')
        (
          'Listed at',
          '${_rs(d['listingPrice'] as num?)} (${(d['listingGainPct'] as num?)?.toStringAsFixed(1) ?? '—'}%)',
        ),
      if (d['cmp'] != null) ('Price now', _rs(d['cmp'] as num?)),
    ];
    return Glass(
      blur: false,
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('KEY FACTS', style: OrvText.label(l)),
          const SizedBox(height: 8),
          Wrap(
            runSpacing: 12,
            children: [
              for (final (k, v) in cells)
                FractionallySizedBox(
                  widthFactor: 0.5,
                  child: Padding(padding: const EdgeInsets.only(right: 8), child: _fact(l, k, v)),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _Odds extends StatelessWidget {
  const _Odds({required this.d});
  final J d;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final pool = d['pool'] as J?;
    return Glass(
      blur: false,
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('YOUR ODDS', style: OrvText.label(l)),
          const SizedBox(height: 6),
          Row(
            children: [
              for (final o in (d['odds'] as List).cast<J>())
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        o['category'] == 'retail' ? 'Retail' : 'Small HNI',
                        style: OrvText.muted(l).copyWith(fontSize: 12),
                      ),
                      Text(_chance(o['chance'] as num?), style: OrvText.heading(l).copyWith(fontSize: 24)),
                      Text(
                        '${o['minLots']} lot${o['minLots'] == 1 ? '' : 's'} · ${_rs(o['minAmount'] as num)}',
                        style: OrvText.muted(l).copyWith(fontSize: 12),
                      ),
                      Text(
                        o['basis'] == 'exact'
                            ? 'from applications'
                            : (o['basis'] == 'estimate' ? 'estimate' : 'once bidding starts'),
                        style: OrvText.muted(l).copyWith(fontSize: 11.5),
                      ),
                    ],
                  ),
                ),
            ],
          ),
          if (pool != null) ...[
            Divider(height: 22, color: l.c.edge),
            Text(
              'With your ${pool['accounts']} accounts',
              style: OrvText.body(l).copyWith(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                Expanded(
                  child: _fact(
                    l,
                    'Expected',
                    pool['expectedAllotments'] == null ? '—' : (pool['expectedAllotments'] as num).toStringAsFixed(2),
                  ),
                ),
                Expanded(child: _fact(l, 'At least one', _chance(pool['chanceAtLeastOne'] as num?))),
                Expanded(child: _fact(l, 'Card cost', _rs(pool['cardCost'] as num?))),
                Expanded(child: _fact(l, 'Expected gain', _signed(pool['expectedGain'] as num?))),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

/// What the company is, when the plan gives it (paid plans); else a line saying so.
class _Company extends ConsumerWidget {
  const _Company({required this.x});
  final J x;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    List<String> list(String k) => [for (final v in (x[k] as List? ?? const [])) '$v'];
    final about = x['about'] as String?;
    final strengths = list('strengths');
    final risks = list('risks');
    final objects = list('objects');
    final leads = list('leadManagers');
    final reg = x['registrar'] as J?;
    final has = about != null || strengths.isNotEmpty || objects.isNotEmpty || leads.isNotEmpty || reg != null;
    if (!has) {
      if ((x['locked'] as List? ?? const []).isEmpty) return const SizedBox.shrink();
      return Padding(
        padding: const EdgeInsets.only(top: 12),
        child: Row(
          children: [
            Icon(LucideIcons.lock, size: 13, color: l.c.muted),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                'Company details, financials and lead managers need IPO Guru’s Basic plan (₹99 a month).',
                style: OrvText.muted(l).copyWith(fontSize: 12),
              ),
            ),
          ],
        ),
      );
    }
    Widget bullets(String title, List<String> xs) => xs.isEmpty
        ? const SizedBox.shrink()
        : Padding(
            padding: const EdgeInsets.only(top: 10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title.toUpperCase(), style: OrvText.label(l).copyWith(fontSize: 10.5)),
                for (final t in xs)
                  Padding(
                    padding: const EdgeInsets.only(top: 3),
                    child: Text('•  $t', style: OrvText.body(l).copyWith(fontSize: 13.5)),
                  ),
              ],
            ),
          );
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Glass(
        blur: false,
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('THE COMPANY', style: OrvText.label(l)),
            if (about != null)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(about, style: OrvText.body(l).copyWith(fontSize: 14, height: 1.45)),
              ),
            bullets('Strengths', strengths),
            bullets('Risks', risks),
            bullets('What the money is for', objects),
            if (leads.isNotEmpty) bullets('Lead managers', [leads.join(', ')]),
            if (reg != null)
              Padding(
                padding: const EdgeInsets.only(top: 10),
                child: GestureDetector(
                  onTap: reg['statusPage'] == null
                      ? null
                      : () => ref.read(urlOpenerProvider)(Uri.parse(reg['statusPage'] as String)),
                  child: Text(
                    'Registrar: ${reg['name']}${reg['statusPage'] != null ? ' — check allotment' : ''}',
                    style: OrvText.body(l).copyWith(fontSize: 13.5, color: reg['statusPage'] != null ? l.accent : null),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _FiguresSheet extends ConsumerStatefulWidget {
  const _FiguresSheet({required this.d});
  final J d;
  @override
  ConsumerState<_FiguresSheet> createState() => _FiguresSheetState();
}

class _FiguresSheetState extends ConsumerState<_FiguresSheet> {
  late final _gmp = TextEditingController(text: widget.d['gmp']?.toString() ?? '');
  late final _retail = TextEditingController(text: (widget.d['subscription'] as J?)?['retail']?.toString() ?? '');
  late final _apps = TextEditingController(
    text: ((widget.d['subscription'] as J?)?['applications'] as J?)?['retail']?.toString() ?? '',
  );

  @override
  void dispose() {
    _gmp.dispose();
    _retail.dispose();
    _apps.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    num? n(TextEditingController c) => c.text.trim().isEmpty ? null : num.tryParse(c.text.trim());
    return StickySheet(
      title: 'Type figures',
      footer: Align(
        alignment: Alignment.centerRight,
        child: OrvButton(
          label: 'Save',
          variant: ButtonVariant.primary,
          onPressed: () async {
            final id = widget.d['id'] as String;
            await ref.read(apiProvider).put<dynamic>('/ipo/issues/$id/figures', {
              if (n(_gmp) != null) 'gmp': n(_gmp),
              'subscription': {
                if (n(_retail) != null) 'retail': n(_retail),
                if (n(_apps) != null) 'retailApplications': n(_apps)!.toInt(),
              },
            });
            ref.invalidate(ipoIssueProvider(id));
            ref.invalidate(ipoIssuesProvider);
            if (context.mounted) Navigator.of(context).pop();
          },
        ),
      ),
      children: [
        OrvField(label: 'GMP (₹)', controller: _gmp, keyboardType: TextInputType.number),
        const SizedBox(height: 8),
        OrvField(label: 'Retail (×)', controller: _retail, keyboardType: TextInputType.number),
        const SizedBox(height: 8),
        OrvField(
          label: 'Retail applications',
          controller: _apps,
          keyboardType: TextInputType.number,
          hint: 'Makes the odds exact',
        ),
      ],
    );
  }
}

// ------------------------------------------------------------------ the desk & notifications settings (spec 0016 A6)

const _events = {
  'announced': ('A new IPO is announced', 'With its size, price, a lot and the GMP.'),
  'opens': ('It opens today', 'The morning bidding starts.'),
  'closes': ('Last day to apply', 'In the morning, with retail demand so far.'),
  'gmp': ('GMP moves a lot', 'Up or down by more than your threshold.'),
  'subscription': ('Retail demand milestones', 'When retail crosses 1×, 10× and 50×.'),
  'allotment': ('Allotment day', 'The day results come out.'),
  'listing': ('Listing day', 'With the gain at the open.'),
};

class IpoSettingsSheet extends ConsumerStatefulWidget {
  const IpoSettingsSheet({super.key});
  @override
  ConsumerState<IpoSettingsSheet> createState() => _IpoSettingsSheetState();
}

class _IpoSettingsSheetState extends ConsumerState<IpoSettingsSheet> {
  J? _s;

  @override
  void initState() {
    super.initState();
    ref.read(apiProvider).get<J>('/ipo/settings').then((s) => mounted ? setState(() => _s = s) : null);
  }

  Widget _label(OrvLook l, String t) => Padding(
    padding: const EdgeInsets.fromLTRB(4, 16, 4, 6),
    child: Text(t.toUpperCase(), style: OrvText.label(l)),
  );

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final s = _s;
    if (s == null) return const SizedBox(height: 160, child: Center(child: CircularProgressIndicator()));
    final types = (s['types'] as List).cast<String>();
    final events = (s['events'] as List).cast<String>();
    void event(String e, bool on) => setState(() {
      final next = {...events};
      on ? next.add(e) : next.remove(e);
      s['events'] = next.toList();
    });
    void type(String t, bool on) => setState(() {
      final next = {...types};
      on ? next.add(t) : next.remove(t);
      if (next.isNotEmpty) s['types'] = next.toList();
    });
    return StickySheet(
      title: 'IPO desk & notifications',
      footer: OrvButton(
        label: 'Save',
        variant: ButtonVariant.primary,
        expand: true,
        onPressed: () async {
          final toaster = Toaster.of(context);
          await ref.read(apiProvider).put<dynamic>('/ipo/settings', s);
          ref.read(ipoShowProvider.notifier).set(null);
          ref.invalidate(ipoIssuesProvider);
          if (context.mounted) Navigator.of(context).pop();
          toaster.show('Saved', tone: ToastTone.success);
        },
      ),
      children: [
        _label(l, 'On the desk'),
        SheetCard(
          children: [
            OrvSwitchRow(
              label: 'Show SME IPOs too',
              value: s['showSme'] == true,
              onChanged: (v) => setState(() => s['showSme'] = v),
            ),
          ],
        ),
        _label(l, 'Will you apply?'),
        SheetCard(
          children: [
            OrvSwitchRow(
              label: 'Ask me and follow up',
              value: events.contains('decide'),
              onChanged: (v) => event('decide', v),
            ),
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Text(
                'I’ll apply makes a task; then “applied?” on the last day, “allotted?” that evening, and the listing.',
                style: OrvText.muted(l).copyWith(fontSize: 12),
              ),
            ),
            const SheetRule(),
            const SizedBox(height: 10),
            Text('Apply by, on the last day', style: OrvText.body(l).copyWith(fontSize: 14)),
            const SizedBox(height: 8),
            Segment<String>(
              value: s['applyBy'] as String? ?? '14:00',
              dense: true,
              options: const [
                ('11:00', '11 am', null, null),
                ('13:00', '1 pm', null, null),
                ('14:00', '2 pm', null, null),
                ('15:30', '3:30', null, null),
              ],
              onChanged: (v) => setState(() => s['applyBy'] = v),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Text(
                'Bids close at 5 pm, and UPI mandates can be slow late in the day.',
                style: OrvText.muted(l).copyWith(fontSize: 12),
              ),
            ),
          ],
        ),
        _label(l, 'Which IPOs ping you'),
        SheetCard(
          children: [
            const SizedBox(height: 10),
            Text('Issue size', style: OrvText.body(l).copyWith(fontSize: 14)),
            const SizedBox(height: 8),
            Segment<int>(
              value: (s['minIssueSizeCr'] as num).toInt(),
              dense: true,
              options: const [
                (0, 'Any', null, null),
                (500, '500+', null, null),
                (1000, '1k+', null, null),
                (2500, '2.5k+', null, null),
                (5000, '5k+', null, null),
              ],
              onChanged: (v) => setState(() => s['minIssueSizeCr'] = v),
            ),
            const SizedBox(height: 12),
            Text('GMP of at least', style: OrvText.body(l).copyWith(fontSize: 14)),
            const SizedBox(height: 8),
            Segment<int>(
              value: (s['minGmpPct'] as num?)?.toInt() ?? -1,
              dense: true,
              options: const [
                (-1, 'Any', null, null),
                (5, '5%', null, null),
                (10, '10%', null, null),
                (20, '20%', null, null),
                (30, '30%', null, null),
              ],
              onChanged: (v) => setState(() => s['minGmpPct'] = v < 0 ? null : v),
            ),
            const SizedBox(height: 6),
            OrvSwitchRow(
              label: 'Mainboard',
              value: types.contains('mainboard'),
              onChanged: (v) => type('mainboard', v),
            ),
            OrvSwitchRow(label: 'SME', value: types.contains('sme'), onChanged: (v) => type('sme', v)),
            OrvSwitchRow(
              label: 'Only IPOs I starred',
              value: s['onlyStarred'] == true,
              onChanged: (v) => setState(() => s['onlyStarred'] = v),
            ),
          ],
        ),
        _label(l, 'Moments'),
        SheetCard(
          children: [
            for (final (n, e) in _events.entries.indexed) ...[
              if (n > 0) const SheetRule(),
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(e.value.$1, style: OrvText.body(l).copyWith(fontSize: 14)),
                          Text(e.value.$2, style: OrvText.muted(l).copyWith(fontSize: 12)),
                        ],
                      ),
                    ),
                    Switch(value: events.contains(e.key), onChanged: (v) => event(e.key, v)),
                  ],
                ),
              ),
            ],
          ],
        ),
        _label(l, 'Keep it calm'),
        SheetCard(
          children: [
            const SizedBox(height: 10),
            Text('A GMP move worth a ping', style: OrvText.body(l).copyWith(fontSize: 14)),
            const SizedBox(height: 8),
            Segment<int>(
              value: (s['gmpMovePct'] as num).toInt(),
              dense: true,
              options: const [
                (3, '3 pts', null, null),
                (5, '5 pts', null, null),
                (10, '10 pts', null, null),
                (20, '20 pts', null, null),
              ],
              onChanged: (v) => setState(() => s['gmpMovePct'] = v),
            ),
            const SizedBox(height: 12),
            Text('At most a day', style: OrvText.body(l).copyWith(fontSize: 14)),
            const SizedBox(height: 8),
            Segment<int>(
              value: (s['maxPerDay'] as num).toInt(),
              dense: true,
              options: const [
                (2, '2', null, null),
                (4, '4', null, null),
                (6, '6', null, null),
                (10, '10', null, null),
                (20, '20', null, null),
              ],
              onChanged: (v) => setState(() => s['maxPerDay'] = v),
            ),
            const SizedBox(height: 12),
          ],
        ),
      ],
    );
  }
}

// ------------------------------------------------------------------ the Pool

class _PoolBody extends ConsumerWidget {
  const _PoolBody();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final s = ref.watch(poolSummaryProvider).value;
    final partners = ref.watch(poolPartnersProvider).value ?? const [];
    final sources = ref.watch(poolSourcesProvider).value ?? const [];
    if (s == null) return const LinearProgressIndicator(minHeight: 2);
    final pos = {for (final p in (s['partners'] as List).cast<J>()) p['partnerId'] as String: p};
    final bal = {for (final b in (s['sources'] as List).cast<J>()) b['sourceId'] as String: b};
    final net = s['netMinor'] as num;
    Widget tile(String k, String v, {Color? tone}) => Expanded(
      child: Glass(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(k.toUpperCase(), style: OrvText.label(l).copyWith(fontSize: 10.5)),
            const SizedBox(height: 2),
            Text(v, style: OrvText.heading(l).copyWith(fontSize: 18, color: tone)),
          ],
        ),
      ),
    );
    void money({String? partnerId, String? kind, String? sourceId, num? amount, String? roundId}) =>
        showGlassSheet<void>(
          context,
          (_) => MoneySheet(
            partners: partners,
            sources: sources,
            kind: kind ?? 'fund',
            partnerId: partnerId,
            sourceId: sourceId,
            amount: amount,
            roundId: roundId,
          ),
        );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            tile('Net profit', _m(net), tone: net >= 0 ? l.c.success : l.c.danger),
            const SizedBox(width: 8),
            tile('With partners', _m(s['withPartnersMinor'] as num)),
          ],
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            tile('In shares', _m(s['inSharesMinor'] as num)),
            const SizedBox(width: 8),
            tile('You owe', _m(s['owedMinor'] as num), tone: (s['owedMinor'] as num) > 0 ? l.c.danger : null),
          ],
        ),
        const SizedBox(height: 12),
        Glass(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('WHERE THE PROFIT WENT', style: OrvText.label(l)),
              const SizedBox(height: 6),
              for (final (k, v, good) in [
                ('Listing gains', s['gainMinor'] as num, true),
                ('Card & other costs', -(s['costsMinor'] as num), false),
                ('Partners’ shares', -(s['sharesMinor'] as num), false),
                ('Net to you', net, net >= 0),
              ])
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 3),
                  child: Row(
                    children: [
                      Expanded(child: Text(k, style: OrvText.muted(l))),
                      Text(
                        '${v < 0 ? '−' : ''}${_m(v.abs())}',
                        style: OrvText.body(l)
                            .copyWith(fontWeight: FontWeight.w600, color: good ? l.c.success : l.c.danger),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        Glass(
          padding: const EdgeInsets.fromLTRB(14, 10, 6, 6),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Expanded(child: Text('PARTNERS', style: OrvText.label(l))),
                  TextButton(onPressed: () => money(), child: const Text('Record money')),
                  IconButton(
                    tooltip: 'Add a partner',
                    icon: Icon(LucideIcons.userPlus, size: 18, color: l.accent),
                    onPressed: () => showGlassSheet<void>(context, (_) => const PartnerSheet()),
                  ),
                ],
              ),
              if (partners.isEmpty)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Text('Add the people whose accounts apply.', style: OrvText.muted(l)),
                ),
              for (final p in partners)
                InkWell(
                  onTap: () => showGlassSheet<void>(context, (_) => PartnerSheet(partner: p)),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    child: Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(p['name'] as String, style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600)),
                              Text(switch ((p['share'] as J)['kind']) {
                                'fixed' => '₹${(p['share'] as J)['value']} per allotment',
                                'percent' => '${(p['share'] as J)['value']}% of the gain',
                                _ => 'No share',
                              }, style: OrvText.muted(l).copyWith(fontSize: 12)),
                            ],
                          ),
                        ),
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Text(
                              _m(pos[p['id']]?['cash'] as num? ?? 0),
                              style: OrvText.body(l).copyWith(fontWeight: FontWeight.w700),
                            ),
                            Text(
                              (pos[p['id']]?['blocked'] as num? ?? 0) > 0
                                  ? '${_m(pos[p['id']]!['blocked'] as num)} blocked'
                                  : 'free',
                              style: OrvText.muted(l).copyWith(fontSize: 12),
                            ),
                          ],
                        ),
                        TextButton(
                          onPressed: () => money(partnerId: p['id'] as String),
                          child: const Text('Send'),
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        Glass(
          padding: const EdgeInsets.fromLTRB(14, 10, 6, 6),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Expanded(child: Text('WHERE THE MONEY COMES FROM', style: OrvText.label(l))),
                  IconButton(
                    tooltip: 'Add a source',
                    icon: Icon(LucideIcons.plus, size: 18, color: l.accent),
                    onPressed: () => showGlassSheet<void>(context, (_) => const SourceSheet()),
                  ),
                ],
              ),
              for (final x in sources)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(x['name'] as String, style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600)),
                            Text(
                              '${x['kind'] == 'card' ? 'Card · ${x['feePct']}%' : x['kind']}${x['repay'] == true ? ' · to pay back' : ''}',
                              style: OrvText.muted(l).copyWith(fontSize: 12),
                            ),
                          ],
                        ),
                      ),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Text('${_m(bal[x['id']]?['given'] as num? ?? 0)} given', style: OrvText.body(l)),
                          if ((bal[x['id']]?['owed'] as num? ?? 0) > 0)
                            Text(
                              'you owe ${_m(bal[x['id']]!['owed'] as num)}',
                              style: OrvText.muted(l).copyWith(fontSize: 12, color: l.c.danger),
                            ),
                        ],
                      ),
                      if ((bal[x['id']]?['owed'] as num? ?? 0) > 0)
                        TextButton(
                          onPressed: () => money(
                            kind: 'repay',
                            sourceId: x['id'] as String,
                            amount: (bal[x['id']]!['owed'] as num) / 100,
                          ),
                          child: const Text('Repay'),
                        ),
                    ],
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        Glass(
          padding: const EdgeInsets.fromLTRB(14, 10, 10, 6),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('IPOS YOU APPLIED TO', style: OrvText.label(l)),
              if ((s['rounds'] as List).isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: Text('Open an IPO in the Desk and choose “Apply from my accounts”.', style: OrvText.muted(l)),
                ),
              for (final r in (s['rounds'] as List).cast<J>())
                InkWell(
                  onTap: () => context.push('/ipo/pool/rounds/${r['id']}'),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    child: Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                (r['issue'] as J)['name'] as String,
                                style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600),
                              ),
                              Text(
                                '${r['applied']}/${r['accounts']} applied · ${r['allotted']} allotted',
                                style: OrvText.muted(l).copyWith(fontSize: 12),
                              ),
                            ],
                          ),
                        ),
                        Text(
                          (r['netMinor'] as num) == 0 ? '—' : _m(r['netMinor'] as num),
                          style: OrvText.body(l).copyWith(
                            fontWeight: FontWeight.w700,
                            color: (r['netMinor'] as num) >= 0 ? l.c.success : l.c.danger,
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
      ],
    );
  }
}

class PartnerSheet extends ConsumerStatefulWidget {
  const PartnerSheet({super.key, this.partner});
  final J? partner;
  @override
  ConsumerState<PartnerSheet> createState() => _PartnerSheetState();
}

class _PartnerSheetState extends ConsumerState<PartnerSheet> {
  late final _name = TextEditingController(text: widget.partner?['name'] as String? ?? '');
  late final _phone = TextEditingController(text: widget.partner?['phone'] as String? ?? '');
  late final _upi = TextEditingController(text: widget.partner?['upi'] as String? ?? '');
  late final _value = TextEditingController(text: '${(widget.partner?['share'] as J?)?['value'] ?? 25}');
  late String _kind = (widget.partner?['share'] as J?)?['kind'] as String? ?? 'none';

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    _upi.dispose();
    _value.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final p = widget.partner;
    return StickySheet(
      title: p == null ? 'Add a partner' : p['name'] as String,
      footer: Row(
        children: [
          if (p != null && (p['phone'] as String).isNotEmpty)
            TextButton.icon(
              icon: const Icon(LucideIcons.messageCircle, size: 16),
              label: const Text('Send their link'),
              onPressed: () async {
                final r = await ref.read(apiProvider).post<J>('/ipo/pool/partners/${p['id']}/link');
                final digits = (p['phone'] as String).replaceAll(RegExp(r'\D'), '');
                final phone = digits.length == 10 ? '91$digits' : digits;
                await ref.read(urlOpenerProvider)(
                  Uri.parse(
                    'https://wa.me/$phone?text=${Uri.encodeComponent('Hi ${p['name']}, your IPO page: ${r['url']}')}',
                  ),
                );
              },
            ),
          const Spacer(),
          OrvButton(
            label: 'Save',
            variant: ButtonVariant.primary,
            onPressed: () async {
              final body = {
                'name': _name.text.trim(),
                'phone': _phone.text.trim(),
                'upi': _upi.text.trim(),
                'share': {'kind': _kind, 'value': _kind == 'none' ? 0 : num.tryParse(_value.text) ?? 0},
              };
              if (p == null) {
                await ref.read(apiProvider).post<dynamic>('/ipo/pool/partners', body);
              } else {
                await ref.read(apiProvider).put<dynamic>('/ipo/pool/partners/${p['id']}', {...p, ...body});
              }
              ref.invalidate(poolPartnersProvider);
              ref.invalidate(poolSummaryProvider);
              if (context.mounted) Navigator.of(context).pop();
            },
          ),
        ],
      ),
      children: [
        OrvField(label: 'Name', controller: _name, autofocus: p == null),
        const SizedBox(height: 8),
        OrvField(label: 'Phone (WhatsApp)', controller: _phone, keyboardType: TextInputType.phone),
        const SizedBox(height: 8),
        OrvField(label: 'UPI ID', controller: _upi),
        const SizedBox(height: 10),
        Text('THEIR SHARE OF A GAIN', style: OrvText.label(l)),
        const SizedBox(height: 6),
        Wrap(
          spacing: 6,
          children: [
            _chip(context, 'Nothing', _kind == 'none', () => setState(() => _kind = 'none')),
            _chip(context, 'Fixed ₹', _kind == 'fixed', () => setState(() => _kind = 'fixed')),
            _chip(context, '% of the gain', _kind == 'percent', () => setState(() => _kind = 'percent')),
          ],
        ),
        if (_kind != 'none') ...[
          const SizedBox(height: 8),
          OrvField(
            label: _kind == 'fixed' ? '₹ per allotment' : '% of the gain',
            controller: _value,
            keyboardType: TextInputType.number,
          ),
        ],
      ],
    );
  }
}

class SourceSheet extends ConsumerStatefulWidget {
  const SourceSheet({super.key});
  @override
  ConsumerState<SourceSheet> createState() => _SourceSheetState();
}

class _SourceSheetState extends ConsumerState<SourceSheet> {
  final _name = TextEditingController();
  final _fee = TextEditingController(text: '0');
  String _kind = 'family';
  bool _repay = true;

  @override
  void dispose() {
    _name.dispose();
    _fee.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return StickySheet(
      title: 'Add a source',
      footer: Align(
        alignment: Alignment.centerRight,
        child: OrvButton(
          label: 'Save',
          variant: ButtonVariant.primary,
          onPressed: () async {
            await ref.read(apiProvider).post<dynamic>('/ipo/pool/sources', {
              'name': _name.text.trim(),
              'kind': _kind,
              'feePct': num.tryParse(_fee.text) ?? 0,
              'repay': _repay,
            });
            ref.invalidate(poolSourcesProvider);
            ref.invalidate(poolSummaryProvider);
            if (context.mounted) Navigator.of(context).pop();
          },
        ),
      ),
      children: [
        OrvField(label: 'Name (Brother, Dad, HDFC card cash…)', controller: _name, autofocus: true),
        const SizedBox(height: 8),
        Wrap(
          spacing: 6,
          children: [
            for (final (k, label) in const [
              ('self', 'My own'),
              ('family', 'Family'),
              ('card', 'Credit card'),
              ('other', 'Other'),
            ])
              _chip(context, label, _kind == k, () {
                setState(() {
                  _kind = k;
                  _repay = k == 'family';
                  if (k == 'card' && (num.tryParse(_fee.text) ?? 0) == 0) _fee.text = '2.5';
                });
              }),
          ],
        ),
        const SizedBox(height: 8),
        OrvField(label: 'What it costs to use (%)', controller: _fee, keyboardType: TextInputType.number),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: Text('Has to be paid back', style: OrvText.body(l)),
          value: _repay,
          onChanged: (v) => setState(() => _repay = v),
        ),
      ],
    );
  }
}

class MoneySheet extends ConsumerStatefulWidget {
  const MoneySheet({
    super.key,
    required this.partners,
    required this.sources,
    this.kind = 'fund',
    this.partnerId,
    this.sourceId,
    this.amount,
    this.roundId,
  });
  final List<J> partners;
  final List<J> sources;
  final String kind;
  final String? partnerId;
  final String? sourceId;
  final num? amount;
  final String? roundId;
  @override
  ConsumerState<MoneySheet> createState() => _MoneySheetState();
}

class _MoneySheetState extends ConsumerState<MoneySheet> {
  late String _kind = widget.kind;
  late String? _partner = widget.partnerId;
  late String? _source = widget.sourceId ?? widget.sources.firstOrNull?['id'] as String?;
  late final _amount = TextEditingController(text: widget.amount == null ? '' : '${widget.amount}');
  String _method = 'UPI';

  @override
  void initState() {
    super.initState();
    _amount.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _amount.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final src = widget.sources.where((s) => s['id'] == _source).firstOrNull;
    final amount = num.tryParse(_amount.text) ?? 0;
    final fee = _kind == 'fund' && src != null ? amount * (src['feePct'] as num) / 100 : 0;
    Widget pick(String label, List<J> items, String? value, void Function(String) set) => Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label.toUpperCase(), style: OrvText.label(l)),
        const SizedBox(height: 4),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            for (final x in items)
              _chip(context, x['name'] as String, value == x['id'], () => setState(() => set(x['id'] as String))),
          ],
        ),
        const SizedBox(height: 8),
      ],
    );
    return StickySheet(
      title: 'Record money',
      footer: Row(
        children: [
          Expanded(
            child: Text(
              fee > 0 ? '${src!['name']} fee: ${_rs(fee)}' : 'ORVYN never moves money.',
              style: OrvText.muted(l).copyWith(fontSize: 12, color: fee > 0 ? l.c.warning : null),
            ),
          ),
          OrvButton(
            label: 'Record',
            variant: ButtonVariant.primary,
            onPressed: amount <= 0
                ? null
                : () async {
                    final toaster = Toaster.of(context);
                    try {
                      await ref.read(apiProvider).post<dynamic>('/ipo/pool/ledger', {
                        'kind': _kind,
                        'amount': amount,
                        'partnerId': _kind == 'fund' || _kind == 'return' ? _partner : null,
                        'sourceId': _kind == 'fund' || _kind == 'repay' || _kind == 'cost' ? _source : null,
                        'roundId': widget.roundId,
                        'method': _method,
                      });
                      ref.invalidate(poolSummaryProvider);
                      if (widget.roundId != null) ref.invalidate(poolRoundProvider(widget.roundId!));
                      if (context.mounted) Navigator.of(context).pop();
                      toaster.show('Recorded', tone: ToastTone.success);
                    } catch (e) {
                      toaster.show('Couldn’t record it', body: messageFor(e), tone: ToastTone.danger);
                    }
                  },
          ),
        ],
      ),
      children: [
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            for (final (k, label) in const [
              ('fund', 'I sent money'),
              ('return', 'Money came back'),
              ('repay', 'I paid back'),
              ('cost', 'A cost'),
            ])
              _chip(context, label, _kind == k, () => setState(() => _kind = k)),
          ],
        ),
        const SizedBox(height: 10),
        if (_kind == 'fund' || _kind == 'repay' || _kind == 'cost')
          pick(_kind == 'repay' ? 'To' : 'From', widget.sources, _source, (v) => _source = v),
        if (_kind == 'fund' || _kind == 'return')
          pick(_kind == 'fund' ? 'To' : 'From', widget.partners, _partner, (v) => _partner = v),
        OrvField(label: 'Amount (₹)', controller: _amount, keyboardType: TextInputType.number),
        const SizedBox(height: 8),
        Wrap(
          spacing: 6,
          children: [
            for (final x in const ['UPI', 'IMPS', 'Cash'])
              _chip(context, x, _method == x, () => setState(() => _method = x)),
          ],
        ),
      ],
    );
  }
}

class StartRoundSheet extends ConsumerStatefulWidget {
  const StartRoundSheet({super.key, required this.issueId, required this.issueName});
  final String issueId;
  final String issueName;
  @override
  ConsumerState<StartRoundSheet> createState() => _StartRoundSheetState();
}

class _StartRoundSheetState extends ConsumerState<StartRoundSheet> {
  Set<String>? _chosen;

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final partners = (ref.watch(poolPartnersProvider).value ?? const []).where((p) => p['active'] == true).toList();
    _chosen ??= partners.isEmpty ? null : {for (final p in partners) p['id'] as String};
    return StickySheet(
      title: 'Apply to ${widget.issueName}',
      footer: Align(
        alignment: Alignment.centerRight,
        child: OrvButton(
          label: 'Plan it',
          variant: ButtonVariant.primary,
          onPressed: (_chosen ?? const {}).isEmpty
              ? null
              : () async {
                  final r = await ref.read(apiProvider).post<J>('/ipo/pool/rounds', {
                    'issueId': widget.issueId,
                    'partnerIds': _chosen!.toList(),
                  });
                  ref.invalidate(ipoIssueProvider(widget.issueId));
                  if (!context.mounted) return;
                  Navigator.of(context).pop();
                  await context.push('/ipo/pool/rounds/${r['id']}');
                },
        ),
      ),
      children: [
        if (partners.isEmpty) Text('Add partners first in My Pool.', style: OrvText.muted(l)),
        for (final p in partners)
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(p['name'] as String, style: OrvText.body(l)),
            value: _chosen?.contains(p['id']) ?? false,
            onChanged: (v) => setState(() => v == true ? _chosen!.add(p['id'] as String) : _chosen!.remove(p['id'])),
          ),
      ],
    );
  }
}

// ------------------------------------------------------------------ one round

const _word = {
  'planned': 'Planned',
  'funded': 'Money sent',
  'applied': 'Applied',
  'mandate': 'Mandate accepted',
  'allotted': 'Allotted',
  'not_allotted': 'Not allotted',
  'sold': 'Sold',
  'settled': 'Settled',
};

class RoundScreen extends ConsumerWidget {
  const RoundScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final r = ref.watch(poolRoundProvider(id)).value;
    final partners = ref.watch(poolPartnersProvider).value ?? const [];
    final sources = ref.watch(poolSourcesProvider).value ?? const [];
    final api = ref.read(apiProvider);
    Future<void> update(J a, Map<String, dynamic> body) async {
      await api.put<dynamic>('/ipo/pool/applications/${a['id']}', body);
      ref.invalidate(poolRoundProvider(id));
      ref.invalidate(poolSummaryProvider);
    }

    return OrvModule(
      module: 'ipo',
      child: Builder(
        builder: (context) {
          final l = context.orv;
          if (r == null) return const Scaffold(body: Center(child: CircularProgressIndicator()));
          final issue = r['issue'] as J;
          return Scaffold(
            body: SafeArea(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 40),
                children: [
                  Row(
                    children: [
                      IconButton(
                        tooltip: 'Back',
                        icon: Icon(LucideIcons.arrowLeft, color: l.c.text),
                        onPressed: () => context.canPop() ? context.pop() : context.go('/ipo'),
                      ),
                      Expanded(
                        child: PageTitle(
                          issue['name'] as String,
                          overline:
                              '${r['applied']}/${r['accounts']} applied · closes ${_day(issue['closeDate'] as String?)}',
                        ),
                      ),
                    ],
                  ),
                  Glass(
                    padding: const EdgeInsets.all(14),
                    child: Row(
                      children: [
                        Expanded(child: _fact(l, 'To send', _m(r['toSendMinor'] as num))),
                        Expanded(child: _fact(l, 'Card cost', _m(r['feesIfCheapestMinor'] as num))),
                        Expanded(child: _fact(l, 'Net to you', _m(r['netMinor'] as num))),
                      ],
                    ),
                  ),
                  for (final a in (r['applications'] as List).cast<J>()) ...[
                    const SizedBox(height: 10),
                    Glass(
                      blur: false,
                      padding: const EdgeInsets.fromLTRB(14, 12, 10, 8),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Row(
                            children: [
                              Expanded(
                                child: Text(
                                  (a['partner'] as J)['name'] as String,
                                  style: OrvText.body(l).copyWith(fontWeight: FontWeight.w700),
                                ),
                              ),
                              if (a['reportedBy'] == 'partner') OrvBadge('said so', tone: l.accent),
                              const SizedBox(width: 6),
                              OrvBadge(_word[a['status']] ?? a['status'] as String),
                            ],
                          ),
                          Text(
                            '${a['lots']} lot · ${_m(a['amountMinor'] as num)} · holds ${_m(a['holdsMinor'] as num)}',
                            style: OrvText.muted(l).copyWith(fontSize: 12.5),
                          ),
                          if ((a['needMinor'] as num) > 0)
                            Padding(
                              padding: const EdgeInsets.only(top: 4),
                              child: Text(
                                'Needs ${_m(a['needMinor'] as num)}${a['suggestion'] == null ? '' : ' — cheapest: ${(a['suggestion'] as J)['source']}'}',
                                style: OrvText.body(l).copyWith(fontSize: 13.5, color: l.c.warning),
                              ),
                            )
                          else if (['planned', 'funded'].contains(a['status']))
                            Padding(
                              padding: const EdgeInsets.only(top: 4),
                              child: Text(
                                'Already holds enough — nothing to send.',
                                style: OrvText.body(l).copyWith(fontSize: 13.5),
                              ),
                            ),
                          if (a['gainMinor'] != null)
                            Padding(
                              padding: const EdgeInsets.only(top: 4),
                              child: Text(
                                'Gain ${_m(a['gainMinor'] as num)} · their share ${_m(a['shareMinor'] as num? ?? 0)} · back ${_m(a['backMinor'] as num)}',
                                style: OrvText.body(l).copyWith(fontSize: 13.5),
                              ),
                            ),
                          Wrap(
                            spacing: 2,
                            children: [
                              if ((a['needMinor'] as num) > 0)
                                TextButton(
                                  onPressed: () => showGlassSheet<void>(
                                    context,
                                    (_) => MoneySheet(
                                      partners: partners,
                                      sources: sources,
                                      partnerId: (a['partner'] as J)['id'] as String,
                                      sourceId: (a['suggestion'] as J?)?['sourceId'] as String?,
                                      amount: (a['needMinor'] as num) / 100,
                                      roundId: id,
                                    ),
                                  ),
                                  child: const Text('Record transfer'),
                                ),
                              if (['planned', 'funded'].contains(a['status']))
                                TextButton(
                                  onPressed: () => update(a, {'status': 'applied'}),
                                  child: const Text('Applied'),
                                ),
                              if (a['status'] == 'applied')
                                TextButton(
                                  onPressed: () => update(a, {'status': 'mandate'}),
                                  child: const Text('Mandate'),
                                ),
                              if (['applied', 'mandate'].contains(a['status'])) ...[
                                TextButton(
                                  onPressed: () => update(a, {'allottedLots': 1}),
                                  child: const Text('Allotted'),
                                ),
                                TextButton(
                                  onPressed: () => update(a, {'status': 'not_allotted'}),
                                  child: const Text('Not allotted'),
                                ),
                              ],
                              if (a['status'] == 'allotted')
                                TextButton(
                                  onPressed: () => showGlassSheet<void>(
                                    context,
                                    (_) => _SaleSheet(
                                      suggested:
                                          (issue['listingPrice'] as num?) ??
                                          ((issue['priceMax'] as num?) != null && issue['gmp'] != null
                                              ? (issue['priceMax'] as num) + (issue['gmp'] as num)
                                              : null),
                                      onSave: (price) => update(a, {'soldPrice': price, 'saleCosts': 20}),
                                    ),
                                  ),
                                  child: const Text('Sold…'),
                                ),
                              if (a['status'] == 'sold')
                                TextButton(
                                  onPressed: () async {
                                    await api.post<dynamic>('/ipo/pool/applications/${a['id']}/settle', {
                                      'returned': (a['backMinor'] as num) / 100,
                                    });
                                    ref.invalidate(poolRoundProvider(id));
                                    ref.invalidate(poolSummaryProvider);
                                  },
                                  child: const Text('Settle (all back)'),
                                ),
                              if ((a['partner'] as J)['phone'] != '' && ['planned', 'funded'].contains(a['status']))
                                IconButton(
                                  tooltip: 'Ask on WhatsApp',
                                  icon: Icon(LucideIcons.messageCircle, size: 18, color: l.accent),
                                  onPressed: () async {
                                    final link = await api.post<J>(
                                      '/ipo/pool/partners/${(a['partner'] as J)['id']}/link',
                                    );
                                    final digits = ((a['partner'] as J)['phone'] as String).replaceAll(
                                      RegExp(r'\D'),
                                      '',
                                    );
                                    final text =
                                        'Hi ${(a['partner'] as J)['name']}, please apply to the ${issue['name']} IPO: ${a['lots']} lot (${_m(a['amountMinor'] as num)}) before ${_day(issue['closeDate'] as String?)}. Tap here when done: ${link['url']}';
                                    await ref.read(urlOpenerProvider)(
                                      Uri.parse(
                                        'https://wa.me/${digits.length == 10 ? '91$digits' : digits}?text=${Uri.encodeComponent(text)}',
                                      ),
                                    );
                                  },
                                ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ],
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}

class _SaleSheet extends StatefulWidget {
  const _SaleSheet({required this.suggested, required this.onSave});
  final num? suggested;
  final Future<void> Function(num price) onSave;
  @override
  State<_SaleSheet> createState() => _SaleSheetState();
}

class _SaleSheetState extends State<_SaleSheet> {
  late final _price = TextEditingController(text: widget.suggested?.toString() ?? '');
  @override
  void dispose() {
    _price.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => StickySheet(
    title: 'Sold at',
    footer: Align(
      alignment: Alignment.centerRight,
      child: OrvButton(
        label: 'Save',
        variant: ButtonVariant.primary,
        onPressed: () async {
          final p = num.tryParse(_price.text);
          if (p == null) return;
          unawaited(HapticFeedback.lightImpact());
          await widget.onSave(p);
          if (context.mounted) Navigator.of(context).pop();
        },
      ),
    ),
    children: [OrvField(label: '₹ a share', controller: _price, keyboardType: TextInputType.number, autofocus: true)],
  );
}
