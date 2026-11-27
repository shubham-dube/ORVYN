import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../app/calendar.dart' show urlOpenerProvider;
import '../app/notifications.dart';
import '../app/router.dart';
import '../app/state.dart';
import '../app/today.dart';
import '../core/config.dart';
import '../core/push_android.dart' show AndroidAlarmScheduler, settleShade;
import '../design/toast.dart';
import 'settings_screen.dart' show SettingsSectionScreen;

/// A page of ORVYN, or a pull request, a registrar's site… in the browser.
Future<void> openNotificationUrl(WidgetRef ref, String url) async {
  var u = Uri.parse(url);
  final web = Uri.parse(Config.webUrl);
  if (u.hasScheme && u.host != web.host) {
    if (u.scheme == 'https' || u.scheme == 'http') await ref.read(urlOpenerProvider)(u);
    return;
  }
  // the web's /settings#security is /settings/security here
  if (u.path == '/settings' && u.hasFragment) {
    final section = u.fragment == 'reminders' ? 'today' : u.fragment;
    if (section == 'today' || SettingsSectionScreen.titles.containsKey(section)) u = Uri(path: '/settings/$section');
  }
  if (u.path == '/settings/devices') u = Uri(path: '/settings/security');
  final to = Uri(path: u.path.isEmpty ? '/' : u.path, query: u.hasQuery ? u.query : null).toString();
  ref.read(routerProvider).go(to);
}

/// Taps on this phone's notifications and arrivals while ORVYN is open, on every screen of the app.
class NotificationHost extends ConsumerStatefulWidget {
  const NotificationHost({super.key, required this.child});
  final Widget child;
  @override
  ConsumerState<NotificationHost> createState() => _NotificationHostState();
}

class _NotificationHostState extends ConsumerState<NotificationHost> {
  StreamSubscription<dynamic>? _arrivals;
  StreamSubscription<dynamic>? _taps;

  @override
  void initState() {
    super.initState();
    _taps = ref.read(pusherProvider).taps.listen((t) => unawaited(_tapped(t)));
    _arrivals = ref.read(arrivalsProvider).stream.listen((n) {
      if (!mounted) return;
      // already reading that chat
      if (n.url != null && ref.read(routerProvider).routeInformationProvider.value.uri.path == n.url) return;
      HapticFeedback.lightImpact();
      Toaster.of(context).show(n.title, body: n.body.isEmpty ? null : n.body);
    });
    ref.listenManual(sessionProvider, (_, s) {
      if (s is! SignedIn) return;
      // the tap that opened ORVYN, once it knows who this is and has left the splash
      final launch = ref.read(pusherProvider).takeLaunch();
      if (launch == null) return;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) unawaited(_tapped(launch));
      });
    }, fireImmediately: true);
  }

  @override
  void dispose() {
    _taps?.cancel();
    _arrivals?.cancel();
    super.dispose();
  }

  /// A button does its job, the body opens.
  Future<void> _tapped(Map<String, dynamic> t) async {
    if (ref.read(sessionProvider) is! SignedIn) return;
    final id = t['id'] as String?;
    final action = t['action'] as String?;
    // an alarm scheduled on this phone: its buttons act on this phone's own copy
    if (t['kind'] == 'local-alarm') {
      if (action == 'done') unawaited(ref.read(todayActionsProvider).complete(t['taskId'] as String, true));
      if (action == 'snooze_10m') unawaited(AndroidAlarmScheduler.snooze(t));
      if (action == null) await openNotificationUrl(ref, '/today');
      return;
    }
    if (id == null) return;
    final ctl = ref.read(notificationsProvider.notifier);
    // a button that opens something
    final opens = (t['open'] as Map?)?[action] as String?;
    if (opens != null) {
      unawaited(ctl.markRead(id).catchError((Object _) {}));
      return openNotificationUrl(ref, opens);
    }
    if (action != null && action.isNotEmpty) {
      final text = (t['input'] as String?)?.trim();
      final ok = await ctl.act(id, action, text: text);
      debugPrint('orvyn: shade action $action from the open app: ${ok ? 'done' : 'failed'}');
      // the shade copy changes either way, so a reply there never spins on
      if (!ok && ref.read(pusherProvider).ready) {
        await settleShade(
          id,
          ok: false,
          title: t['title'] as String?,
          url: t['url'] as String?,
          text: text,
        ).catchError((Object _) {});
      }
      if (mounted && !ok) Toaster.of(context).show('That didn’t work', tone: ToastTone.danger);
      return;
    }
    unawaited(ctl.markRead(id).catchError((Object _) {}));
    final url = t['url'] as String?;
    if (url != null) await openNotificationUrl(ref, url);
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
