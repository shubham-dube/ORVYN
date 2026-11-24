import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../app/notifications.dart';
import '../app/state.dart';
import '../core/models.dart';
import '../design/controls.dart';
import '../design/glass.dart';
import '../design/theme.dart';
import 'common.dart';
import 'dashboard_widgets.dart';
import 'home_cards.dart';

class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});
  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  late Timer _tick;

  @override
  void initState() {
    super.initState();
    _tick = Timer.periodic(const Duration(seconds: 15), (_) => setState(() {}));
  }

  @override
  void dispose() {
    _tick.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final session = ref.watch(sessionProvider);
    final me = session is SignedIn ? session.me : null;
    final first = (me?.name ?? '').split(' ').first;
    final modules = moduleKeys.where((k) => me?.can(k) ?? false).toList();
    final modesFor = [
      if (me?.can('today') ?? false) 'task',
      if (me?.can('money') ?? false) 'expense',
      if (me?.can('drop') ?? false) 'drop',
    ];

    return RefreshIndicator(
      color: l.accent,
      onRefresh: () async {
        ref.invalidate(homeProvider);
        await ref.read(notificationsProvider.notifier).load();
        await ref.read(sessionProvider.notifier).refreshMe();
      },
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 56, 16, 120),
        children: [
          // mission control (spec 0017 A): hero → now & next → needs you → today → money → mail → live → week
          HomeHero(first: first),
          if (me?.can('today') ?? false) const NowNext(),
          if (modesFor.isNotEmpty) QuickAddCard(key: ValueKey(modesFor.join()), modes: modesFor),
          const NeedsYouCard(),
          if (me?.can('today') ?? false) const TodayCard(),
          if (me?.can('money') ?? false) const MoneyCard(),
          if (me?.can('today') ?? false) const InboxPreview(),
          const LiveCard(),
          if (me?.can('today') ?? false) const WeekCard(),
          Glass(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SectionLabel('Your ORVYN'),
                const SizedBox(height: 12),
                for (final k in modules)
                  OrvModule(
                    module: k,
                    child: Builder(
                      builder: (context) {
                        final ml = context.orv;
                        final (name, line) = moduleInfo[k]!;
                        const routes = {
                          'today': '/today',
                          'drop': '/drop',
                          'money': '/money',
                          'library': '/library',
                          'vault': '/vault',
                        };
                        return GestureDetector(
                          behavior: HitTestBehavior.opaque,
                          onTap: routes[k] == null ? null : () => context.go(routes[k]!),
                          child: Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Container(
                                  width: 34,
                                  height: 34,
                                  decoration: BoxDecoration(
                                    gradient: ml.accentGradient,
                                    borderRadius: BorderRadius.circular(10),
                                  ),
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Row(
                                        children: [
                                          Text(name, style: OrvText.body(ml).copyWith(fontWeight: FontWeight.w600)),
                                          const SizedBox(width: 8),
                                          if (routes[k] == null) const OrvBadge('soon'),
                                        ],
                                      ),
                                      Text(line, style: OrvText.muted(ml)),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          ),
                        );
                      },
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

class _Pulse extends StatefulWidget {
  const _Pulse({required this.color});
  final Color color;
  @override
  State<_Pulse> createState() => _PulseState();
}

class _PulseState extends State<_Pulse> with SingleTickerProviderStateMixin {
  late final _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 2400));
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    context.reduceMotion ? _c.stop() : _c.repeat(reverse: true);
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => FadeTransition(
    opacity: Tween(begin: 0.4, end: 1.0).animate(_c),
    child: Container(
      width: 8,
      height: 8,
      decoration: BoxDecoration(shape: BoxShape.circle, color: widget.color),
    ),
  );
}
