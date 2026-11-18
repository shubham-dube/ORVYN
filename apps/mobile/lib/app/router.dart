import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../design/orb.dart';
import '../features/money_screen.dart';
import '../features/gallery_screen.dart';
import '../features/home_screen.dart';
import '../features/settings_screen.dart';
import '../features/today_screen.dart';
import '../features/today_settings_screen.dart';
import '../features/shell.dart';
import '../features/sign_in_screen.dart';
import 'state.dart';

/// Bridges Riverpod's session into go_router's redirect.
class _SessionListenable extends ChangeNotifier {
  _SessionListenable(Ref ref) {
    ref.listen(sessionProvider, (_, _) => notifyListeners());
  }
}

final routerProvider = Provider<GoRouter>((ref) {
  final listenable = _SessionListenable(ref);
  final r = GoRouter(
    refreshListenable: listenable,
    initialLocation: '/',
    redirect: (context, state) {
      final s = ref.read(sessionProvider);
      final at = state.matchedLocation;
      final public = at == '/sign-in' || at.startsWith('/join/') || at == '/splash';
      return switch (s) {
        SessionLoading() => at == '/splash' ? null : '/splash?to=${Uri.encodeComponent(state.uri.toString())}',
        SignedOut() => public && at != '/splash' ? null : '/sign-in',
        SignedIn() => public ? (state.uri.queryParameters['to'] ?? '/') : null,
      };
    },
    routes: [
      GoRoute(
        path: '/splash',
        builder: (_, _) => const Scaffold(
          body: Center(
            child: Orb(size: 56, state: OrbState.thinking, label: 'Loading'),
          ),
        ),
      ),
      GoRoute(path: '/sign-in', builder: (_, _) => const SignInScreen()),
      GoRoute(
        path: '/join/:token',
        builder: (_, s) => JoinScreen(token: s.pathParameters['token']!),
      ),
      GoRoute(path: '/settings/today', builder: (_, _) => const TodaySettingsScreen()),
      GoRoute(path: '/gallery', builder: (_, _) => const GalleryScreen()),
      ShellRoute(
        builder: (context, state, child) => Shell(location: state.matchedLocation, child: child),
        routes: [
          GoRoute(
            path: '/',
            pageBuilder: (_, _) => const NoTransitionPage(child: HomeScreen()),
          ),
          GoRoute(
            path: '/today',
            pageBuilder: (_, _) => const NoTransitionPage(child: TodayScreen()),
          ),
          GoRoute(
            path: '/money',
            pageBuilder: (_, _) => const NoTransitionPage(child: MoneyScreen()),
          ),
          GoRoute(
            path: '/settings',
            pageBuilder: (_, _) => const NoTransitionPage(child: SettingsScreen()),
          ),
        ],
      ),
    ],
  );
  ref.onDispose(() {
    r.dispose();
    listenable.dispose();
  });
  return r;
});
