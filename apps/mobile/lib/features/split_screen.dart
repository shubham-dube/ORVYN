import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../app/calendar.dart' show urlOpenerProvider;
import '../app/state.dart';
import '../design/controls.dart';
import '../design/glass.dart';
import '../design/theme.dart';
import '../design/toast.dart';
import '../money/money.dart' show formatMoney;
import 'common.dart';
import 'sheets.dart';

typedef J = Map<String, dynamic>;

final splitGroupsProvider = FutureProvider.autoDispose<List<J>>(
  (ref) async => [for (final x in await ref.read(apiProvider).get<List<dynamic>>('/split/groups')) x as J],
);
final splitGroupProvider = FutureProvider.autoDispose.family<J, String>((ref, id) {
  final sub = ref.watch(realtimeProvider).messages.listen((m) {
    if (m['type'] == 'split.changed' && m['groupId'] == id) ref.invalidateSelf();
  });
  ref.onDispose(sub.cancel);
  return ref.read(apiProvider).get<J>('/split/groups/$id');
});

String _m(num paise) => formatMoney(paise.toInt());
const _kindEmoji = {'trip': '🧳', 'party': '🎉', 'home': '🏠', 'other': '👥'};
const _catEmoji = {
  'food': '🍽️',
  'stay': '🏨',
  'travel': '🚕',
  'drinks': '🍻',
  'tickets': '🎟️',
  'shopping': '🛍️',
  'other': '🧾',
};
String _today() => DateTime.now().toIso8601String().substring(0, 10);

Widget _owe(OrvLook l, num v, {double size = 14}) => Text(
  v == 0
      ? 'settled'
      : v > 0
      ? 'gets ${_m(v)}'
      : 'owes ${_m(-v)}',
  style: TextStyle(
    fontFamily: fontFamily,
    fontSize: size,
    fontWeight: FontWeight.w700,
    color: v > 0
        ? l.c.success
        : v < 0
        ? l.c.danger
        : l.c.muted,
  ),
);

