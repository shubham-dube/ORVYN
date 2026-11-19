import 'dart:async';
import 'dart:convert';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import 'package:timezone/timezone.dart' as tz;

import 'actions.dart';
import 'alarm.dart';
import 'background.dart';
import 'api.dart';
import 'config.dart';
import 'push.dart';
import 'session_store.dart';

final _plugin = FlutterLocalNotificationsPlugin();
const _channel = AndroidNotificationChannel(
  'orvyn',
  'ORVYN',
  description: 'Reminders, messages and alerts',
  importance: Importance.high,
);
const _urgent = AndroidNotificationChannel(
  'orvyn.urgent',
  'Urgent',
  description: 'Things that break through quiet hours',
  importance: Importance.max,
);

const _alarm = AndroidNotificationChannel(
  'orvyn.alarm',
  'Alarms',
  description: 'Reminders you asked to ring like an alarm',
  importance: Importance.max,
  playSound: true,
  audioAttributesUsage: AudioAttributesUsage.alarm,
  enableVibration: true,
);

/// An alarm rings (insistent sound until acted on), lights the screen over the lock screen, and stays until dismissed.
AndroidNotificationDetails _alarmDetails({
  required String tag,
  required String body,
  List<AndroidNotificationAction>? actions,
}) => AndroidNotificationDetails(
  _alarm.id,
  _alarm.name,
  channelDescription: _alarm.description,
  importance: Importance.max,
  priority: Priority.max,
  category: AndroidNotificationCategory.alarm,
  fullScreenIntent: true,
  ongoing: true,
  autoCancel: false,
  audioAttributesUsage: AudioAttributesUsage.alarm,
  additionalFlags: Int32List.fromList(<int>[4]), // FLAG_INSISTENT: keeps ringing until the person acts
  visibility: NotificationVisibility.public,
  tag: tag,
  styleInformation: BigTextStyleInformation(body),
  actions: actions,
);

/// Taps arrive here (in any isolate) as the notification's payload: `{"id": ..., "url": ..., "action": ...}`.
final StreamController<Map<String, dynamic>> notificationTaps = StreamController.broadcast();

class AndroidShade implements NotificationShade {
  @override
  Future<void> show(ShowPush p) => _plugin.show(
    id: notificationIntId(p.id),
    title: p.title,
    body: p.body,
    payload: jsonEncode({'id': p.id, 'url': p.url, if (p.alarm) 'alarm': true}),
    notificationDetails: NotificationDetails(
      android: p.alarm
          ? _alarmDetails(
              tag: p.id,
              body: p.body,
              actions: [
                for (final a in p.actions.take(maxShadeActions))
                  AndroidNotificationAction(
                    a.id,
                    a.label,
                    showsUserInterface: a.open != null,
                    cancelNotification: true,
                    // a reply box right in the shade: answered without opening ORVYN
                    inputs: [if (a.reply != null) AndroidNotificationActionInput(label: a.reply)],
                  ),
              ],
            )
          : AndroidNotificationDetails(
              p.priority == 'urgent' ? _urgent.id : _channel.id,
              p.priority == 'urgent' ? _urgent.name : _channel.name,
              tag: p.id,
              styleInformation: BigTextStyleInformation(p.body),
              actions: [
                for (final a in p.actions.take(maxShadeActions))
                  // a button that only does something (Done, Snooze…) runs without opening the app
                  AndroidNotificationAction(
                    a.id,
                    a.label,
                    showsUserInterface: a.open != null,
                    cancelNotification: true,
                    // a reply box right in the shade: answered without opening ORVYN
                    inputs: [if (a.reply != null) AndroidNotificationActionInput(label: a.reply)],
                  ),
              ],
            ),
    ),
  );

  @override
  Future<void> cancel(String id) => _plugin.cancel(id: notificationIntId(id), tag: id);
}

Future<void> initShade() async {
  await _plugin.initialize(
    settings: const InitializationSettings(android: AndroidInitializationSettings('@drawable/ic_stat_orvyn')),
    onDidReceiveNotificationResponse: (r) {
      final p = r.payload == null ? <String, dynamic>{} : jsonDecode(r.payload!) as Map<String, dynamic>;
      notificationTaps.add({...p, 'action': r.actionId, if (r.input != null) 'input': r.input});
    },
    onDidReceiveBackgroundNotificationResponse: backgroundAction,
  );
  final android = _plugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
  await android?.createNotificationChannel(_channel);
  await android?.createNotificationChannel(_urgent);
  await android?.createNotificationChannel(_alarm);
}

/// Local alarms (D22): scheduled with Android's alarm-clock scheduling, so they ring on time with no connection.
class AndroidAlarmScheduler implements AlarmScheduler {
  static const _kind = 'local-alarm';

