import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../app/state.dart';
import '../core/phone_checks.dart';
import '../design/controls.dart';
import '../design/theme.dart';
import 'common.dart';

final _deliveryProvider = FutureProvider.autoDispose<Map<String, dynamic>?>((ref) async {
  try {
    return await ref.read(apiProvider).get<Map<String, dynamic>>('/notifications/delivery');
  } catch (_) {
    return null;
  }
});

final _phoneProvider = FutureProvider.autoDispose<PhoneStatus>(
  (ref) => ref.read(phoneChecksProvider).status(push: ref.read(pusherProvider).ready),
);

/// Is this phone ready to ring, and does every device get notifications? (spec 0007 A3)
class DeliveryPanel extends ConsumerStatefulWidget {
  const DeliveryPanel({super.key});
  @override
  ConsumerState<DeliveryPanel> createState() => _DeliveryPanelState();
}

class _DeliveryPanelState extends ConsumerState<DeliveryPanel> {
  String? _testing;
  Map<String, dynamic>? _result;

  Future<void> _test(String? deviceId) async {
    setState(() => _testing = deviceId ?? 'all');
    try {
      final r = await ref.read(apiProvider).post<Map<String, dynamic>>('/notifications/test', {'deviceId': ?deviceId});
      setState(() => _result = r);
      ref.invalidate(_deliveryProvider);
    } catch (e) {
      if (mounted) setState(() => _result = {'error': messageFor(e)});
    } finally {
      if (mounted) setState(() => _testing = null);
    }
  }

  Widget _check(OrvLook l, String label, bool? ok, {String? fix, VoidCallback? onFix, String? help}) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 4),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(
          ok == true ? LucideIcons.circleCheck : (ok == false ? LucideIcons.circleAlert : LucideIcons.circleHelp),
          size: 18,
          color: ok == true ? l.c.success : (ok == false ? l.c.danger : l.c.muted),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: OrvText.body(l)),
              if (help != null && ok != true) Text(help, style: OrvText.muted(l).copyWith(fontSize: 12)),
            ],
          ),
        ),
        if (ok != true && fix != null) TextButton(onPressed: onFix, child: Text(fix)),
      ],
    ),
  );

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final phone = ref.watch(_phoneProvider).value;
    final d = ref.watch(_deliveryProvider).value;
    final checks = ref.read(phoneChecksProvider);
    final session = ref.watch(sessionProvider);
    final myDevice = session is SignedIn ? session.deviceId : null;
    final devices = ((d?['devices'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final server = (d?['server'] as Map?)?.cast<String, dynamic>();
    final pushResults = ((_result?['push'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final live = ((_result?['live'] as List?) ?? const []).cast<String>();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SectionLabel('This phone'),
        const SizedBox(height: 4),
        _check(
          l,
          'Notifications allowed',
          phone?.notifications,
          fix: 'Allow',
          onFix: () async {
            await checks.allowNotifications();
            ref.invalidate(_phoneProvider);
          },
        ),
        _check(
          l,
          'Alarms ring on time',
          phone?.exactAlarms,
          fix: 'Allow',
          help: 'Needs “Alarms & reminders” for ORVYN.',
          onFix: () async {
            await checks.allowExactAlarms();
            ref.invalidate(_phoneProvider);
          },
        ),
        _check(
          l,
          'Alarms show over the lock screen',
          null,
          fix: 'Allow',
          help: 'Android 14+: allow full-screen notifications for ORVYN.',
          onFix: checks.allowFullScreen,
        ),
        _check(
          l,
          'Runs in the background',
          phone?.batteryFree,
          fix: 'Allow',
          help: 'Out of battery saving, so pushes come at once and payments are read while ORVYN is closed.',
          onFix: () async {
            await checks.allowBackground();
            ref.invalidate(_phoneProvider);
          },
        ),
        _check(
          l,
          'Push when the app is closed',
          phone?.push,
          help: server?['fcm'] == false
              ? 'Android push isn’t set up on the server yet (FCM).'
              : 'This build has no Firebase config. Notifications arrive while ORVYN is open.',
        ),
        Text(
          'On Xiaomi, Oppo, Vivo and Realme phones also turn on Autostart for ORVYN (Settings → Apps → ORVYN), or '
          'the phone stops it when you swipe it away.',
          style: OrvText.muted(l).copyWith(fontSize: 12),
        ),
        const SizedBox(height: 14),
        const SectionLabel('Your devices'),
        const SizedBox(height: 4),
        if (d == null) Text('Couldn’t load your devices.', style: OrvText.muted(l)),
        for (final dev in devices)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(
                  dev['platform'] == 'android'
                      ? LucideIcons.smartphone
                      : dev['platform'] == 'windows'
                      ? LucideIcons.monitor
                      : LucideIcons.laptop,
                  size: 18,
                  color: l.accent,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${dev['name']}${dev['id'] == myDevice ? ' (this phone)' : ''}',
                        style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600),
                      ),
                      Text(_status(dev), style: OrvText.muted(l).copyWith(fontSize: 12)),
                      if (_result != null &&
                          (live.contains(dev['id']) || pushResults.any((p) => p['deviceId'] == dev['id'])))
                        Text(
                          [
                            if (live.contains(dev['id'])) 'Delivered live.',
                            for (final p in pushResults.where((p) => p['deviceId'] == dev['id']))
                              p['outcome'] == 'sent' ? 'Pushed.' : '${p['outcome']}: ${p['detail']}',
                          ].join(' '),
                          style: OrvText.muted(l).copyWith(fontSize: 12, color: l.accent),
                        ),
                    ],
                  ),
                ),
                TextButton(
                  onPressed: _testing == null ? () => _test(dev['id'] as String) : null,
                  child: Text(_testing == dev['id'] ? '…' : 'Test'),
                ),
              ],
            ),
          ),
        const SizedBox(height: 6),
        OrvButton(
          label: 'Test every device',
          icon: LucideIcons.send,
          loading: _testing == 'all',
          onPressed: _testing == null ? () => _test(null) : null,
        ),
        if (_result?['error'] != null)
          Text('${_result!['error']}', style: OrvText.muted(l).copyWith(color: l.c.danger)),
      ],
    );
  }

  static String _status(Map<String, dynamic> dev) {
    final push = ((dev['push'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final active = push.where((t) => t['active'] == true);
    final bad = active.where((t) => t['lastResult'] == 'failed' || t['lastResult'] == 'skipped').firstOrNull;
    if (bad != null) return 'Push failing: ${bad['lastError'] ?? 'unknown reason'}';
    if (active.isNotEmpty) return 'Push on — reaches it even when closed';
    if (dev['live'] == true) return 'Open now · gets notifications only while open';
    if (push.isNotEmpty) return 'Push expired — open ORVYN there to renew it';
    return dev['platform'] == 'windows' ? 'Not running — start the tray app' : 'No push set up';
  }
}