/// Split (spec 0011 part B): trips and parties — who paid, who owes, and the fewest transfers to settle.
class SplitListScreen extends ConsumerWidget {
  const SplitListScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final groups = ref.watch(splitGroupsProvider);
    return OrvModule(
      module: 'split',
      child: Builder(
        builder: (context) {
          final l = context.orv;
          final list = groups.value ?? const [];
          final owe = list
              .where((g) => (g['myBalance'] as num) < 0)
              .fold<num>(0, (s, g) => s - (g['myBalance'] as num));
          final get = list
              .where((g) => (g['myBalance'] as num) > 0)
              .fold<num>(0, (s, g) => s + (g['myBalance'] as num));
          return RefreshIndicator(
            color: l.accent,
            onRefresh: () async => ref.invalidate(splitGroupsProvider),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 56, 16, 120),
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    const Expanded(child: PageTitle('Split', overline: 'Who paid, who owes')),
                    Padding(
                      padding: const EdgeInsets.only(bottom: 16),
                      child: OrvButton(
                        label: 'New group',
                        small: true,
                        variant: ButtonVariant.primary,
                        icon: LucideIcons.plus,
                        onPressed: () => showGlassSheet<void>(context, (_) => const _NewGroupSheet()),
                      ),
                    ),
                  ],
                ),
                Row(
                  children: [
                    Expanded(
                      child: Glass(
                        padding: const EdgeInsets.all(14),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('YOU GET BACK', style: OrvText.label(l).copyWith(fontSize: 10.5)),
                            Text(_m(get), style: OrvText.heading(l).copyWith(color: l.c.success)),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Glass(
                        padding: const EdgeInsets.all(14),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('YOU OWE', style: OrvText.label(l).copyWith(fontSize: 10.5)),
                            Text(_m(owe), style: OrvText.heading(l).copyWith(color: l.c.danger)),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                if (groups.isLoading && list.isEmpty) const LinearProgressIndicator(minHeight: 2),
                if (!groups.isLoading && list.isEmpty)
                  Text('No groups yet. Make one for a trip or a party — friends or guests.', style: OrvText.muted(l)),
                for (final g in list)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: GestureDetector(
                      onTap: () => context.push('/split/${g['id']}'),
                      child: Glass(
                        blur: false,
                        padding: const EdgeInsets.all(14),
                        child: Row(
                          children: [
                            Text(_kindEmoji[g['kind']] ?? '👥', style: const TextStyle(fontSize: 26)),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    g['name'] as String,
                                    style: OrvText.body(l).copyWith(fontWeight: FontWeight.w700),
                                  ),
                                  Text(
                                    '${g['members']} people · ${_m(g['totalMinor'] as num)} spent',
                                    style: OrvText.muted(l).copyWith(fontSize: 12.5),
                                  ),
                                ],
                              ),
                            ),
                            _owe(l, g['myBalance'] as num),
                          ],
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _NewGroupSheet extends ConsumerStatefulWidget {
  const _NewGroupSheet();
  @override
  ConsumerState<_NewGroupSheet> createState() => _NewGroupSheetState();
}

class _NewGroupSheetState extends ConsumerState<_NewGroupSheet> {
  final _name = TextEditingController();
  final _guest = TextEditingController();
  final _phone = TextEditingController();
  String _kind = 'trip';
  List<J> _people = const [];
  final _chosen = <String>{};
  final _guests = <J>[];

  @override
  void initState() {
    super.initState();
    _name.addListener(() => setState(() {}));
    _guest.addListener(() => setState(() {}));
    ref.read(apiProvider).get<List<dynamic>>('/split/groups/people').then((r) {
      if (mounted) setState(() => _people = [for (final x in r) x as J]);
    }, onError: (_) {});
  }

  @override
  void dispose() {
    _name.dispose();
    _guest.dispose();
    _phone.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final s = ref.watch(sessionProvider);
    final canChat = s is SignedIn && s.me.can('chat');
    return StickySheet(
      title: 'New group',
      footer: Align(
        alignment: Alignment.centerRight,
        child: OrvButton(
          label: 'Make the group',
          variant: ButtonVariant.primary,
          onPressed: _name.text.trim().isEmpty
              ? null
              : () async {
                  final g = await ref.read(apiProvider).post<J>('/split/groups', {
                    'name': _name.text.trim(),
                    'kind': _kind,
                    'memberIds': _chosen.toList(),
                    'guests': _guests,
                    'withChat': canChat,
                  });
                  ref.invalidate(splitGroupsProvider);
                  if (!context.mounted) return;
                  Navigator.of(context).pop();
                  await context.push('/split/${g['id']}');
                },
        ),
      ),
      children: [
        OrvField(label: 'Name', controller: _name, autofocus: true, hint: 'Goa trip'),
        const SizedBox(height: 8),
        Wrap(
          spacing: 6,
          children: [
            for (final e in _kindEmoji.entries)
              ChoiceChip(
                label: Text('${e.value} ${e.key}'),
                selected: _kind == e.key,
                showCheckmark: false,
                onSelected: (_) => setState(() => _kind = e.key),
              ),
          ],
        ),
        if (_people.isNotEmpty) ...[
          const SizedBox(height: 10),
          Text('FRIENDS ON ORVYN', style: OrvText.label(l)),
          for (final p in _people)
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              dense: true,
              title: Text(
                (p['name'] as String?)?.isNotEmpty == true
                    ? p['name'] as String
                    : (p['email'] as String).split('@').first,
                style: OrvText.body(l),
              ),
              value: _chosen.contains(p['id']),
              onChanged: (v) => setState(() => v == true ? _chosen.add(p['id'] as String) : _chosen.remove(p['id'])),
            ),
        ],
        const SizedBox(height: 10),
        Text('GUESTS (NOT ON ORVYN)', style: OrvText.label(l)),
        for (final g in _guests)
          ListTile(
            contentPadding: EdgeInsets.zero,
            dense: true,
            title: Text(g['name'] as String),
            subtitle: Text(g['phone'] as String),
            trailing: IconButton(
              icon: const Icon(LucideIcons.x, size: 16),
              onPressed: () => setState(() => _guests.remove(g)),
            ),
          ),
        Row(
          children: [
            Expanded(
              child: OrvField(label: 'Guest name', controller: _guest),
            ),
            const SizedBox(width: 8),
            SizedBox(
              width: 130,
              child: OrvField(label: 'Phone', controller: _phone, keyboardType: TextInputType.phone),
            ),
            TextButton(
              onPressed: _guest.text.trim().isEmpty
                  ? null
                  : () => setState(() {
                      _guests.add({'name': _guest.text.trim(), 'phone': _phone.text.trim()});
                      _guest.clear();
                      _phone.clear();
                    }),
              child: const Text('Add'),
            ),
          ],
        ),
      ],
    );
  }
}

class SplitGroupScreen extends ConsumerWidget {
  const SplitGroupScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final g = ref.watch(splitGroupProvider(id)).value;
    final s = ref.watch(sessionProvider);
    final meId = s is SignedIn ? s.me.id : null;
    return OrvModule(
      module: 'split',
      child: Builder(
        builder: (context) {
          final l = context.orv;
          if (g == null) return const Scaffold(body: Center(child: CircularProgressIndicator()));
          final members = (g['members'] as List).cast<J>();
          final name = {for (final m in members) m['id'] as String: m['name'] as String};
          final mine = members.where((m) => m['userId'] == meId).firstOrNull;
          final api = ref.read(apiProvider);
          final toaster = Toaster.of(context);
          Future<void> remind(String memberId) async {
            try {
              final r = await api.post<J>('/split/groups/$id/members/$memberId/remind');
              if (r['whatsapp'] != null) {
                await ref.read(urlOpenerProvider)(Uri.parse(r['whatsapp'] as String));
              } else {
                toaster.show('Reminder sent', tone: ToastTone.success);
              }
            } catch (e) {
              toaster.show('Couldn’t remind', body: messageFor(e), tone: ToastTone.danger);
            }
          }

          return Scaffold(
            floatingActionButton: FloatingActionButton.extended(
              onPressed: () =>
                  showGlassSheet<void>(context, (_) => ExpenseSheet(group: g, meMemberId: mine?['id'] as String?)),
              icon: const Icon(LucideIcons.plus),
              label: const Text('Add expense'),
            ),
            body: SafeArea(
              child: RefreshIndicator(
                onRefresh: () async => ref.invalidate(splitGroupProvider(id)),
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 100),
                  children: [
                    Row(
                      children: [
                        IconButton(
                          tooltip: 'Back',
                          icon: Icon(LucideIcons.arrowLeft, color: l.c.text),
                          onPressed: () => context.canPop() ? context.pop() : context.go('/split'),
                        ),
                        Expanded(
                          child: PageTitle(
                            g['name'] as String,
                            overline:
                                '${_kindEmoji[g['kind']]} ${members.length} people · ${_m(g['totalMinor'] as num)}',
                          ),
                        ),
                        if (g['conversationId'] != null)
                          IconButton(
                            tooltip: 'Group chat',
                            icon: Icon(LucideIcons.messageCircle, color: l.accent),
                            onPressed: () => context.push('/chat/${g['conversationId']}'),
                          ),
                        IconButton(
                          tooltip: 'Copy summary',
                          icon: Icon(LucideIcons.copy, color: l.c.muted),
                          onPressed: () async {
                            final t = await api.get<J>('/split/groups/$id/summary');
                            await Clipboard.setData(ClipboardData(text: t['text'] as String));
                            toaster.show('Summary copied — paste it anywhere');
                          },
                        ),
                      ],
                    ),
                    if (mine != null)
                      Glass(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('YOU', style: OrvText.label(l)),
                            _owe(l, mine['balance'] as num, size: 22),
                            Text(
                              'paid ${_m(mine['paid'] as num)} · your share ${_m(mine['consumed'] as num)}',
                              style: OrvText.muted(l).copyWith(fontSize: 12.5),
                            ),
                          ],
                        ),
                      ),
                    const SizedBox(height: 12),
                    Glass(
                      padding: const EdgeInsets.fromLTRB(14, 12, 6, 6),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Text('SETTLE UP', style: OrvText.label(l)),
                          if ((g['plan'] as List).isEmpty)
                            Padding(
                              padding: const EdgeInsets.symmetric(vertical: 8),
                              child: Text('Everyone is square. 🎉', style: OrvText.muted(l)),
                            ),
                          for (final t in (g['plan'] as List).cast<J>())
                            Padding(
                              padding: const EdgeInsets.symmetric(vertical: 4),
                              child: Row(
                                children: [
                                  Expanded(
                                    child: Text(
                                      '${t['fromName']} → ${t['toName']}',
                                      style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600),
                                    ),
                                  ),
                                  Text(
                                    _m(t['amount'] as num),
                                    style: OrvText.body(l).copyWith(fontWeight: FontWeight.w700),
                                  ),
                                  PopupMenuButton<String>(
                                    tooltip: 'Settle ${t['fromName']} to ${t['toName']}',
                                    onSelected: (v) async {
                                      if (v == 'paid') {
                                        await showGlassSheet<void>(
                                          context,
                                          (_) => _PaymentSheet(groupId: id, members: members, plan: t),
                                        );
                                      } else if (v == 'remind') {
                                        await remind(t['from'] as String);
                                      } else if (v == 'upi') {
                                        await ref.read(urlOpenerProvider)(
                                          Uri.parse(
                                            'upi://pay?pa=${Uri.encodeComponent(t['toUpi'] as String)}&pn=${Uri.encodeComponent(t['toName'] as String)}&am=${((t['amount'] as num) / 100).toStringAsFixed(2)}&cu=INR&tn=${Uri.encodeComponent(g['name'] as String)}',
                                          ),
                                        );
                                      }
                                    },
                                    itemBuilder: (_) => [
                                      const PopupMenuItem(value: 'paid', child: Text('Record payment')),
                                      if (t['from'] != mine?['id'])
                                        const PopupMenuItem(value: 'remind', child: Text('Remind')),
                                      if ((t['toUpi'] as String).isNotEmpty && t['from'] == mine?['id'])
                                        const PopupMenuItem(value: 'upi', child: Text('Pay by UPI')),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 12),
                    Glass(
                      padding: const EdgeInsets.fromLTRB(14, 12, 14, 6),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Text('EXPENSES', style: OrvText.label(l)),
                          if ((g['expenses'] as List).isEmpty)
                            Padding(
                              padding: const EdgeInsets.symmetric(vertical: 8),
                              child: Text('Nothing yet — add the first bill.', style: OrvText.muted(l)),
                            ),
                          for (final e in (g['expenses'] as List).cast<J>())
                            InkWell(
                              onTap: () => showGlassSheet<void>(
                                context,
                                (_) => ExpenseSheet(group: g, meMemberId: mine?['id'] as String?, expense: e),
                              ),
                              child: Padding(
                                padding: const EdgeInsets.symmetric(vertical: 8),
                                child: Row(
                                  children: [
                                    Text(_catEmoji[e['category']] ?? '🧾', style: const TextStyle(fontSize: 20)),
                                    const SizedBox(width: 10),
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Text(
                                            e['title'] as String,
                                            style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600),
                                          ),
                                          Text(
                                            'paid by ${(e['paid'] as List).cast<J>().map((p) => name[p['memberId']]).join(' + ')}',
                                            style: OrvText.muted(l).copyWith(fontSize: 12),
                                          ),
                                        ],
                                      ),
                                    ),
                                    Column(
                                      crossAxisAlignment: CrossAxisAlignment.end,
                                      children: [
                                        Text(
                                          _m(e['amount'] as num),
                                          style: OrvText.body(l).copyWith(fontWeight: FontWeight.w700),
                                        ),
                                        if (mine != null)
                                          Text(
                                            'you ${_m((e['shares'] as List).cast<J>().where((x) => x['memberId'] == mine['id']).fold<num>(0, (a, x) => a + (x['amount'] as num)))}',
                                            style: OrvText.muted(l).copyWith(fontSize: 12),
                                          ),
                                      ],
                                    ),
                                  ],
                                ),
                              ),
                            ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 12),
                    Glass(
                      padding: const EdgeInsets.fromLTRB(14, 12, 6, 6),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Text('PEOPLE', style: OrvText.label(l)),
                          for (final m in members)
                            Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    '${m['name']}${m['guest'] == true ? ' · guest' : ''}',
                                    style: OrvText.body(l).copyWith(fontSize: 14),
                                  ),
                                ),
                                _owe(l, m['balance'] as num, size: 13),
                                if (m['guest'] == true)
                                  IconButton(
                                    tooltip: 'Copy ${m['name']}’s link',
                                    icon: Icon(LucideIcons.link2, size: 16, color: l.c.muted),
                                    onPressed: () async {
                                      final r = await api.post<J>('/split/groups/$id/members/${m['id']}/link');
                                      await Clipboard.setData(ClipboardData(text: r['url'] as String));
                                      toaster.show('${m['name']}’s link copied');
                                    },
                                  )
                                else
                                  const SizedBox(width: 48),
                              ],
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

const _methods = {'equal': 'Equally', 'exact': 'Exact ₹', 'percent': '%', 'shares': 'Shares'};

/// Add or change an expense on the phone: who paid (one person or several), and how it splits.
class ExpenseSheet extends ConsumerStatefulWidget {
  const ExpenseSheet({super.key, required this.group, required this.meMemberId, this.expense});
  final J group;
  final String? meMemberId;
  final J? expense;
  @override
  ConsumerState<ExpenseSheet> createState() => _ExpenseSheetState();
}

class _ExpenseSheetState extends ConsumerState<ExpenseSheet> {
  late final List<J> _members = (widget.group['members'] as List).cast<J>();
  late final _title = TextEditingController(text: widget.expense?['title'] as String? ?? '');
  late final _amount = TextEditingController(
    text: widget.expense == null ? '' : ((widget.expense!['amount'] as num) / 100).toString(),
  );
  late String _category = widget.expense?['category'] as String? ?? 'food';
  late bool _many = ((widget.expense?['paid'] as List?)?.length ?? 1) > 1;
  late String _payer =
      (widget.expense?['paid'] as List?)?.cast<J>().first['memberId'] as String? ??
      widget.meMemberId ??
      _members.first['id'] as String;
  late final Map<String, TextEditingController> _paid = {
    for (final m in _members)
      m['id'] as String: TextEditingController(
        text:
            (widget.expense?['paid'] as List? ?? const [])
                .cast<J>()
                .where((p) => p['memberId'] == m['id'])
                .map((p) => ((p['amount'] as num) / 100).toString())
                .firstOrNull ??
            '',
      ),
  };
  late String _method = widget.expense?['method'] as String? ?? 'equal';
  late final Map<String, TextEditingController> _among = {
    for (final m in _members)
      m['id'] as String: TextEditingController(
        text: widget.expense == null
            ? '1'
            : (widget.expense!['among'] as List)
                      .cast<J>()
                      .where((a) => a['memberId'] == m['id'])
                      .map((a) => '${a['value']}')
                      .firstOrNull ??
                  '',
      ),
  };
  late final Set<String> _equal = {
    for (final m in _members)
      if (widget.expense == null || (widget.expense!['among'] as List).cast<J>().any((a) => a['memberId'] == m['id']))
        m['id'] as String,
  };
  String? _problem;

  @override
  void initState() {
    super.initState();
    _amount.addListener(() => setState(() {}));
    _title.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _title.dispose();
    _amount.dispose();
    for (final c in [..._paid.values, ..._among.values]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    final amount = num.tryParse(_amount.text) ?? 0;
    final among = _method == 'equal'
        ? [
            for (final id in _equal) {'memberId': id, 'value': 0},
          ]
        : [
            for (final e in _among.entries)
              if (e.value.text.trim().isNotEmpty) {'memberId': e.key, 'value': num.tryParse(e.value.text) ?? 0},
          ];
    final body = {
      'title': _title.text.trim(),
      'amount': amount,
      'date': widget.expense?['date'] ?? _today(),
      'category': _category,
      'paid': _many
          ? [
              for (final e in _paid.entries)
                if ((num.tryParse(e.value.text) ?? 0) > 0) {'memberId': e.key, 'amount': num.parse(e.value.text)},
            ]
          : [
              {'memberId': _payer, 'amount': amount},
            ],
      'split': {'method': _method, 'among': among},
    };
    final api = ref.read(apiProvider);
    final gid = widget.group['id'] as String;
    try {
      if (widget.expense == null) {
        await api.post<dynamic>('/split/groups/$gid/expenses', body);
      } else {
        await api.put<dynamic>('/split/groups/$gid/expenses/${widget.expense!['id']}', body);
      }
      ref.invalidate(splitGroupProvider(gid));
      ref.invalidate(splitGroupsProvider);
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      setState(() => _problem = messageFor(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return StickySheet(
      title: widget.expense == null ? 'Add an expense' : 'Change the expense',
      footer: Row(
        children: [
          if (widget.expense != null)
            TextButton(
              onPressed: () async {
                final gid = widget.group['id'] as String;
                await ref.read(apiProvider).delete<dynamic>('/split/groups/$gid/expenses/${widget.expense!['id']}');
                ref.invalidate(splitGroupProvider(gid));
                if (context.mounted) Navigator.of(context).pop();
              },
              child: const Text('Remove'),
            ),
          Expanded(
            child: Text(_problem ?? '', style: OrvText.muted(l).copyWith(color: l.c.danger, fontSize: 12)),
          ),
          OrvButton(
            label: 'Save',
            variant: ButtonVariant.primary,
            onPressed: _title.text.trim().isEmpty || (num.tryParse(_amount.text) ?? 0) <= 0 ? null : _save,
          ),
        ],
      ),
      children: [
        OrvField(label: 'What for', controller: _title, autofocus: widget.expense == null),
        const SizedBox(height: 8),
        OrvField(label: 'Amount (₹)', controller: _amount, keyboardType: TextInputType.number),
        const SizedBox(height: 8),
        Wrap(
          spacing: 6,
          runSpacing: 4,
          children: [
            for (final c in _catEmoji.entries)
              ChoiceChip(
                label: Text('${c.value} ${c.key}'),
                selected: _category == c.key,
                showCheckmark: false,
                onSelected: (_) => setState(() => _category = c.key),
              ),
          ],
        ),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: Text('Several people paid', style: OrvText.body(l)),
          value: _many,
          onChanged: (v) => setState(() => _many = v),
        ),
        if (!_many)
          Wrap(
            spacing: 6,
            children: [
              for (final m in _members)
                ChoiceChip(
                  label: Text('${m['name']} paid'),
                  selected: _payer == m['id'],
                  showCheckmark: false,
                  onSelected: (_) => setState(() => _payer = m['id'] as String),
                ),
            ],
          )
        else
          for (final m in _members)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: OrvField(
                label: '${m['name']} paid (₹)',
                controller: _paid[m['id']]!,
                keyboardType: TextInputType.number,
              ),
            ),
        const SizedBox(height: 8),
        Text('HOW IT SPLITS', style: OrvText.label(l)),
        Wrap(
          spacing: 6,
          children: [
            for (final e in _methods.entries)
              ChoiceChip(
                label: Text(e.value),
                selected: _method == e.key,
                showCheckmark: false,
                onSelected: (_) => setState(() {
                  _method = e.key;
                  for (final c in _among.values) {
                    c.text = e.key == 'shares'
                        ? '1'
                        : e.key == 'percent'
                        ? (100 / _members.length).toStringAsFixed(0)
                        : '';
                  }
                }),
              ),
          ],
        ),
        for (final m in _members)
          _method == 'equal'
              ? CheckboxListTile(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  title: Text(m['name'] as String),
                  value: _equal.contains(m['id']),
                  onChanged: (v) => setState(() => v == true ? _equal.add(m['id'] as String) : _equal.remove(m['id'])),
                )
              : Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: OrvField(
                    label: '${m['name']} (${_methods[_method]})',
                    controller: _among[m['id']]!,
                    keyboardType: TextInputType.number,
                  ),
                ),
      ],
    );
  }
}

class _PaymentSheet extends ConsumerStatefulWidget {
  const _PaymentSheet({required this.groupId, required this.members, required this.plan});
  final String groupId;
  final List<J> members;
  final J plan;
  @override
  ConsumerState<_PaymentSheet> createState() => _PaymentSheetState();
}

class _PaymentSheetState extends ConsumerState<_PaymentSheet> {
  late final _amount = TextEditingController(text: ((widget.plan['amount'] as num) / 100).toStringAsFixed(2));
  String _method = 'UPI';

  @override
  void dispose() {
    _amount.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return StickySheet(
      title: '${widget.plan['fromName']} paid ${widget.plan['toName']}',
      footer: Align(
        alignment: Alignment.centerRight,
        child: OrvButton(
          label: 'Record',
          variant: ButtonVariant.primary,
          onPressed: () async {
            await ref.read(apiProvider).post<dynamic>('/split/groups/${widget.groupId}/settlements', {
              'fromId': widget.plan['from'],
              'toId': widget.plan['to'],
              'amount': num.tryParse(_amount.text) ?? 0,
              'method': _method,
              'date': _today(),
            });
            ref.invalidate(splitGroupProvider(widget.groupId));
            ref.invalidate(splitGroupsProvider);
            if (context.mounted) Navigator.of(context).pop();
          },
        ),
      ),
      children: [
        OrvField(label: 'Amount (₹)', controller: _amount, keyboardType: TextInputType.number),
        const SizedBox(height: 8),
        Wrap(
          spacing: 6,
          children: [
            for (final x in const ['UPI', 'Cash', 'Bank'])
              ChoiceChip(
                label: Text(x),
                selected: _method == x,
                showCheckmark: false,
                onSelected: (_) => setState(() => _method = x),
              ),
          ],
        ),
        const SizedBox(height: 6),
        Text('ORVYN never moves money — this records what happened.', style: OrvText.muted(l).copyWith(fontSize: 12)),
      ],
    );
  }
}
