import 'dart:async';

import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:drift/native.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:orvyn/app/calendar.dart';
import 'package:orvyn/app/home_widget.dart';
import 'package:orvyn/money/capture.dart';
import 'package:orvyn/drop/drop.dart';
import 'package:orvyn/app/app.dart';
import 'package:orvyn/app/lock.dart';
import 'package:orvyn/app/state.dart';
import 'package:orvyn/core/api.dart';
import 'package:orvyn/core/push.dart';
import 'package:orvyn/core/session_store.dart';
import 'package:orvyn/sync/db.dart';

import 'fake_server.dart';
import 'fake_socket.dart';

const ownerId = '00000000-0000-4000-8000-0000000000aa';
const deviceId = '00000000-0000-4000-8000-0000000000dd';

Map<String, dynamic> userJson({String role = 'member', List<String> ent = const ['today'], String name = 'Asha Rao'}) =>
    {
      'id': ownerId,
      'email': 'asha@example.test',
      'name': name,
      'avatarUrl': null,
      'role': role,
      'entitlements': ent,
      'hasPasskey': false,
    };

Map<String, dynamic> sessionJson(
  Map<String, dynamic> user, {
  String access = 'access-1',
  String refresh = 'refresh-1',
}) => {'accessToken': access, 'expiresIn': 900, 'refreshToken': refresh, 'deviceId': deviceId, 'user': user};

Map<String, dynamic> notificationJson(String id, String title, {String body = '', String module = 'core'}) => {
  'id': id,
  'module': module,
  'kind': 'test',
  'title': title,
  'body': body,
  'url': null,
  'actions': <dynamic>[],
  'priority': 'normal',
  'createdAt': DateTime(2026, 11, 16, 9).toIso8601String(),
  'readAt': null,
  'dismissedAt': null,
};

class FakeAuthenticator implements Authenticator {
  bool ok = true;
  int prompts = 0;
  @override
  Future<bool> available() async => true;
  @override
  Future<bool> authenticate(String reason) async {
    prompts++;
    return ok;
  }
}

class RecordingPusher implements Pusher {
  final cleared = <String>[];
  final tapController = StreamController<Map<String, dynamic>>.broadcast();
  @override
  Stream<Map<String, dynamic>> get taps => tapController.stream;
  @override
  bool get ready => false;
  @override
  Future<void> init() async {}
  @override
  Future<String?> token() async => null;
  @override
  Stream<String> get tokenRefresh => const Stream.empty();
  @override
  Future<void> clear(String id) async => cleared.add(id);
}

/// The whole app over a fake API + socket, a memory store and an in-memory database.
class AppHarness {
  AppHarness() {
    driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;
    server.on('GET /notifications', (_) => {'items': <dynamic>[], 'unread': 0}); // the API's real shape
    server.on(
      'GET /notifications/settings',
      (_) => {
        'quietHours': null,
        'emailFor': ['urgent'],
        'mutedModules': <String>[],
      },
    );
    server.on(
      'GET /me/devices',
      (_) => [
        {
          'id': deviceId,
          'name': 'Pixel 8',
          'platform': 'android',
          'appVersion': '0.1.0',
          'current': true,
          'createdAt': '2026-11-01T00:00:00Z',
          'lastSeenAt': '2026-11-16T08:00:00Z',
        },
      ],
    );
    server.on('GET /sync/pull', (_) => {'changes': <dynamic>[], 'cursor': '0', 'hasMore': false});
    server.on(
      'POST /auth/refresh',
      (_) => const Reply(401, {
        'error': {'code': 'no_session', 'message': 'x'},
      }),
    );
    server.on('POST /auth/sign-out', (_) => {'ok': true});
  }

  final server = FakeServer();
  final sockets = FakeSocketServer();
  final store = MemorySessionStore();
  final db = LocalDb(NativeDatabase.memory());
  final auth = FakeAuthenticator();
  final pusher = RecordingPusher();
  DateTime now = DateTime(2026, 11, 16, 9, 30);
  final opened = <Uri>[];
  final widget = RecordingWidgetPublisher();
  final capture = FakeCaptureChannel();
  final share = FakeShareChannel();
  PickedFile? photo;
  String? spoken;
  final widgetClicks = StreamController<Uri?>.broadcast();

