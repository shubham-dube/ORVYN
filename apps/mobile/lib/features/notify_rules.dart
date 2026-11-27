import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../app/state.dart';
import '../core/api.dart';
import '../design/controls.dart';
import '../design/theme.dart';
import '../design/toast.dart';

typedef NotifyJson = Map<String, dynamic>;

/// Every kind of notification ORVYN sends (spec 0019), from the server so the phone and the web share one list.
final notifyCatalogProvider = FutureProvider.autoDispose<NotifyJson>(
  (ref) => ref.read(apiProvider).get<NotifyJson>('/notifications/catalog'),
);
final _channelsProvider = FutureProvider.autoDispose<NotifyJson>(
  (ref) => ref.read(apiProvider).get<NotifyJson>('/notifications/channels'),
);

const _ways = ['push', 'urgent', 'alarm', 'email', 'whatsapp'];
const _wayWord = {'push': 'Push', 'urgent': 'Urgent', 'alarm': 'Alarm', 'email': 'Email', 'whatsapp': 'WhatsApp'};
const _wayIcon = {
  'push': LucideIcons.bell,
  'urgent': LucideIcons.siren,
  'alarm': LucideIcons.alarmClock,
  'email': LucideIcons.mail,
  'whatsapp': LucideIcons.messageCircle,
};

/// Urgent and Alarm both imply a push and don't stack; turning push off takes them with it (same as the web).
List<String> toggleWay(List<String> ways, String w) {
  final has = ways.contains(w);
  var out = has ? ways.where((x) => x != w).toList() : [...ways, w];
  if (!has && (w == 'urgent' || w == 'alarm') && !out.contains('push')) out = ['push', ...out];
  if (!has && w == 'alarm') out.remove('urgent');
  if (!has && w == 'urgent') out.remove('alarm');
  if (has && w == 'push') out = out.where((x) => x != 'urgent' && x != 'alarm').toList();
  return out;
}

/// Per kind: on or off, the ways, a sample (spec 0019). Grouped by module; only the modules this person has.
class NotifyRules extends ConsumerStatefulWidget {
  const NotifyRules({super.key, required this.settings, required this.onSave});
  final NotifyJson settings;
  final Future<void> Function(NotifyJson) onSave;
  @override
  ConsumerState<NotifyRules> createState() => _NotifyRulesState();
}

class _NotifyRulesState extends ConsumerState<NotifyRules> {
  final _open = <String>{};
  late NotifyJson _rules = Map<String, dynamic>.from((widget.settings['rules'] as Map?) ?? const {});

  @override
  void didUpdateWidget(covariant NotifyRules old) {
    super.didUpdateWidget(old);
    _rules = Map<String, dynamic>.from((widget.settings['rules'] as Map?) ?? const {});
  }

  /// "Send one of each": where the run is, and what it is sending
  int? _at;
  String _now = '';
  bool _stop = false;

  /// Every kind this person has, a sample each, a few seconds apart so each can be seen (and an alarm answered),
  /// each through the ways set for it — the whole set up, end to end.
  Future<void> _sweep(List<NotifyJson> types) async {
    final toaster = Toaster.of(context);
    final api = ref.read(apiProvider);
    var sent = 0;
    final missed = <String>[];
    _stop = false;
    for (final (i, t) in types.indexed) {
      if (_stop || !mounted) break;
      setState(() {
        _at = i;
        _now = t['label'] as String? ?? t['key'] as String;
      });
      try {
        await api.post<dynamic>('/notifications/sample', {'type': t['key']});
        sent++;
      } on ApiError catch (e) {
        missed.add('${t['label']}: ${e.message}');
      }
      if (i < types.length - 1) await Future<void>.delayed(const Duration(seconds: 6));
    }
    if (!mounted) return;
    setState(() => _at = null);
    toaster.show(
      '$sent of ${types.length} samples sent',
      body: missed.isEmpty ? 'Each came the ways set for it. Off kinds were skipped.' : missed.take(3).join('\n'),
      tone: missed.isEmpty ? ToastTone.success : ToastTone.danger,
    );
  }

