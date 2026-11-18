import 'dart:convert';

/// What a push data message asks the phone to do. Mirrors `PushPayload` in apps/api/src/modules/notify.
sealed class PushCommand {
  const PushCommand(this.id);
  final String id;

  static PushCommand? parse(Map<String, dynamic> data) {
    final id = data['id'] as String?;
    if (id == null) return null;
    return switch (data['type']) {
      'notify' => ShowPush(
        id: id,
        title: (data['title'] as String?) ?? 'ORVYN',
        body: (data['body'] as String?) ?? '',
        url: _nullable(data['url']),
        module: (data['module'] as String?) ?? 'core',
        priority: (data['priority'] as String?) ?? 'normal',
        alarm: data['alarm'] == true || data['alarm'] == 'true',
        actions: [
          for (final a in _list(data['actions']))
            PushAction(a['id'] as String, a['label'] as String, a['open'] as String?),
        ],
      ),
      'dismiss' || 'read' => ClearPush(id),
      _ => null,
    };
  }

  // FCM data values are strings; non-string fields arrive JSON-encoded
  static String? _nullable(Object? v) => v == null || v == 'null' ? null : v as String;
  static List<Map<String, dynamic>> _list(Object? v) {
    if (v == null || v == 'null') return const [];
    final raw = v is String ? jsonDecode(v) : v;
    return [for (final a in raw as List) Map<String, dynamic>.from(a as Map)];
  }
}

class PushAction {
  const PushAction(this.id, this.label, this.open);
  final String id;
  final String label;
  final String? open;
}

class ShowPush extends PushCommand {
  const ShowPush({
    required String id,
    required this.title,
    required this.body,
    required this.url,
    required this.module,
    required this.priority,
    required this.actions,
    this.alarm = false,
  }) : super(id);
  final String title;
  final String body;
  final String? url;
  final String module;
  final String priority;
  final List<PushAction> actions;

  /// rings like an alarm (D22)
  final bool alarm;
}

class ClearPush extends PushCommand {
  const ClearPush(super.id);
}

/// Stable 31-bit id for Android's notification manager (FNV-1a), the same in every isolate and app run.
int notificationIntId(String id) {
  var h = 0x811c9dc5;
  for (final c in id.codeUnits) {
    h ^= c;
    h = (h * 0x01000193) & 0xffffffff;
  }
  return h & 0x7fffffff;
}

/// The phone's notification shade, behind an interface so the logic is testable.
abstract interface class NotificationShade {
  Future<void> show(ShowPush p);
  Future<void> cancel(String id);
}

/// One notification per ORVYN notification; a dismiss or read anywhere removes it here too.
Future<void> handlePush(Map<String, dynamic> data, NotificationShade shade) async {
  switch (PushCommand.parse(data)) {
    case final ShowPush p:
      await shade.show(p);
    case final ClearPush c:
      await shade.cancel(c.id);
    case null:
      break;
  }
}

/// Device push (FCM on Android). Tests and unconfigured builds use [NoPush].
abstract interface class Pusher {
  bool get ready;

  /// Taps on this phone's notifications while the app runs: {id, url, action}
  Stream<Map<String, dynamic>> get taps;
  Future<void> init();
  Future<String?> token();
  Stream<String> get tokenRefresh;
  Future<void> clear(String id);
}

class NoPush implements Pusher {
  const NoPush();
  @override
  bool get ready => false;
  @override
  Stream<Map<String, dynamic>> get taps => const Stream.empty();
  @override
  Future<void> init() async {}
  @override
  Future<String?> token() async => null;
  @override
  Stream<String> get tokenRefresh => const Stream.empty();
  @override
  Future<void> clear(String id) async {}
}
