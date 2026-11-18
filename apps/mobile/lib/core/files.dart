import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:open_filex/open_filex.dart';
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';

/// A file chosen or recorded on the phone, ready to upload.
typedef LocalFile = ({Uint8List bytes, String name, String mime});

const _byExt = {
  'png': 'image/png',
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'webp': 'image/webp',
  'gif': 'image/gif',
  'heic': 'image/heic',
  'pdf': 'application/pdf',
  'txt': 'text/plain',
  'md': 'text/markdown',
  'csv': 'text/csv',
  'json': 'application/json',
  'mp3': 'audio/mpeg',
  'm4a': 'audio/mp4',
  'aac': 'audio/aac',
  'wav': 'audio/wav',
  'ogg': 'audio/ogg',
  'mp4': 'video/mp4',
  'mov': 'video/quicktime',
  'zip': 'application/zip',
  'doc': 'application/msword',
  'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'xls': 'application/vnd.ms-excel',
  'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'ppt': 'application/vnd.ms-powerpoint',
  'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/// The type a file most likely has, from its name (same table as the web and the server).
String mimeFromName(String name, [String fallback = 'application/octet-stream']) {
  final m = RegExp(r'\.([a-z0-9]{1,5})$', caseSensitive: false).firstMatch(name);
  final ext = m?.group(1)?.toLowerCase();
  if (ext == 'webm') return name.toLowerCase().startsWith('voice-') ? 'audio/webm' : 'video/webm';
  return _byExt[ext] ?? fallback;
}

/// What ORVYN shows itself; the rest opens in the phone's own app.
enum ViewKind { image, text, other }

ViewKind viewKind(String mime) => RegExp(r'^image/(png|jpeg|webp|gif)$').hasMatch(mime)
    ? ViewKind.image
    : (mime.startsWith('text/') || mime == 'application/json')
    ? ViewKind.text
    : ViewKind.other;

/// Pick any common file (PDF, documents, spreadsheets, audio, video, …).
final anyFilePickerProvider = Provider<Future<LocalFile?> Function()>(
  (_) => () async {
    final f = (await FilePicker.pickFiles()).firstOrNull;
    if (f == null) return null;
    final bytes = await f.readAsBytes();
    return (bytes: bytes, name: f.name, mime: mimeFromName(f.name));
  },
);

/// Records voice notes (AAC in .m4a). Swapped for a fake in tests.
abstract class VoiceRecorder {
  Future<bool> start();
  Future<LocalFile?> stop();
  Stream<double> get level;
}

class DeviceVoiceRecorder implements VoiceRecorder {
  final _rec = AudioRecorder();
  String? _path;

  @override
  Future<bool> start() async {
    if (!await _rec.hasPermission()) return false;
    final dir = await getTemporaryDirectory();
    final now = DateTime.now();
    String two(int n) => n.toString().padLeft(2, '0');
    _path =
        '${dir.path}/voice-${now.year}-${two(now.month)}-${two(now.day)}-${two(now.hour)}${two(now.minute)}${two(now.second)}.m4a';
    await _rec.start(const RecordConfig(encoder: AudioEncoder.aacLc, bitRate: 64000, sampleRate: 22050), path: _path!);
    return true;
  }

  @override
  Future<LocalFile?> stop() async {
    final path = await _rec.stop();
    if (path == null) return null;
    final f = File(path);
    final bytes = await f.readAsBytes();
    unawaited(f.delete().catchError((Object _) => f));
    return (bytes: bytes, name: path.split('/').last.replaceFirst(RegExp(r'\d{2}\.m4a$'), '.m4a'), mime: 'audio/mp4');
  }

  @override
  Stream<double> get level =>
      _rec.onAmplitudeChanged(const Duration(milliseconds: 120)).map((a) => ((a.current + 50) / 50).clamp(0.0, 1.0));
}

final voiceRecorderProvider = Provider<VoiceRecorder>((_) => DeviceVoiceRecorder());

/// Hands a file to the phone's own app (PDF reader, music player, Sheets, …).
final externalOpenerProvider = Provider<Future<bool> Function(Uint8List bytes, String name, String mime)>(
  (_) => (bytes, name, mime) async {
    final dir = await getTemporaryDirectory();
    final f = File('${dir.path}/open/${name.replaceAll(RegExp(r'[\\/]'), '_')}');
    await f.parent.create(recursive: true);
    await f.writeAsBytes(bytes, flush: true);
    final r = await OpenFilex.open(f.path, type: mime);
    return r.type == ResultType.done;
  },
);
