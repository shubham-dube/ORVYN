import 'dart:async';
import 'dart:io';

import 'package:flutter/services.dart';

/// Real Geist in widget tests, so layout (and overflow) matches the phone instead of the square test font.
Future<void> testExecutable(FutureOr<void> Function() testMain) async {
  for (final (family, files) in [
    ('Geist', ['Regular', 'Medium', 'SemiBold', 'Bold'].map((w) => 'assets/fonts/Geist-$w.ttf')),
    ('GeistMono', ['assets/fonts/GeistMono-Regular.ttf']),
  ]) {
    final loader = FontLoader(family);
    for (final f in files) {
      loader.addFont(Future.value(ByteData.sublistView(File(f).readAsBytesSync())));
    }
    await loader.load();
  }
  await testMain();
}
