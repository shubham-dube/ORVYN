import 'dart:async';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:orvyn/core/files.dart';

import 'calendar_screen_test.dart' show tapIt;
import 'support/fake_server.dart';
import 'support/harness.dart';

class FakeRecorder implements VoiceRecorder {
  bool allowed = true;
  bool started = false;
  final levels = StreamController<double>.broadcast();
  @override
  Future<bool> start() async => started = allowed;
  @override
  Future<LocalFile?> stop() async {
    started = false;
    return (bytes: Uint8List.fromList(List.filled(2000, 7)), name: 'voice-2026-11-16-0930.m4a', mime: 'audio/mp4');
  }

  @override
  Stream<double> get level => levels.stream;
}

void main() {
  testWidgets('Drop: record, keep, then play a voice note; attach any file', (tester) async {
    final rec = FakeRecorder();
    final opened = <(String, String)>[];
    final h = AppHarness()
      ..signedInAs(userJson(ent: ['drop', 'library']))
      ..extraOverrides.addAll([
        voiceRecorderProvider.overrideWithValue(rec),
        anyFilePickerProvider.overrideWithValue(
          () async => (bytes: Uint8List.fromList([1, 2, 3]), name: 'budget.xlsx', mime: mimeFromName('budget.xlsx')),
        ),
        externalOpenerProvider.overrideWithValue((bytes, name, mime) async {
          opened.add((name, mime));
          return true;
        }),
      ]);
    final b = FakeSyncBackend()..attach(h.server);
    var n = 0;
    h.server.on(
      'POST /files',
      (r) => {'id': '0193f000-0000-7000-8000-00000000000${++n}', 'name': 'x', 'mime': 'x', 'size': 3},
    );
    h.server.on('GET /files/0193f000-0000-7000-8000-000000000001', (_) => 'audio-bytes');
    await h.pump(tester);
    await tapIt(tester, find.text('Drop').first);

    // record: the timer runs, then stop keeps it as a voice note
    await tester.enterText(find.byKey(const Key('drop-text')), 'remember the plumber’s number');
    await tapIt(tester, find.byTooltip('Record a voice note'));
    expect(rec.started, isTrue);
    expect(find.byKey(const Key('recording-timer')), findsOneWidget);
    await tapIt(tester, find.byTooltip('Stop and keep the voice note'));
    final voice = b.rows.values.where((r) => r['kind'] == 'voice').single;
    expect(voice['fileName'], 'voice-2026-11-16-0930.m4a');
    expect(voice['text'], 'remember the plumber’s number');
    final upload = h.server.calls.firstWhere((c) => c.path == '/files');
    expect(upload.headers['x-file-purpose'], 'voice');

    // attach any file: a spreadsheet goes up as a file
    await tapIt(tester, find.byTooltip('Attach a file'));
    expect(b.rows.values.where((r) => r['fileName'] == 'budget.xlsx' || r['kind'] == 'file'), isNotEmpty);

    // play from the list: handed to the phone's player with its type
    await tapIt(tester, find.byTooltip('Play').first);
    expect(opened.single, ('voice-2026-11-16-0930.m4a', 'audio/mp4'));
    await finish(tester);
  });

  test('types from file names match the web and the server', () {
    expect(mimeFromName('a.PDF'), 'application/pdf');
    expect(mimeFromName('voice-1.webm'), 'audio/webm');
    expect(mimeFromName('clip.webm'), 'video/webm');
    expect(mimeFromName('x.docx'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(viewKind('image/png'), ViewKind.image);
    expect(viewKind('text/csv'), ViewKind.text);
    expect(viewKind('audio/mp4'), ViewKind.other);
  });
}
