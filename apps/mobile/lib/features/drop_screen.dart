import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../app/state.dart';
import '../core/api.dart';
import '../design/controls.dart';
import '../design/glass.dart';
import '../design/theme.dart';
import '../design/toast.dart';
import '../drop/drop.dart';
import '../money/money.dart';
import 'common.dart';

/// Drop (spec 0003): type, speak, snap or share anything; the AI suggests what it is; one tap puts it in Today or
/// Money. Nothing is created without that tap (AC3).
class DropScreen extends ConsumerWidget {
  const DropScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final items = ref.watch(dropItemsProvider).value ?? const <DropItemView>[];
    final open = items.where((i) => i.open).toList();
    final done = items.where((i) => i.status == 'done' || i.status == 'kept').take(8).toList();
    return OrvModule(
      module: 'drop',
      child: Builder(
        builder: (context) {
          final l = context.orv;
          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 56, 16, 120),
            children: [
              const PageTitle('Drop', overline: 'Text, voice, a photo or a link'),
              const _Composer(),
              const SizedBox(height: 12),
              if (open.isEmpty)
                Text('Nothing waiting. Whatever you drop shows up here with a suggestion.', style: OrvText.muted(l)),
              for (final i in open)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: _ItemCard(item: i),
                ),
              if (done.isNotEmpty) ...[
                const SizedBox(height: 8),
                Text('Done', style: OrvText.label(l)),
                for (final i in done)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    child: Row(
                      children: [
                        Icon(LucideIcons.circleCheck, size: 14, color: l.c.success),
                        const SizedBox(width: 8),
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
            ],
          );
        },
      ),
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

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
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

class _ItemCard extends ConsumerWidget {
  const _ItemCard({required this.item});
  final DropItemView item;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final actions = ref.read(dropActionsProvider);
    return Semantics(
      container: true,
      label: 'Dropped: ${item.summary}',
      child: Glass(
        blur: false,
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(
                  item.kind == 'photo'
                      ? LucideIcons.image
                      : item.kind == 'link'
                      ? LucideIcons.link
                      : item.kind == 'voice'
                      ? LucideIcons.mic
                      : LucideIcons.stickyNote,
                  size: 16,
                  color: l.c.muted,
                ),
                const SizedBox(width: 8),
                Expanded(child: Text(item.summary, style: OrvText.body(l))),
                GestureDetector(
                  onTap: () => actions.dismiss(item),
                  child: Semantics(
                    button: true,
                    label: 'Dismiss',
                    excludeSemantics: true,
                    child: Icon(LucideIcons.x, size: 18, color: l.c.faint),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            if (item.status == 'new' || item.status == 'thinking')
              Text('Reading it…', style: OrvText.muted(l))
            else if (item.status == 'proposed' && item.proposal != null)
              _Proposal(item: item)
            else ...[
              Text(
                item.problem ?? '',
                style: OrvText.muted(l).copyWith(color: item.status == 'failed' ? l.c.danger : l.c.warning),
              ),
              const SizedBox(height: 6),
              Wrap(
                spacing: 6,
                children: [
                  if (item.status == 'failed')
                    OrvButton(label: 'Try again', small: true, onPressed: () => actions.retry(item)),
                  OrvButton(
                    label: 'Make it a task',
                    small: true,
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
                  ),
                  OrvButton(
                    label: 'Keep as a note',
                    small: true,
                    variant: ButtonVariant.ghost,
                    onPressed: () => actions.keep(item),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _Proposal extends ConsumerStatefulWidget {
  const _Proposal({required this.item});
  final DropItemView item;
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
              toaster.show(
                kind == 'note'
                    ? 'Kept as a note'
                    : kind == 'expense'
                    ? 'Added to Money · ${formatMoney(((p['amount'] as num) * 100).round())}'
                    : 'Added to Today',
                tone: ToastTone.success,
              );
            },
          ),
        ),
      ],
    );
  }
}
