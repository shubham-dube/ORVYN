import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_timezone/flutter_timezone.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../activity/phone_day.dart';
import '../app/state.dart';
import '../design/controls.dart';
import '../design/glass.dart';
import '../design/theme.dart';
import 'common.dart';

typedef J = Map<String, dynamic>;

class _DayQuery {
  const _DayQuery(this.date);
  final String date;
  @override
  bool operator ==(Object o) => o is _DayQuery && o.date == date;
  @override
  int get hashCode => date.hashCode;
}

final _dayProvider = FutureProvider.autoDispose.family<J, _DayQuery>((ref, q) async {
  final tz = await FlutterTimezone.getLocalTimezone().then((t) => t.identifier, onError: (_) => 'Asia/Kolkata');
  return ref.read(apiProvider).get<J>('/activity/day', query: {'date': q.date, 'tz': tz});
});

String _ymd(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

String _dur(num ms) {
  final m = (ms / 60000).round();
  if (m < 1) return ms > 0 ? 'under a minute' : '0 min';
  final h = m ~/ 60;
  return h > 0 ? '$h h${m % 60 > 0 ? ' ${m % 60} min' : ''}' : '$m min';
}

String _clock(String iso) {
  final t = DateTime.parse(iso).toLocal();
  final h = t.hour % 12 == 0 ? 12 : t.hour % 12;
  return '$h:${t.minute.toString().padLeft(2, '0')} ${t.hour < 12 ? 'am' : 'pm'}';
}

/// My Day (spec 0020, 0024): every device in one day, this phone included.
class DayScreen extends ConsumerStatefulWidget {
  const DayScreen({super.key});
  @override
  ConsumerState<DayScreen> createState() => _DayScreenState();
}

class _DayScreenState extends ConsumerState<DayScreen> with WidgetsBindingObserver {
  DateTime _day = DateTime.now();
  bool? _on;
  bool? _allowed;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_check());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    // back from Android's Usage access page
    if (s == AppLifecycleState.resumed) unawaited(_check(send: true));
  }

  Future<void> _check({bool send = false}) async {
    final store = ref.read(storeProvider);
    final usage = ref.read(usageSourceProvider);
    final on = await phoneDayOn(store);
    final allowed = await usage.allowed().catchError((Object _) => false);
    if (!mounted) return;
    setState(() {
      _on = on;
      _allowed = allowed;
    });
    if (send && on && allowed) {
      await sendPhoneDay(ref.read(apiProvider), store, usage).catchError((Object _) => null);
      ref.invalidate(_dayProvider);
    }
  }

  Future<void> _switch(bool on) async {
    await setPhoneDay(ref.read(storeProvider), ref.read(usageSourceProvider), on);
    if (on && !(_allowed ?? false)) await ref.read(usageSourceProvider).openSettings();
    await _check(send: on);
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final date = _ymd(_day);
    final today = _ymd(DateTime.now());
    final day = ref.watch(_dayProvider(_DayQuery(date)));
    return Scaffold(
      body: SafeArea(
        child: RefreshIndicator(
          color: l.accent,
          onRefresh: () async {
            await _check(send: true);
            ref.invalidate(_dayProvider);
          },
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 40),
            children: [
              Row(
                children: [
                  IconButton(
                    onPressed: () => context.canPop() ? context.pop() : context.go('/'),
                    icon: Icon(LucideIcons.arrowLeft, color: l.c.text),
                    tooltip: 'Back',
                  ),
                  const Expanded(child: PageTitle('My Day')),
                  IconButton(
                    tooltip: 'Day before',
                    onPressed: () => setState(() => _day = _day.subtract(const Duration(days: 1))),
                    icon: Icon(LucideIcons.chevronLeft, color: l.c.text),
                  ),
                  IconButton(
                    tooltip: 'Day after',
                    onPressed: date == today ? null : () => setState(() => _day = _day.add(const Duration(days: 1))),
                    icon: Icon(LucideIcons.chevronRight, color: l.c.text),
                  ),
                ],
              ),
              _PhoneCard(on: _on, allowed: _allowed, onSwitch: _switch),
              const SizedBox(height: 12),
              ...day.when(
                loading: () => [
                  const Center(
                    child: Padding(padding: EdgeInsets.all(24), child: CircularProgressIndicator()),
                  ),
                ],
                error: (e, _) => [Text(messageFor(e), style: OrvText.muted(l))],
                data: (d) => _body(l, d, date),
              ),
            ],
          ),
        ),
      ),
    );
  }

  List<Widget> _body(OrvLook l, J d, String date) {
    final devices = (d['devices'] as List? ?? const []).cast<J>();
    final blocks = (d['blocks'] as List).cast<J>().where((b) {
      final ms = DateTime.parse(b['end'] as String).difference(DateTime.parse(b['start'] as String)).inMilliseconds;
      return ms >= 120000 && (b['kind'] == 'active' || b['kind'] == 'media');
    }).toList();
    if ((d['activeMs'] as num) == 0) {
      return [Text('Nothing was recorded on $date.', style: OrvText.muted(l))];
    }
    return [
      Wrap(
        spacing: 10,
        runSpacing: 10,
        children: [
          _Tile('In use', _dur(d['activeMs'] as num), 'any device, counted once'),
          _Tile('Deep work', _dur(d['deepMs'] as num), '${(d['deep'] as List).length} runs'),
          if (d['firstAt'] != null)
            _Tile('From – to', '${_clock(d['firstAt'] as String)} – ${_clock(d['lastAt'] as String)}', ''),
        ],
      ),
      const SizedBox(height: 16),
      Text('Each device', style: OrvText.heading(l)),
      const SizedBox(height: 8),
      for (final v in devices)
        Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: Glass(
            blur: false,
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(
                      switch (v['kind']) {
                        'phone' => LucideIcons.smartphone,
                        'pc' => LucideIcons.monitor,
                        _ => LucideIcons.globe,
                      },
                      size: 16,
                      color: l.c.muted,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        v['name'] as String,
                        style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    Text(_dur(v['activeMs'] as num), style: OrvText.muted(l)),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  [for (final p in (v['places'] as List).cast<J>().take(6)) '${p['place']} ${_dur(p['ms'] as num)}']
                      .join(' · '),
                  style: OrvText.muted(l),
                ),
              ],
            ),
          ),
        ),
      const SizedBox(height: 12),
      Text('Where the attention was', style: OrvText.heading(l)),
      const SizedBox(height: 6),
      for (final b in blocks.reversed)
        ListTile(
          dense: true,
          contentPadding: EdgeInsets.zero,
          title: Text(
            '${b['place']}${(b['what'] as String).isEmpty ? '' : ': ${b['what']}'}',
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: OrvText.body(l),
          ),
          subtitle: Text(
            '${_clock(b['start'] as String)}–${_clock(b['end'] as String)}${devices.length > 1 ? ' · ${b['device']}' : ''}',
            style: OrvText.muted(l),
          ),
        ),
    ];
  }
}

