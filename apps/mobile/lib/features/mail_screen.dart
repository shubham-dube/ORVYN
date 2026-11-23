import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../app/state.dart';
import '../design/controls.dart';
import '../design/glass.dart';
import '../design/theme.dart';
import 'common.dart';
import 'home_cards.dart';
import 'sheets.dart';
import 'tools.dart';

/// Mail on the phone (spec 0017 B): every mailbox, triaged — Important, Updates, Everything else — with a catch-up on
/// top. Swipe a mail away when it's dealt with; long-press for more. Read-only in the mailbox itself.
class MailScreen extends ConsumerStatefulWidget {
  const MailScreen({super.key});
  @override
  ConsumerState<MailScreen> createState() => _MailScreenState();
}

class _MailScreenState extends ConsumerState<MailScreen> {
  String _box = '';
  bool _restOpen = false;
  bool _checking = false;

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final inbox = ref.watch(inboxProvider);
    final v = inbox.value;
    final boxes = [for (final b in (v?['boxes'] as List? ?? const [])) Map<String, dynamic>.from(b as Map)];
    final accounts = [for (final b in boxes) b['account'] as String];
    List<Map<String, dynamic>> group(String k) => [
      for (final x in (v?[k] as List? ?? const []))
        if (_box.isEmpty || (x as Map)['account'] == _box) Map<String, dynamic>.from(x as Map),
    ];
    final important = group('important'), updates = group('updates'), rest = group('rest');
    final total = important.length + updates.length + rest.length;
    Widget section(String title, String hint, List<Map<String, dynamic>> items, {bool collapsible = false}) {
      if (items.isEmpty) return const SizedBox.shrink();
      final open = !collapsible || _restOpen;
      return Padding(
        padding: const EdgeInsets.only(top: 12),
        child: Glass(
          blur: false,
          padding: const EdgeInsets.fromLTRB(12, 6, 6, 6),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              InkWell(
                onTap: collapsible ? () => setState(() => _restOpen = !_restOpen) : null,
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  child: Row(
                    children: [
                      Text(title, style: OrvText.heading(l).copyWith(fontSize: 15.5)),
                      const SizedBox(width: 8),
                      OrvBadge('${items.length}'),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          hint,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: OrvText.muted(l).copyWith(fontSize: 12),
                        ),
                      ),
                      if (collapsible)
                        Icon(open ? LucideIcons.chevronUp : LucideIcons.chevronDown, size: 17, color: l.c.muted),
                    ],
                  ),
                ),
              ),
              if (open)
                for (final m in items) SmartMailRow(m: m, accounts: accounts),
            ],
          ),
        ),
      );
    }

    return Scaffold(
      body: SafeArea(
        child: RefreshIndicator(
          color: l.accent,
          onRefresh: () async {
            await ref.read(apiProvider).post<dynamic>('/inbox/refresh');
            ref.invalidate(inboxProvider);
          },
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 40),
            children: [
              Row(
                children: [
                  IconButton(
                    onPressed: () => context.canPop() ? context.pop() : context.go('/'),
                    icon: Icon(LucideIcons.arrowLeft, color: l.c.text),
                    tooltip: 'Back',
                  ),
                  Expanded(
                    child: PageTitle(
                      'Mail',
                      overline: v == null
                          ? 'Reading your mailboxes…'
                          : '$total unread · ${boxes.length} ${boxes.length == 1 ? 'mailbox' : 'mailboxes'}',
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: IconButton(
                      tooltip: 'Check now',
                      icon: _checking
                          ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                          : Icon(LucideIcons.refreshCw, color: l.c.muted, size: 19),
                      onPressed: () async {
                        setState(() => _checking = true);
                        try {
                          await ref.read(apiProvider).post<dynamic>('/inbox/refresh');
                          ref.invalidate(inboxProvider);
                        } finally {
                          if (mounted) setState(() => _checking = false);
                        }
                      },
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: IconButton(
                      tooltip: 'Connect a mailbox',
                      icon: Icon(LucideIcons.plus, color: l.accent),
                      onPressed: () => showGlassSheet<void>(context, (_) => const MailboxSheet()),
                    ),
                  ),
                ],
              ),
              if (inbox.isLoading && v == null) const LinearProgressIndicator(minHeight: 2),
              if (v != null && boxes.isEmpty)
                Glass(
                  padding: const EdgeInsets.all(18),
                  child: Column(
                    children: [
                      Icon(LucideIcons.mail, size: 28, color: l.accent),
                      const SizedBox(height: 8),
                      Text('Connect your mailboxes', style: OrvText.body(l).copyWith(fontWeight: FontWeight.w700)),
                      const SizedBox(height: 4),
                      Text(
                        'Add Gmail to a Google account, or Zoho, Outlook or any IMAP mailbox with an app password. ORVYN reads unread mail (never changes it) and puts what matters first.',
                        textAlign: TextAlign.center,
                        style: OrvText.muted(l),
                      ),
                      const SizedBox(height: 12),
                      OrvButton(
                        label: 'Connect a mailbox',
                        small: true,
                        variant: ButtonVariant.primary,
                        onPressed: () => showGlassSheet<void>(context, (_) => const MailboxSheet()),
                      ),
                    ],
                  ),
                ),
              if (boxes.length > 1)
                SizedBox(
                  height: 40,
                  child: ListView(
                    scrollDirection: Axis.horizontal,
                    children: [
                      for (final a in ['', ...accounts])
                        Padding(
                          padding: const EdgeInsets.only(right: 6),
                          child: ChoiceChip(
                            avatar: a.isEmpty
                                ? null
                                : CircleAvatar(radius: 5, backgroundColor: accountTone(l, a, accounts)),
                            label: Text(a.isEmpty ? 'All' : a),
                            selected: _box == a,
                            showCheckmark: false,
                            visualDensity: VisualDensity.compact,
                            onSelected: (_) => setState(() => _box = a),
                            selectedColor: l.accent.withValues(alpha: 0.16),
                            side: BorderSide(color: _box == a ? l.accent : l.c.edge),
                            backgroundColor: Colors.transparent,
                          ),
                        ),
                    ],
                  ),
                ),
              for (final b in boxes)
                if (b['problem'] != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Text(
                      '${b['account']}: ${b['problem']}',
                      style: OrvText.muted(l).copyWith(color: l.c.danger, fontSize: 12.5),
                    ),
                  ),
              if (v?['catchUp'] != null && _box.isEmpty)
                Container(
                  margin: const EdgeInsets.only(top: 12),
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(OrvTokens.radiusLg),
                    gradient: LinearGradient(
                      colors: [l.accent.withValues(alpha: 0.18), l.accent.withValues(alpha: 0.05)],
                    ),
                    border: Border.all(color: l.accent.withValues(alpha: 0.2)),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Icon(LucideIcons.sparkles, size: 14, color: l.accent),
                          const SizedBox(width: 6),
                          Text(
                            'Catch up',
                            style: OrvText.body(l)
                                .copyWith(fontSize: 12.5, fontWeight: FontWeight.w700, color: l.accent),
                          ),
                        ],
                      ),
                      const SizedBox(height: 6),
                      Text(v!['catchUp'] as String, style: OrvText.body(l).copyWith(fontSize: 15, height: 1.45)),
                    ],
                  ),
                ),
              section('Important', 'people waiting, money due, security', important),
              section('Updates', 'deliveries, travel, invites', updates),
              section('Everything else', 'newsletters, promotions', rest, collapsible: true),
              if (v != null && boxes.isNotEmpty && total == 0)
                Padding(
                  padding: const EdgeInsets.only(top: 20),
                  child: Center(child: Text('Inbox zero across every mailbox. Lovely.', style: OrvText.muted(l))),
                ),
              if (boxes.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 14),
                  child: Text(
                    'Swipe left when a mail is dealt with; long-press for more. Read-only: nothing changes in your mailboxes.',
                    style: OrvText.muted(l).copyWith(fontSize: 11.5),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
