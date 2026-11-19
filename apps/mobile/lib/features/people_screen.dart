import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../app/state.dart';
import '../design/controls.dart';
import '../design/glass.dart';
import '../design/theme.dart';
import '../design/toast.dart';
import 'common.dart';
import 'sheets.dart';

/// The modules a person can be given (the server checks them again on every call — ADR-0005).
const peopleModules = <(String, String, IconData)>[
  ('today', 'Today', LucideIcons.circleCheck),
  ('drop', 'Drop', LucideIcons.inbox),
  ('money', 'Money', LucideIcons.wallet),
  ('library', 'Library', LucideIcons.bookOpen),
  ('vault', 'Vault', LucideIcons.lockKeyhole),
  ('assistant', 'Assistant', LucideIcons.sparkles),
  ('brief', 'Brief', LucideIcons.sunrise),
  ('chat', 'Chat', LucideIcons.messageCircle),
  ('split', 'Split', LucideIcons.receipt),
  ('ipo', 'IPO', LucideIcons.trendingUp),
];

final peopleProvider = FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) async {
  final r = await ref.read(apiProvider).get<List<dynamic>>('/admin/users');
  return [for (final x in r) Map<String, dynamic>.from(x as Map)];
});

final invitesProvider = FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) async {
  final r = await ref.read(apiProvider).get<List<dynamic>>('/admin/invites');
  return [for (final x in r) Map<String, dynamic>.from(x as Map)];
});

String _seen(String? iso) {
  if (iso == null) return 'Not signed in yet';
  final d = DateTime.now().difference(DateTime.parse(iso));
  if (d.inMinutes < 5) return 'Active now';
  if (d.inHours < 1) return 'Seen ${d.inMinutes} min ago';
  if (d.inDays < 1) return 'Seen ${d.inHours} h ago';
  return 'Seen ${d.inDays} d ago';
}

