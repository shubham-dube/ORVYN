import 'dart:async';
import 'dart:convert';

import 'package:drift/drift.dart';
import 'package:meta/meta.dart';
import 'package:uuid/uuid.dart';

import '../core/api.dart';
import '../core/hlc.dart';
import 'db.dart';

/// A row as the app sees it: the server's latest copy with this device's unacknowledged edits on top.
class SyncedRecord {
  const SyncedRecord(this.entity, this.id, this.data);
  final String entity;
  final String id;
  final Map<String, dynamic> data;
}

class Rejection {
  const Rejection(this.mutationId, this.entity, this.entityId, this.reason);
  final String mutationId;
  final String entity;
  final String entityId;
  final String reason;
}

/// Offline-first sync (ADR-0006), the Dart twin of the web client:
/// writes land locally and in the outbox at once; `sync()` pushes the outbox, then pulls everything after
/// the cursor. Field-level last-writer-wins is decided by the server using each mutation's HLC.
class SyncClient {
  SyncClient({required this.db, required this.api, required String node, int Function()? now})
    : hlc = Hlc(node, now: now);

  final LocalDb db;
  final Api api;
  final Hlc hlc;
  static const _uuid = Uuid();
  static const _cursorKey = 'sync.cursor';
  Future<void>? _running;
  bool _again = false;
  final _rejections = StreamController<Rejection>.broadcast();

  /// Mutations the server refused (e.g. module switched off); the UI tells the person.
  Stream<Rejection> get rejections => _rejections.stream;

  // ------------------------------------------------------------------ writes

  /// Create or change fields of a record. Returns the record id.
  Future<String> upsert(String entity, Map<String, dynamic> fields, {String? id}) async {
    final entityId = id ?? _uuid.v7();
    final stamp = hlc.tick();
    await db.transaction(() async {
      final current = await _row(entity, entityId);
      final merged = {...?current?.let(_decode), ...fields, 'id': entityId};
      await _put(entity, entityId, merged, deleted: false);
      await db
          .into(db.outbox)
          .insert(
            OutboxCompanion.insert(
              mutationId: _uuid.v4(),
              entity: entity,
              entityId: entityId,
              op: 'upsert',
              fields: jsonEncode(fields),
              hlc: stamp,
              createdAt: DateTime.now(),
            ),
          );
    });
    return entityId;
  }

  Future<void> remove(String entity, String entityId) async {
    final stamp = hlc.tick();
    await db.transaction(() async {
      final current = await _row(entity, entityId);
      await _put(entity, entityId, current == null ? {'id': entityId} : _decode(current), deleted: true);
      await db
          .into(db.outbox)
          .insert(
            OutboxCompanion.insert(
              mutationId: _uuid.v4(),
              entity: entity,
              entityId: entityId,
              op: 'delete',
              fields: '{}',
              hlc: stamp,
              createdAt: DateTime.now(),
            ),
          );
    });
  }

  // ------------------------------------------------------------------ reads

  Stream<List<SyncedRecord>> watch(String entity) {
    final q = db.select(db.records)..where((r) => r.entity.equals(entity) & r.deleted.equals(false));
    return q.watch().map((rows) => [for (final r in rows) SyncedRecord(r.entity, r.entityId, _decode(r))]);
  }

  Future<SyncedRecord?> get(String entity, String id) async {
    final r = await _row(entity, id);
    return r == null || r.deleted ? null : SyncedRecord(entity, id, _decode(r));
  }

  Future<int> pendingCount() async => (await db.select(db.outbox).get()).length;

  // ------------------------------------------------------------------ sync

  /// Push then pull. Calls while a sync runs coalesce into one more pass.
  Future<void> sync() {
    if (_running != null) {
      _again = true;
      return _running!;
    }
    return _running = _loop().whenComplete(() => _running = null);
  }

  Future<void> _loop() async {
    do {
      _again = false;
      await _push();
      await _pull();
    } while (_again);
  }

  Future<void> _push() async {
    while (true) {
      final batch =
          await (db.select(db.outbox)
                ..orderBy([(o) => OrderingTerm.asc(o.createdAt), (o) => OrderingTerm.asc(o.hlc)])
                ..limit(500))
              .get();
      if (batch.isEmpty) return;
      final res = await api.post<Map<String, dynamic>>('/sync/push', {
        'mutations': [
          for (final m in batch)
            {
              'mutationId': m.mutationId,
              'entity': m.entity,
              'entityId': m.entityId,
              'op': m.op,
              'fields': jsonDecode(m.fields),
              'hlc': m.hlc,
            },
        ],
      });
      hlc.receive(res['hlc'] as String);
      final done = <String>{for (final a in res['applied'] as List) (a as Map)['mutationId'] as String};
      final byId = {for (final m in batch) m.mutationId: m};
      for (final r in res['rejected'] as List) {
        final id = (r as Map)['mutationId'] as String;
        done.add(id);
        final m = byId[id];
        if (m != null) _rejections.add(Rejection(id, m.entity, m.entityId, r['reason'] as String));
      }
      await (db.delete(db.outbox)..where((o) => o.mutationId.isIn(done))).go();
      if (done.length < batch.length) return; // server kept some back; try again next sync
    }
  }

  /// Pull only — what a `sync.changed` nudge needs when nothing is pending; exposed for tests.
  @visibleForTesting
  Future<void> pullOnly() => _pull();

  Future<void> _pull() async {
    var hasMore = true;
    while (hasMore) {
      final cursor = await db.getMeta(_cursorKey);
      final res = await api.get<Map<String, dynamic>>('/sync/pull', query: {'cursor': ?cursor});
      final changes = res['changes'] as List;
      await db.transaction(() async {
        for (final c in changes.cast<Map<String, dynamic>>()) {
          final entity = c['entity'] as String;
          final id = c['entityId'] as String;
          final pending =
              await (db.select(db.outbox)
                    ..where((o) => o.entity.equals(entity) & o.entityId.equals(id))
                    ..orderBy([(o) => OrderingTerm.asc(o.hlc)]))
                  .get();
          if (c['op'] == 'delete') {
            await _put(entity, id, {'id': id}, deleted: true);
            continue;
          }
          // server copy, then this device's not-yet-acknowledged edits on top
          final data = Map<String, dynamic>.from(c['data'] as Map);
          var deleted = false;
          for (final p in pending) {
            if (p.op == 'delete') {
              deleted = true;
            } else {
              data.addAll(jsonDecode(p.fields) as Map<String, dynamic>);
            }
          }
          await _put(entity, id, data, deleted: deleted);
        }
        await db.setMeta(_cursorKey, res['cursor'] as String);
      });
      hasMore = res['hasMore'] as bool;
    }
  }

  // ------------------------------------------------------------------ helpers

  Future<LocalRecord?> _row(String entity, String id) =>
      (db.select(db.records)..where((r) => r.entity.equals(entity) & r.entityId.equals(id))).getSingleOrNull();

  Future<void> _put(String entity, String id, Map<String, dynamic> data, {required bool deleted}) => db
      .into(db.records)
      .insertOnConflictUpdate(
        RecordsCompanion.insert(
          entity: entity,
          entityId: id,
          data: jsonEncode(data),
          deleted: Value(deleted),
          updatedAt: DateTime.now(),
        ),
      );

  static Map<String, dynamic> _decode(LocalRecord r) => jsonDecode(r.data) as Map<String, dynamic>;

  Future<void> dispose() => _rejections.close();
}

extension<T> on T {
  R let<R>(R Function(T) f) => f(this);
}
