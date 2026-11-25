import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:orvyn/chat/chat_crypto.dart' show b64, unb64;
import 'package:orvyn/core/session_store.dart';
import 'package:orvyn/pc/pc.dart';
import 'package:orvyn/pc/pc_crypto.dart';

/// A PC at the other end (the real one is apps/desktop/src-tauri/src/pc).
class FakePc {
  FakePc() {
    link = PcLink(
      pair,
      send: (f) {
        if (online) sent.add(f);
        return online;
      },
      messages: wire.stream,
      deviceName: 'Pixel',
      output: (id, text, reset) => out.add('$id:$text:$reset'),
      opened: (_) {},
      problem: (_) {},
    );
  }
  static final pair = PcPairing(id: 'pair-aaaaaaaaaaa', key: unb64(b64(List.filled(32, 7))), name: 'PC');
  final wire = StreamController<Map<String, dynamic>>.broadcast(sync: true);
  final sent = <Map<String, dynamic>>[];
  final out = <String>[];
  bool online = true;
  late final PcLink link;
  late PcChannel chan;
  int _seen = 0;

  String get s => sent.lastWhere((f) => (f['d'] as String).startsWith('o.'))['s'] as String;
  void raw(String d, {String from = 'pc'}) => wire.add({'type': 'pc', 'from': from, 's': s, 'd': d});
  void answer([String half = 'HALF']) {
    chan = PcChannel(pair.key, '$s.$half', me: 'p');
    raw('r.$half');
  }

  Future<void> say(Map<String, dynamic> m) async {
    await chan.seal(jsonEncode(m), raw);
    await settle();
  }

  Future<void> settle() => Future<void>.delayed(const Duration(milliseconds: 60));

  /// What it asked since last time.
  Future<List<Map<String, dynamic>>> asked() async {
    await settle();
    final all = <Map<String, dynamic>>[];
    for (final f in sent.sublist(_seen).where((f) => (f['d'] as String).startsWith('m.'))) {
      await chan.open(
        f['d'] as String,
        (p) => all.add(jsonDecode(p) as Map<String, dynamic>),
        () => fail('not the next message'),
      );
    }
    _seen = sent.length;
    return all;
  }
}

const hello = {
  't': 'hello',
  'pc': 'PC',
  'shells': [
    {'id': 'pwsh', 'name': 'PowerShell'},
  ],
  'terms': [
    {'id': 't1', 'name': 'PowerShell', 'since': 0, 'exit': null},
  ],
};

void main() {
  final v = jsonDecode(
    File('../../packages/vault-crypto/fixtures/pc-vectors.json').readAsStringSync(),
  ) as Map<String, dynamic>;

  test('the same bytes as the PC and the browser', () async {
    final key = unb64(v['key'] as String);
    for (final m in (v['messages'] as List).cast<Map<String, dynamic>>()) {
      expect(
        await pcSeal(
          key,
          v['sid'] as String,
          m['dir'] as String,
          m['n'] as int,
          m['plain'] as String,
          nonce: unb64(v['nonce'] as String),
        ),
        m['frame'],
      );
    }
    final want = v['pairing'] as Map<String, dynamic>;
    final p = PcPairing.read('https://orvyn.dubey.app/pc#${want['text']}')!;
    expect(p.toJson(), {'id': want['id'], 'key': v['key'], 'name': want['name']});
    expect(PcPairing.read('hello'), isNull);
  });

  test('refuses changed, repeated, reordered, reflected messages and those of another session', () async {
    final key = unb64(v['key'] as String);
    final phone = PcChannel(key, 's1');
    final pc = PcChannel(key, 's1', me: 'p');
    late String a, b;
    await phone.seal('a', (f) => a = f);
    await phone.seal('b', (f) => b = f);
    Future<String?> open(PcChannel c, String f) async {
      String? got;
      await c.open(f, (p) => got = p, () {});
      return got;
    }

    final at = a.length - 10;
    expect(await open(pc, b), isNull);
    expect(await open(pc, a.replaceRange(at, at + 1, a[at] == 'A' ? 'B' : 'A')), isNull);
    expect(await open(phone, a), isNull);
    expect(await open(PcChannel(key, 's2', me: 'p'), a), isNull);
    expect(await open(pc, a), 'a');
    expect(await open(pc, a), isNull);
    expect(await open(pc, b), 'b');
  });

  test('PIN only encrypted, only to the PC; then goes on where it was after the network drops', () async {
    final t = FakePc()..link.connect();
    expect(t.sent.single['to'], isNull);
    t.answer();
    expect(t.link.status, PcStatus.pin);
    t.link.enterPin('826193');
    expect(await t.asked(), [
      {'t': 'auth', 'pin': '826193', 'name': 'Pixel'},
    ]);
    expect(t.sent.last['to'], 'pc');
    expect(jsonEncode(t.sent), isNot(contains('826193')));
    await t.say({'t': 'badpin', 'left': 4});
    expect((t.link.status, t.link.left), (PcStatus.pin, 4));
    t.link.enterPin('826194');
    await t.asked();
    await t.say(hello);
    expect(t.link.status, PcStatus.open);
    t.link.attach('t1', 50, 30);
    await t.say({'t': 'out', 'id': 't1', 'd': 'abc', 'end': 3, 'reset': false});
    expect(t.out, ['t1:abc:false']);
    expect(await t.asked(), [
      {'t': 'attach', 'id': 't1', 'cols': 50, 'rows': 30, 'from': 0},
      {'t': 'ack', 'id': 't1', 'end': 3},
    ]);
    t.wire.add({'type': 'hello'}); // a new connection to the server
    expect(t.link.status, PcStatus.finding);
    expect(t.link.type('t1', 'lost?'), isFalse); // never typed later by surprise
    t.answer('NEW');
    await t.say(hello);
    expect(await t.asked(), [
      {'t': 'auth', 'pin': '826194', 'name': 'Pixel'},
      {'t': 'attach', 'id': 't1', 'cols': 50, 'rows': 30, 'from': 3},
    ]);
    t.link.dispose();
  });

  test('starts again on a repeated message; stays out when idle; ignores another device', () async {
    final t = FakePc()..link.connect();
    t.answer();
    t.link.enterPin('x');
    await t.asked();
    await t.say(hello);
    t.raw('x.off', from: 'someone-else');
    await t.settle();
    expect(t.link.status, PcStatus.open);
    await t.chan.seal('{"t":"pong"}', (f) {
      t
        ..raw(f)
        ..raw(f);
    });
    await t.settle();
    expect(t.link.status, PcStatus.finding);
    await Future<void>.delayed(const Duration(milliseconds: 400));
    t.answer('B');
    await t.asked();
    await t.say({'t': 'end', 'why': 'idle'});
    expect(t.link.status, PcStatus.idle);
    t.wire.add({'type': 'hello'});
    expect(t.link.status, PcStatus.idle);
    t.link.dispose();
  });

  test('pairings are kept, replaced and forgotten', () async {
    final store = MemorySessionStore();
    final p = PcPairings(store);
    await p.add(FakePc.pair);
    await p.add(FakePc.pair);
    expect((await p.list()).map((x) => x.name), ['PC']);
    await p.remove(FakePc.pair.id);
    expect(await store.read(pcPairingsKey), isNull);
  });
}
