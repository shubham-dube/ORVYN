import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:kterm/kterm.dart';
import 'package:material_ui/material_ui.dart';
import 'package:orvyn/chat/chat_crypto.dart' show b64;
import 'package:orvyn/pc/pc_crypto.dart';

import 'support/harness.dart';

void main() {
  testWidgets('My PC: paste the code, PIN, a live terminal with keys', (tester) async {
    final h = AppHarness()..signedInAs(userJson(ent: const ['today', 'pc']));
    await h.pump(tester);
    final key = List.filled(32, 9);
    final id = b64(List.filled(12, 5));
    late PcChannel chan;
    late Map<String, dynamic> at;
    var typed = '';
    final inputs = <Map<String, dynamic>>[];
    // a 1×1 PNG
    final pixel = base64.decode(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    );
    var end = 0;
    void push(String d) => h.sockets.push({'type': 'pc', 'from': 'pc', 's': at['s'], 'd': d});
    Future<void> say(Map<String, dynamic> m) => chan.seal(jsonEncode(m), push);
    Future<void> out(String d) {
      end += d.length;
      return say({'t': 'out', 'id': 't1', 'd': d, 'end': end, 'reset': false});
    }

    h.sockets.last.sent.stream.listen((raw) {
      final f = jsonDecode(raw as String) as Map<String, dynamic>;
      if (f['type'] != 'pc') return;
      if (f['d'] == 'o.$id') {
        at = f;
        chan = PcChannel(key, '${f['s']}.half', me: 'p');
        push('r.half');
        return;
      }
      chan.open(f['d'] as String, (p) {
        final m = jsonDecode(p) as Map<String, dynamic>;
        switch (m['t']) {
          case 'auth':
            say(
              m['pin'] == 'a right pin'
                  ? {
                      't': 'hello',
                      'pc': 'PC',
                      'shells': [
                        {'id': 'pwsh', 'name': 'PowerShell'},
                      ],
                      'terms': <dynamic>[],
                    }
                  : {'t': 'badpin', 'left': 4},
            );
          case 'new':
            say({
              't': 'opened',
              'id': 't1',
              'terms': [
                {'id': 't1', 'name': 'PowerShell', 'since': 0, 'exit': null},
              ],
            });
          case 'attach':
            out('PS C:> \x1b[6n'); // a question the PC has answered already
          case 'deck':
            say({
              't': 'deck',
              'sound': {'volume': 40, 'muted': false},
            });
          case 'files':
            say({
              't': 'files',
              'path': r'C:\Users\me',
              'parent': null,
              'cut': false,
              'list': [
                {'name': 'notes.txt', 'path': r'C:\Users\me\notes.txt', 'dir': false, 'size': 5},
              ],
            });
          case 'places':
            say({
              't': 'places',
              'list': [
                {'name': 'Downloads', 'path': r'C:\Users\me\Downloads', 'dir': true, 'size': 0},
              ],
            });
          case 'live' when m['on'] == true:
            say({'t': 'blob', 'id': 7, 'name': 'live.jpg', 'size': pixel.length, 'part': 24576});
            say({'t': 'part', 'id': 7, 'n': 0, 'd': b64(pixel)});
          case 'input':
            inputs.add(m);
          case 'in':
            typed += m['d'] as String;
        }
      }, () => fail('not the next message'));
    });

    // the cipher is real, so let real time pass between frames
    Future<void> wait() async {
      for (var i = 0; i < 6; i++) {
        await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 30)));
        await tester.pump(const Duration(milliseconds: 60));
      }
    }

    GoRouter.of(tester.element(find.byType(Scaffold).first)).go('/pc');
    await wait();
    await tester.enterText(find.byType(TextField).first, 'nonsense');
    await tester.tap(find.text('Pair'));
    await wait();
    expect(find.textContaining('isn’t a pairing code'), findsOneWidget);
    await tester.enterText(find.byType(TextField).first, 'ORVYN-PC1.$id.${b64(key)}.${b64(utf8.encode('Study PC'))}');
    await tester.tap(find.text('Pair'));
    await wait();
    expect(find.text('Study PC'), findsOneWidget);
    await tester.enterText(find.byType(TextField).first, 'wrong');
    await tester.tap(find.text('Open'));
    await wait();
    expect(find.text('Wrong PIN. 4 tries left.'), findsOneWidget);
    await tester.enterText(find.byType(TextField).first, 'a right pin');
    await tester.tap(find.text('Open'));
    await wait();
    expect(find.text('Live · encrypted'), findsOneWidget);
    await tester.tap(find.text('PowerShell'));
    await wait();
    final view = tester.widget<TerminalView>(find.byType(TerminalView));
    expect(view.terminal.buffer.getText(), contains('PS C:>'));
    expect(typed, ''); // the terminal's own answer stayed here
    view.terminal.textInput('dir');
    await tester.tap(find.text('Ctrl C'));
    await tester.tap(find.text('Ctrl'));
    await wait();
    view.terminal.textInput('d');
    await wait();
    expect(typed, 'dir\x03\x04');
    // a suggestion runs only when Run is pressed (AC7)
    h.server.on('POST /pc/suggest', (_) => {'command': 'Get-Date', 'why': 'Shows the time', 'careful': true});
    typed = '';
    await tester.tap(find.text('Say it'));
    await wait();
    await tester.enterText(find.byType(TextField).first, 'what time is it');
    await tester.tap(find.text('Suggest'));
    await wait();
    expect(find.text('Changes things: read it first.'), findsOneWidget);
    expect(typed, '');
    await tester.ensureVisible(find.text('Run'));
    await tester.tap(find.text('Run'));
    await wait();
    expect(typed, 'Get-Date\r');
    await tester.tap(find.text('Deck'));
    await wait();
    // the screen live: a tap is a click where it was tapped
    await tester.tap(find.text('Show the screen live'));
    await wait();
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 200)));
    await wait();
    expect(find.bySemanticsLabel('The PC’s screen, live'), findsOneWidget);
    final r = tester.getRect(find.byType(Image).first);
    await tester.tapAt(r.topLeft + Offset(r.width * 0.25, r.height * 0.75));
    await tester.pump(const Duration(milliseconds: 400)); // past a double tap
    await wait();
    final click = inputs.firstWhere((i) => i['k'] == 'click');
    expect((click['x'] as num).toDouble(), closeTo(0.25, 0.05));
    expect((click['y'] as num).toDouble(), closeTo(0.75, 0.05));
    await tester.ensureVisible(find.text('Ctrl+C'));
    await tester.tap(find.text('Ctrl+C'));
    await wait();
    expect(inputs.any((i) => i['k'] == 'key' && i['key'] == 'ctrl+c'), isTrue);
    await tester.tap(find.text('Controls'));
    await wait();
    expect(find.text('Mute'), findsOneWidget);
    await tester.tap(find.text('Files'));
    await wait();
    expect(find.text('Downloads'), findsWidgets);
    expect(find.text('notes.txt', skipOffstage: false), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await wait();
    await tester.pumpWidget(const SizedBox());
    await tester.pump(const Duration(seconds: 40));
  });
}
