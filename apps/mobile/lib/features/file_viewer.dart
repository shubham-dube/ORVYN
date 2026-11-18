import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../app/state.dart';
import '../core/files.dart';
import '../design/controls.dart';
import '../design/theme.dart';
import '../design/toast.dart';
import 'common.dart';
import 'sheets.dart';

/// Opens a stored file (spec 0007 A1): photos and text inside ORVYN, everything else in the phone's own app.
Future<void> openStoredFile(
  BuildContext context,
  WidgetRef ref, {
  required String id,
  required String name,
  String? mime,
}) async {
  final type = (mime == null || mime.isEmpty || mime == 'application/octet-stream') ? mimeFromName(name) : mime;
  final toaster = Toaster.of(context);
  Uint8List bytes;
  try {
    bytes = await ref.read(apiProvider).download(id);
  } catch (e) {
    toaster.show('Couldn’t open it', body: messageFor(e), tone: ToastTone.danger);
    return;
  }
  if (!context.mounted) return;
  switch (viewKind(type)) {
    case ViewKind.image:
    case ViewKind.text:
      await showGlassSheet<void>(context, (_) => _Viewer(name: name, mime: type, bytes: bytes));
    case ViewKind.other:
      final ok = await ref.read(externalOpenerProvider)(bytes, name, type);
      if (!ok) toaster.show('No app on this phone opens $name', tone: ToastTone.danger);
  }
}

class _Viewer extends ConsumerWidget {
  const _Viewer({required this.name, required this.mime, required this.bytes});
  final String name;
  final String mime;
  final Uint8List bytes;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final image = viewKind(mime) == ViewKind.image;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(name, style: OrvText.heading(l), maxLines: 1, overflow: TextOverflow.ellipsis),
          const SizedBox(height: 10),
          ConstrainedBox(
            constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.65),
            child: image
                ? InteractiveViewer(
                    maxScale: 5,
                    child: Image.memory(bytes, key: const Key('viewer-image'), fit: BoxFit.contain),
                  )
                : SingleChildScrollView(
                    child: SelectableText(
                      utf8.decode(bytes.length > 400000 ? bytes.sublist(0, 400000) : bytes, allowMalformed: true),
                      key: const Key('viewer-text'),
                      style: OrvText.body(l).copyWith(fontFamily: 'monospace', fontSize: 13),
                    ),
                  ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              OrvButton(
                label: 'Open in another app',
                small: true,
                icon: LucideIcons.externalLink,
                onPressed: () => ref.read(externalOpenerProvider)(bytes, name, mime),
              ),
              const Spacer(),
              OrvButton(
                label: 'Done',
                small: true,
                variant: ButtonVariant.primary,
                onPressed: () => Navigator.of(context).pop(),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
