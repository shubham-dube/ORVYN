import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../app/smart_add.dart';
import '../app/state.dart';
import '../app/today.dart';
import '../design/controls.dart';
import '../design/glass.dart';
import '../design/theme.dart';
import '../design/toast.dart';
import 'sheets.dart';
import 'task_sheet.dart';

/// Quick add (spec 0012 A4/A5): type it the way you'd say it; what ORVYN understood appears as chips you can tap to
/// change or × to read literally. No date written → the Inbox (shown as a faint chip). ⤢ opens the full form.
class QuickAdd extends ConsumerStatefulWidget {
  const QuickAdd({super.key, this.focus = false});
  final bool focus;
  @override
  ConsumerState<QuickAdd> createState() => _QuickAddState();
}

class _QuickAddState extends ConsumerState<QuickAdd> {
  final _c = TextEditingController();
  final _focus = FocusNode();
  ParsedTask? _parsed;
  String _parsedFor = '';
  final _literal = <List<int>>[];
  Timer? _debounce;

  /// a day or time picked from a chip; wins over what the words say
  String? _day;
  TimeOfDay? _time;

  @override
  void initState() {
    super.initState();
    _c.addListener(_onText);
    _focus.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _focus.dispose();
    _c.dispose();
    super.dispose();
  }

  bool get _empty => _c.text.trim().isEmpty;

