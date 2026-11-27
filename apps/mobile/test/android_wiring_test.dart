import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Wiring Android needs that no widget test can see. Both of these were broken on a real phone (2026-11-27):
/// replies in the shade spun forever, and payments were never read with ORVYN closed.
void main() {
  test('the shade’s buttons and reply box reach ORVYN (the plugin’s receiver is declared)', () {
    final manifest = File('android/app/src/main/AndroidManifest.xml').readAsStringSync();
    expect(manifest, contains('com.dexterous.flutterlocalnotifications.ActionBroadcastReceiver'));
  });

  test('background readers name their library: Flutter looks only in main.dart otherwise', () {
    final dir = Directory('android/app/src/main/kotlin');
    final kotlin = dir
        .listSync(recursive: true)
        .whereType<File>()
        .where((f) => f.path.endsWith('.kt'))
        .map((f) => f.readAsStringSync())
        .join('\n');
    final entrypoints = RegExp(r'DartExecutor\.DartEntrypoint\(\s*loader\.findAppBundlePath\(\),([^)]*)\)')
        .allMatches(kotlin)
        .map((m) => m[1]!)
        .toList();
    expect(entrypoints, isNotEmpty);
    for (final e in entrypoints) {
      expect(e, contains('"package:orvyn/'), reason: 'DartEntrypoint($e) must name its library');
    }
    // and each named function is marked as an entry point where it lives
    for (final (lib, fn) in [
      ('lib/money/capture.dart', 'moneyCaptureMain'),
      ('lib/activity/phone_day.dart', 'phoneDayMain'),
    ]) {
      expect(File(lib).readAsStringSync(), matches(RegExp("@pragma\\('vm:entry-point'\\)\\s*Future<void> $fn\\(")));
    }
  });
}
