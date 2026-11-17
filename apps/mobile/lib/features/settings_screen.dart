import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../app/lock.dart';
import '../app/platform.dart';
import '../app/notifications.dart';
import '../app/state.dart';
import '../app/today_settings.dart';

import 'package:go_router/go_router.dart';

import '../core/models.dart';
import '../design/controls.dart';
import '../design/glass.dart';
import '../design/theme.dart';
import '../design/toast.dart';
import 'common.dart';

final devicesProvider = FutureProvider.autoDispose<List<DeviceView>>((ref) async {
  final list = await ref.read(apiProvider).get<List<dynamic>>('/me/devices');
  return [for (final d in list) DeviceView.fromJson(d as Map<String, dynamic>)];
});

final notifySettingsProvider = FutureProvider.autoDispose<Map<String, dynamic>>(
  (ref) => ref.read(apiProvider).get<Map<String, dynamic>>('/notifications/settings'),
);

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 56, 16, 120),
      children: const [
        PageTitle('Settings'),
        _Profile(),
        SizedBox(height: 14),
        _Light(),
        SizedBox(height: 14),
        _Notifications(),
        SizedBox(height: 14),
        _TodayEntry(),
        _Security(),
      ],
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.title, this.line, required this.children});
  final String title;
  final String? line;
  final List<Widget> children;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return Glass(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Semantics(header: true, child: Text(title, style: OrvText.heading(l))),
          if (line != null) Text(line!, style: OrvText.muted(l)),
          const SizedBox(height: 14),
          ...children,
        ],
      ),
    );
  }
}

class _Profile extends ConsumerStatefulWidget {
  const _Profile();
  @override
  ConsumerState<_Profile> createState() => _ProfileState();
}

class _ProfileState extends ConsumerState<_Profile> {
  late final TextEditingController _name;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    final s = ref.read(sessionProvider);
    _name = TextEditingController(text: s is SignedIn ? s.me.name : '')..addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(sessionProvider);
    final me = s is SignedIn ? s.me : null;
    return _Section(
      title: 'You',
      line: me?.email,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Expanded(
              child: OrvField(label: 'Name', controller: _name),
            ),
            const SizedBox(width: 10),
            OrvButton(
              label: 'Save',
              variant: ButtonVariant.primary,
              loading: _busy,
              onPressed: _name.text.trim().isEmpty || _name.text.trim() == me?.name
                  ? null
                  : () async {
                      setState(() => _busy = true);
                      final toaster = Toaster.of(context);
                      try {
                        await ref.read(sessionProvider.notifier).updateName(_name.text.trim());
                        toaster.show('Saved', tone: ToastTone.success);
                      } catch (e) {
                        toaster.show(messageFor(e), tone: ToastTone.danger);
                      } finally {
                        if (mounted) setState(() => _busy = false);
                      }
                    },
            ),
          ],
        ),
      ],
    );
  }
}

class _Light extends ConsumerWidget {
  const _Light();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final pref = ref.watch(themePreferenceProvider);
    const options = [
      (ThemePreference.auto, 'Follow the sun', LucideIcons.sparkles),
      (ThemePreference.dawn, 'Dawn', LucideIcons.sunrise),
      (ThemePreference.day, 'Day', LucideIcons.sun),
      (ThemePreference.dusk, 'Dusk', LucideIcons.sunset),
      (ThemePreference.night, 'Night', LucideIcons.moon),
    ];
    return _Section(
      title: 'Light',
      line: 'ORVYN’s light follows your day. Right now it is ${ref.watch(phaseProvider).name}.',
      children: [
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final (value, label, icon) in options)
              Semantics(
                selected: pref == value,
                button: true,
                label: label,
                excludeSemantics: true,
                child: GestureDetector(
                  onTap: () => ref.read(themePreferenceProvider.notifier).set(value),
                  child: AnimatedContainer(
                    duration: OrvTokens.durationBase,
                    curve: springSmooth,
                    width: 96,
                    height: 76,
                    decoration: BoxDecoration(
                      color: pref == value ? l.accent.withValues(alpha: 0.12) : Colors.transparent,
                      borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
                      border: Border.all(color: pref == value ? l.accent : l.c.edge, width: pref == value ? 2 : 1),
                    ),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(icon, size: 20, color: pref == value ? l.accent : l.c.muted),
                        const SizedBox(height: 6),
                        Text(
                          label,
                          textAlign: TextAlign.center,
                          style: OrvText.muted(l).copyWith(color: l.c.text, fontSize: 12),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
          ],
        ),
      ],
    );
  }
}

class _Notifications extends ConsumerWidget {
  const _Notifications();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final pushReady = ref.watch(pusherProvider).ready;
    final settings = ref.watch(notifySettingsProvider);
    Future<void> save(Map<String, dynamic> s) async {
      await ref.read(apiProvider).put<dynamic>('/notifications/settings', s);
      ref.invalidate(notifySettingsProvider);
    }

