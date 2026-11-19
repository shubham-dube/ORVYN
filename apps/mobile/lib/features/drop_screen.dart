import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../app/state.dart';
import '../core/api.dart';
import '../core/files.dart';
import 'file_viewer.dart';
import '../design/controls.dart';
import '../design/glass.dart';
import '../design/theme.dart';
import '../design/toast.dart';
import '../drop/drop.dart';
import '../money/money.dart';
import 'common.dart';
import 'sheets.dart';

/// Drop (spec 0003, calm in 0008 C): one composer, then what waits for you as quiet rows — what ORVYN thinks each
/// thing is and one tap to accept it, the full editor only when you ask. Nothing is created without that tap (AC3).
class DropScreen extends ConsumerStatefulWidget {
  const DropScreen({super.key});
  @override
  ConsumerState<DropScreen> createState() => _DropScreenState();
}

class _DropScreenState extends ConsumerState<DropScreen> {
  bool _showDone = false;

  @override
  Widget build(BuildContext context) {
    final items = ref.watch(dropItemsProvider).value ?? const <DropItemView>[];
    final ready = items.where((i) => i.status == 'proposed' && i.proposal != null).toList();
    final reading = items.where((i) => i.status == 'new' || i.status == 'thinking').toList();
    final stuck = items.where((i) => i.open && !ready.contains(i) && !reading.contains(i)).toList();
    final done = items.where((i) => i.status == 'done' || i.status == 'kept').take(12).toList();
    final waiting = ready.length + stuck.length;
    return OrvModule(
      module: 'drop',
      child: Builder(
        builder: (context) {
          final l = context.orv;
          return RefreshIndicator(
            color: l.accent,
            onRefresh: () => ref.read(syncProvider).sync().catchError((Object _) {}),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 56, 16, 120),
              children: [
                PageTitle('Drop', overline: waiting == 0 ? 'Text, voice, a photo or a link' : '$waiting to decide'),
                const _Composer(),
                if (ready.isEmpty && reading.isEmpty && stuck.isEmpty)
                  const _Empty()
                else ...[
                  if (ready.isNotEmpty) ...[
                    _GroupHead('Ready for you', ready.length),
                    _Group(children: [for (final i in ready) _ReadyRow(item: i)]),
                  ],
                  if (reading.isNotEmpty) ...[
                    _GroupHead('Reading', reading.length),
                    _Group(children: [for (final i in reading) _ReadingRow(item: i)]),
                  ],
                  if (stuck.isNotEmpty) ...[
                    _GroupHead('Needs a hand', stuck.length),
                    _Group(children: [for (final i in stuck) _StuckRow(item: i)]),
                  ],
                ],
                if (done.isNotEmpty) ...[
                  const SizedBox(height: 14),
                  InkWell(
                    borderRadius: BorderRadius.circular(10),
                    onTap: () => setState(() => _showDone = !_showDone),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 8),
                      child: Row(
                        children: [
                          Text('Done · ${done.length}', style: OrvText.label(l)),
                          const SizedBox(width: 4),
                          Icon(_showDone ? LucideIcons.chevronUp : LucideIcons.chevronDown, size: 14, color: l.c.muted),
                        ],
                      ),
                    ),
                  ),
                  if (_showDone)
                    _Group(
                      children: [
                        for (final i in done)
                          Padding(
                            padding: const EdgeInsets.symmetric(vertical: 10),
                            child: Row(
                              children: [
                                Icon(LucideIcons.circleCheck, size: 15, color: l.c.success),
                                const SizedBox(width: 10),
                                Expanded(
                                  child: Text(i.summary, style: OrvText.muted(l), overflow: TextOverflow.ellipsis),
                                ),
                                Text(
                                  i.status == 'kept'
                                      ? 'note'
                                      : (i.resultRef?.startsWith('money') ?? false)
                                      ? 'in Money'
                                      : 'in Today',
                                  style: OrvText.muted(l).copyWith(fontSize: 12),
                                ),
                              ],
                            ),
                          ),
                      ],
                    ),
                ],
              ],
            ),
          );
        },
      ),
    );
  }
}