/// People (owner only, spec 0008 C): everyone you invited, what each can open, and invites by link.
class PeopleScreen extends ConsumerWidget {
  const PeopleScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.orv;
    final s = ref.watch(sessionProvider);
    final owner = s is SignedIn && s.me.isOwner;
    final people = ref.watch(peopleProvider);
    final invites = (ref.watch(invitesProvider).value ?? const []).where((i) => i['usedAt'] == null).toList();
    return Scaffold(
      body: SafeArea(
        child: RefreshIndicator(
          color: l.accent,
          onRefresh: () async {
            ref.invalidate(peopleProvider);
            ref.invalidate(invitesProvider);
          },
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 40),
            children: [
              Row(
                children: [
                  IconButton(
                    onPressed: () => context.canPop() ? context.pop() : context.go('/settings'),
                    icon: Icon(LucideIcons.arrowLeft, color: l.c.text),
                    tooltip: 'Back',
                  ),
                  const Expanded(child: PageTitle('People')),
                  if (owner)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: OrvButton(
                        label: 'Invite',
                        small: true,
                        variant: ButtonVariant.primary,
                        icon: LucideIcons.userPlus,
                        onPressed: () => showGlassSheet<void>(context, (_) => const InviteSheet()),
                      ),
                    ),
                ],
              ),
              if (!owner)
                Text('Only the owner manages people.', style: OrvText.muted(l))
              else ...[
                switch (people) {
                  AsyncData(:final value) => Glass(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
                    child: Column(
                      children: [
                        for (var i = 0; i < value.length; i++) ...[
                          if (i > 0) Divider(height: 1, color: l.c.edge),
                          _PersonRow(person: value[i]),
                        ],
                      ],
                    ),
                  ),
                  AsyncError() => Text('Couldn’t load people.', style: OrvText.muted(l)),
                  _ => const LinearProgressIndicator(minHeight: 2),
                },
                if (invites.isNotEmpty) ...[
                  Padding(
                    padding: const EdgeInsets.fromLTRB(4, 20, 4, 8),
                    child: Text('WAITING INVITES  ${invites.length}', style: OrvText.label(l)),
                  ),
                  Glass(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
                    child: Column(
                      children: [
                        for (final i in invites)
                          Row(
                            children: [
                              Icon(LucideIcons.mailOpen, size: 17, color: l.c.muted),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Padding(
                                  padding: const EdgeInsets.symmetric(vertical: 10),
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        (i['email'] as String?) ?? (i['note'] as String?) ?? 'Anyone with the link',
                                        style: OrvText.body(l),
                                      ),
                                      Text(
                                        '${(i['entitlements'] as List).length} modules · until ${(i['expiresAt'] as String).substring(0, 10)}',
                                        style: OrvText.muted(l).copyWith(fontSize: 12),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                              IconButton(
                                tooltip: 'Cancel invite',
                                icon: Icon(LucideIcons.x, size: 17, color: l.c.muted),
                                onPressed: () async {
                                  await ref.read(apiProvider).delete<dynamic>('/admin/invites/${i['id']}');
                                  ref.invalidate(invitesProvider);
                                },
                              ),
                            ],
                          ),
                      ],
                    ),
                  ),
                ],
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _PersonRow extends StatelessWidget {
  const _PersonRow({required this.person});
  final Map<String, dynamic> person;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final name = (person['name'] as String?)?.isNotEmpty == true ? person['name'] as String : person['email'] as String;
    final owner = person['role'] == 'owner';
    final ents = (person['entitlements'] as List).cast<String>();
    final disabled = person['disabled'] == true;
    final mods = peopleModules.where((m) => ents.contains(m.$1)).map((m) => m.$2).toList();
    return InkWell(
      onTap: owner ? null : () => showGlassSheet<void>(context, (_) => PersonSheet(person: person)),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: Row(
          children: [
            Opacity(
              opacity: disabled ? 0.45 : 1,
              child: OrvAvatar(name: name, size: 38),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(name, style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600)),
                  Text(
                    owner
                        ? 'Everything · ${_seen(person['lastSeenAt'] as String?)}'
                        : disabled
                        ? 'Paused'
                        : '${mods.isEmpty ? 'No modules' : mods.join(', ')} · ${_seen(person['lastSeenAt'] as String?)}',
                    style: OrvText.muted(l).copyWith(fontSize: 12.5),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            if (owner) const OrvBadge('owner') else Icon(LucideIcons.chevronRight, size: 17, color: l.c.faint),
          ],
        ),
      ),
    );
  }
}

/// One person: what they can open (a switch per module, saved as you flip it) and pause/resume.
class PersonSheet extends ConsumerStatefulWidget {
  const PersonSheet({super.key, required this.person});
  final Map<String, dynamic> person;
  @override
  ConsumerState<PersonSheet> createState() => _PersonSheetState();
}

class _PersonSheetState extends ConsumerState<PersonSheet> {
  late final Set<String> _ents = {...(widget.person['entitlements'] as List).cast<String>()};
  late bool _disabled = widget.person['disabled'] == true;

  Future<void> _set(String key, bool on) async {
    final toaster = Toaster.of(context);
    setState(() => on ? _ents.add(key) : _ents.remove(key));
    try {
      await ref.read(apiProvider).put<dynamic>('/admin/users/${widget.person['id']}/entitlements', {
        'entitlements': _ents.toList(),
      });
      ref.invalidate(peopleProvider);
    } catch (e) {
      setState(() => on ? _ents.remove(key) : _ents.add(key));
      toaster.show('Couldn’t change that', body: messageFor(e), tone: ToastTone.danger);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final p = widget.person;
    final name = (p['name'] as String?)?.isNotEmpty == true ? p['name'] as String : p['email'] as String;
    return StickySheet(
      title: name,
      footer: Row(
        children: [
          Expanded(child: Text(p['email'] as String, style: OrvText.muted(l).copyWith(fontSize: 12))),
          OrvButton(
            label: _disabled ? 'Resume access' : 'Pause access',
            small: true,
            variant: _disabled ? ButtonVariant.primary : ButtonVariant.ghost,
            onPressed: () async {
              final next = !_disabled;
              await ref.read(apiProvider).put<dynamic>('/admin/users/${p['id']}/disabled', {'disabled': next});
              setState(() => _disabled = next);
              ref.invalidate(peopleProvider);
            },
          ),
        ],
      ),
      children: [
        Text('What they can open', style: OrvText.label(l)),
        const SizedBox(height: 4),
        for (final (key, label, icon) in peopleModules)
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            secondary: Icon(icon, size: 19, color: _ents.contains(key) ? l.accent : l.c.muted),
            title: Text(label, style: OrvText.body(l)),
            value: _ents.contains(key),
            onChanged: _disabled ? null : (v) => _set(key, v),
          ),
        const SizedBox(height: 4),
        Text(
          'Their data stays theirs: you choose what they can open, never what is inside.',
          style: OrvText.muted(l).copyWith(fontSize: 12),
        ),
      ],
    );
  }
}

/// A new invite: an email (optional), the modules, then a link to share once.
class InviteSheet extends ConsumerStatefulWidget {
  const InviteSheet({super.key});
  @override
  ConsumerState<InviteSheet> createState() => _InviteSheetState();
}

class _InviteSheetState extends ConsumerState<InviteSheet> {
  final _email = TextEditingController();
  final Set<String> _mods = {'today', 'drop', 'money', 'library'};
  String? _link;
  bool _busy = false;

  @override
  void dispose() {
    _email.dispose();
    super.dispose();
  }

  Future<void> _create() async {
    setState(() => _busy = true);
    final toaster = Toaster.of(context);
    try {
      final r = await ref.read(apiProvider).post<Map<String, dynamic>>('/admin/invites', {
        if (_email.text.trim().isNotEmpty) 'email': _email.text.trim(),
        'entitlements': _mods.toList(),
        'expiresInDays': 7,
      });
      ref.invalidate(invitesProvider);
      setState(() => _link = r['link'] as String?);
    } catch (e) {
      toaster.show('Couldn’t create the invite', body: messageFor(e), tone: ToastTone.danger);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    if (_link != null) {
      return StickySheet(
        title: 'Invite ready',
        footer: Align(
          alignment: Alignment.centerRight,
          child: OrvButton(
            label: 'Copy link',
            variant: ButtonVariant.primary,
            icon: LucideIcons.copy,
            onPressed: () async {
              final toaster = Toaster.of(context);
              await Clipboard.setData(ClipboardData(text: _link!));
              toaster.show('Link copied — it is shown only once', tone: ToastTone.success);
            },
          ),
        ),
        children: [
          SelectableText(_link!, style: OrvText.body(l)),
          const SizedBox(height: 8),
          Text('Send it on WhatsApp or mail. It works once, for 7 days.', style: OrvText.muted(l)),
        ],
      );
    }
    return StickySheet(
      title: 'Invite someone',
      footer: Align(
        alignment: Alignment.centerRight,
        child: OrvButton(
          label: 'Create link',
          variant: ButtonVariant.primary,
          loading: _busy,
          onPressed: _mods.isEmpty ? null : _create,
        ),
      ),
      children: [
        OrvField(
          label: 'Their email (optional)',
          controller: _email,
          keyboardType: TextInputType.emailAddress,
          hint: 'Only this address can use the link',
        ),
        const SizedBox(height: 10),
        Text('WHAT THEY CAN OPEN', style: OrvText.label(l)),
        const SizedBox(height: 6),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            for (final (key, label, _) in peopleModules)
              FilterChip(
                label: Text(label),
                selected: _mods.contains(key),
                showCheckmark: false,
                onSelected: (v) => setState(() => v ? _mods.add(key) : _mods.remove(key)),
                selectedColor: l.accent.withValues(alpha: 0.16),
                side: BorderSide(color: _mods.contains(key) ? l.accent : l.c.edge),
                backgroundColor: Colors.transparent,
              ),
          ],
        ),
      ],
    );
  }
}