  Future<void> _set(String key, NotifyJson? rule) async {
    setState(() => rule == null ? _rules.remove(key) : _rules[key] = rule);
    await widget.onSave({...widget.settings, 'rules': _rules});
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final cat = ref.watch(notifyCatalogProvider).value;
    final wa = ref.watch(_channelsProvider).value?['whatsapp'] as Map?;
    final waOk = wa?['verified'] == true;
    final s = ref.watch(sessionProvider);
    final me = s is SignedIn ? s.me : null;
    if (cat == null) return const LinearProgressIndicator(minHeight: 2);
    bool can(String module) => switch (module) {
      'core' => true,
      'inbox' => me?.can('today') ?? false,
      _ => me?.can(module) ?? false,
    };
    final names = Map<String, dynamic>.from(cat['modules'] as Map);
    final types = [for (final t in cat['types'] as List) Map<String, dynamic>.from(t as Map)];
    final modules = <String>{
      for (final t in types)
        if (can(t['module'] as String)) t['module'] as String,
    }.toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('What reaches you, and how', style: OrvText.heading(l).copyWith(fontSize: 15.5)),
        const SizedBox(height: 2),
        Text(
          'Everything lands in the bell. Choose more for each kind — or switch it off.',
          style: OrvText.muted(l).copyWith(fontSize: 12.5),
        ),
        const SizedBox(height: 8),
        Builder(
          builder: (context) {
            final all = [
              for (final t in types)
                if (can(t['module'] as String) && (_rules[t['key']] as Map?)?['on'] != false) t,
            ];
            return _at == null
                ? Align(
                    alignment: Alignment.centerLeft,
                    child: OrvButton(
                      label: 'Send one of each (${all.length})',
                      small: true,
                      icon: LucideIcons.send,
                      onPressed: all.isEmpty ? null : () => _sweep(all),
                    ),
                  )
                : Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Text(
                              'Sending ${_at! + 1} of ${all.length}: $_now',
                              style: OrvText.body(l).copyWith(fontSize: 13),
                            ),
                            const SizedBox(height: 4),
                            LinearProgressIndicator(value: (_at! + 1) / all.length, minHeight: 3),
                          ],
                        ),
                      ),
                      const SizedBox(width: 8),
                      OrvButton(label: 'Stop', small: true, onPressed: () => _stop = true),
                    ],
                  );
          },
        ),
        const SizedBox(height: 4),
        for (final m in modules) ...[
          GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: () => setState(() => _open.contains(m) ? _open.remove(m) : _open.add(m)),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 10),
              child: Row(
                children: [
                  Expanded(
                    child: Text(names[m] as String? ?? m, style: OrvText.body(l).copyWith(fontWeight: FontWeight.w700)),
                  ),
                  Text(
                    '${types.where((t) => t['module'] == m).length} kinds',
                    style: OrvText.muted(l).copyWith(fontSize: 12),
                  ),
                  const SizedBox(width: 6),
                  Icon(_open.contains(m) ? LucideIcons.chevronUp : LucideIcons.chevronDown, size: 17, color: l.c.muted),
                ],
              ),
            ),
          ),
          if (_open.contains(m))
            Padding(
              padding: const EdgeInsets.only(left: 4, right: 4, bottom: 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (final t in types.where((t) => t['module'] == m))
                    _TypeRow(
                      t: t,
                      rule: (_rules[t['key']] as Map?)?.cast<String, dynamic>(),
                      waOk: waOk,
                      onSet: (r) => _set(t['key'] as String, r),
                    ),
                ],
              ),
            ),
          Divider(height: 1, color: l.c.hairline),
        ],
      ],
    );
  }
}

class _TypeRow extends ConsumerWidget {
  const _TypeRow({required this.t, required this.rule, required this.waOk, required this.onSet});
  final NotifyJson t;
  final Map<String, dynamic>? rule;
  final bool waOk;
  final Future<void> Function(NotifyJson? rule) onSet;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final managed = t['managedIn'] as Map?;
    final locked = t['locked'] == true;
    final on = (rule?['on'] as bool?) ?? true;
    final ways = [for (final w in (rule?['ways'] as List?) ?? (t['ways'] as List)) w as String];
    return Semantics(
      container: true,
      label: t['label'] as String,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(t['label'] as String, style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600)),
                      Text(t['when'] as String, style: OrvText.muted(l).copyWith(fontSize: 12)),
                    ],
                  ),
                ),
                if (managed == null)
                  Switch(value: on, onChanged: locked ? null : (v) => onSet({'on': v, 'ways': ways})),
              ],
            ),
            if (managed != null)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: GestureDetector(
                  onTap: () => context.push(
                    (managed['href'] as String).startsWith('/settings') ? '/settings/today' : managed['href'] as String,
                  ),
                  child: Text(
                    'Set on each item — ${managed['label']}',
                    style: OrvText.body(l).copyWith(fontSize: 12.5, color: l.accent),
                  ),
                ),
              )
            else if (!on)
              Text('Off — nothing is sent, not even to the bell.', style: OrvText.muted(l).copyWith(fontSize: 12))
            else ...[
              const SizedBox(height: 6),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  for (final w in _ways)
                    if (w != 'alarm' || t['alarm'] == true)
                      FilterChip(
                        key: Key('way-${t['key']}-$w'),
                        avatar: Icon(_wayIcon[w], size: 14),
                        label: Text(_wayWord[w]!),
                        selected: ways.contains(w),
                        showCheckmark: false,
                        visualDensity: VisualDensity.compact,
                        selectedColor: l.accent.withValues(alpha: 0.16),
                        onSelected: w == 'whatsapp' && !waOk && !ways.contains(w)
                            ? null
                            : (_) => onSet({'on': true, 'ways': toggleWay(ways, w)}),
                      ),
                ],
              ),
              Row(
                children: [
                  if (ways.isEmpty) Text('In-app only', style: OrvText.muted(l).copyWith(fontSize: 12)),
                  const Spacer(),
                  if (rule != null) TextButton(onPressed: () => onSet(null), child: const Text('Default')),
                  TextButton.icon(
                    icon: const Icon(LucideIcons.send, size: 14),
                    label: const Text('Sample'),
                    onPressed: () async {
                      final toaster = Toaster.of(context);
                      try {
                        await ref.read(apiProvider).post<dynamic>('/notifications/sample', {'type': t['key']});
                        toaster.show('Sample sent', tone: ToastTone.success);
                      } on ApiError catch (e) {
                        toaster.show(e.message, tone: ToastTone.danger);
                      }
                    },
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
