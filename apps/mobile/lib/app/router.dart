import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../design/orb.dart';
import '../features/ipo_screen.dart';
import '../features/brief_screen.dart';
import '../features/mail_screen.dart';
import '../features/people_screen.dart';
import '../features/assistant_screen.dart';
import '../features/drop_screen.dart';
import '../features/library_screen.dart';
import '../features/money_screen.dart';
import '../features/vault_screen.dart';
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
      GoRoute(
        path: '/settings/:section',
        builder: (_, s) => SettingsSectionScreen(section: s.pathParameters['section']!),
      ),
      GoRoute(path: '/people', builder: (_, _) => const PeopleScreen()),
      GoRoute(path: '/mail', builder: (_, _) => const MailScreen()),
      GoRoute(
        path: '/ipo/pool/rounds/:id',
        builder: (_, s) => RoundScreen(id: s.pathParameters['id']!),
      ),
      GoRoute(
        path: '/ipo/:id',
        builder: (_, s) => IpoDetailScreen(id: s.pathParameters['id']!),
      ),
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
            path: '/drop',
            pageBuilder: (_, _) => const NoTransitionPage(child: DropScreen()),
          ),
          GoRoute(
            path: '/money',
            pageBuilder: (_, _) => const NoTransitionPage(child: MoneyScreen()),
          ),
          GoRoute(
            path: '/library',
            pageBuilder: (_, _) => const NoTransitionPage(child: LibraryScreen()),
          ),
          GoRoute(
            path: '/vault',
            pageBuilder: (_, _) => const NoTransitionPage(child: VaultScreen()),
          ),
          GoRoute(
            path: '/settings',
            pageBuilder: (_, _) => const NoTransitionPage(child: SettingsScreen()),
          ),
          GoRoute(
            path: '/ipo',
            pageBuilder: (_, s) => NoTransitionPage(child: IpoScreen(pool: s.uri.queryParameters['tab'] == 'pool')),
          ),
          GoRoute(
            path: '/brief',
            pageBuilder: (_, _) => const NoTransitionPage(child: BriefScreen()),
          ),
          GoRoute(
            path: '/assistant',
            pageBuilder: (_, s) => NoTransitionPage(child: assistantRoute(s)),
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
