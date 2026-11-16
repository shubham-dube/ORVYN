import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter_timezone/flutter_timezone.dart';

import '../core/api.dart';
import '../core/config.dart';

/// IANA zone (e.g. Asia/Kolkata) for quiet hours; UTC if the platform can't say.
Future<String> localTimeZone() async {
  try {
    return (await FlutterTimezone.getLocalTimezone()).identifier;
  } catch (_) {
    return 'UTC';
  }
}

/// "Pixel 8" rather than "Android phone" in the device list, so people recognise what to sign out.
Future<DeviceInfo> loadDeviceInfo() async {
  try {
    final a = await DeviceInfoPlugin().androidInfo;
    final name = '${a.manufacturer[0].toUpperCase()}${a.manufacturer.substring(1)} ${a.model}'.trim();
    return DeviceInfo(
      name: name.length > 60 ? name.substring(0, 60) : name,
      platform: 'android',
      appVersion: Config.appVersion,
    );
  } catch (_) {
    return const DeviceInfo(name: 'Android phone', platform: 'android', appVersion: Config.appVersion);
  }
}
