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
    final now = ref.watch(clockProvider)();
    final session = ref.watch(sessionProvider);
    final me = session is SignedIn ? session.me : null;
    final first = (me?.name ?? '').split(' ').first;
    final items = ref.watch(notificationsProvider);
    final unread = items.where((n) => n.readAt == null).length;
    final modules = moduleKeys.where((k) => me?.can(k) ?? false).toList();
    final loc = MaterialLocalizations.of(context);
    final modesFor = [
      if (me?.can('today') ?? false) 'task',
      if (me?.can('money') ?? false) 'expense',
      if (me?.can('drop') ?? false) 'drop',
    ];

    return RefreshIndicator(
      color: l.accent,
      onRefresh: () async {
        await ref.read(notificationsProvider.notifier).load();
        await ref.read(sessionProvider.notifier).refreshMe();
      },
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 56, 16, 120),
        children: [
          PageTitle(first.isEmpty ? greetingAt(now) : '${greetingAt(now)}, $first', overline: loc.formatFullDate(now)),
          if (modesFor.isNotEmpty) QuickAddCard(key: ValueKey(modesFor.join()), modes: modesFor),
          if (me?.can('today') ?? false) const TodayCard(),
          Glass(
            level: GlassLevel.float,
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Expanded(child: SectionLabel('Needs you')),
                    if (unread > 0) OrvBadge('$unread new', tone: l.accent),
                  ],
                ),
                const SizedBox(height: 10),
                if (items.isEmpty) Text('Nothing needs you. Enjoy the quiet.', style: OrvText.muted(l)),
                for (final n in items.take(3))
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Glass(
                      blur: false,
                      padding: const EdgeInsets.all(12),
                      child: SizedBox(
                        width: double.infinity,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(n.title, style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600)),
                            if (n.body.isNotEmpty)
                              Text(n.body, maxLines: 2, overflow: TextOverflow.ellipsis, style: OrvText.muted(l)),
                          ],
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          if (me?.can('money') ?? false) const MoneyCard(),
          if (me?.can('today') ?? false) const WeekCard(),
          if (me?.can('drop') ?? false) const DropCard(),
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
                        const routes = {'today': '/today', 'drop': '/drop', 'money': '/money'};
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
