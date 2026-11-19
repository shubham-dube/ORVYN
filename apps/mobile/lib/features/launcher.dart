import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../app/state.dart';
import '../app/today.dart';
import '../design/theme.dart';
import '../drop/drop.dart';
import '../library/library.dart';
import '../vault/vault.dart';

/// One module as the launcher shows it.
class LauncherModule {
  const LauncherModule(this.key, this.name, this.icon, this.route, {this.entitlement});
  final String key;
  final String name;
  final IconData icon;
  final String route;

  /// null: everyone has it (Settings)
  final String? entitlement;
}

const launcherModules = <LauncherModule>[
  LauncherModule('assistant', 'Assistant', LucideIcons.sparkles, '/assistant', entitlement: 'assistant'),
  LauncherModule('today', 'Today', LucideIcons.circleCheck, '/today', entitlement: 'today'),
  LauncherModule('money', 'Money', LucideIcons.wallet, '/money', entitlement: 'money'),
  LauncherModule('drop', 'Drop', LucideIcons.inbox, '/drop', entitlement: 'drop'),
  LauncherModule('library', 'Library', LucideIcons.bookOpen, '/library', entitlement: 'library'),
  LauncherModule('vault', 'Vault', LucideIcons.lockKeyhole, '/vault', entitlement: 'vault'),
  LauncherModule('settings', 'Settings', LucideIcons.settings, '/settings'),
];

/// Routes that live behind "More" in the dock (so More lights up while you are in one of them).
const moreRoutes = ['/assistant', '/drop', '/library', '/vault', '/settings'];

/// Every module one tap away (spec 0007 B): a grid of tiles, each with a live line — what waits in Drop,
/// how many documents, whether the Vault is open — so the launcher is also a glance at your life.
class ModuleLauncher extends ConsumerWidget {
  const ModuleLauncher({super.key, required this.location});
  final String location;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final session = ref.watch(sessionProvider);
    final me = session is SignedIn ? session.me : null;
    final shown = launcherModules.where((m) => m.entitlement == null || (me?.can(m.entitlement!) ?? false)).toList();

    String? line(String key) {
      switch (key) {
        case 'today':
          final open = (ref.watch(tasksProvider).value ?? const []).where((t) => t.completedAt == null).length;
          return open == 0 ? 'All clear' : '$open open';
        case 'drop':
          final n = (ref.watch(dropItemsProvider).value ?? const []).where((i) => i.open).length;
          return n == 0 ? 'Nothing waiting' : '$n to decide';
        case 'library':
          final n = (ref.watch(docsProvider).value ?? const []).length;
          return n == 0 ? 'Empty' : '$n ${n == 1 ? 'item' : 'items'}';
        case 'vault':
          return switch (ref.watch(vaultProvider).status) {
            VaultStatus.unlocked => 'Open',
            VaultStatus.locked => 'Locked',
            VaultStatus.none => 'Set up',
            VaultStatus.loading => null,
          };
        case 'money':
          return 'Spend & budgets';
        case 'settings':
          return 'Devices, alerts';
        case 'assistant':
          return 'Ask anything';
      }
      return null;
    }

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Center(
            child: Container(
              width: 36,
              height: 4,
              decoration: BoxDecoration(color: l.c.track, borderRadius: BorderRadius.circular(2)),
            ),
          ),
          const SizedBox(height: 14),
          Text('Everything', style: OrvText.heading(l)),
          const SizedBox(height: 12),
          GridView.count(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            crossAxisCount: 3,
            mainAxisSpacing: 10,
            crossAxisSpacing: 10,
            childAspectRatio: 1.02,
            children: [
              for (final m in shown)
                _Tile(
                  module: m,
                  line: line(m.key),
                  active: location.startsWith(m.route),
                  onTap: () {
                    HapticFeedback.selectionClick();
                    Navigator.of(context).pop();
                    context.go(m.route);
                  },
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _Tile extends StatelessWidget {
  const _Tile({required this.module, required this.line, required this.active, required this.onTap});
  final LauncherModule module;
  final String? line;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return Semantics(
      button: true,
      selected: active,
      label: 'Open ${module.name}',
      excludeSemantics: true,
      child: Material(
        color: active ? l.accent.withValues(alpha: 0.14) : l.c.field,
        borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
        child: InkWell(
          borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
          onTap: onTap,
          child: Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
              border: Border.all(color: active ? l.accent.withValues(alpha: 0.5) : l.c.edge),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(gradient: l.accentGradient, borderRadius: BorderRadius.circular(11)),
                  child: Icon(module.icon, size: 19, color: Colors.white),
                ),
                const Spacer(),
                Text(
                  module.name,
                  style: OrvText.body(l).copyWith(fontWeight: FontWeight.w700, fontSize: 14),
                  maxLines: 1,
                ),
                if (line != null)
                  Text(
                    line!,
                    style: OrvText.muted(l).copyWith(fontSize: 11.5),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