class _Tile extends StatelessWidget {
  const _Tile(this.label, this.value, this.sub);
  final String label, value, sub;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return SizedBox(
      width: 160,
      child: Glass(
        blur: false,
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label, style: OrvText.muted(l)),
            Text(value, style: OrvText.heading(l)),
            if (sub.isNotEmpty) Text(sub, style: OrvText.muted(l).copyWith(fontSize: 11)),
          ],
        ),
      ),
    );
  }
}

class _PhoneCard extends StatelessWidget {
  const _PhoneCard({required this.on, required this.allowed, required this.onSwitch});
  final bool? on;
  final bool? allowed;
  final Future<void> Function(bool) onSwitch;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    if (on == null) return const SizedBox.shrink();
    return Glass(
      blur: false,
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          OrvSwitchRow(
            label: 'Track this phone',
            subtitle: 'Which app is open and for how long, from Android’s own record. Nothing inside an app is read.',
            value: on!,
            onChanged: (v) => unawaited(onSwitch(v)),
          ),
          if (on! && allowed == false) ...[
            const SizedBox(height: 8),
            Text('Android needs your OK: Usage access → ORVYN → allow.', style: OrvText.muted(l)),
            const SizedBox(height: 6),
            OrvButton(label: 'Open Usage access', small: true, onPressed: () => unawaited(onSwitch(true))),
          ],
        ],
      ),
    );
  }
}