class _Empty extends StatelessWidget {
  const _Empty();
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 28, 8, 8),
      child: Column(
        children: [
          Icon(LucideIcons.inbox, size: 30, color: l.c.faint),
          const SizedBox(height: 10),
          Text('Nothing waiting', style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600)),
          const SizedBox(height: 4),
          Text(
            'Drop a thought, a receipt or a link. ORVYN reads it and suggests where it goes; you decide.',
            textAlign: TextAlign.center,
            style: OrvText.muted(l),
          ),
        ],
      ),
    );
  }
}

class _GroupHead extends StatelessWidget {
  const _GroupHead(this.text, this.count);
  final String text;
  final int count;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(4, 16, 4, 6),
    child: Text('${text.toUpperCase()}  $count', style: OrvText.label(context.orv)),
  );
}

class _Group extends StatelessWidget {
  const _Group({required this.children});
  final List<Widget> children;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return Glass(
      blur: false,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
      child: Column(
        children: [
          for (var i = 0; i < children.length; i++) ...[if (i > 0) Divider(height: 1, color: l.c.edge), children[i]],
        ],
      ),
    );
  }
}

IconData _kindIcon(DropItemView i) => switch (i.kind) {
  'photo' => LucideIcons.image,
  'link' => LucideIcons.link,
  'voice' => LucideIcons.mic,
  'file' => LucideIcons.paperclip,
  _ => LucideIcons.stickyNote,
};

/// What ORVYN thinks it is, in words: "Task · Tue 17 Nov, 5:00 pm", "Expense · ₹499 · Food & dining".
String suggestionLine(Map<String, dynamic> p, MaterialLocalizations loc) {
  String when(Object? at) {
    final d = DateTime.tryParse('$at')?.toLocal();
    if (d == null) return '';
    final day = loc.formatMediumDate(d);
    return '$at'.length > 10 ? '$day, ${loc.formatTimeOfDay(TimeOfDay.fromDateTime(d))}' : day;
  }

  return switch (p['kind']) {
    'task' => ['Task', when(p['dueAt'] ?? p['dueDate'])].where((x) => x.isNotEmpty).join(' · '),
    'event' => ['Event', when(p['start'])].where((x) => x.isNotEmpty).join(' · '),
    'expense' => 'Expense · ${formatMoney(((p['amount'] as num? ?? 0) * 100).round())} · ${p['category'] ?? ''}',
    _ => 'Note',
  };
}

/// One thing ORVYN has read: the summary, its suggestion, and Add — Edit opens the full editor.
class _ReadyRow extends ConsumerWidget {
  const _ReadyRow({required this.item});
  final DropItemView item;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final p = item.proposal!;
    final kind = p['kind'] as String;
    final title = (p['title'] ?? p['merchant'] ?? item.summary) as String;
    void edit() => showGlassSheet<void>(context, (_) => _ProposalSheet(item: item));
    return Semantics(
      container: true,
      label: 'Dropped: ${item.summary}',
      child: InkWell(
        onTap: edit,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 10),
          child: Row(
            children: [
              _KindIcon(item: item),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: OrvText.body(l), maxLines: 2, overflow: TextOverflow.ellipsis),
                    const SizedBox(height: 2),
                    Text(
                      suggestionLine(p, MaterialLocalizations.of(context)),
                      style: OrvText.muted(l).copyWith(fontSize: 12.5, color: l.accent),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              if (item.fileId != null) _OpenFile(item: item),
              IconButton(
                tooltip: 'Edit: ${item.summary}',
                visualDensity: VisualDensity.compact,
                icon: Icon(LucideIcons.pencil, size: 17, color: l.c.muted),
                onPressed: edit,
              ),
              _AcceptButton(item: item, kind: kind),
            ],
          ),
        ),
      ),
    );
  }
}

class _KindIcon extends StatelessWidget {
  const _KindIcon({required this.item});
  final DropItemView item;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return Container(
      width: 32,
      height: 32,
      decoration: BoxDecoration(color: l.c.field, borderRadius: BorderRadius.circular(10)),
      child: Icon(_kindIcon(item), size: 16, color: l.c.muted),
    );
  }
}

class _OpenFile extends ConsumerWidget {
  const _OpenFile({required this.item});
  final DropItemView item;
  @override
  Widget build(BuildContext context, WidgetRef ref) => IconButton(
    tooltip: item.kind == 'voice' ? 'Play' : 'Open',
    visualDensity: VisualDensity.compact,
    icon: Icon(item.kind == 'voice' ? LucideIcons.play : LucideIcons.paperclip, size: 17, color: context.orv.accent),
    onPressed: () => openStoredFile(context, ref, id: item.fileId!, name: item.fileName ?? 'file'),
  );
}

