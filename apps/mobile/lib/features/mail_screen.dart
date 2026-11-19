import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../app/calendar.dart' show urlOpenerProvider;
import '../design/controls.dart';
import '../design/glass.dart';
import '../design/theme.dart';
import 'common.dart';
import 'connections.dart';
import 'sheets.dart';
import 'tools.dart';

/// Mail on the phone (spec 0008 C): unread mail from the last week across Gmail and every connected mailbox,
/// one mailbox or all, and any mail into a task. Read-only: nothing is marked read here.
class MailScreen extends ConsumerStatefulWidget {
  const MailScreen({super.key});
  @override
  ConsumerState<MailScreen> createState() => _MailScreenState();
}

class _MailScreenState extends ConsumerState<MailScreen> {
  String _box = '';

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final boxes = ref.watch(mailProvider);
    final list = boxes.value ?? const [];
    final shown = _box.isEmpty ? list : list.where((b) => b['connectionId'] == _box).toList();
    final total = list.fold<int>(0, (a, b) => a + ((b['unread'] as num?)?.toInt() ?? 0));
    return Scaffold(
      body: SafeArea(
        child: RefreshIndicator(
          color: l.accent,
          onRefresh: () async => ref.invalidate(mailProvider),
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
                  Expanded(child: PageTitle('Mail', overline: list.isEmpty ? null : '$total unread this week')),
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
              if (boxes.isLoading && list.isEmpty) const LinearProgressIndicator(minHeight: 2),
              if (!boxes.isLoading && list.isEmpty)
                Glass(
                  padding: const EdgeInsets.all(18),
                  child: Column(
                    children: [
                      Icon(LucideIcons.mail, size: 28, color: l.c.faint),
                      const SizedBox(height: 8),
                      Text('No mailbox yet', style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600)),
                      const SizedBox(height: 4),
                      Text(
                        'Add Gmail to a Google account, or connect Zoho, Outlook or any IMAP mailbox with an app password.',
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
              if (list.length > 1)
                SizedBox(
                  height: 40,
                  child: ListView(
                    scrollDirection: Axis.horizontal,
                    children: [
                      for (final b in [
                        <String, dynamic>{'connectionId': '', 'account': 'All'},
                        ...list,
                      ])
                        Padding(
                          padding: const EdgeInsets.only(right: 6),
                          child: ChoiceChip(
                            label: Text(b['connectionId'] == '' ? 'All' : '${b['account']} · ${b['unread']}'),
                            selected: _box == b['connectionId'],
                            showCheckmark: false,
                            visualDensity: VisualDensity.compact,
                            onSelected: (_) => setState(() => _box = b['connectionId'] as String),
                            selectedColor: l.accent.withValues(alpha: 0.16),
                            side: BorderSide(color: _box == b['connectionId'] ? l.accent : l.c.edge),
                            backgroundColor: Colors.transparent,
                          ),
                        ),
                    ],
                  ),
                ),
              for (final b in shown) ...[
                Padding(
                  padding: const EdgeInsets.fromLTRB(4, 14, 4, 6),
                  child: Row(
                    children: [
                      ProviderMark(provider: b['provider'] == 'gmail' ? 'google' : 'mail', size: 18),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          b['account'] as String,
                          style: OrvText.muted(l).copyWith(fontWeight: FontWeight.w600, fontSize: 13),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      Text('${b['unread']} unread', style: OrvText.muted(l).copyWith(fontSize: 12)),
                    ],
                  ),
                ),
                if (b['problem'] != null)
                  Text(b['problem'] as String, style: OrvText.muted(l).copyWith(color: l.c.danger, fontSize: 12.5)),
                if ((b['items'] as List? ?? const []).isEmpty && b['problem'] == null)
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
                    child: Text('Nothing unread this week.', style: OrvText.muted(l)),
                  )
                else
                  Glass(
                    blur: false,
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
                    child: Column(
                      children: [
                        for (final (n, raw) in (b['items'] as List).indexed) ...[
                          if (n > 0) Divider(height: 1, color: l.c.edge),
                          _MailRow(mail: Map<String, dynamic>.from(raw as Map)),
                        ],
                      ],
                    ),
                  ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _MailRow extends ConsumerWidget {
  const _MailRow({required this.mail});
  final Map<String, dynamic> mail;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final from = (mail['from'] as String).replaceAll(RegExp('<.*>'), '').trim();
    final at = DateTime.tryParse('${mail['at']}')?.toLocal();
    final loc = MaterialLocalizations.of(context);
    return InkWell(
      onTap: mail['url'] == null ? null : () => ref.read(urlOpenerProvider)(Uri.parse(mail['url'] as String)),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: Row(
          children: [
            OrvAvatar(name: from.isEmpty ? '?' : from, size: 34),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          from.isEmpty ? mail['from'] as String : from,
                          style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      if (at != null)
                        Text(loc.formatShortMonthDay(at), style: OrvText.muted(l).copyWith(fontSize: 11.5)),
                    ],
                  ),
                  Text(
                    mail['subject'] as String,
                    style: OrvText.muted(l).copyWith(fontSize: 13),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            IconButton(
              tooltip: 'Make a task: ${mail['subject']}',
              icon: Icon(LucideIcons.listPlus, size: 18, color: l.accent),
              onPressed: () => showGlassSheet<void>(context, (_) => MailTaskSheet(mail: mail)),
            ),
          ],
        ),
      ),
    );
  }
}
