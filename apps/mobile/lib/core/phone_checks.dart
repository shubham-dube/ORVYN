import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// What the phone allows, for notifications to arrive and alarms to ring on time (spec 0007 A3).
class PhoneStatus {
  const PhoneStatus({this.notifications, this.exactAlarms, this.batteryFree, required this.push});

  /// null = unknown on this platform
  final bool? notifications;
  final bool? exactAlarms;

  /// out of battery optimisation: pushes and payment capture aren't held back while the phone sleeps
  final bool? batteryFree;

  /// FCM is set up in this build and the token is registered
  final bool push;
}

abstract interface class PhoneChecks {
  Future<PhoneStatus> status({required bool push});
  Future<void> allowNotifications();
  Future<void> allowExactAlarms();
  Future<void> allowFullScreen();
  Future<void> allowBackground();
}

class AndroidPhoneChecks implements PhoneChecks {
  AndroidFlutterLocalNotificationsPlugin? get _a => defaultTargetPlatform == TargetPlatform.android
      ? FlutterLocalNotificationsPlugin()
            .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
      : null;

  @override
  Future<PhoneStatus> status({required bool push}) async {
    final a = _a;
    if (a == null) return PhoneStatus(push: push);
    return PhoneStatus(
      notifications: await a.areNotificationsEnabled(),
      exactAlarms: await a.canScheduleExactNotifications(),
      batteryFree: await _phone.invokeMethod<bool>('batteryFree').catchError((Object _) => null),
      push: push,
    );
  }

  static const _phone = MethodChannel('orvyn/phone');

  @override
  Future<void> allowBackground() async {
    await _phone.invokeMethod<void>('allowBackground').catchError((Object _) {});
  }

  @override
  Future<void> allowNotifications() async => _a?.requestNotificationsPermission();
  @override
  Future<void> allowExactAlarms() async => _a?.requestExactAlarmsPermission();
  @override
  Future<void> allowFullScreen() async => _a?.requestFullScreenIntentPermission();
}

final phoneChecksProvider = Provider<PhoneChecks>((_) => AndroidPhoneChecks());
