import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvyn/core/api.dart';
import 'package:orvyn/core/session_store.dart';
import 'package:orvyn/sync/db.dart';
import 'package:orvyn/sync/sync_client.dart';

import 'support/fake_server.dart';

void main() {
  late FakeServer server;
  late FakeSyncBackend backend;

  setUpAll(() => driftRuntimeOptions.dontWarnAboutMultipleDatabases = true); // one in-memory db per simulated device

  setUp(() {
    server = FakeServer();
    backend = FakeSyncBackend()..attach(server);
  });

  SyncClient device(String node, {int Function()? now}) {
    final api = Api(baseUrl: 'http://api.test', store: MemorySessionStore(), adapter: server);
    return SyncClient(db: LocalDb(NativeDatabase.memory()), api: api, node: node, now: now);
  }

  test('writes show instantly offline, then reach the server and other devices', () async {
    final phone = device('phone');
    final laptop = device('laptop');
    final id = await phone.upsert('test.note', {'title': 'Milk', 'done': false});
    expect((await phone.get('test.note', id))!.data['title'], 'Milk');
    expect(await phone.pendingCount(), 1);

    await phone.sync();
    expect(await phone.pendingCount(), 0);
    await laptop.sync();
    expect((await laptop.get('test.note', id))!.data, containsPair('title', 'Milk'));
  });

  test('concurrent edits merge per field: each device keeps the field it changed last', () async {
    var t = 1000;
    final phone = device('phone', now: () => t);
    final laptop = device('laptop', now: () => t);
    final id = await phone.upsert('test.note', {'title': 'Milk', 'done': false});
    await phone.sync();
    await laptop.sync();

    t = 2000;
    await phone.upsert('test.note', {'title': 'Oat milk'}, id: id);
    t = 3000;
    await laptop.upsert('test.note', {'done': true}, id: id);
    await laptop.sync();
    await phone.sync();
    await laptop.sync();

    for (final d in [phone, laptop]) {
      final r = (await d.get('test.note', id))!.data;
      expect(r['title'], 'Oat milk');
      expect(r['done'], true);
    }
  });

  test('a pull never hides an edit that has not been pushed yet', () async {
    final phone = device('phone');
    final laptop = device('laptop');
    final id = await laptop.upsert('test.note', {'title': 'A', 'body': 'x'});
    await laptop.sync();
    await phone.sync();
    // phone edits offline; laptop changes another field meanwhile
    await phone.upsert('test.note', {'title': 'B'}, id: id);
    await laptop.upsert('test.note', {'body': 'y'}, id: id);
    await laptop.sync();
    // phone pulls before its push lands: sees the laptop's body AND keeps its own pending title
    await phone.pullOnly();
    var r = (await phone.get('test.note', id))!.data;
    expect([r['title'], r['body']], ['B', 'y']);
    expect(await phone.pendingCount(), 1);
    await phone.sync();
    r = (await phone.get('test.note', id))!.data;
    expect([r['title'], r['body']], ['B', 'y']);
  });

  test('deletes sync and pushes are idempotent', () async {
    final phone = device('phone');
    final laptop = device('laptop');
    final id = await phone.upsert('test.note', {'title': 'Temp'});
    await phone.sync();
    await laptop.sync();
    await laptop.remove('test.note', id);
    expect(await laptop.get('test.note', id), isNull);
    await laptop.sync();
    await phone.sync();
    expect(await phone.get('test.note', id), isNull);
    expect(backend.seen.length, 2);
  });

  test('rejected mutations leave the outbox and are reported', () async {
    final phone = device('phone');
    backend.refusedEntities.add('vault.item');
    final reasons = <String>[];
    phone.rejections.listen((r) => reasons.add(r.reason));
    await phone.upsert('vault.item', {'x': 1});
    await phone.sync();
    await Future<void>.delayed(Duration.zero);
    expect(await phone.pendingCount(), 0);
    expect(reasons, ['forbidden']);
  });

  test('watch streams live rows', () async {
    final phone = device('phone');
    final seen = <int>[];
    final sub = phone.watch('test.note').listen((rows) => seen.add(rows.length));
    await phone.upsert('test.note', {'title': 'one'});
    await phone.upsert('test.note', {'title': 'two'});
    await Future<void>.delayed(const Duration(milliseconds: 50));
    await sub.cancel();
    expect(seen.last, 2);
  });
}
