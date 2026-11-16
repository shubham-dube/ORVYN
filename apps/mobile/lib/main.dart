import 'dart:io';

import 'package:drift/native.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import 'app/app.dart';
import 'app/platform.dart';
import 'app/state.dart';
import 'core/push_android.dart';
import 'sync/db.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final dir = await getApplicationSupportDirectory();
  final db = LocalDb(NativeDatabase.createInBackground(File(p.join(dir.path, 'orvyn.sqlite'))));
  final push = PushService();
  await push.init();
  final device = await loadDeviceInfo();
  runApp(
    ProviderScope(
      overrides: [
        dbProvider.overrideWithValue(db),
        pusherProvider.overrideWithValue(push),
        deviceInfoProvider.overrideWithValue(device),
      ],
      child: const OrvynApp(),
    ),
  );
}