    return _Section(
      title: 'Notifications',
      line: 'One notification reaches every device; open or dismiss it anywhere and it clears everywhere.',
      children: [
        Row(
          children: [
            Icon(LucideIcons.bell, size: 18, color: l.accent),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                pushReady ? 'Push on this phone: on' : 'Push on this phone: arrives with the release build',
                style: OrvText.body(l),
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        OrvButton(
          label: 'Send a test',
          icon: LucideIcons.send,
          onPressed: () {
            final toaster = Toaster.of(context);
            ref
                .read(notificationsProvider.notifier)
                .sendTest()
                .catchError((Object e) => toaster.show(messageFor(e), tone: ToastTone.danger));
          },
        ),
        const SizedBox(height: 14),
        Divider(height: 1, color: l.c.hairline),
        const SizedBox(height: 10),
        switch (settings) {
          AsyncData(:final value) => _QuietHours(settings: value, onSave: save),
          AsyncError() => Text('Couldn’t load quiet hours.', style: OrvText.muted(l)),
          _ => const SizedBox(height: 40),
        },
      ],
    );
  }
}

class _QuietHours extends StatelessWidget {
  const _QuietHours({required this.settings, required this.onSave});
  final Map<String, dynamic> settings;
  final Future<void> Function(Map<String, dynamic>) onSave;

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final quiet = settings['quietHours'] as Map<String, dynamic>?;
    Future<void> pick(String key) async {
      final parts = (quiet![key] as String).split(':');
      final t = await showTimePicker(
        context: context,
        initialTime: TimeOfDay(hour: int.parse(parts[0]), minute: int.parse(parts[1])),
      );
      if (t == null) return;
      final v = '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
      await onSave({
        ...settings,
        'quietHours': {...quiet, key: v},
      });
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        OrvSwitchRow(
          label: 'Quiet hours',
          subtitle: 'Only urgent things break through.',
          value: quiet != null,
          onChanged: (on) async => onSave({
            ...settings,
            'quietHours': on ? {'start': '22:30', 'end': '07:00', 'timeZone': await localTimeZone()} : null,
          }),
        ),
        if (quiet != null) ...[
          const SizedBox(height: 8),
          Row(
            children: [
              OrvButton(label: 'From ${quiet['start']}', small: true, onPressed: () => pick('start')),
              const SizedBox(width: 8),
              OrvButton(label: 'Until ${quiet['end']}', small: true, onPressed: () => pick('end')),
              const SizedBox(width: 8),
              Flexible(
                child: Text('${quiet['timeZone']}', style: OrvText.muted(l), overflow: TextOverflow.ellipsis),
              ),
            ],
          ),
        ],
      ],
    );
  }
}

class _Security extends ConsumerWidget {
  const _Security();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final lock = ref.watch(lockProvider);
    final devices = ref.watch(devicesProvider);
    final now = ref.watch(clockProvider)();
    return _Section(
      title: 'Security',
      children: [
        OrvSwitchRow(
          label: 'App lock',
          subtitle: 'Fingerprint, face or PIN when ORVYN opens and after 5 minutes away.',
          value: lock.enabled,
          onChanged: (on) async {
            final toaster = Toaster.of(context);
            if (!await ref.read(lockProvider.notifier).setEnabled(on)) {
              toaster.show('App lock needs a screen lock on this phone', tone: ToastTone.danger);
            }
          },
        ),
        const SizedBox(height: 16),
        const SectionLabel('Signed-in devices'),
        const SizedBox(height: 8),
        switch (devices) {
          AsyncData(:final value) => Column(
            children: [
              for (final d in value)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Glass(
                    blur: false,
                    padding: const EdgeInsets.all(12),
                    child: Row(
                      children: [
                        Icon(
                          d.platform == 'android' || d.platform == 'ios' ? LucideIcons.smartphone : LucideIcons.monitor,
                          color: l.accent,
                          size: 20,
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Flexible(
                                    child: Text(
                                      d.name,
                                      overflow: TextOverflow.ellipsis,
                                      style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600),
                                    ),
                                  ),
                                  if (d.current) ...[const SizedBox(width: 6), OrvBadge('this phone', tone: l.accent)],
                                ],
                              ),
                              Text('${d.platform} · ${timeAgo(d.lastSeenAt, now)}', style: OrvText.muted(l)),
                            ],
                          ),
                        ),
                        if (!d.current)
                          OrvButton(
                            label: 'Sign out',
                            small: true,
                            variant: ButtonVariant.ghost,
                            semanticLabel: 'Sign out ${d.name}',
                            onPressed: () async {
                              await ref.read(apiProvider).delete<dynamic>('/me/devices/${d.id}');
                              ref.invalidate(devicesProvider);
                            },
                          ),
                      ],
                    ),
                  ),
                ),
            ],
          ),
          AsyncError() => Text('Couldn’t load devices.', style: OrvText.muted(l)),
          _ => const SizedBox(height: 40),
        },
        const SizedBox(height: 8),
        OrvButton(
          label: 'Sign out of this phone',
          icon: LucideIcons.logOut,
          variant: ButtonVariant.danger,
          expand: true,
          onPressed: () => ref.read(sessionProvider.notifier).signOut(),
        ),
      ],
    );
  }
}

/// Settings → Today (only for people who have Today).
class _TodayEntry extends ConsumerWidget {
  const _TodayEntry();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(sessionProvider);
    if (s is! SignedIn || !s.me.can('today')) return const SizedBox.shrink();
    final l = context.orv;
    final configured = ref.watch(todaySettingsProvider).value != null;
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: OrvModule(
        module: 'today',
        child: Builder(
          builder: (context) {
            return Semantics(
              button: true,
              label: 'Working hours and reminders',
              excludeSemantics: true,
              child: GestureDetector(
                onTap: () => context.push('/settings/today'),
                child: Glass(
                  padding: const EdgeInsets.all(20),
                  child: Row(
                    children: [
                      Icon(LucideIcons.calendarClock, color: context.orv.accent),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Working hours & reminders', style: OrvText.heading(l)),
                            Text(
                              configured ? 'Yours — change them any time' : 'Not set up yet',
                              style: OrvText.muted(l),
                            ),
                          ],
                        ),
                      ),
                      Icon(LucideIcons.chevronRight, color: l.c.muted),
                    ],
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}