  @override
  Future<void> replaceAll(List<AlarmSlot> wanted) async {
    final want = {for (final w in wanted) w.id: w};
    final pending = await _plugin.pendingNotificationRequests();
    final have = <int>{};
    for (final p in pending) {
      final payload = p.payload == null ? null : jsonDecode(p.payload!) as Map<String, dynamic>;
      if (payload?['kind'] != _kind) continue;
      if (want.containsKey(p.id)) {
        have.add(p.id);
      } else {
        await _plugin.cancel(id: p.id);
      }
    }
    for (final w in wanted) {
      if (have.contains(w.id)) continue;
      await _plugin.zonedSchedule(
        id: w.id,
        title: w.title,
        body: w.body,
        scheduledDate: tz.TZDateTime.fromMillisecondsSinceEpoch(tz.UTC, w.at.millisecondsSinceEpoch),
        notificationDetails: NotificationDetails(
          android: _alarmDetails(
            tag: 'alarm-${w.id}',
            body: w.body,
            actions: const [
              AndroidNotificationAction('done', 'Done', cancelNotification: true),
              AndroidNotificationAction('snooze_10m', 'Snooze 10 min', cancelNotification: true),
            ],
          ),
        ),
        androidScheduleMode: AndroidScheduleMode.alarmClock,
        payload: jsonEncode({
          'kind': _kind,
          'alarm': true,
          'taskId': w.taskId,
          'localId': w.id,
          'title': w.title,
          'body': w.body,
        }),
      );
    }
  }

  /// Snooze: the same alarm again in [minutes].
  static Future<void> snooze(Map<String, dynamic> payload, {int minutes = 10}) async {
    final id = notificationIntId('snooze:${payload['localId']}:${DateTime.now().millisecondsSinceEpoch ~/ 60000}');
    await _plugin.zonedSchedule(
      id: id,
      title: payload['title'] as String?,
      body: payload['body'] as String?,
      scheduledDate: tz.TZDateTime.fromMillisecondsSinceEpoch(
        tz.UTC,
        DateTime.now().add(Duration(minutes: minutes)).millisecondsSinceEpoch,
      ),
      notificationDetails: NotificationDetails(
        android: _alarmDetails(
          tag: 'alarm-$id',
          body: (payload['body'] as String?) ?? '',
          actions: const [
            AndroidNotificationAction('done', 'Done', cancelNotification: true),
            AndroidNotificationAction('snooze_10m', 'Snooze 10 min', cancelNotification: true),
          ],
        ),
      ),
      androidScheduleMode: AndroidScheduleMode.alarmClock,
      payload: jsonEncode({...payload, 'localId': id}),
    );
  }
}

/// A shade button pressed while the app is in the background or closed: do it with the stored session.
@pragma('vm:entry-point')
Future<void> backgroundAction(NotificationResponse r) async {
  final action = r.actionId;
  if (action == null || r.payload == null) return;
  final payload = jsonDecode(r.payload!) as Map<String, dynamic>;
  if (payload['kind'] == 'local-alarm') return localAlarmAction(payload, action);
  final id = payload['id'] as String?;
  if (id == null) return;
  final api = Api(baseUrl: Config.apiUrl, store: SecureSessionStore());
  final typed = r.input?.trim();
  await runNotificationAction(api, id, action, text: typed == null || typed.isEmpty ? null : typed);
}

/// A button on a local alarm while the app is closed: Done completes the task from this phone's own copy (synced
/// when there's a connection); Snooze rings again in 10 minutes.
Future<void> localAlarmAction(Map<String, dynamic> payload, String action) async {
  if (action == 'snooze_10m') return AndroidAlarmScheduler.snooze(payload);
  if (action == 'done') await completeTaskInBackground(payload['taskId'] as String);
}

/// Data messages while the app is in the background or killed.
@pragma('vm:entry-point')
Future<void> firebaseBackgroundHandler(RemoteMessage m) async {
  await Firebase.initializeApp();
  await initShade();
  await handlePush(m.data, AndroidShade());
}

/// FCM, or nothing when the build has no Firebase config yet (google-services.json is added at release
/// time — docs/DECISIONS.md). The app works fully without it; pushes simply arrive only while it is open.
class PushService implements Pusher {
  bool _ready = false;
  @override
  bool get ready => _ready;

  @override
  Stream<Map<String, dynamic>> get taps => notificationTaps.stream;

  @override
  Future<void> init() async {
    try {
      await initShade();
      await Firebase.initializeApp();
      FirebaseMessaging.onBackgroundMessage(firebaseBackgroundHandler);
      FirebaseMessaging.onMessage.listen((m) => handlePush(m.data, AndroidShade()));
      _ready = true;
    } catch (e) {
      debugPrint('push disabled: $e');
    }
  }

  /// Asks permission (Android 13+), registers this app instance with FCM and returns its Firebase Installation ID
  /// (spec 0008 A). Falls back to the older registration token only when registration isn't available here.
  @override
  Future<PushAddress?> address() async {
    if (!_ready) return null;
    final m = FirebaseMessaging.instance;
    final s = await m.requestPermission();
    if (s.authorizationStatus == AuthorizationStatus.denied) return null;
    try {
      final fid = m.onRegistered.first.timeout(const Duration(seconds: 20));
      await m.register();
      return PushAddress('fid', await fid);
    } catch (e) {
      debugPrint('FCM register failed ($e); using a registration token');
      // ignore: deprecated_member_use
      final t = await m.getToken();
      return t == null ? null : PushAddress('token', t);
    }
  }

  @override
  Stream<PushAddress> get addressChanges =>
      _ready ? FirebaseMessaging.instance.onRegistered.map((fid) => PushAddress('fid', fid)) : const Stream.empty();

  @override
  Future<void> unregister() async {
    if (!_ready) return;
    try {
      await FirebaseMessaging.instance.unregister();
    } catch (_) {
      // offline: the server forgets this phone anyway at sign-out
    }
  }

  /// Foreground: the in-app list already shows it, but the shade copy must go when it's dismissed elsewhere.
  @override
  Future<void> clear(String id) => _ready ? AndroidShade().cancel(id) : Future.value();
}
