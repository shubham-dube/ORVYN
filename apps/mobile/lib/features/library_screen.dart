import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../app/state.dart';
import '../app/today.dart' show dayKey;
import '../design/controls.dart';
import '../design/glass.dart';
import '../design/theme.dart';
import '../design/toast.dart';
import '../core/files.dart';
import '../library/library.dart';
import 'file_viewer.dart';
import 'record_sheet.dart';
import '../money/money.dart' show formatMoney;
import 'common.dart';
import 'sheets.dart';

/// Library (spec 0004): documents and notes the AI reads — titled, tagged, searchable on the phone, with the dates that
/// remind you before something runs out.
class LibraryScreen extends ConsumerStatefulWidget {
  const LibraryScreen({super.key});
  @override
  ConsumerState<LibraryScreen> createState() => _LibraryScreenState();
}

class _LibraryScreenState extends ConsumerState<LibraryScreen> {
  final _search = TextEditingController();
  String _category = '';
  bool _busy = false;

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _addPhoto(bool camera) async {
    final toaster = Toaster.of(context);
    setState(() => _busy = true);
    try {
      final id = await ref.read(libraryActionsProvider).addPhoto(camera: camera);
      if (id != null) toaster.show('Added to Library', body: 'ORVYN is reading it.', tone: ToastTone.success);
    } catch (e) {
      toaster.show('Couldn’t add that', body: messageFor(e), tone: ToastTone.danger);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _add(Future<LocalFile?> Function() pick, {String done = 'Added to Library'}) async {
    final toaster = Toaster.of(context);
    final f = await pick();
    if (f == null) return;
    setState(() => _busy = true);
    try {
      await ref.read(libraryActionsProvider).addFile(f.bytes, name: f.name, mime: f.mime);
      toaster.show(done, body: 'ORVYN is reading it.', tone: ToastTone.success);
    } catch (e) {
      toaster.show('Couldn’t add that', body: messageFor(e), tone: ToastTone.danger);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final docs = ref.watch(docsProvider).value ?? const <DocItem>[];
    final today = dayKey(ref.watch(clockProvider)());
    final shown = searchDocs(docs, _search.text).where((d) => _category.isEmpty || d.category == _category).toList();
    final soon = expiringSoon(docs, today).take(4).toList();
    final used = ({for (final d in docs) d.category}.toList()..sort());
    return OrvModule(
      module: 'library',
      child: Builder(
        builder: (context) {
          final l = context.orv;
          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 56, 16, 120),
            children: [
              PageTitle(
                'Library',
                overline: docs.isEmpty ? 'Documents that organise themselves' : '${docs.length} kept',
              ),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  OrvButton(
                    key: const Key('lib-photo'),
                    label: 'Photo',
                    small: true,
                    variant: ButtonVariant.primary,
                    icon: LucideIcons.camera,
                    loading: _busy,
                    onPressed: () => _addPhoto(true),
                  ),
                  OrvButton(
                    key: const Key('lib-gallery'),
                    label: 'From gallery',
                    small: true,
                    icon: LucideIcons.image,
                    onPressed: _busy ? null : () => _addPhoto(false),
                  ),
                  OrvButton(
                    key: const Key('lib-file'),
                    label: 'File',
                    small: true,
                    icon: LucideIcons.paperclip,
                    onPressed: _busy ? null : () => _add(ref.read(anyFilePickerProvider)),
                  ),
                  OrvButton(
                    key: const Key('lib-voice'),
                    label: 'Voice note',
                    small: true,
                    icon: LucideIcons.mic,
                    onPressed: _busy ? null : () => _add(() => recordVoiceNote(context), done: 'Voice note kept'),
                  ),
                  OrvButton(
                    key: const Key('lib-note'),
                    label: 'Note',
                    small: true,
                    icon: LucideIcons.notebookPen,
                    onPressed: () => showGlassSheet<void>(context, (_) => const _NoteSheet()),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              TextField(
                key: const Key('lib-search'),
                controller: _search,
                onChanged: (_) => setState(() {}),
                style: OrvText.body(l),
                decoration: InputDecoration(
                  isDense: true,
                  prefixIcon: Icon(LucideIcons.search, size: 16, color: l.c.faint),
                  hintText: 'Search in plain words — “pan card”, “rent”',
                  hintStyle: OrvText.body(l).copyWith(color: l.c.faint),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: BorderSide(color: l.c.edge),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: BorderSide(color: l.c.edge),
                  ),
                ),
              ),
              if (used.length > 1)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Wrap(
                    spacing: 6,
                    children: [
                      for (final c in ['', ...used])
                        ChoiceChip(
                          label: Text(c.isEmpty ? 'All' : c),
                          selected: _category == c,
                          showCheckmark: false,
                          onSelected: (_) => setState(() => _category = c),
                          selectedColor: l.accent.withValues(alpha: 0.16),
                          side: BorderSide(color: _category == c ? l.accent : l.c.edge),
                          backgroundColor: Colors.transparent,
                        ),
                    ],
                  ),
                ),
              if (soon.isNotEmpty && _search.text.isEmpty && _category.isEmpty) ...[
                const SizedBox(height: 12),
                Glass(
                  padding: const EdgeInsets.all(14),
                  child: Semantics(
                    container: true,
                    label: 'Running out',
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const SectionLabel('Running out'),
                        for (final d in soon)
                          InkWell(
                            onTap: () => showGlassSheet<void>(context, (_) => _DocSheet(id: d.id)),
                            child: Padding(
                              padding: const EdgeInsets.symmetric(vertical: 6),
                              child: Row(
                                children: [
                                  Expanded(
                                    child: Text(
                                      d.title.isEmpty ? 'Document' : d.title,
                                      style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600),
                                    ),
                                  ),
                                  Text(
                                    expiryLabel(expiry(d.expiresOn, today).days),
                                    style: OrvText.muted(l).copyWith(
                                      color: expiry(d.expiresOn, today).urgency == Urgency.expired
                                          ? l.c.danger
                                          : l.c.warning,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
              ],
              const SizedBox(height: 12),
              if (shown.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 24),
                  child: Text(
                    docs.isEmpty
                        ? 'Your Library is empty. Photograph a document — an insurance policy, a PAN card, a rent agreement — or write a note. ORVYN reads it, titles and tags it, and reminds you before it expires.'
                        : 'Nothing matches. Try fewer words.',
                    style: OrvText.muted(l),
                  ),
                ),
              for (final d in shown) _DocCard(doc: d, today: today),
            ],
          );
        },
      ),
    );
  }
}

class _DocCard extends StatelessWidget {
  const _DocCard({required this.doc, required this.today});
  final DocItem doc;
  final String today;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final e = expiry(doc.expiresOn, today);
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: InkWell(
        borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
        onTap: () => showGlassSheet<void>(context, (_) => _DocSheet(id: doc.id)),
        child: Glass(
          blur: false,
          padding: const EdgeInsets.all(14),
          child: SizedBox(
            width: double.infinity,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        doc.title.isNotEmpty
                            ? doc.title
                            : (doc.working ? 'Reading…' : (doc.fileName.isEmpty ? 'Untitled' : doc.fileName)),
                        style: OrvText.body(l).copyWith(fontWeight: FontWeight.w700),
                      ),
                    ),
                    if (doc.working)
                      const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)),
                  ],
                ),
                Text(
                  '${doc.category}${doc.size > 0 ? ' · ${formatBytes(doc.size)}' : ''}',
                  style: OrvText.muted(l).copyWith(fontSize: 12),
                ),
                if (doc.summary.isNotEmpty)
                  Text(doc.summary, maxLines: 2, overflow: TextOverflow.ellipsis, style: OrvText.muted(l)),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 6,
                  runSpacing: 4,
                  children: [
                    if (doc.status == 'waiting') const OrvBadge('Waiting for tomorrow'),
                    if (doc.status == 'failed') const OrvBadge('Fill in yourself'),
                    if (e.urgency != Urgency.none)
                      OrvBadge(
                        expiryLabel(e.days),
                        tone: e.urgency == Urgency.expired
                            ? l.c.danger
                            : (e.urgency == Urgency.soon ? l.c.warning : null),
                      ),
                    for (final t in doc.tags.take(4)) OrvBadge('#$t'),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _DocSheet extends ConsumerStatefulWidget {
  const _DocSheet({required this.id});
  final String id;
  @override
  ConsumerState<_DocSheet> createState() => _DocSheetState();
}

class _DocSheetState extends ConsumerState<_DocSheet> {
  TextEditingController? _title;
  TextEditingController? _summary;
  String? _expires;
  bool? _remind;
  String? _category;

  @override
  void dispose() {
    _title?.dispose();
    _summary?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final doc = (ref.watch(docsProvider).value ?? const <DocItem>[]).where((d) => d.id == widget.id).firstOrNull;
    if (doc == null) return const SizedBox(height: 80);
    _title ??= TextEditingController(text: doc.title);
    _summary ??= TextEditingController(text: doc.summary);
    _expires ??= doc.expiresOn ?? '';
    _remind ??= doc.remind;
    _category ??= doc.category;
    final today = dayKey(ref.watch(clockProvider)());
    final e = expiry(_expires!.isEmpty ? null : _expires, today);
    final actions = ref.read(libraryActionsProvider);
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Document', style: OrvText.heading(l)),
          const SizedBox(height: 8),
          if (doc.working) Text('ORVYN is reading this…', style: OrvText.muted(l)),
          if (doc.problem != null) Text(doc.problem!, style: OrvText.muted(l).copyWith(color: l.c.warning)),
          const SizedBox(height: 8),
          OrvField(label: 'Title', controller: _title!),
          const SizedBox(height: 10),
          Text('Category', style: OrvText.muted(l).copyWith(fontWeight: FontWeight.w600)),
          const SizedBox(height: 4),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final c in {...libraryCategories, doc.category})
                ChoiceChip(
                  label: Text(c),
                  selected: _category == c,
                  showCheckmark: false,
                  onSelected: (_) => setState(() => _category = c),
                  selectedColor: l.accent.withValues(alpha: 0.16),
                  side: BorderSide(color: _category == c ? l.accent : l.c.edge),
                  backgroundColor: Colors.transparent,
                ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              OrvButton(
                key: const Key('lib-expiry'),
                small: true,
                icon: LucideIcons.calendarClock,
                label: _expires!.isEmpty ? 'Set an expiry date' : 'Expires ${_expires!}',
                onPressed: () async {
                  final now = ref.read(clockProvider)();
                  final d = await showDatePicker(
                    context: context,
                    initialDate: _expires!.isEmpty ? now : DateTime.parse(_expires!),
                    firstDate: DateTime(now.year - 10),
                    lastDate: DateTime(now.year + 30),
                  );
                  if (d != null) setState(() => _expires = dayKey(d));
                },
              ),
              const SizedBox(width: 8),
              if (_expires!.isNotEmpty) ...[
                Expanded(child: Text(expiryLabel(e.days), style: OrvText.muted(l))),
                IconButton(
                  tooltip: 'Clear the date',
                  icon: const Icon(LucideIcons.x, size: 16),
                  onPressed: () => setState(() => _expires = ''),
                ),
              ],
            ],
          ),
          OrvSwitchRow(
            label: 'Remind me before it expires',
            value: _remind!,
            onChanged: (v) => setState(() => _remind = v),
          ),
          const SizedBox(height: 8),
          OrvField(label: 'Summary', controller: _summary!, maxLines: 3),
          for (final k in doc.keyDates)
            if (k.date != _expires)
              Row(
                children: [
                  Expanded(child: Text('${k.label} · ${k.date}', style: OrvText.muted(l))),
                  TextButton(onPressed: () => setState(() => _expires = k.date), child: const Text('Use as expiry')),
                ],
              ),
          if (doc.amounts.isNotEmpty) ...[
            const SizedBox(height: 8),
            Glass(
              blur: false,
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const SectionLabel('Amounts in it'),
                  for (final (i, a) in doc.amounts.indexed)
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            '${a.label} · ${formatMoney(a.amountMinor, currency: a.currency)}',
                            style: OrvText.body(l),
                          ),
                        ),
                        if (doc.moneyState == 'added')
                          const OrvBadge('In Money')
                        else if (doc.moneyState == 'dismissed')
                          const OrvBadge('Skipped')
                        else ...[
                          TextButton(
                            onPressed: () async {
                              final toaster = Toaster.of(context);
                              await actions.addToMoney(doc, i);
                              toaster.show(
                                'Added to Money',
                                body: '${formatMoney(a.amountMinor)} · ${doc.title}',
                                tone: ToastTone.success,
                              );
                            },
                            child: const Text('Add to Money'),
                          ),
                          TextButton(
                            onPressed: () => actions.update(doc.id, {'moneyState': 'dismissed'}),
                            child: const Text('Not now'),
                          ),
                        ],
                      ],
                    ),
                ],
              ),
            ),
          ],
          const SizedBox(height: 14),
          Row(
            children: [
              OrvButton(
                label: 'Delete',
                small: true,
                variant: ButtonVariant.danger,
                icon: LucideIcons.trash2,
                onPressed: () async {
                  final nav = Navigator.of(context);
                  await actions.remove(doc.id);
                  nav.pop();
                },
              ),
              const SizedBox(width: 6),
              if (doc.fileId != null)
                IconButton(
                  tooltip: 'Open the original',
                  icon: Icon(LucideIcons.externalLink, color: l.accent),
                  onPressed: () => openStoredFile(
                    context,
                    ref,
                    id: doc.fileId!,
                    name: doc.fileName.isEmpty ? doc.title : doc.fileName,
                    mime: doc.data['mime'] as String?,
                  ),
                ),
              OrvButton(
                label: 'Read again',
                small: true,
                variant: ButtonVariant.ghost,
                onPressed: () => actions.reread(doc.id),
              ),
              const Spacer(),
              OrvButton(
                label: 'Save',
                variant: ButtonVariant.primary,
                onPressed: () async {
                  final nav = Navigator.of(context);
                  await actions.update(doc.id, {
                    'title': _title!.text.trim(),
                    'category': _category,
                    'summary': _summary!.text,
                    'expiresOn': _expires!.isEmpty ? null : _expires,
                    'remind': _remind,
                  });
                  nav.pop();
                },
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _NoteSheet extends ConsumerStatefulWidget {
  const _NoteSheet();
  @override
  ConsumerState<_NoteSheet> createState() => _NoteSheetState();
}

class _NoteSheetState extends ConsumerState<_NoteSheet> {
  final _title = TextEditingController();
  final _text = TextEditingController();
  @override
  void dispose() {
    _title.dispose();
    _text.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('New note', style: OrvText.heading(l)),
          const SizedBox(height: 10),
          OrvField(key: const Key('note-title'), label: 'Title (optional)', controller: _title),
          const SizedBox(height: 10),
          OrvField(key: const Key('note-text'), label: 'Note', controller: _text, maxLines: 6, autofocus: true),
          const SizedBox(height: 6),
          Text(
            'ORVYN reads notes to title and tag them. Secrets belong in the Vault, not here.',
            style: OrvText.muted(l).copyWith(fontSize: 12),
          ),
          const SizedBox(height: 12),
          Align(
            alignment: Alignment.centerRight,
            child: OrvButton(
              label: 'Save note',
              variant: ButtonVariant.primary,
              onPressed: () async {
                if (_text.text.trim().isEmpty && _title.text.trim().isEmpty) return;
                final nav = Navigator.of(context);
                final toaster = Toaster.of(context);
                await ref.read(libraryActionsProvider).addNote(title: _title.text, text: _text.text);
                toaster.show('Note saved', tone: ToastTone.success);
                nav.pop();
              },
            ),
          ),
        ],
      ),
    );
  }
}
