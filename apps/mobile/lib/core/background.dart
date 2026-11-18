import 'dart:io';

import 'package:drift/native.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import '../app/today.dart';
import '../sync/db.dart';
import '../sync/sync_client.dart';
import 'api.dart';
import 'config.dart';
import 'session_store.dart';

/// Marks a task done from a closed app (an alarm's Done button): written to this phone's own copy, then synced when
/// there's a connection (the outbox keeps it otherwise).
Future<void> completeTaskInBackground(String taskId) async {
  final dir = await getApplicationSupportDirectory();
  final db = LocalDb(NativeDatabase(File(p.join(dir.path, 'orvyn.sqlite'))));
  try {
    final sync = SyncClient(
      db: db,
      api: Api(baseUrl: Config.apiUrl, store: SecureSessionStore()),
      node: 'b${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}',
    );
    await sync.upsert(todayTask, {'completedAt': DateTime.now().toUtc().toIso8601String()}, id: taskId);
    await sync.sync().timeout(const Duration(seconds: 15), onTimeout: () {});
  } finally {
    await db.close();
  }
}