  void _onText() {
    final text = _c.text;
    setState(() {});
    _literal.removeWhere((r) => r[1] > text.length);
    _debounce?.cancel();
    if (text.trim().length < 2) {
      if (_parsed != null) setState(() => _parsed = null);
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 220), _parse);
  }

  Future<void> _parse() async {
    final text = _c.text;
    final p = await parseOnline(ref, text, [..._literal]);
    if (!mounted || _c.text != text) return;
    setState(() {
      _parsed = p;
      _parsedFor = text;
    });
  }

  ParsedTask? get _p => _parsedFor == _c.text ? _parsed : null;

  /// The fields to save: the parse, then the chips the person changed.
  Map<String, dynamic> _fields(ParsedTask? p) {
    final f = p?.fields() ?? {'title': _c.text.trim()};
    if (_day != null || _time != null) {
      final cur = p?.dueAt != null ? DateTime.parse(p!.dueAt!).toLocal() : null;
      final day = _day ?? (cur != null ? dayKey(cur) : p?.dueDate) ?? dayKey(ref.read(clockProvider)());
      final time = _time ?? (cur != null ? TimeOfDay.fromDateTime(cur) : null);
      final d = DateTime.parse(day);
      if (time != null) {
        f['dueAt'] = DateTime(d.year, d.month, d.day, time.hour, time.minute).toUtc().toIso8601String();
        f['dueDate'] = null;
      } else {
        f['dueAt'] = null;
        f['dueDate'] = day;
      }
    }
    return f;
  }

  void _reset() {
    _c.clear();
    _literal.clear();
    setState(() {
      _parsed = null;
      _day = null;
      _time = null;
    });
  }

  bool _reading = false;

  Future<void> _add() async {
    if (_empty || _reading) return;
    unawaited(HapticFeedback.lightImpact());
    var p = _p;
    // sent before the words were read (a fast tap, a slow network): read them now rather than save them raw
    if (p == null) {
      _debounce?.cancel();
      setState(() => _reading = true);
      p = await parseOnline(ref, _c.text, [..._literal]).timeout(const Duration(seconds: 6), onTimeout: () => null);
      if (!mounted) return;
      setState(() => _reading = false);
    }
    // still nothing (offline): the words as typed, in the Inbox
    if (p != null && looksUnread(p)) p = await parseOnline(ref, _c.text, [..._literal], ai: true) ?? p;
    final f = _fields(p);
    final title = f['title'] as String;
    await ref.read(todayActionsProvider).addParsed(f, newProject: p?.projectName);
    if (!mounted) return;
    final now = ref.read(clockProvider)();
    final day = f['dueAt'] != null ? dayKey(DateTime.parse(f['dueAt'] as String).toLocal()) : f['dueDate'] as String?;
    Toaster.of(context).show(
      day == null ? 'In your Inbox' : 'Added for ${dayWords(day, now).toLowerCase()}',
      body: title,
      tone: ToastTone.success,
    );
    _reset();
  }

  Future<void> _expand() async {
    final p = _p;
    final f = _empty ? <String, dynamic>{} : _fields(p);
    if (p?.projectName != null) f['_newProject'] = p!.projectName;
    _focus.unfocus();
    await openTaskSheet(context, null, initial: f);
    if (mounted && !_empty) _reset();
  }

  Future<void> _pickDay() async {
    final now = ref.read(clockProvider)();
    final d = await showDatePicker(
      context: context,
      initialDate: now,
      firstDate: now.subtract(const Duration(days: 30)),
      lastDate: now.add(const Duration(days: 365 * 5)),
    );
    if (d != null) setState(() => _day = dayKey(d));
  }

  Future<void> _pickTime() async {
    final t = await showTimePicker(context: context, initialTime: _time ?? const TimeOfDay(hour: 10, minute: 0));
    if (t != null) setState(() => _time = t);
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final loc = MaterialLocalizations.of(context);
    final now = ref.watch(clockProvider)();
    final p = _p;
    final open = _focus.hasFocus || !_empty;
    final hasDay = _day != null || (p != null && (p.dueAt != null || p.dueDate != null));

    IconData iconOf(String kind) => switch (kind) {
      'date' => LucideIcons.calendar,
      'time' => LucideIcons.clock,
      'duration' => LucideIcons.timer,
      'repeat' => LucideIcons.repeat,
      'priority' => LucideIcons.flag,
      'project' => LucideIcons.folder,
      'tag' => LucideIcons.hash,
      'deadline' => LucideIcons.flagTriangleRight,
      'notes' => LucideIcons.stickyNote,
      _ => LucideIcons.sparkle,
    };

    final chips = <Widget>[
      if (p != null)
        for (final s in p.spans)
          if (!(s.kind == 'date' && _day != null) && !(s.kind == 'time' && _time != null))
            _Understood(
              icon: iconOf(s.kind),
              label: chipLabel(
                s,
                p,
                (d) => dayWords(dayKey(d), now),
                (t) => loc.formatTimeOfDay(TimeOfDay.fromDateTime(t)),
              ),
              tone: s.kind == 'priority'
                  ? [l.c.faint, l.c.faint, l.c.warning, l.c.danger][p.priority.clamp(0, 3)]
                  : (s.kind == 'deadline' ? l.c.warning : null),
              onTap: switch (s.kind) {
                'date' => _pickDay,
                'time' => _pickTime,
                _ => _expand,
              },
              onRemove: () {
                _literal.add([s.start, s.end]);
                _parse();
              },
              removeLabel: 'Not a ${s.kind}: “${s.text}”',
            ),
      if (_day != null)
        _Understood(
          icon: LucideIcons.calendar,
          label: dayWords(_day!, now),
          onTap: _pickDay,
          onRemove: () => setState(() => _day = null),
          removeLabel: 'Clear the day',
        ),
      if (_time != null)
        _Understood(
          icon: LucideIcons.clock,
          label: loc.formatTimeOfDay(_time!),
          onTap: _pickTime,
          onRemove: () => setState(() => _time = null),
          removeLabel: 'Clear the time',
        ),
      if (!_empty && !hasDay) _GhostChip(icon: LucideIcons.inbox, label: 'Inbox · pick a day', onTap: _pickDay),
    ];

    return AnimatedContainer(
      duration: OrvTokens.durationBase,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(OrvTokens.radiusLg),
        boxShadow: _focus.hasFocus
            ? [BoxShadow(color: l.accent.withValues(alpha: l.dark ? 0.30 : 0.20), spreadRadius: 3.5)]
            : const [],
      ),
      child: Stack(
        children: [
          Glass(
            level: GlassLevel.float,
            padding: EdgeInsets.fromLTRB(14, 2, 6, open ? 10 : 2),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    AnimatedSwitcher(
                      duration: OrvTokens.durationFast,
                      child: Icon(
                        _empty ? LucideIcons.plus : LucideIcons.sparkles,
                        key: ValueKey(_empty),
                        color: l.accent,
                        size: 20,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: TextField(
                        key: const Key('quick-add'),
                        controller: _c,
                        focusNode: _focus,
                        autofocus: widget.focus,
                        textInputAction: TextInputAction.done,
                        textCapitalization: TextCapitalization.sentences,
                        onSubmitted: (_) => _add(),
                        style: OrvText.body(l).copyWith(fontSize: 16),
                        decoration: bareInput(
                          l,
                          hint: 'Add a task… “call mom tmr 6pm”',
                          padding: const EdgeInsets.symmetric(vertical: 14),
                        ),
                      ),
                    ),
                    if (_empty)
                      IconButton(
                        tooltip: 'How to write it',
                        visualDensity: VisualDensity.compact,
                        icon: Icon(LucideIcons.info, size: 18, color: l.c.faint),
                        onPressed: () => showGlassSheet<void>(
                          context,
                          (_) => QuickAddTips(
                            onUse: (s) {
                              _c.text = s;
                              _c.selection = TextSelection.collapsed(offset: s.length);
                              _focus.requestFocus();
                            },
                          ),
                        ),
                      ),
                    IconButton(
                      key: const Key('quick-add-expand'),
                      tooltip: _empty ? 'New task with all the details' : 'Open the full form',
                      visualDensity: VisualDensity.compact,
                      icon: Icon(LucideIcons.maximize2, size: 18, color: _empty ? l.c.faint : l.c.muted),
                      onPressed: _expand,
                    ),
                    AnimatedSwitcher(
                      duration: OrvTokens.durationFast,
                      transitionBuilder: (c, a) => ScaleTransition(scale: a, child: c),
                      child: _empty
                          ? const SizedBox(width: 4, key: ValueKey('none'))
                          : Semantics(
                              container: true,
                              key: const ValueKey('add'),
                              button: true,
                              label: 'Add task',
                              child: GestureDetector(
                                onTap: _add,
                                child: Container(
                                  width: 36,
                                  height: 36,
                                  margin: const EdgeInsets.only(left: 2, right: 4),
                                  decoration: BoxDecoration(
                                    gradient: l.accentGradient,
                                    shape: BoxShape.circle,
                                    boxShadow: [
                                      BoxShadow(
                                        color: l.accentFrom.withValues(alpha: 0.4),
                                        blurRadius: 12,
                                        offset: const Offset(0, 4),
                                      ),
                                    ],
                                  ),
                                  child: _reading
                                      ? const Padding(
                                          padding: EdgeInsets.all(10),
                                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                                        )
                                      : const Icon(LucideIcons.arrowUp, size: 18, color: Colors.white),
                                ),
                              ),
                            ),
                    ),
                  ],
                ),
                AnimatedSize(
                  duration: OrvTokens.durationBase,
                  curve: springSmooth,
                  alignment: Alignment.topLeft,
                  child: chips.isEmpty
                      ? (open && _empty
                            ? Padding(
                                padding: const EdgeInsets.only(left: 28, bottom: 2),
                                child: Text(
                                  'when · time · for 30m · !! · @project · #tag · by fri · // notes',
                                  style: OrvText.muted(l).copyWith(fontSize: 12, color: l.c.faint),
                                ),
                              )
                            : const SizedBox(width: double.infinity))
                      : Padding(
                          padding: const EdgeInsets.only(left: 28, right: 6, bottom: 2),
                          child: Semantics(
                            container: true,
                            label: 'Understood',
                            explicitChildNodes: true,
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                if (p != null && p.spans.isNotEmpty && p.title != _c.text.trim())
                                  Padding(
                                    padding: const EdgeInsets.only(bottom: 6),
                                    child: Text(
                                      p.title,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: OrvText.muted(l).copyWith(fontWeight: FontWeight.w600, color: l.c.text),
                                    ),
                                  ),
                                Wrap(spacing: 6, runSpacing: 6, children: chips),
                              ],
                            ),
                          ),
                        ),
                ),
              ],
            ),
          ),
          // the card's own edge turns the accent while typing: one border, never a box inside a box
          Positioned.fill(
            child: IgnorePointer(
              child: AnimatedContainer(
                duration: OrvTokens.durationBase,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(OrvTokens.radiusLg),
                  border: Border.all(color: _focus.hasFocus ? l.accent : Colors.transparent, width: 1.2),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Understood extends StatelessWidget {
  const _Understood({
    required this.icon,
    required this.label,
    required this.onTap,
    required this.onRemove,
    required this.removeLabel,
    this.tone,
  });
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final VoidCallback onRemove;
  final String removeLabel;
  final Color? tone;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final c = tone ?? l.accent;
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0.85, end: 1),
      duration: OrvTokens.durationBase,
      curve: springSnappy,
      builder: (_, s, child) => Transform.scale(scale: s, child: child),
      child: Container(
        height: 30,
        padding: const EdgeInsets.only(left: 9),
        decoration: BoxDecoration(
          color: c.withValues(alpha: l.dark ? 0.18 : 0.10),
          borderRadius: BorderRadius.circular(OrvTokens.radiusFull),
          border: Border.all(color: c.withValues(alpha: 0.35)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            GestureDetector(
              onTap: onTap,
              child: Row(
                children: [
                  Icon(icon, size: 13, color: c),
                  const SizedBox(width: 5),
                  Text(
                    label,
                    style: OrvText.muted(l)
                        .copyWith(fontSize: 12.5, fontWeight: FontWeight.w600, color: l.dark ? Colors.white : c),
                  ),
                ],
              ),
            ),
            Semantics(
              container: true,
              button: true,
              label: removeLabel,
              excludeSemantics: true,
              child: GestureDetector(
                onTap: onRemove,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(4, 4, 7, 4),
                  child: Icon(LucideIcons.x, size: 12, color: c.withValues(alpha: 0.75)),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _GhostChip extends StatelessWidget {
  const _GhostChip({required this.icon, required this.label, required this.onTap});
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return Semantics(
      container: true,
      button: true,
      label: label,
      excludeSemantics: true,
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          height: 30,
          padding: const EdgeInsets.symmetric(horizontal: 10),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(OrvTokens.radiusFull),
            border: Border.all(color: l.c.edge),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 13, color: l.c.faint),
              const SizedBox(width: 5),
              Text(label, style: OrvText.muted(l).copyWith(fontSize: 12.5, color: l.c.faint)),
            ],
          ),
        ),
      ),
    );
  }
}

/// The short way to write a task, with examples to try (spec 0012 A4).
class QuickAddTips extends StatelessWidget {
  const QuickAddTips({super.key, required this.onUse});
  final ValueChanged<String> onUse;
  static const _rows = [
    (LucideIcons.calendar, 'When', 'today · tmr · fri · next mon · 22 nov · in 3 days · kal · parso'),
    (LucideIcons.clock, 'Time', '3pm · 3 PM · 3:30pm · 15:00 · at 6 · shaam 6 baje'),
    (LucideIcons.timer, 'Duration', 'for 45m · 1h · 1h30 · 1.5h — or a range: 3-4pm'),
    (LucideIcons.flag, 'Priority', '! low · !! medium · !!! high · p1 · urgent'),
    (LucideIcons.folder, 'Project', '@work (a new name offers to make it)'),
    (LucideIcons.hash, 'Tags', '#design #frontend'),
    (LucideIcons.flagTriangleRight, 'Deadline', 'by fri · due 30 nov · deadline mon'),
    (LucideIcons.repeat, 'Repeat', 'every day · weekdays · every mon · every 1st'),
    (LucideIcons.stickyNote, 'Notes', 'everything after //'),
  ];
  static const _examples = [
    'call mom tmr 6pm for 15m !! @home // ask about the trip',
    'review PR fri 3-4pm @work #frontend by mon',
    'pay rent every 1st !',
  ];

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return StickySheet(
      title: 'Write it the way you say it',
      footer: Text(
        'No day written → it waits in your Inbox. Tap a chip to change it; × reads those words literally.',
        style: OrvText.muted(l).copyWith(fontSize: 12),
      ),
      children: [
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(color: l.c.field, borderRadius: BorderRadius.circular(OrvTokens.radiusMd)),
          child: Text(
            'what  when  time  [for 30m]  [!!]  [@project]  [#tag]  [by fri]  [// notes]',
            style: OrvText.body(l).copyWith(fontFamily: monoFamily, fontSize: 12.5),
          ),
        ),
        const SizedBox(height: 12),
        for (final (icon, name, how) in _rows)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(icon, size: 16, color: l.accent),
                const SizedBox(width: 10),
                SizedBox(
                  width: 72,
                  child: Text(name, style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600)),
                ),
                Expanded(child: Text(how, style: OrvText.muted(l))),
              ],
            ),
          ),
        const SizedBox(height: 10),
        const SectionLabel('Try one'),
        const SizedBox(height: 6),
        for (final e in _examples)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: InkWell(
              borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
              onTap: () {
                Navigator.of(context).pop();
                onUse(e);
              },
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
                  border: Border.all(color: l.c.edge),
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(e, style: OrvText.body(l).copyWith(fontFamily: monoFamily, fontSize: 12.5)),
                    ),
                    Icon(LucideIcons.cornerDownLeft, size: 15, color: l.c.faint),
                  ],
                ),
              ),
            ),
          ),
      ],
    );
  }
}
