/// Dart mirrors of `packages/contracts` payloads the app reads.
library;

import 'dart:convert';

class Me {
  const Me({
    required this.id,
    required this.email,
    required this.name,
    required this.avatarUrl,
    required this.role,
    required this.entitlements,
    required this.hasPasskey,
  });

  factory Me.fromJson(Map<String, dynamic> j) => Me(
    id: j['id'] as String,
    email: j['email'] as String,
    name: (j['name'] as String?) ?? '',
    avatarUrl: j['avatarUrl'] as String?,
    role: j['role'] as String,
    entitlements: [for (final e in (j['entitlements'] as List? ?? const [])) e as String],
    hasPasskey: (j['hasPasskey'] as bool?) ?? false,
  );

  final String id;
  final String email;
  final String name;
  final String? avatarUrl;
  final String role;
  final List<String> entitlements;
  final bool hasPasskey;

  bool get isOwner => role == 'owner';
  bool can(String key) => isOwner || entitlements.contains(key);

  Me copyWith({String? name, List<String>? entitlements}) => Me(
    id: id,
    email: email,
    name: name ?? this.name,
    avatarUrl: avatarUrl,
    role: role,
    entitlements: entitlements ?? this.entitlements,
    hasPasskey: hasPasskey,
  );
}

class SessionResponse {
  const SessionResponse({
    required this.accessToken,
    required this.expiresIn,
    required this.refreshToken,
    required this.deviceId,
    required this.user,
  });

  factory SessionResponse.fromJson(Map<String, dynamic> j) => SessionResponse(
    accessToken: j['accessToken'] as String,
    expiresIn: (j['expiresIn'] as num).toInt(),
    refreshToken: j['refreshToken'] as String?,
    deviceId: j['deviceId'] as String,
    user: Me.fromJson(j['user'] as Map<String, dynamic>),
  );

  final String accessToken;
  final int expiresIn;
  final String? refreshToken;
  final String deviceId;
  final Me user;
}

class DeviceView {
  const DeviceView({
    required this.id,
    required this.name,
    required this.platform,
    required this.current,
    required this.lastSeenAt,
  });

  factory DeviceView.fromJson(Map<String, dynamic> j) => DeviceView(
    id: j['id'] as String,
    name: j['name'] as String,
    platform: j['platform'] as String,
    current: (j['current'] as bool?) ?? false,
    lastSeenAt: DateTime.parse(j['lastSeenAt'] as String),
  );

  final String id;
  final String name;
  final String platform;
  final bool current;
  final DateTime lastSeenAt;
}

class NotificationAction {
  const NotificationAction(this.id, this.label, this.open, {this.reply});
  factory NotificationAction.fromJson(Map<String, dynamic> j) => NotificationAction(
    j['id'] as String,
    j['label'] as String,
    j['open'] as String?,
    reply: (j['reply'] as Map?)?['placeholder'] as String?,
  );
  final String id;
  final String label;
  final String? open;

  /// a typed answer goes with it (the placeholder to show), e.g. "food · split 3 · not mine"
  final String? reply;
}

class NotificationView {
  const NotificationView({
    required this.id,
    required this.module,
    required this.kind,
    required this.title,
    required this.body,
    required this.url,
    required this.actions,
    required this.priority,
    required this.createdAt,
    required this.readAt,
    this.silent = false,
  });

  factory NotificationView.fromJson(Map<String, dynamic> j) => NotificationView(
    id: j['id'] as String,
    module: j['module'] as String,
    kind: j['kind'] as String,
    title: j['title'] as String,
    body: (j['body'] as String?) ?? '',
    url: j['url'] as String?,
    actions: [
      for (final a in (j['actions'] as List? ?? const [])) NotificationAction.fromJson(a as Map<String, dynamic>),
    ],
    priority: (j['priority'] as String?) ?? 'normal',
    silent: j['silent'] == true,
    createdAt: DateTime.parse(j['createdAt'] as String),
    readAt: j['readAt'] == null ? null : DateTime.parse(j['readAt'] as String),
  );

  final String id;
  final String module;
  final String kind;
  final String title;
  final String body;
  final String? url;
  final List<NotificationAction> actions;
  final String priority;
  final DateTime createdAt;
  final DateTime? readAt;

  /// in the inbox only: nothing pops up
  final bool silent;

  NotificationView markRead() => NotificationView(
    id: id,
    module: module,
    kind: kind,
    title: title,
    body: body,
    url: url,
    actions: actions,
    priority: priority,
    createdAt: createdAt,
    readAt: readAt ?? DateTime.now(),
  );
}

const moduleKeys = ['today', 'drop', 'money', 'library', 'vault', 'assistant', 'chat', 'ipo', 'jobs'];

String jsonEncodeMe(Me m) => jsonEncode({
  'id': m.id,
  'email': m.email,
  'name': m.name,
  'avatarUrl': m.avatarUrl,
  'role': m.role,
  'entitlements': m.entitlements,
  'hasPasskey': m.hasPasskey,
});

Map<String, dynamic> jsonDecodeMap(String s) => jsonDecode(s) as Map<String, dynamic>;
