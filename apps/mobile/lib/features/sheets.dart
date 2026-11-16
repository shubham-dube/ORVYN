import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../app/notifications.dart';
import '../app/state.dart';
import '../design/controls.dart';
import '../design/glass.dart';
import '../design/theme.dart';
import '../design/toast.dart';
import 'common.dart';

/// Glass bottom sheet that inherits the current light.
Future<T?> showGlassSheet<T>(BuildContext context, Widget Function(BuildContext) builder) {
  final look = context.orv;
  return showModalBottomSheet<T>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    barrierColor: look.c.scrim,
    builder: (ctx) => OrvTheme(
      look: look,
      child: Padding(
        padding: EdgeInsets.only(left: 8, right: 8, bottom: MediaQuery.viewInsetsOf(ctx).bottom + 8),
        child: Glass(
          level: GlassLevel.halo,
          child: SafeArea(top: false, child: builder(ctx)),
        ),
      ),
    ),
  );
}

class NotificationsSheet extends ConsumerWidget {
  const NotificationsSheet({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final items = ref.watch(notificationsProvider);
    final ctl = ref.read(notificationsProvider.notifier);
    final now = ref.watch(clockProvider)();
    return ConstrainedBox(
      constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.75),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 18, 12, 8),
            child: Row(
              children: [
                Expanded(
                  child: Semantics(header: true, child: Text('Notifications', style: OrvText.heading(l))),
                ),
                if (items.isNotEmpty)
                  OrvButton(label: 'Clear all', small: true, variant: ButtonVariant.ghost, onPressed: ctl.dismissAll),
              ],
            ),
          ),
          if (items.isEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 24, 20, 36),
              child: Column(
                children: [
                  Icon(LucideIcons.bellOff, color: l.c.muted),
                  const SizedBox(height: 8),
                  Text('All quiet', style: OrvText.heading(l)),
                  Text('Nothing needs you right now.', style: OrvText.muted(l)),
                ],
              ),
            )
          else
            Flexible(
              child: ListView.separated(
                shrinkWrap: true,
                padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
                itemCount: items.length,
                separatorBuilder: (_, _) => const SizedBox(height: 8),
                itemBuilder: (context, i) {
                  final n = items[i];
                  return Dismissible(
                    key: ValueKey(n.id),
                    direction: DismissDirection.endToStart,
                    onDismissed: (_) => ctl.dismiss(n.id).catchError((Object _) {}),
                    child: OrvModule(
                      module: n.module,
                      child: Glass(
                        blur: false,
                        padding: const EdgeInsets.all(12),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Padding(
                              padding: const EdgeInsets.only(top: 6, right: 10),
                              child: Container(
                                width: 8,
                                height: 8,
                                decoration: BoxDecoration(
                                  shape: BoxShape.circle,
                                  color: n.readAt == null ? context.orv.accent : Colors.transparent,
                                ),
                              ),
                            ),
                            Expanded(
                              child: GestureDetector(
                                behavior: HitTestBehavior.opaque,
                                onTap: () {
                                  ctl.markRead(n.id).catchError((Object _) {});
                                  if (n.url != null) {
                                    Navigator.of(context).pop();
                                    context.go(n.url!);
                                  }
                                },
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(n.title, style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600)),
                                    if (n.body.isNotEmpty) Text(n.body, style: OrvText.muted(l)),
                                    const SizedBox(height: 2),
                                    Text(
                                      timeAgo(n.createdAt, now),
                                      style: OrvText.muted(l).copyWith(color: l.c.faint, fontSize: 11),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                            Semantics(
                              container: true,
                              button: true,
                              label: 'Dismiss ${n.title}',
                              child: GestureDetector(
                                onTap: () => ctl.dismiss(n.id).catchError((Object _) {}),
                                child: Padding(
                                  padding: const EdgeInsets.all(6),
                                  child: Icon(LucideIcons.x, size: 18, color: l.c.muted),
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
            ),
        ],
      ),
    );
  }
}

class _Command {
  const _Command(this.label, this.icon, this.run, {this.hint});
  final String label;
  final IconData icon;
  final Future<void> Function() run;
  final String? hint;
}

/// Tap the Orb: navigate, change the light, send a test — and, once Drop and the Assistant arrive, type or
/// say anything.
class CommandSheet extends ConsumerStatefulWidget {
  const CommandSheet({super.key});
  @override
  ConsumerState<CommandSheet> createState() => _CommandSheetState();
}

class _CommandSheetState extends ConsumerState<CommandSheet> {
  final _q = TextEditingController();

  @override
  void dispose() {
    _q.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final router = GoRouter.of(context);
    final toaster = Toaster.of(context);
    final theme = ref.read(themePreferenceProvider.notifier);
    final commands = <_Command>[
      _Command('Go to Home', LucideIcons.house, () async => router.go('/')),
      _Command('Open Settings', LucideIcons.settings, () async => router.go('/settings')),
      _Command(
        'Send me a test notification',
        LucideIcons.bell,
        () => ref.read(notificationsProvider.notifier).sendTest(),
      ),
      _Command('Light: follow the sun', LucideIcons.sparkles, () => theme.set(ThemePreference.auto), hint: 'Auto'),
      _Command('Light: dawn', LucideIcons.sunrise, () => theme.set(ThemePreference.dawn)),
      _Command('Light: day', LucideIcons.sun, () => theme.set(ThemePreference.day)),
      _Command('Light: dusk', LucideIcons.sunset, () => theme.set(ThemePreference.dusk)),
      _Command('Light: night', LucideIcons.moon, () => theme.set(ThemePreference.night)),
      _Command('Sign out', LucideIcons.logOut, () => ref.read(sessionProvider.notifier).signOut()),
    ];
    final q = _q.text.trim().toLowerCase();
    final shown = commands.where((c) => c.label.toLowerCase().contains(q)).toList();
    Future<void> run(_Command c) async {
      Navigator.of(context).pop();
      try {
        await c.run();
      } catch (e) {
        toaster.show('That didn’t work', body: messageFor(e), tone: ToastTone.danger);
      }
    }

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
          child: TextField(
            controller: _q,
            autofocus: true,
            onChanged: (_) => setState(() {}),
            onSubmitted: (_) => shown.isEmpty ? null : run(shown.first),
            style: OrvText.body(l).copyWith(fontSize: 17),
            decoration: InputDecoration(
              hintText: 'Ask or do anything…',
              hintStyle: OrvText.body(l).copyWith(color: l.c.faint, fontSize: 17),
              border: InputBorder.none,
              prefixIcon: Icon(LucideIcons.search, color: l.accent),
            ),
          ),
        ),
        Divider(height: 1, color: l.c.hairline),
        ConstrainedBox(
          constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.5),
          child: shown.isEmpty
              ? Padding(
                  padding: const EdgeInsets.all(24),
                  child: Text(
                    'Nothing matches yet. Drop and the Assistant will understand anything you type here.',
                    style: OrvText.muted(l),
                    textAlign: TextAlign.center,
                  ),
                )
              : ListView(
                  shrinkWrap: true,
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  children: [
                    for (final c in shown)
                      ListTile(
                        leading: Icon(c.icon, color: l.accent, size: 20),
                        title: Text(c.label, style: OrvText.body(l)),
                        trailing: c.hint == null ? null : Text(c.hint!, style: OrvText.muted(l)),
                        onTap: () => run(c),
                      ),
                  ],
                ),
        ),
      ],
    );
  }
}
