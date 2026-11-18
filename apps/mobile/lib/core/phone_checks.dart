import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// What the phone allows, for notifications to arrive and alarms to ring on time (spec 0007 A3).
class PhoneStatus {
  const PhoneStatus({this.notifications, this.exactAlarms, required this.push});

  /// null = unknown on this platform
  final bool? notifications;
  final bool? exactAlarms;

  /// FCM is set up in this build and the token is registered
  final bool push;
}

abstract interface class PhoneChecks {
  Future<PhoneStatus> status({required bool push});
  Future<void> allowNotifications();
  Future<void> allowExactAlarms();
  Future<void> allowFullScreen();
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
      push: push,
    );
  }

  @override
  Future<void> allowNotifications() async => _a?.requestNotificationsPermission();
  @override
  Future<void> allowExactAlarms() async => _a?.requestExactAlarmsPermission();
  @override
  Future<void> allowFullScreen() async => _a?.requestFullScreenIntentPermission();
}

final phoneChecksProvider = Provider<PhoneChecks>((_) => AndroidPhoneChecks());