  /// Starts already signed in (a stored refresh token the fake server accepts).
  void signedInAs(Map<String, dynamic> user) {
    store.values['refresh'] = 'refresh-0';
    server.on('POST /auth/refresh', (_) => sessionJson(user));
    server.on('GET /me', (_) => user);
  }

  Future<void> pump(WidgetTester tester) async {
    tester.platformDispatcher.accessibilityFeaturesTestValue = const FakeAccessibilityFeatures(disableAnimations: true);
    tester.view.physicalSize = const Size(1170, 2532);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    // the app keeps live queries open at its root (home-screen widget); unmount so their timers close
    addTearDown(() => finish(tester));
    addTearDown(tester.platformDispatcher.clearAccessibilityFeaturesTestValue);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          storeProvider.overrideWithValue(store),
          apiProvider.overrideWith((ref) => Api(baseUrl: 'http://api.test', store: store, adapter: server)),
          socketConnectorProvider.overrideWithValue(sockets.connect),
          dbProvider.overrideWithValue(db),
          pusherProvider.overrideWithValue(pusher),
          authenticatorProvider.overrideWithValue(auth),
          clockProvider.overrideWithValue(() => now),
          widgetPublisherProvider.overrideWithValue(widget),
          captureChannelProvider.overrideWithValue(capture),
          shareChannelProvider.overrideWithValue(share),
          photoPickerProvider.overrideWithValue(({required bool camera}) async => photo),
          speechProvider.overrideWithValue(FakeSpeech(() => spoken)),
          widgetClicksProvider.overrideWithValue(widgetClicks.stream),
          urlOpenerProvider.overrideWithValue((u) async {
            opened.add(u);
            return true;
          }),
        ],
        child: const OrvynApp(),
      ),
    );
    await settle(tester);
  }
}

/// Infinite animations (aurora, orb) never "settle"; pump enough real frames for async work instead.
Future<void> settle(WidgetTester tester, [int frames = 12]) async {
  for (var i = 0; i < frames; i++) {
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 5)));
    await tester.pump(const Duration(milliseconds: 50));
  }
}

/// Debug aid: every visible text.
List<String?> texts(WidgetTester t) => [for (final e in find.byType(Text).evaluate()) (e.widget as Text).data];

/// Unmount inside the test so drift's live queries close (their cleanup timers must finish before the test ends).
Future<void> finish(WidgetTester tester) async {
  await tester.pumpWidget(const SizedBox());
  await tester.pump(const Duration(milliseconds: 10));
}

class RecordingWidgetPublisher implements WidgetPublisher {
  final snapshots = <Map<String, dynamic>>[];
  Map<String, dynamic>? get last => snapshots.isEmpty ? null : snapshots.last;
  @override
  Future<void> publish(Map<String, dynamic> snapshot) async => snapshots.add(snapshot);
}

/// Stands in for MoneyListener.kt: a queue of kept notifications, the access switch, "arrived" pings.
class FakeCaptureChannel implements CaptureChannel {
  bool on = false;
  int settingsOpened = 0;
  final items = <Captured>[];
  final _arrived = StreamController<void>.broadcast();
  void deliver(Captured c) {
    items.add(c);
    _arrived.add(null);
  }

  @override
  Stream<void> get arrived => _arrived.stream;
  @override
  Future<bool> enabled() async => on;
  @override
  Future<void> openSettings() async => settingsOpened++;
  @override
  Future<List<Captured>> pending() async => [...items];
  @override
  Future<void> ack(int count) async => items.removeRange(0, count.clamp(0, items.length));
}

class FakeShareChannel implements ShareChannel {
  Shared? next;
  final _arrived = StreamController<void>.broadcast();
  void deliver(Shared s) {
    next = s;
    _arrived.add(null);
  }

  @override
  Stream<void> get arrived => _arrived.stream;
  @override
  Future<Shared?> take() async {
    final s = next;
    next = null;
    return s;
  }
}

class FakeSpeech implements Speech {
  FakeSpeech(this.words);
  final String? Function() words;
  @override
  Future<String?> listen() async => words();
}
