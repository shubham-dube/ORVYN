import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/actions.dart';
import '../core/models.dart';
import 'state.dart';

/// The live notification list: loaded on sign-in, kept current by the socket. Reading or dismissing here
/// clears it on every other device (and vice versa).
final notificationsProvider = NotifierProvider<NotificationsController, List<NotificationView>>(
  NotificationsController.new,
);

/// New arrivals while the app is open, for the edge-glow toast.
final arrivalsProvider = Provider<StreamController<NotificationView>>((ref) {
  final c = StreamController<NotificationView>.broadcast();
  ref.onDispose(c.close);
  return c;
});

class NotificationsController extends Notifier<List<NotificationView>> {
  StreamSubscription<Map<String, dynamic>>? _sub;

  @override
  List<NotificationView> build() {
    final session = ref.watch(sessionProvider);
    ref.onDispose(() => _sub?.cancel());
    if (session is! SignedIn) return const [];
    _sub = ref.read(realtimeProvider).messages.listen(_onMessage);
    unawaited(load());
    return const [];
  }

  int get unread => state.where((n) => n.readAt == null).length;

  Future<void> load() async {
    try {
      final res = await ref.read(apiProvider).get<Map<String, dynamic>>('/notifications');
      state = [for (final j in res['items'] as List<dynamic>) NotificationView.fromJson(j as Map<String, dynamic>)];
    } catch (_) {
      // offline: keep what we have
    }
  }

  void _onMessage(Map<String, dynamic> m) {
    switch (m['type']) {
      case 'notify.new':
        final n = NotificationView.fromJson(m['notification'] as Map<String, dynamic>);
        if (state.any((x) => x.id == n.id)) return;
        state = [n, ...state];
        ref.read(arrivalsProvider).add(n);
      case 'notify.read':
        state = [for (final n in state) n.id == m['id'] ? n.markRead() : n];
        unawaited(ref.read(pusherProvider).clear(m['id'] as String));
      case 'notify.dismissed':
        state = state.where((n) => n.id != m['id']).toList();
        unawaited(ref.read(pusherProvider).clear(m['id'] as String));
    }
  }

  Future<void> markRead(String id) async {
    state = [for (final n in state) n.id == id ? n.markRead() : n];
    await ref.read(apiProvider).post<dynamic>('/notifications/$id/read');
  }

  Future<void> dismiss(String id) async {
    final before = state;
    state = state.where((n) => n.id != id).toList();
    try {
      await ref.read(apiProvider).post<dynamic>('/notifications/$id/dismiss');
      await ref.read(pusherProvider).clear(id);
    } catch (_) {
      state = before;
      rethrow;
    }
  }

  Future<void> dismissAll() async {
    final ids = [for (final n in state) n.id];
    state = const [];
    await ref.read(apiProvider).post<dynamic>('/notifications/dismiss-all');
    for (final id in ids) {
      await ref.read(pusherProvider).clear(id);
    }
  }

  /// Press an action (Done, Snooze 10 min, …): the server does it and clears it on every device.
  Future<bool> act(String id, String actionId, {String? text}) async {
    final before = state;
    state = state.where((n) => n.id != id).toList();
    final ok = await runNotificationAction(ref.read(apiProvider), id, actionId, text: text);
    if (ok) {
      await ref.read(pusherProvider).clear(id);
    } else {
      state = before;
    }
    return ok;
  }

  Future<void> sendTest() => ref.read(apiProvider).post<dynamic>('/notifications/test');
}
