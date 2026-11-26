import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../app/notifications.dart';
import '../app/state.dart';
import '../app/smart_add.dart';
import '../app/today.dart';
import '../drop/drop.dart';
import '../design/controls.dart';
import '../design/glass.dart';
import '../design/theme.dart';
import '../design/toast.dart';
import 'common.dart';
import 'notification_host.dart' show openNotificationUrl;

/// Glass bottom sheet that inherits the current light.
Future<T?> showGlassSheet<T>(BuildContext context, Widget Function(BuildContext) builder) {
  final look = context.orv;
  return showModalBottomSheet<T>(
    context: context,
    // above the shell's bottom nav, never under it (spec 0012 follow-up)
    useRootNavigator: true,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    barrierColor: look.c.scrim,
    builder: (ctx) => OrvTheme(
      look: look,
      child: Padding(
        padding: EdgeInsets.only(left: 8, right: 8, bottom: MediaQuery.viewInsetsOf(ctx).bottom + 8),
        child: Glass(
          level: GlassLevel.halo,
          // list tiles and ripples paint on a transparent Material inside the glass
          child: Material(
            type: MaterialType.transparency,
            child: SafeArea(top: false, child: builder(ctx)),
          ),
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
                                    unawaited(openNotificationUrl(ref, n.url!));
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
                                    if (n.actions.any((a) => a.open == null && a.reply == null))
                                      Padding(
                                        padding: const EdgeInsets.only(top: 6),
                                        child: Wrap(
                                          spacing: 6,
                                          runSpacing: 6,
                                          children: [
                                            for (final a in n.actions.where((a) => a.open == null && a.reply == null))
                                              OrvButton(
                                                label: a.label,
                                                small: true,
                                                variant: a.id == 'done'
                                                    ? ButtonVariant.primary
                                                    : ButtonVariant.secondary,
                                                onPressed: () async {
                                                  final toaster = Toaster.of(context);
                                                  final ok = await ctl.act(n.id, a.id);
                                                  if (!ok) toaster.show('That didn’t work', tone: ToastTone.danger);
                                                },
                                              ),
                                          ],
                                        ),
                                      ),
                                    for (final a in n.actions.where((a) => a.reply != null))
                                      ReplyField(
                                        label: '${a.label} to ${n.title}',
                                        hint: a.reply!,
                                        onSend: (text) => ctl.act(n.id, a.id, text: text),
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
      if (ref.read(sessionProvider) case SignedIn(:final me) when me.can('drop'))
        _Command('Open Drop', LucideIcons.arrowDownToLine, () async => router.go('/drop')),
      if (ref.read(sessionProvider) case SignedIn(:final me) when me.can('money'))
        _Command('Open Money', LucideIcons.wallet, () async => router.go('/money')),
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
    // anything typed can become a task (natural-language dates arrive with the parser, spec 0002 M2)
    final session = ref.read(sessionProvider);
    final typed = _q.text.trim();
    if (typed.length > 1 && session is SignedIn && session.me.can('assistant')) {
      final ask = _Command('Ask ORVYN “$typed”', LucideIcons.sparkles, () async {
        router.go('/assistant?q=${Uri.encodeComponent(typed)}');
      }, hint: 'Assistant');
      // a question goes first
      if (RegExp(
        r'\?\s*$|^(what|how|when|where|who|which|why|do|did|does|is|are|can|show|find)\b',
        caseSensitive: false,
      ).hasMatch(typed)) {
        shown.insert(0, ask);
      } else {
        shown.add(ask);
      }
    }
    if (typed.length > 1 && session is SignedIn && session.me.can('drop')) {
      shown.add(
        _Command('Drop “$typed”', LucideIcons.arrowDownToLine, () async {
          await ref.read(dropActionsProvider).dropText(typed);
          toaster.show('Dropped', body: 'A suggestion is on its way in Drop.', tone: ToastTone.success);
          router.go('/drop');
        }, hint: 'Drop'),
      );
    }
    if (typed.length > 1 && session is SignedIn && session.me.can('today')) {
      shown.add(
        _Command('Add “$typed” to Today', LucideIcons.circlePlus, () async {
          final today = dayKey(ref.read(clockProvider)());
          final p = await parseOnline(ref, typed, const []);
          if (p != null) {
            await ref.read(todayActionsProvider).addParsed(p.fields(today), newProject: p.projectName, source: 'orb');
          } else {
            await ref.read(todayActionsProvider).add(typed, dueDate: today, source: 'orb'); // offline: as typed
          }
          toaster.show('Added to Today', body: typed, tone: ToastTone.success);
        }, hint: 'Task'),
      );
    }
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

/// A form in a sheet with its actions pinned at the bottom (spec 0007 B): the fields scroll, Save never does.
/// Capped at 90% of the screen so the sheet never covers everything.
class StickySheet extends StatelessWidget {
  const StickySheet({super.key, required this.title, required this.children, required this.footer, this.trailing});
  final String title;
  final List<Widget> children;
  final Widget footer;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final max = MediaQuery.sizeOf(context).height * 0.9 - MediaQuery.viewInsetsOf(context).bottom;
    return ConstrainedBox(
      constraints: BoxConstraints(maxHeight: max.clamp(240, double.infinity)),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 10, 12, 4),
            child: Column(
              children: [
                Container(
                  width: 36,
                  height: 4,
                  decoration: BoxDecoration(color: l.c.track, borderRadius: BorderRadius.circular(2)),
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(child: Text(title, style: OrvText.heading(l))),
                    ?trailing,
                  ],
                ),
              ],
            ),
          ),
          Flexible(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 16),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: children,
              ),
            ),
          ),
          DecoratedBox(
            decoration: BoxDecoration(
              border: Border(top: BorderSide(color: l.c.hairline)),
            ),
            child: Padding(padding: const EdgeInsets.fromLTRB(16, 10, 16, 10), child: footer),
          ),
        ],
      ),
    );
  }
}

/// A short typed answer to a notification ("food", "split 3", "not mine"); the keyboard's send button sends.
class ReplyField extends StatefulWidget {
  const ReplyField({super.key, required this.label, required this.hint, required this.onSend});
  final String label;
  final String hint;
  final Future<bool> Function(String text) onSend;
  @override
  State<ReplyField> createState() => _ReplyFieldState();
}

class _ReplyFieldState extends State<ReplyField> {
  final _c = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final t = _c.text.trim();
    if (t.isEmpty || _busy) return;
    setState(() => _busy = true);
    final toaster = Toaster.of(context);
    final ok = await widget.onSend(t);
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok) {
      _c.clear();
    } else {
      toaster.show('That didn’t work', tone: ToastTone.danger);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Row(
        children: [
          Expanded(
            child: FocusRing(
              radius: 20,
              padding: const EdgeInsets.symmetric(horizontal: 14),
              child: TextField(
                key: Key('reply-${widget.label}'),
                controller: _c,
                maxLength: 200,
                textInputAction: TextInputAction.send,
                onSubmitted: (_) => _send(),
                style: OrvText.body(l).copyWith(fontSize: 14),
                decoration: bareInput(
                  l,
                  hint: widget.hint,
                  fontSize: 15,
                  padding: const EdgeInsets.symmetric(vertical: 11),
                ).copyWith(counterText: ''),
              ),
            ),
          ),
          const SizedBox(width: 6),
          IconButton.filled(
            tooltip: 'Send reply',
            onPressed: _busy ? null : _send,
            style: IconButton.styleFrom(backgroundColor: l.accent),
            icon: _busy
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                  )
                : const Icon(LucideIcons.send, size: 16, color: Colors.white),
          ),
        ],
      ),
    );
  }
}
