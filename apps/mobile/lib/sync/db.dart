import 'package:drift/drift.dart';

part 'db.g.dart';

/// The local mirror of the person's synced data. Every module's rows live here as JSON, keyed by
/// (entity, id), so a new module needs no client migration to start syncing.
@DataClassName('LocalRecord')
class Records extends Table {
  TextColumn get entity => text()();
  TextColumn get entityId => text()();
  TextColumn get data => text()(); // JSON object
  BoolColumn get deleted => boolean().withDefault(const Constant(false))();
  DateTimeColumn get updatedAt => dateTime()();

  @override
  Set<Column<Object>> get primaryKey => {entity, entityId};
}

/// Changes made on this device that the server has not acknowledged yet.
@DataClassName('PendingMutation')
class Outbox extends Table {
  TextColumn get mutationId => text()();
  TextColumn get entity => text()();
  TextColumn get entityId => text()();
  TextColumn get op => text()(); // upsert | delete
  TextColumn get fields => text()(); // JSON object
  TextColumn get hlc => text()();
  DateTimeColumn get createdAt => dateTime()();
  IntColumn get attempts => integer().withDefault(const Constant(0))();

  @override
  Set<Column<Object>> get primaryKey => {mutationId};
}

class Meta extends Table {
  TextColumn get key => text()();
  TextColumn get value => text()();

  @override
  Set<Column<Object>> get primaryKey => {key};
}

@DriftDatabase(tables: [Records, Outbox, Meta])
class LocalDb extends _$LocalDb {
  LocalDb(super.e);

  @override
  int get schemaVersion => 1;

  Future<String?> getMeta(String key) async =>
      (await (select(meta)..where((m) => m.key.equals(key))).getSingleOrNull())?.value;

  Future<void> setMeta(String key, String value) =>
      into(meta).insertOnConflictUpdate(MetaCompanion.insert(key: key, value: value));

  /// Forget everything — sign-out on this device.
  Future<void> wipe() => transaction(() async {
    await delete(records).go();
    await delete(outbox).go();
    await delete(meta).go();
  });
}
