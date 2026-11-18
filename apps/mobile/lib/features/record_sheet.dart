import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../core/files.dart';
import '../design/controls.dart';
import '../design/theme.dart';
import 'sheets.dart';

/// Records a voice note in a sheet: a big button, a live level and a timer; returns the recording, or null.
Future<LocalFile?> recordVoiceNote(BuildContext context) =>
    showGlassSheet<LocalFile?>(context, (_) => const _RecordSheet());

class _RecordSheet extends ConsumerStatefulWidget {
  const _RecordSheet();
  @override
  ConsumerState<_RecordSheet> createState() => _RecordSheetState();
}

class _RecordSheetState extends ConsumerState<_RecordSheet> {
  DateTime? _since;
  double _level = 0;
  String? _problem;
  StreamSubscription<double>? _sub;
  Timer? _tick;

  @override
  void dispose() {
    _sub?.cancel();
    _tick?.cancel();
    if (_since != null) unawaited(ref.read(voiceRecorderProvider).stop());
    super.dispose();
  }

  Future<void> _toggle() async {
    final rec = ref.read(voiceRecorderProvider);
    if (_since == null) {
      if (!await rec.start()) {
        setState(() => _problem = 'Microphone access is off. Allow it for ORVYN in the phone’s settings.');
        return;
      }
      unawaited(HapticFeedback.mediumImpact());
      _sub = rec.level.listen((v) => mounted ? setState(() => _level = v) : null);
      _tick = Timer.periodic(const Duration(seconds: 1), (_) => mounted ? setState(() {}) : null);
      setState(() => _since = DateTime.now());
    } else {
      await _sub?.cancel();
      _tick?.cancel();
      final f = await rec.stop();
      _since = null;
      if (mounted) Navigator.of(context).pop(f);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final secs = _since == null ? 0 : DateTime.now().difference(_since!).inSeconds;
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(_since == null ? 'Voice note' : 'Recording', style: OrvText.heading(l)),
          const SizedBox(height: 18),
          Semantics(
            button: true,
            label: _since == null ? 'Start recording' : 'Stop and keep',
            excludeSemantics: true,
            child: GestureDetector(
              onTap: _toggle,
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 140),
                width: 96 + 24 * _level,
                height: 96 + 24 * _level,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: _since == null ? l.accentGradient : null,
                  color: _since == null ? null : l.c.danger,
                  boxShadow: [BoxShadow(color: l.accentFrom.withValues(alpha: 0.35), blurRadius: 24 + 30 * _level)],
                ),
                child: Icon(_since == null ? LucideIcons.mic : LucideIcons.square, color: Colors.white, size: 34),
              ),
            ),
          ),
          const SizedBox(height: 14),
          Text(
            _since == null
                ? 'Tap to start'
                : '${secs ~/ 60}:${(secs % 60).toString().padLeft(2, '0')} · tap to stop and keep',
            key: const Key('record-status'),
            style: OrvText.muted(l),
          ),
          if (_problem != null) ...[
            const SizedBox(height: 8),
            Text(
              _problem!,
              style: OrvText.muted(l).copyWith(color: l.c.danger),
              textAlign: TextAlign.center,
            ),
          ],
          const SizedBox(height: 12),
          OrvButton(
            label: 'Cancel',
            small: true,
            variant: ButtonVariant.ghost,
            onPressed: () => Navigator.of(context).pop(),
          ),
        ],
      ),
    );
  }
}