/// Accept the suggestion as it is: one tap.
class _AcceptButton extends ConsumerWidget {
  const _AcceptButton({required this.item, required this.kind});
  final DropItemView item;
  final String kind;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final label = kind == 'note' ? 'Keep' : 'Add';
    return Semantics(
      button: true,
      label: '$label: ${item.summary}',
      excludeSemantics: true,
      child: GestureDetector(
        onTap: () async {
          final toaster = Toaster.of(context);
          unawaited(HapticFeedback.lightImpact());
          final p = item.proposal!;
          await ref.read(dropActionsProvider).confirm(item, p);
          toaster.show(_doneText(p), tone: ToastTone.success);
        },
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
          decoration: BoxDecoration(gradient: l.accentGradient, borderRadius: BorderRadius.circular(20)),
          child: Text(
            label,
            style: const TextStyle(
              fontFamily: fontFamily,
              color: Colors.white,
              fontWeight: FontWeight.w700,
              fontSize: 13,
            ),
          ),
        ),
      ),
    );
  }
}

String _doneText(Map<String, dynamic> p) => switch (p['kind']) {
  'note' => 'Kept as a note',
  'expense' => 'Added to Money · ${formatMoney(((p['amount'] as num) * 100).round())}',
  _ => 'Added to Today',
};

class _ReadingRow extends ConsumerWidget {
  const _ReadingRow({required this.item});
  final DropItemView item;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    return Semantics(
      container: true,
      label: 'Dropped: ${item.summary}',
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: Row(
          children: [
            _KindIcon(item: item),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(item.summary, style: OrvText.body(l), maxLines: 2, overflow: TextOverflow.ellipsis),
                  Text('Reading it…', style: OrvText.muted(l).copyWith(fontSize: 12.5)),
                ],
              ),
            ),
            if (item.fileId != null) _OpenFile(item: item),
            SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: l.accent)),
            const SizedBox(width: 8),
          ],
        ),
      ),
    );
  }
}

