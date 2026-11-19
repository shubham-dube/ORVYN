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
  return ref.read(apiProvider).get<J>('/ipo/issues', query: {'when': when});
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
                    const Expanded(child: PageTitle('IPO desk', overline: 'India · mainboard and SME')),
                    if (!_pool)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 14),
                        child: IconButton(
                          tooltip: 'IPO notifications',
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

class _DeskBody extends ConsumerWidget {
  const _DeskBody();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final when = ref.watch(ipoWhenProvider);
    final data = ref.watch(ipoIssuesProvider);
    final issues = [for (final x in (data.value?['issues'] as List? ?? const [])) x as J];
    final feed = data.value?['feed'] as J?;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SizedBox(
          height: 40,
          child: ListView(
            scrollDirection: Axis.horizontal,
            children: [
              for (final (k, label) in const [
                ('current', 'Open & upcoming'),
                ('closed', 'Awaiting listing'),
                ('listed', 'Listed'),
              ])
                Padding(
                  padding: const EdgeInsets.only(right: 6),
                  child: _chip(context, label, when == k, () => ref.read(ipoWhenProvider.notifier).set(k)),
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
            padding: const EdgeInsets.only(top: 10),
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

class _IssueCard extends StatelessWidget {
  const _IssueCard({required this.i});
  final J i;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final odds = (i['odds'] as List).cast<J>();
    final retail = odds.where((o) => o['category'] == 'retail').firstOrNull;
    final sub = i['subscription'] as J?;
    final gmpPct = i['gmpPct'] as num?;
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
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        i['name'] as String,
                        style: OrvText.body(l).copyWith(fontWeight: FontWeight.w700),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    if (i['starred'] == true) Icon(LucideIcons.star, size: 15, color: l.c.warning),
                    const SizedBox(width: 6),
                    OrvBadge(i['type'] == 'sme' ? 'SME' : i['status'] as String),
                  ],
                ),
                const SizedBox(height: 2),
                Text(
                  '${i['issueSizeCr'] == null ? 'Size —' : '₹${_group((i['issueSizeCr'] as num).round())} cr'} · '
                  '${_rs(i['priceMax'] as num?)} · ${retail == null ? '' : '${_rs(retail['minAmount'] as num)} a lot · '}'
                  '${_day(i['openDate'] as String?)}–${_day(i['closeDate'] as String?)}',
                  style: OrvText.muted(l).copyWith(fontSize: 12.5),
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    OrvBadge(
                      i['gmp'] == null ? 'GMP —' : 'GMP ₹${i['gmp']} · ${gmpPct?.toStringAsFixed(0)}%',
                      tone: (gmpPct ?? 0) >= 25
                          ? l.c.success
                          : (gmpPct ?? 0) <= 0 && i['gmp'] != null
                          ? l.c.danger
                          : null,
                    ),
                    if (sub?['retail'] != null) OrvBadge('Retail ${_times(sub!['retail'] as num)}'),
                    if (retail?['chance'] != null)
                      OrvBadge('Odds ${_chance(retail!['chance'] as num)}', tone: l.accent),
                    if (i['pool'] != null) OrvBadge('${(i['pool'] as J)['accounts']} accounts', tone: l.accent),
                  ],
                ),
                const SizedBox(height: 8),
                Text(i['verdict'] as String, style: OrvText.muted(l).copyWith(fontSize: 13)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// ------------------------------------------------------------------ one IPO

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
          return Scaffold(
            body: SafeArea(
              child: d == null
                  ? const Center(child: CircularProgressIndicator())
                  : ListView(
                      padding: const EdgeInsets.fromLTRB(16, 8, 16, 40),
                      children: [
                        Row(
                          children: [
                            IconButton(
                              tooltip: 'Back',
                              icon: Icon(LucideIcons.arrowLeft, color: l.c.text),
                              onPressed: () => context.canPop() ? context.pop() : context.go('/ipo'),
                            ),
                            Expanded(child: PageTitle(d['name'] as String, overline: d['status'] as String)),
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
                          ],
                        ),
                        Text(d['verdict'] as String, style: OrvText.body(l)),
                        const SizedBox(height: 12),
                        _Facts(d: d),
                        const SizedBox(height: 12),
                        _GmpAndSubscription(d: d),
                        const SizedBox(height: 12),
                        _Odds(d: d),
                        const SizedBox(height: 12),
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
                                variant: ButtonVariant.primary,
                                icon: LucideIcons.users,
                                onPressed: () => showGlassSheet<void>(
                                  context,
                                  (_) => StartRoundSheet(issueId: id, issueName: d['name'] as String),
                                ),
                              ),
                            const Spacer(),
                            TextButton(
                              onPressed: () => showGlassSheet<void>(context, (_) => _FiguresSheet(d: d)),
                              child: const Text('Type figures'),
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        Text(
                          d['sourceUrl'] == null
                              ? 'Typed in by hand · GMP is unofficial · not investment advice'
                              : 'Data: ${d['source']} · GMP is unofficial · not investment advice',
                          style: OrvText.muted(l).copyWith(fontSize: 11.5),
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

Widget _fact(OrvLook l, String k, String v) => Column(
  crossAxisAlignment: CrossAxisAlignment.start,
  children: [
    Text(k.toUpperCase(), style: OrvText.label(l).copyWith(fontSize: 10.5)),
    const SizedBox(height: 2),
    Text(v, style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600, fontSize: 14)),
  ],
);

class _Facts extends StatelessWidget {
  const _Facts({required this.d});
  final J d;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final cells = [
      ('Issue size', d['issueSizeCr'] == null ? '—' : '₹${_group((d['issueSizeCr'] as num).round())} cr'),
      ('Price', _rs(d['priceMax'] as num?)),
      ('Lot', d['lotSize'] == null ? '—' : '${d['lotSize']} shares'),
      ('Est. listing', _rs(d['estListingPrice'] as num?)),
      ('Closes', _day(d['closeDate'] as String?)),
      ('Allotment', _day(d['allotmentDate'] as String?)),
      ('Refund', _day(d['refundDate'] as String?)),
      ('Listing', _day(d['listingDate'] as String?)),
    ];
    return Glass(
      padding: const EdgeInsets.all(14),
      child: GridView.count(
        crossAxisCount: 4,
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        childAspectRatio: 1.45,
        children: [for (final (k, v) in cells) _fact(l, k, v)],
      ),
    );
  }
}

class _GmpAndSubscription extends StatelessWidget {
  const _GmpAndSubscription({required this.d});
  final J d;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final s = d['subscription'] as J?;
    final history = [for (final h in (d['history'] as List? ?? const [])) h as J]
        .where((h) => h['gmp'] != null)
        .toList();
    return Glass(
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
          Text(
            d['gmp'] == null ? '—' : '₹${d['gmp']}  ${(d['gmpPct'] as num?)?.toStringAsFixed(1)}%',
            style: OrvText.heading(l).copyWith(fontSize: 24),
          ),
          if (history.length > 1)
            Text(
              'Trend: ${history.map((h) => '₹${h['gmp']}').join(' → ')}',
              style: OrvText.muted(l).copyWith(fontSize: 12),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          Divider(height: 22, color: l.c.edge),
          Text('SUBSCRIPTION', style: OrvText.label(l)),
          const SizedBox(height: 4),
          if (s == null)
            Text('No figures yet — they come once bidding starts.', style: OrvText.muted(l))
          else
            for (final (k, v) in [
              ('QIB', s['qib']),
              ('NII', s['nii']),
              ('Small HNI', s['snii']),
              ('Retail', s['retail']),
              ('Total', s['total']),
            ])
              if (v != null)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 2),
                  child: Row(
                    children: [
                      Expanded(child: Text(k, style: OrvText.muted(l))),
                      Text(_times(v as num), style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600)),
                    ],
                  ),
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
                            : o['basis'] == 'estimate'
                            ? 'estimate'
                            : 'once bidding starts',
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
                Expanded(child: _fact(l, 'Expected gain', _rs(pool['expectedGain'] as num?))),
              ],
            ),
          ],
        ],
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

// ------------------------------------------------------------------ notifications settings

const _events = {
  'announced': 'A new IPO is announced',
  'opens': 'It opens today',
  'closes': 'Last day to apply',
  'gmp': 'GMP moves a lot',
  'subscription': 'Retail crosses 1×, 10×, 50×',
  'allotment': 'Allotment day',
  'listing': 'Listing day',
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

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final s = _s;
    if (s == null) return const SizedBox(height: 160, child: Center(child: CircularProgressIndicator()));
    final types = (s['types'] as List).cast<String>();
    final events = (s['events'] as List).cast<String>();
    return StickySheet(
      title: 'IPO notifications',
      footer: Align(
        alignment: Alignment.centerRight,
        child: OrvButton(
          label: 'Save',
          variant: ButtonVariant.primary,
          onPressed: () async {
            final toaster = Toaster.of(context);
            await ref.read(apiProvider).put<dynamic>('/ipo/settings', s);
            if (context.mounted) Navigator.of(context).pop();
            toaster.show('Saved', tone: ToastTone.success);
          },
        ),
      ),
      children: [
        Text('WHICH IPOS', style: OrvText.label(l)),
        const SizedBox(height: 6),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            for (final v in [0, 500, 1000, 2500, 5000])
              _chip(
                context,
                v == 0 ? 'Any size' : '₹${_group(v)} cr+',
                (s['minIssueSizeCr'] as num) == v,
                () => setState(() => s['minIssueSizeCr'] = v),
              ),
          ],
        ),
        const SizedBox(height: 6),
        Wrap(
          spacing: 6,
          children: [
            for (final t in ['mainboard', 'sme'])
              _chip(context, t == 'sme' ? 'SME' : 'Mainboard', types.contains(t), () {
                setState(() {
                  final next = {...types};
                  if (!next.remove(t)) next.add(t);
                  if (next.isNotEmpty) s['types'] = next.toList();
                });
              }),
          ],
        ),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: Text('Only IPOs I starred', style: OrvText.body(l)),
          value: s['onlyStarred'] == true,
          onChanged: (v) => setState(() => s['onlyStarred'] = v),
        ),
        Text('WHEN TO PING', style: OrvText.label(l)),
        for (final e in _events.entries)
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            dense: true,
            title: Text(e.value, style: OrvText.body(l).copyWith(fontSize: 14)),
            value: events.contains(e.key),
            onChanged: (v) => setState(() {
              final next = {...events};
              v ? next.add(e.key) : next.remove(e.key);
              s['events'] = next.toList();
            }),
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
