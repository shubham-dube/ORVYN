import 'dart:async';
import 'dart:ui';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../app/home_widget.dart';
import '../drop/drop.dart';
import '../app/notifications.dart';
import '../app/state.dart';
import '../core/models.dart';
import '../design/orb.dart';
import '../design/theme.dart';
import '../design/toast.dart';
import 'sheets.dart';

/// The signed-in frame: content, a glass dock in thumb reach with the Orb in the middle, a bell up top.
class Shell extends ConsumerStatefulWidget {
  const Shell({super.key, required this.child, required this.location});
  final Widget child;
  final String location;
  @override
  ConsumerState<Shell> createState() => _ShellState();
}

class _ShellState extends ConsumerState<Shell> {
  StreamSubscription<NotificationView>? _arrivals;
  StreamSubscription<Map<String, dynamic>>? _taps;
  StreamSubscription<Uri?>? _widget;
  StreamSubscription<void>? _shares;

  @override
  void initState() {
    super.initState();
    // a tap on one of this phone's notifications while ORVYN is open: a button does its job, the body opens
    _taps = ref.read(pusherProvider).taps.listen((t) async {
      final id = t['id'] as String?;
      final action = t['action'] as String?;
      if (id == null) return;
      final ctl = ref.read(notificationsProvider.notifier);
      if (action != null && action.isNotEmpty) {
        final ok = await ctl.act(id, action);
        if (mounted && !ok) Toaster.of(context).show('That didn’t work', tone: ToastTone.danger);
        return;
      }
      unawaited(ctl.markRead(id).catchError((Object _) {}));
      final url = t['url'] as String?;
      if (url != null && mounted) context.go(url);
    });
    // the home-screen widget: the list opens Today, "+" opens it ready to type
    _widget = ref.read(widgetClicksProvider).listen((u) {
      final route = routeForWidgetUri(u);
      if (route != null && mounted) context.go(route);
    });
    // shared to ORVYN from another app: it becomes a Drop item
    Future<void> takeShare() async {
      final s = ref.read(sessionProvider);
      if (s is! SignedIn || !s.me.can('drop')) return;
      final shared = await ref.read(shareChannelProvider).take();
      if (shared == null || !mounted) return;
      final toaster = Toaster.of(context);
      try {
        if (await dropShared(ref.read(dropActionsProvider), shared) && mounted) context.go('/drop');
      } catch (_) {
        toaster.show('That couldn’t be dropped', tone: ToastTone.danger);
      }
    }

    unawaited(takeShare());
    _shares = ref.read(shareChannelProvider).arrived.listen((_) => unawaited(takeShare()));
    _arrivals = ref.read(arrivalsProvider).stream.listen((n) {
      HapticFeedback.lightImpact();
      if (mounted) Toaster.of(context).show(n.title, body: n.body.isEmpty ? null : n.body);
    });
  }

  @override
  void dispose() {
    _taps?.cancel();
    _widget?.cancel();
    _shares?.cancel();
    _arrivals?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final unread = ref.watch(notificationsProvider).where((n) => n.readAt == null).length;
    final session = ref.watch(sessionProvider);
    final canToday = session is SignedIn && session.me.can('today');
    final canMoney = session is SignedIn && session.me.can('money');
    return Scaffold(
      extendBody: true,
      body: SafeArea(
        bottom: false,
        child: Stack(
          children: [
            Positioned.fill(child: widget.child),
            Positioned(
              top: 8,
              right: 12,
              child: _Bell(
                count: unread,
                onTap: () => showGlassSheet<void>(context, (_) => const NotificationsSheet()),
              ),
            ),
          ],
        ),
      ),
      bottomNavigationBar: SafeArea(
        minimum: const EdgeInsets.fromLTRB(12, 0, 12, 12),
        child: SizedBox(
          height: 84,
          child: Stack(
            clipBehavior: Clip.none,
            alignment: Alignment.bottomCenter,
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(OrvTokens.radiusLg),
                child: BackdropFilter(
                  filter: ImageFilter.blur(sigmaX: OrvTokens.glassFloatBlur / 2, sigmaY: OrvTokens.glassFloatBlur / 2),
                  child: Container(
                    height: 64,
                    decoration: BoxDecoration(
                      color: l.c.glassStrong,
                      borderRadius: BorderRadius.circular(OrvTokens.radiusLg),
                      border: Border.all(color: l.c.edge),
                    ),
                    child: Row(
                      children: [
                        _DockItem(
                          icon: LucideIcons.house,
                          label: 'Home',
                          active: widget.location == '/',
                          onTap: () => context.go('/'),
                        ),
                        if (canToday)
                          _DockItem(
                            icon: LucideIcons.circleCheck,
                            label: 'Today',
                            active: widget.location.startsWith('/today'),
                            onTap: () => context.go('/today'),
                          ),
                        const Spacer(flex: 3),
                        if (canMoney)
                          _DockItem(
                            icon: LucideIcons.wallet,
                            label: 'Money',
                            active: widget.location.startsWith('/money'),
                            onTap: () => context.go('/money'),
                          ),
                        _DockItem(
                          icon: LucideIcons.settings,
                          label: 'Settings',
                          active: widget.location.startsWith('/settings'),
                          onTap: () => context.go('/settings'),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              Positioned(
                bottom: 18,
                child: Orb(size: 64, onTap: () => showGlassSheet<void>(context, (_) => const CommandSheet())),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _DockItem extends StatelessWidget {
  const _DockItem({required this.icon, required this.label, required this.active, required this.onTap});
  final IconData icon;
  final String label;
  final bool active;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final c = active ? l.accent : l.c.muted;
    return Expanded(
      flex: 2,
      child: Semantics(
        container: true,
        button: true,
        selected: active,
        label: label,
        excludeSemantics: true,
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: () {
            HapticFeedback.selectionClick();
            onTap();
          },
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, color: c, size: 22),
              const SizedBox(height: 2),
              Text(
                label,
                style: TextStyle(fontFamily: fontFamily, fontSize: 11, fontWeight: FontWeight.w600, color: c),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Bell extends StatelessWidget {
  const _Bell({required this.count, required this.onTap});
  final int count;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return Semantics(
      container: true,
      button: true,
      label: count > 0 ? 'Notifications, $count unread' : 'Notifications',
      excludeSemantics: true,
      child: GestureDetector(
        onTap: onTap,
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            Container(
              width: 42,
              height: 42,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: l.c.glassStrong,
                border: Border.all(color: l.c.edge),
              ),
              child: Icon(LucideIcons.bell, size: 19, color: l.c.text),
            ),
            if (count > 0)
              Positioned(
                right: -2,
                top: -2,
                child: TweenAnimationBuilder<double>(
                  key: ValueKey(count),
                  tween: Tween(begin: 0.6, end: 1),
                  duration: OrvTokens.durationSlow,
                  curve: springSnappy,
                  builder: (_, s, child) => Transform.scale(scale: s, child: child),
                  child: Container(
                    constraints: const BoxConstraints(minWidth: 18),
                    padding: const EdgeInsets.symmetric(horizontal: 4),
                    height: 18,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(gradient: l.accentGradient, borderRadius: BorderRadius.circular(9)),
                    child: Text(
                      count > 9 ? '9+' : '$count',
                      style: const TextStyle(
                        fontFamily: fontFamily,
                        color: Colors.white,
                        fontSize: 10,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