/// ORVYN couldn't read it (AI paused, failed): say why, and offer the plain ways out.
class _StuckRow extends ConsumerWidget {
  const _StuckRow({required this.item});
  final DropItemView item;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final actions = ref.read(dropActionsProvider);
    return Semantics(
      container: true,
      label: 'Dropped: ${item.summary}',
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                _KindIcon(item: item),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(item.summary, style: OrvText.body(l), maxLines: 2, overflow: TextOverflow.ellipsis),
                ),
                if (item.fileId != null) _OpenFile(item: item),
                IconButton(
                  tooltip: 'Dismiss',
                  visualDensity: VisualDensity.compact,
                  icon: Icon(LucideIcons.x, size: 17, color: l.c.faint),
                  onPressed: () => actions.dismiss(item),
                ),
              ],
            ),
            if ((item.problem ?? '').isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(left: 42, top: 2),
                child: Text(
                  item.problem!,
                  style: OrvText.muted(l)
                      .copyWith(fontSize: 12.5, color: item.status == 'failed' ? l.c.danger : l.c.warning),
                ),
              ),
            Padding(
              padding: const EdgeInsets.only(left: 36),
              child: Wrap(
                spacing: 2,
                children: [
                  if (item.status == 'failed')
                    TextButton(onPressed: () => actions.retry(item), child: const Text('Try again')),
                  TextButton(
                    onPressed: () => actions.confirm(item, {
                      'kind': 'task',
                      'title': item.summary,
                      'dueDate': null,
                      'dueAt': null,
                      'durationMin': null,
                      'priority': 0,
                      'notes': '',
                      'why': '',
                    }),
                    child: const Text('Make it a task'),
                  ),
                  TextButton(onPressed: () => actions.keep(item), child: const Text('Keep as a note')),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The full editor for one suggestion: change what it is, its words, amount or category, then add.
class _ProposalSheet extends ConsumerWidget {
  const _ProposalSheet({required this.item});
  final DropItemView item;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    return StickySheet(
      title: 'What is it?',
      trailing: IconButton(
        tooltip: 'Dismiss',
        icon: Icon(LucideIcons.trash2, size: 18, color: l.c.muted),
        onPressed: () async {
          await ref.read(dropActionsProvider).dismiss(item);
          if (context.mounted) Navigator.of(context).pop();
        },
      ),
      footer: const SizedBox.shrink(),
      children: [
        Text(item.summary, style: OrvText.muted(l), maxLines: 3, overflow: TextOverflow.ellipsis),
        const SizedBox(height: 10),
        _Proposal(item: item, onDone: () => Navigator.of(context).pop()),
      ],
    );
  }
}

class _Composer extends ConsumerStatefulWidget {
  const _Composer();
  @override
  ConsumerState<_Composer> createState() => _ComposerState();
}

class _ComposerState extends ConsumerState<_Composer> {
  final _c = TextEditingController();
  bool _voice = false;
  bool _listening = false;
  bool _busy = false;

  /// recording a voice note: when it started, and how loud it is now
  DateTime? _recordingSince;
  double _level = 0;
  StreamSubscription<double>? _levelSub;
  Timer? _tick;

  @override
  void dispose() {
    _c.dispose();
    _levelSub?.cancel();
    _tick?.cancel();
    super.dispose();
  }

  Future<void> _record() async {
    final toaster = Toaster.of(context);
    final rec = ref.read(voiceRecorderProvider);
    if (_recordingSince == null) {
      if (!await rec.start()) {
        toaster.show(
          'Microphone access is off',
          body: 'Allow it for ORVYN in the phone’s settings.',
          tone: ToastTone.danger,
        );
        return;
      }
      unawaited(HapticFeedback.mediumImpact());
      _levelSub = rec.level.listen((v) => mounted ? setState(() => _level = v) : null);
      _tick = Timer.periodic(const Duration(seconds: 1), (_) => mounted ? setState(() {}) : null);
      setState(() => _recordingSince = DateTime.now());
      return;
    }
    await _stopRecording(keep: true);
  }

  Future<void> _stopRecording({required bool keep}) async {
    final toaster = Toaster.of(context);
    final rec = ref.read(voiceRecorderProvider);
    await _levelSub?.cancel();
    _tick?.cancel();
    final f = await rec.stop();
    setState(() {
      _recordingSince = null;
      _level = 0;
    });
    if (!keep || f == null) return;
    setState(() => _busy = true);
    try {
      await ref.read(dropActionsProvider).dropVoice(f.bytes, name: f.name, mime: f.mime, words: _c.text);
      _c.clear();
      toaster.show('Voice note kept', body: 'It’s in Drop; you can play it any time.', tone: ToastTone.success);
    } on ApiError catch (e) {
      toaster.show(
        e.code == 'offline' ? 'Voice notes need a connection' : 'That recording couldn’t be kept',
        tone: ToastTone.danger,
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _file() async {
    final toaster = Toaster.of(context);
    final f = await ref.read(anyFilePickerProvider)();
    if (f == null) return;
    setState(() => _busy = true);
    try {
      await ref.read(dropActionsProvider).dropFile(f.bytes, name: f.name, mime: f.mime, caption: _c.text.trim());
      _c.clear();
    } on ApiError catch (e) {
      toaster.show(
        e.code == 'offline'
            ? 'Files need a connection'
            : (e.message.isNotEmpty ? e.message : 'That file couldn’t be dropped'),
        tone: ToastTone.danger,
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _send() async {
    if (_c.text.trim().isEmpty) return;
    unawaited(HapticFeedback.lightImpact());
    await ref.read(dropActionsProvider).dropText(_c.text, voice: _voice);
    _c.clear();
    setState(() => _voice = false);
  }

  Future<void> _photo(bool camera) async {
    final toaster = Toaster.of(context);
    final f = await ref.read(photoPickerProvider)(camera: camera);
    if (f == null) return;
    setState(() => _busy = true);
    try {
      await ref.read(dropActionsProvider).dropFile(f.bytes, name: f.name, mime: f.mime, caption: _c.text.trim());
      _c.clear();
    } on ApiError catch (e) {
      toaster.show(
        e.code == 'offline' ? 'Photos need a connection' : 'That photo couldn’t be dropped',
        tone: ToastTone.danger,
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _speak() async {
    setState(() => _listening = true);
    final words = await ref.read(speechProvider).listen();
    if (!mounted) return;
    setState(() {
      _listening = false;
      if (words != null && words.trim().isNotEmpty) {
        _c.text = _c.text.isEmpty ? words : '${_c.text} $words';
        _voice = true;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return Glass(
      level: GlassLevel.float,
      padding: const EdgeInsets.fromLTRB(14, 4, 8, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            key: const Key('drop-text'),
            controller: _c,
            minLines: 1,
            maxLines: 5,
            onChanged: (_) => setState(() {}),
            textInputAction: TextInputAction.send,
            onSubmitted: (_) => _send(),
            style: OrvText.body(l).copyWith(fontSize: 16),
            decoration: InputDecoration(
              hintText: 'Drop anything… “dentist friday 11”, “spent 240 on lunch”',
              hintStyle: OrvText.body(l).copyWith(color: l.c.faint, fontSize: 16),
              border: InputBorder.none,
            ),
          ),
          if (_recordingSince != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Row(
                children: [
                  Container(
                    width: 8,
                    height: 8,
                    decoration: BoxDecoration(color: l.c.danger, shape: BoxShape.circle),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    'Recording ${DateTime.now().difference(_recordingSince!).inSeconds ~/ 60}:${(DateTime.now().difference(_recordingSince!).inSeconds % 60).toString().padLeft(2, '0')}',
                    key: const Key('recording-timer'),
                    style: OrvText.body(l).copyWith(color: l.c.danger, fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(width: 10),
                  for (final k in const [0.5, 0.9, 0.7, 1.0, 0.6, 0.8])
                    AnimatedContainer(
                      duration: const Duration(milliseconds: 120),
                      margin: const EdgeInsets.symmetric(horizontal: 1.5),
                      width: 3,
                      height: 4 + 16 * _level * k,
                      decoration: BoxDecoration(color: l.accent, borderRadius: BorderRadius.circular(2)),
                    ),
                  const Spacer(),
                  TextButton(onPressed: () => _stopRecording(keep: false), child: const Text('Discard')),
                ],
              ),
            ),
          Row(
            children: [
              IconButton(
                tooltip: 'Take a photo',
                icon: Icon(LucideIcons.camera, color: l.c.muted),
                onPressed: _busy ? null : () => _photo(true),
              ),
              IconButton(
                tooltip: 'Choose a photo',
                icon: Icon(LucideIcons.image, color: l.c.muted),
                onPressed: _busy ? null : () => _photo(false),
              ),
              IconButton(
                tooltip: 'Attach a file',
                icon: Icon(LucideIcons.paperclip, color: l.c.muted),
                onPressed: _busy || _recordingSince != null ? null : _file,
              ),
              IconButton(
                tooltip: _recordingSince == null ? 'Record a voice note' : 'Stop and keep the voice note',
                icon: Icon(
                  _recordingSince == null ? LucideIcons.audioLines : LucideIcons.square,
                  color: _recordingSince == null ? l.c.muted : l.c.danger,
                ),
                onPressed: _busy ? null : _record,
              ),
              IconButton(
                tooltip: _listening ? 'Listening' : 'Speak',
                icon: Icon(
                  _listening ? LucideIcons.audioLines : LucideIcons.mic,
                  color: _listening ? l.accent : l.c.muted,
                ),
                onPressed: _listening ? null : _speak,
              ),
              const Spacer(),
              OrvButton(
                label: 'Drop',
                small: true,
                variant: ButtonVariant.primary,
                icon: LucideIcons.send,
                loading: _busy,
                onPressed: _c.text.trim().isEmpty ? null : _send,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _Proposal extends ConsumerStatefulWidget {
  const _Proposal({required this.item, this.onDone});
  final DropItemView item;
  final VoidCallback? onDone;
  @override
  ConsumerState<_Proposal> createState() => _ProposalState();
}

class _ProposalState extends ConsumerState<_Proposal> {
  late Map<String, dynamic> _p = {...widget.item.proposal!};
  late final _title = TextEditingController(text: (_p['title'] ?? _p['merchant'] ?? '') as String);
  late final _amount = TextEditingController(text: _p['amount']?.toString() ?? '');
  bool _busy = false;

  @override
  void dispose() {
    _title.dispose();
    _amount.dispose();
    super.dispose();
  }

  void _switch(String kind) {
    final title = _title.text;
    final now = ref.read(clockProvider)();
    setState(() {
      _p = switch (kind) {
        'task' => {
          'kind': 'task',
          'title': title,
          'dueDate': null,
          'dueAt': null,
          'durationMin': null,
          'priority': 0,
          'notes': '',
          'why': _p['why'] ?? '',
        },
        'event' => {
          'kind': 'event',
          'title': title,
          'start': now.toUtc().toIso8601String(),
          'end': now.add(const Duration(hours: 1)).toUtc().toIso8601String(),
          'location': '',
          'notes': '',
          'why': _p['why'] ?? '',
        },
        'expense' => {
          'kind': 'expense',
          'amount': 1,
          'currency': 'INR',
          'direction': 'debit',
          'merchant': title,
          'category': 'Other',
          'occurredAt': null,
          'note': '',
          'why': _p['why'] ?? '',
        },
        _ => {
          'kind': 'note',
          'title': title.isEmpty ? 'Note' : title,
          'text': widget.item.text,
          'why': _p['why'] ?? '',
        },
      };
      if (kind == 'expense') _amount.text = '1';
    });
  }

  Map<String, dynamic> _final() {
    final p = {..._p};
    if (p['kind'] == 'expense') {
      p['merchant'] = _title.text.trim();
      p['amount'] = num.tryParse(_amount.text.replaceAll(',', '')) ?? p['amount'];
    } else {
      p['title'] = _title.text.trim().isEmpty ? p['title'] : _title.text.trim();
    }
    return p;
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final me = ref.watch(sessionProvider);
    bool can(String k) => me is SignedIn && me.me.can(k);
    final kinds = [
      if (can('today')) ...['task', 'event'],
      if (can('money')) 'expense',
      'note',
    ];
    final cats = ref.watch(categoriesProvider).value ?? const <CategoryItem>[];
    final kind = _p['kind'] as String;
    String when() {
      final at = _p['dueAt'] ?? _p['start'] ?? _p['dueDate'];
      if (at == null) return '';
      final d = DateTime.tryParse('$at')?.toLocal();
      if (d == null) return '';
      final loc = MaterialLocalizations.of(context);
      return '${loc.formatMediumDate(d)}${'$at'.length > 10 ? ' · ${loc.formatTimeOfDay(TimeOfDay.fromDateTime(d))}' : ''}';
    }

    ChoiceChip chip(String label, bool on, VoidCallback tap) => ChoiceChip(
      label: Text(label),
      selected: on,
      showCheckmark: false,
      onSelected: (_) => tap(),
      selectedColor: l.accent.withValues(alpha: 0.16),
      side: BorderSide(color: on ? l.accent : l.c.edge),
      backgroundColor: Colors.transparent,
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Wrap(
          spacing: 6,
          children: [
            for (final k in kinds) chip('${k[0].toUpperCase()}${k.substring(1)}', kind == k, () => _switch(k)),
          ],
        ),
        if ((_p['why'] as String? ?? '').isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text('Why: ${_p['why']}', style: OrvText.muted(l).copyWith(fontSize: 12)),
          ),
        const SizedBox(height: 8),
        if (kind == 'expense') ...[
          Row(
            children: [
              SizedBox(
                width: 120,
                child: OrvField(label: 'Amount (₹)', controller: _amount, keyboardType: TextInputType.number),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: OrvField(label: 'Merchant', controller: _title),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final name in {
                '${_p['category']}',
                ...cats.where((c) => c.kind == 'expense' && !c.archived).map((c) => c.name),
              }.take(10))
                chip(name, _p['category'] == name, () => setState(() => _p['category'] = name)),
            ],
          ),
        ] else
          OrvField(label: 'Title', controller: _title),
        if (when().isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(when(), style: OrvText.muted(l).copyWith(color: l.accent)),
          ),
        const SizedBox(height: 10),
        Align(
          alignment: Alignment.centerRight,
          child: OrvButton(
            label: kind == 'note' ? 'Keep note' : (kind == 'expense' ? 'Add to Money' : 'Add to Today'),
            small: true,
            variant: ButtonVariant.primary,
            loading: _busy,
            onPressed: () async {
              final toaster = Toaster.of(context);
              setState(() => _busy = true);
              final p = _final();
              await ref.read(dropActionsProvider).confirm(widget.item, p);
              toaster.show(_doneText(p), tone: ToastTone.success);
              widget.onDone?.call();
            },
          ),
        ),
      ],
    );
  }
}
