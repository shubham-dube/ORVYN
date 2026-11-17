import 'dart:async';
import 'dart:convert';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import 'actions.dart';
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

/// Taps arrive here (in any isolate) as the notification's payload: `{"id": ..., "url": ..., "action": ...}`.
final StreamController<Map<String, dynamic>> notificationTaps = StreamController.broadcast();

class AndroidShade implements NotificationShade {
  @override
  Future<void> show(ShowPush p) => _plugin.show(
    id: notificationIntId(p.id),
    title: p.title,
    body: p.body,
    payload: jsonEncode({'id': p.id, 'url': p.url}),
    notificationDetails: NotificationDetails(
      android: AndroidNotificationDetails(
        p.priority == 'urgent' ? _urgent.id : _channel.id,
        p.priority == 'urgent' ? _urgent.name : _channel.name,
        tag: p.id,
        styleInformation: BigTextStyleInformation(p.body),
        actions: [
          for (final a in p.actions.take(maxShadeActions))
            // a button that only does something (Done, Snooze…) runs without opening the app
            AndroidNotificationAction(a.id, a.label, showsUserInterface: a.open != null, cancelNotification: true),
        ],
      ),
    ),
  );

  @override
  Future<void> cancel(String id) => _plugin.cancel(id: notificationIntId(id), tag: id);
}

Future<void> initShade() async {
  await _plugin.initialize(
    settings: const InitializationSettings(android: AndroidInitializationSettings('@mipmap/ic_launcher')),
    onDidReceiveNotificationResponse: (r) {
      final p = r.payload == null ? <String, dynamic>{} : jsonDecode(r.payload!) as Map<String, dynamic>;
      notificationTaps.add({...p, 'action': r.actionId});
    },
    onDidReceiveBackgroundNotificationResponse: backgroundAction,
  );
  final android = _plugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
  await android?.createNotificationChannel(_channel);
  await android?.createNotificationChannel(_urgent);
}

/// A shade button pressed while the app is in the background or closed: do it with the stored session.
@pragma('vm:entry-point')
Future<void> backgroundAction(NotificationResponse r) async {
  final action = r.actionId;
  if (action == null || r.payload == null) return;
  final id = (jsonDecode(r.payload!) as Map<String, dynamic>)['id'] as String?;
  if (id == null) return;
  final api = Api(baseUrl: Config.apiUrl, store: SecureSessionStore());
  await runNotificationAction(api, id, action);
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

  /// Asks permission (Android 13+) and returns the FCM token to register, or null.
  @override
  Future<String?> token() async {
    if (!_ready) return null;
    final s = await FirebaseMessaging.instance.requestPermission();
    if (s.authorizationStatus == AuthorizationStatus.denied) return null;
    // The API sends with FCM HTTP v1 `message.token`; moving to installation-ID direct send needs an API
    // change first (docs/specs/0001-foundation/spec.md, open questions).
    // ignore: deprecated_member_use
    return FirebaseMessaging.instance.getToken();
  }

  @override
  // ignore: deprecated_member_use
  Stream<String> get tokenRefresh => _ready ? FirebaseMessaging.instance.onTokenRefresh : const Stream.empty();

  /// Foreground: the in-app list already shows it, but the shade copy must go when it's dismissed elsewhere.
  @override
  Future<void> clear(String id) => _ready ? AndroidShade().cancel(id) : Future.value();
}
