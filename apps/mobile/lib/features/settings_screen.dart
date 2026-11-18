import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../app/lock.dart';
import '../app/platform.dart';
import '../app/notifications.dart';
import '../app/state.dart';
import '../app/calendar.dart';
import '../app/today_settings.dart';
import '../core/api.dart';

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
        _Calendars(),
        SizedBox(height: 14),
        _AiUsage(),
        SizedBox(height: 14),
        _Security(),
      ],
    );
  }
}

final _aiUsageProvider = FutureProvider.autoDispose<Map<String, dynamic>?>((ref) async {
  try {
    return await ref.read(apiProvider).get<Map<String, dynamic>>('/ai/usage', query: {'days': 14});
  } catch (_) {
    return null;
  }
});

String _usd(num n) => '${r'$'}${n.toStringAsFixed(n < 0.1 ? 3 : 2)}';

/// What AI has cost, by day and by job. Counts only, never what was asked or read.
class _AiUsage extends ConsumerWidget {
  const _AiUsage();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final u = ref.watch(_aiUsageProvider).value;
    const names = {
      'drop.understand': 'Sorting what you drop',
      'today.parse': 'Reading typed tasks',
      'assistant.chat': 'Assistant',
      'library.read': 'Reading documents',
    };
    final status = (u?['status'] as Map?)?.cast<String, dynamic>();
    final byTask = ((u?['byTask'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final byDay = ((u?['byDay'] as List?) ?? const []).cast<Map<String, dynamic>>().reversed.toList();
    final mx = byDay.fold<double>(0.001, (a, d) => (d['costUsd'] as num) > a ? (d['costUsd'] as num).toDouble() : a);
    final spent = (status?['spentTodayUsd'] as num?) ?? 0;
    final cap = (status?['capUsd'] as num?) ?? 1;
    return _Section(
      title: 'AI',
      line: 'What ORVYN’s helpers have used. Only counts are shown, never what you asked or what was read.',
      children: [
        if (u == null || status == null)
          Text('Couldn’t load AI use right now.', style: OrvText.muted(l))
        else ...[
          Text(
            status['available'] != true
                ? 'AI is not set up on this server.'
                : status['paused'] == true
                ? 'Paused until tomorrow.'
                : 'On.',
            style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 4),
          Text(
            'Today, everyone together: ${_usd(spent)} of ${_usd(cap)}. '
            'The limit is set on the server; each person can use at most half of it.',
            style: OrvText.muted(l),
          ),
          const SizedBox(height: 8),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: (spent / (cap == 0 ? 1 : cap)).clamp(0, 1).toDouble(),
              minHeight: 6,
              backgroundColor: l.c.track,
              color: status['paused'] == true ? l.c.warning : l.accent,
            ),
          ),
          const SizedBox(height: 12),
          Text('Your use, last ${u['days']} days: ${_usd(u['totalUsd'] as num)}', style: OrvText.muted(l)),
          const SizedBox(height: 6),
          Semantics(
            label: 'Your AI cost per day',
            child: SizedBox(
              height: 56,
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  for (final d in byDay)
                    Expanded(
                      child: Container(
                        margin: const EdgeInsets.symmetric(horizontal: 1),
                        height: 4 + (d['costUsd'] as num) / mx * 52,
                        decoration: BoxDecoration(
                          gradient: l.accentGradient,
                          borderRadius: const BorderRadius.vertical(top: Radius.circular(3)),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
          if (byDay.isEmpty) Text('No AI use yet.', style: OrvText.muted(l)),
          for (final t in byTask)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Row(
                children: [
                  Expanded(child: Text(names[t['task']] ?? t['task'] as String, style: OrvText.body(l))),
                  Text('${t['calls']} calls · ${_usd(t['costUsd'] as num)}', style: OrvText.muted(l)),
                ],
              ),
            ),
        ],
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

/// Settings → Calendars (D15): every Google account the person connected, each calendar shown or hidden.
class _Calendars extends ConsumerWidget {
  const _Calendars();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(sessionProvider);
    if (s is! SignedIn || !s.me.can('today')) return const SizedBox.shrink();
    final l = context.orv;
    final accounts = ref.watch(calendarAccountsProvider);
    final calendars = ref.watch(calendarsProvider).value ?? const <CalendarItem>[];
    final actions = ref.read(calendarActionsProvider);
    final toaster = Toaster.of(context);
    Future<void> connect([String? hint]) async {
      try {
        await actions.connectGoogle(hint: hint);
      } on ApiError catch (e) {
        toaster.show(
          e.code == 'google_not_configured'
              ? 'Google Calendar isn’t set up on this server yet'
              : 'Couldn’t start connecting',
          tone: ToastTone.danger,
        );
      }
    }

    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: _Section(
        title: 'Calendars',
        line: 'Connect as many Google accounts as you use. Changes go both ways; pick which calendars show.',
        children: [
          ...switch (accounts) {
            AsyncData(:final value) => [
              for (final a in value) ...[
                Row(
                  children: [
                    Icon(LucideIcons.calendarDays, size: 18, color: l.accent),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(a.email, style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600)),
                    ),
                    if (a.needsReconnect)
                      OrvButton(label: 'Reconnect', small: true, onPressed: () => connect(a.email))
                    else
                      IconButton(
                        tooltip: 'Sync ${a.email} now',
                        icon: Icon(LucideIcons.refreshCw, size: 18, color: l.c.muted),
                        onPressed: () => actions.syncNow(a.id).catchError((Object _) {}),
                      ),
                    IconButton(
                      tooltip: 'Disconnect ${a.email}',
                      icon: Icon(LucideIcons.unplug, size: 18, color: l.c.muted),
                      onPressed: () async {
                        final ok = await showDialog<bool>(
                          context: context,
                          builder: (c) => AlertDialog(
                            title: Text('Disconnect ${a.email}?'),
                            content: const Text('Its calendars leave ORVYN on every device.'),
                            actions: [
                              TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Keep')),
                              TextButton(onPressed: () => Navigator.pop(c, true), child: const Text('Disconnect')),
                            ],
                          ),
                        );
                        if (ok == true) await actions.disconnect(a.id);
                      },
                    ),
                  ],
                ),
                if (a.needsReconnect)
                  Text(
                    'Google stopped accepting this connection.',
                    style: OrvText.muted(l).copyWith(color: l.c.danger),
                  ),
                for (final c in calendars.where((c) => c.accountId == a.id))
                  Padding(
                    padding: const EdgeInsets.only(left: 26),
                    child: OrvSwitchRow(
                      label: c.name,
                      subtitle: c.writable ? null : 'View only',
                      value: c.visible,
                      onChanged: (v) => actions.setCalendar(c.id, {'visible': v}),
                    ),
                  ),
                const SizedBox(height: 10),
              ],
            ],
            AsyncError() => [Text('Couldn’t load your calendars.', style: OrvText.muted(l))],
            _ => [const SizedBox(height: 24)],
          },
          OrvButton(
            label: (accounts.value?.isNotEmpty ?? false)
                ? 'Connect another Google account'
                : 'Connect a Google account',
            icon: LucideIcons.plus,
            onPressed: connect,
          ),
        ],
      ),
    );
  }
}
