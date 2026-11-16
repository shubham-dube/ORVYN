import 'package:flutter_test/flutter_test.dart';
import 'package:orvyn/core/push.dart';

class FakeShade implements NotificationShade {
  final shown = <ShowPush>[];
  final cancelled = <String>[];
  @override
  Future<void> show(ShowPush p) async => shown.add(p);
  @override
  Future<void> cancel(String id) async => cancelled.add(id);
}

void main() {
  test('an FCM notify message (all strings) becomes one notification with its actions', () async {
    final shade = FakeShade();
    // exactly what apps/api push-sender.ts sends: non-strings JSON-encoded
    await handlePush({
      'type': 'notify',
      'id': 'n1',
      'title': 'Pay rent',
      'body': 'Due today',
      'url': '/today',
      'module': 'money',
      'priority': 'high',
      'actions': '[{"id":"done","label":"Done"},{"id":"open","label":"Open","open":"/money"}]',
    }, shade);
    final p = shade.shown.single;
    expect([p.title, p.body, p.url, p.module, p.priority], ['Pay rent', 'Due today', '/today', 'money', 'high']);
    expect(p.actions.map((a) => a.label), ['Done', 'Open']);
    expect(p.actions.last.open, '/money');
  });

  test('null url arrives as the string "null" and is treated as none', () async {
    final shade = FakeShade();
    await handlePush({'type': 'notify', 'id': 'n2', 'title': 'Hi', 'url': 'null', 'actions': 'null'}, shade);
    expect(shade.shown.single.url, isNull);
    expect(shade.shown.single.actions, isEmpty);
  });

  test('dismiss or read elsewhere removes it from this phone', () async {
    final shade = FakeShade();
    await handlePush({'type': 'dismiss', 'id': 'n1'}, shade);
    await handlePush({'type': 'read', 'id': 'n2'}, shade);
    expect(shade.cancelled, ['n1', 'n2']);
  });

  test('unknown or malformed messages are ignored', () async {
    final shade = FakeShade();
    await handlePush({'type': 'something-new', 'id': 'x'}, shade);
    await handlePush({'type': 'notify'}, shade);
    expect(shade.shown, isEmpty);
    expect(shade.cancelled, isEmpty);
  });

  test('notification ids are stable 31-bit ints', () {
    const id = '0190a3c2-7b1e-7cc0-9f00-123456789abc';
    expect(notificationIntId(id), notificationIntId(id));
    expect(notificationIntId(id), inInclusiveRange(0, 0x7fffffff));
    expect(notificationIntId(id), isNot(notificationIntId('0190a3c2-7b1e-7cc0-9f00-123456789abd')));
  });
}
