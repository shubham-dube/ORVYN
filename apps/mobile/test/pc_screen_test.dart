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
    expect(tester.takeException(), isNull);
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await wait();
    await tester.pumpWidget(const SizedBox());
    await tester.pump(const Duration(seconds: 40));
  });
}
