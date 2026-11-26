import '../features/notification_host.dart';
import '../money/capture.dart';
import 'home_widget.dart';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../design/aurora.dart';
import '../design/orb.dart';
import '../design/theme.dart';
import '../design/toast.dart';
import 'lock.dart';
import 'router.dart';
import 'state.dart';

class OrvynApp extends ConsumerStatefulWidget {
  const OrvynApp({super.key});
  @override
  ConsumerState<OrvynApp> createState() => _OrvynAppState();
}

class _OrvynAppState extends ConsumerState<OrvynApp> with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    final lock = ref.read(lockProvider.notifier);
    if (s == AppLifecycleState.paused) lock.paused();
    if (s == AppLifecycleState.resumed) {
      lock.resumed();
      ref.read(realtimeProvider).kick();
      if (ref.read(sessionProvider) is SignedIn) ref.read(syncProvider).sync().catchError((_) {});
      ref.invalidate(phaseProvider);
    }
  }

  @override
  Widget build(BuildContext context) {
    ref.watch(homeWidgetSyncProvider); // keeps the home-screen widget current (and blank when signed out)
    ref.watch(alarmSyncProvider); // alarms ring on this phone even offline
    ref.watch(captureSyncProvider); // payment messages read on this phone become transactions (ADR-0012)
    final look = OrvLook(phase: ref.watch(phaseProvider), module: 'core');
    final locked = ref.watch(lockProvider).locked && ref.watch(sessionProvider) is SignedIn;
    return OrvTheme(
      look: look,
      child: MaterialApp.router(
        title: 'ORVYN',
        debugShowCheckedModeBanner: false,
        theme: materialTheme(look),
        routerConfig: ref.watch(routerProvider),
        localizationsDelegates: GlobalMaterialLocalizations.delegates,
        supportedLocales: const [Locale('en', 'IN'), Locale('en'), Locale('hi')],
        builder: (context, child) => OrvTheme(
          look: look,
          child: Aurora(
            child: Toaster(
              // locked: the app keeps its state but is not painted, tappable or read out
              child: Stack(
                fit: StackFit.expand,
                children: [
                  Offstage(
                    offstage: locked,
                    child: NotificationHost(child: child ?? const SizedBox()),
                  ),
                  if (locked) const _LockScreen(),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Only the living light and the Orb until the person unlocks.
class _LockScreen extends ConsumerStatefulWidget {
  const _LockScreen();
  @override
  ConsumerState<_LockScreen> createState() => _LockScreenState();
}

class _LockScreenState extends ConsumerState<_LockScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => ref.read(lockProvider.notifier).unlock());
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return Positioned.fill(
      child: SafeArea(
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Orb(size: 72, label: 'Unlock ORVYN', onTap: () => ref.read(lockProvider.notifier).unlock()),
              const SizedBox(height: 16),
              Text('ORVYN is locked', style: OrvText.heading(l)),
              Text('Tap the orb to unlock', style: OrvText.muted(l)),
            ],
          ),
        ),
      ),
    );
  }
}
