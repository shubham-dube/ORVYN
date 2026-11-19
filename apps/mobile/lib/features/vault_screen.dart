import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../design/controls.dart';
import '../design/glass.dart';
import '../design/theme.dart';
import '../design/toast.dart';
import '../vault/vault.dart';
import '../vault/vault_crypto.dart' show WrongPassphrase, WrongRecoveryKey, generatePassword;
import 'common.dart';
import 'sheets.dart';

/// Vault (spec 0004, ADR-0004): secrets locked on this phone with a passphrase only the person knows. The server, the AI
/// and backups only ever hold scrambled data they cannot read.
class VaultScreen extends ConsumerStatefulWidget {
  const VaultScreen({super.key});
  @override
  ConsumerState<VaultScreen> createState() => _VaultScreenState();
}

class _VaultScreenState extends ConsumerState<VaultScreen> {
  /// shown once, right after setup — even though the vault is already open behind it
  String? _recovery;

  @override
  Widget build(BuildContext context) {
    final v = ref.watch(vaultProvider);
    return OrvModule(
      module: 'vault',
      child: Builder(
        builder: (context) => Listener(
          behavior: HitTestBehavior.translucent,
          onPointerDown: (_) => ref.read(vaultProvider.notifier).touch(),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 56, 16, 120),
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Expanded(
                    child: PageTitle(
                      'Vault',
                      overline: v.status == VaultStatus.unlocked
                          ? '${v.items.length} ${v.items.length == 1 ? 'item' : 'items'} · open on this phone'
                          : 'Only your devices can open it',
                    ),
                  ),
                  if (v.status == VaultStatus.unlocked && _recovery == null) ...[
                    Padding(
                      padding: const EdgeInsets.only(bottom: 16),
                      child: IconButton(
                        tooltip: 'Vault settings',
                        icon: Icon(LucideIcons.settings2, size: 19, color: context.orv.c.muted),
                        onPressed: () => showGlassSheet<void>(context, (_) => const _VaultSettings()),
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.only(bottom: 18),
                      child: OrvButton(
                        label: 'Lock now',
                        small: true,
                        icon: LucideIcons.lock,
                        onPressed: () => ref.read(vaultProvider.notifier).lock(),
                      ),
                    ),
                  ],
                ],
              ),
              if (v.status == VaultStatus.loading) const SizedBox(height: 120),
              if (v.status == VaultStatus.none || _recovery != null)
                _Setup(recovery: _recovery, onRecovery: (k) => setState(() => _recovery = k)),
              if (v.status == VaultStatus.locked && _recovery == null) const _Locked(),
              if (v.status == VaultStatus.unlocked && _recovery == null) const _Open(),
            ],
          ),
        ),
      ),
    );
  }
}

class _Setup extends ConsumerStatefulWidget {
  const _Setup({required this.recovery, required this.onRecovery});
  final String? recovery;
  final ValueChanged<String?> onRecovery;
  @override
  ConsumerState<_Setup> createState() => _SetupState();
}

class _SetupState extends ConsumerState<_Setup> {
  final _pass = TextEditingController();
  final _again = TextEditingController();
  bool _busy = false;
  bool _saved = false;

  @override
  void dispose() {
    _pass.dispose();
    _again.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    if (widget.recovery != null) {
      return Glass(
        level: GlassLevel.float,
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Save your recovery key', style: OrvText.heading(l)),
            const SizedBox(height: 8),
            Text(
              'If you forget your passphrase, this key is the only way back in. ORVYN cannot recover it for you — nobody can. '
              'It is shown once. Write it down and keep it somewhere safe.',
              style: OrvText.muted(l),
            ),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: l.c.field,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: l.c.edge),
              ),
              child: SelectableText(
                widget.recovery!,
                key: const Key('recovery-key'),
                textAlign: TextAlign.center,
                style: OrvText.body(l).copyWith(fontFamily: 'monospace', fontSize: 17, letterSpacing: 1.5),
              ),
            ),
            const SizedBox(height: 10),
            OrvButton(
              label: 'Copy (clears in 30 s)',
              small: true,
              icon: LucideIcons.copy,
              onPressed: () => ref.read(vaultProvider.notifier).copySecret(widget.recovery!),
            ),
            const SizedBox(height: 8),
            OrvSwitchRow(
              label: 'I have saved my recovery key somewhere safe',
              value: _saved,
              onChanged: (v) => setState(() => _saved = v),
            ),
            const SizedBox(height: 8),
            OrvButton(
              label: 'Open my Vault',
              variant: ButtonVariant.primary,
              expand: true,
              onPressed: _saved ? () => widget.onRecovery(null) : null,
            ),
          ],
        ),
      );
    }
    final ok = _pass.text.length >= 10 && _pass.text == _again.text;
    return Glass(
      level: GlassLevel.float,
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Set up your Vault', style: OrvText.heading(l)),
          const SizedBox(height: 8),
          Text(
            'Passwords, cards, IDs, API keys and recovery codes — locked on your phone with a passphrase only you know. '
            'The server, the AI and backups only ever hold scrambled data they cannot read.',
            style: OrvText.muted(l),
          ),
          const SizedBox(height: 12),
          OrvField(
            key: const Key('vault-pass'),
            label: 'Passphrase',
            hint: 'At least 10 characters — a sentence works well',
            controller: _pass,
            obscure: true,
          ),
          const SizedBox(height: 10),
          OrvField(
            key: const Key('vault-pass2'),
            label: 'Again',
            controller: _again,
            obscure: true,
            error: _again.text.isNotEmpty && _again.text != _pass.text ? 'These don’t match yet.' : null,
          ),
          const SizedBox(height: 14),
          ListenableBuilder(
            listenable: Listenable.merge([_pass, _again]),
            builder: (_, _) => OrvButton(
              label: _busy ? 'Creating…' : 'Create my Vault',
              variant: ButtonVariant.primary,
              expand: true,
              loading: _busy,
              onPressed: _pass.text.length >= 10 && _pass.text == _again.text
                  ? () async {
                      setState(() => _busy = true);
                      try {
                        widget.onRecovery(await ref.read(vaultProvider.notifier).setup(_pass.text));
                      } finally {
                        if (mounted) setState(() => _busy = false);
                      }
                    }
                  : null,
            ),
          ),
          if (!ok) const SizedBox.shrink(),
          const SizedBox(height: 8),
          Text(
            'Your passphrase never leaves this phone. If you lose it and the recovery key, the contents are gone for good.',
            style: OrvText.muted(l).copyWith(fontSize: 12, color: l.c.faint),
          ),
        ],
      ),
    );
  }
}

class _Locked extends ConsumerStatefulWidget {
  const _Locked();
  @override
  ConsumerState<_Locked> createState() => _LockedState();
}

class _LockedState extends ConsumerState<_Locked> {
  final _pass = TextEditingController();
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _pass.dispose();
    super.dispose();
  }

  Future<void> _unlock() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(vaultProvider.notifier).unlockWith(_pass.text);
      _pass.clear();
    } on WrongPassphrase {
      if (mounted) setState(() => _error = 'That passphrase isn’t right.');
    } catch (_) {
      if (mounted) setState(() => _error = 'Couldn’t open the Vault.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return Glass(
      level: GlassLevel.float,
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Icon(LucideIcons.lock, color: l.accent),
              const SizedBox(width: 10),
              Text('Vault is locked', style: OrvText.heading(l)),
            ],
          ),
          const SizedBox(height: 4),
          Text('Enter your passphrase to open it.', style: OrvText.muted(l)),
          const SizedBox(height: 12),
          OrvField(
            key: const Key('vault-unlock'),
            label: 'Passphrase',
            controller: _pass,
            obscure: true,
            error: _error,
            onSubmitted: (_) => _unlock(),
          ),
          const SizedBox(height: 12),
          ListenableBuilder(
            listenable: _pass,
            builder: (_, _) => OrvButton(
              label: 'Unlock',
              variant: ButtonVariant.primary,
              expand: true,
              icon: LucideIcons.lockOpen,
              loading: _busy,
              onPressed: _pass.text.isEmpty ? null : _unlock,
            ),
          ),
          TextButton(
            onPressed: () => showGlassSheet<void>(context, (_) => const _RecoverSheet()),
            child: const Align(alignment: Alignment.centerLeft, child: Text('Forgot it? Use my recovery key')),
          ),
        ],
      ),
    );
  }
}

class _RecoverSheet extends ConsumerStatefulWidget {
  const _RecoverSheet();
  @override
  ConsumerState<_RecoverSheet> createState() => _RecoverSheetState();
}

class _RecoverSheetState extends ConsumerState<_RecoverSheet> {
  final _key = TextEditingController();
  final _pass = TextEditingController();
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _key.dispose();
    _pass.dispose();
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
          Text('Recover with your key', style: OrvText.heading(l)),
          const SizedBox(height: 10),
          OrvField(label: 'Recovery key', hint: 'XXXX-XXXX-XXXX-…', controller: _key, error: _error),
          const SizedBox(height: 10),
          OrvField(label: 'New passphrase', hint: 'At least 10 characters', controller: _pass, obscure: true),
          const SizedBox(height: 14),
          ListenableBuilder(
            listenable: Listenable.merge([_key, _pass]),
            builder: (_, _) => OrvButton(
              label: 'Open and set the passphrase',
              variant: ButtonVariant.primary,
              expand: true,
              loading: _busy,
              onPressed: _key.text.isEmpty || _pass.text.length < 10
                  ? null
                  : () async {
                      final nav = Navigator.of(context);
                      final toaster = Toaster.of(context);
                      setState(() {
                        _busy = true;
                        _error = null;
                      });
                      try {
                        await ref.read(vaultProvider.notifier).recover(_key.text, _pass.text);
                        toaster.show('Vault opened', body: 'Your new passphrase is set.', tone: ToastTone.success);
                        nav.pop();
                      } on WrongRecoveryKey {
                        if (mounted) setState(() => _error = 'That recovery key isn’t right.');
                      } catch (_) {
                        if (mounted) setState(() => _error = 'Couldn’t open the Vault.');
                      } finally {
                        if (mounted) setState(() => _busy = false);
                      }
                    },
            ),
          ),
        ],
      ),
    );
  }
}

class _Open extends ConsumerStatefulWidget {
  const _Open();
  @override
  ConsumerState<_Open> createState() => _OpenState();
}

class _OpenState extends ConsumerState<_Open> {
  final _search = TextEditingController();
  String _kind = '';

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final v = ref.watch(vaultProvider);
    final q = _search.text.trim().toLowerCase();
    final shown = [
      for (final i in v.items)
        if ((_kind.isEmpty || i.kind == _kind) &&
            (q.isEmpty || '${i.title} ${i.subtitle} ${i.fields['url'] ?? ''}'.toLowerCase().contains(q)))
          i,
    ];
    final kinds = _kind.isEmpty && q.isEmpty
        ? [
            for (final k in vaultKinds)
              if (shown.any((i) => i.kind == k)) k,
          ]
        : <String>[];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
          decoration: BoxDecoration(
            color: l.c.success.withValues(alpha: 0.10),
            borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
          ),
          child: Row(
            children: [
              Icon(LucideIcons.shieldCheck, size: 16, color: l.c.success),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Encrypted on your devices. The server only ever holds sealed boxes.',
                  style: OrvText.muted(l).copyWith(fontSize: 12.5),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: TextField(
                key: const Key('vault-search'),
                controller: _search,
                onChanged: (_) => setState(() {}),
                style: OrvText.body(l),
                decoration: InputDecoration(
                  isDense: true,
                  filled: true,
                  fillColor: l.c.field,
                  prefixIcon: Icon(LucideIcons.search, size: 16, color: l.c.faint),
                  hintText: 'Titles, usernames, websites',
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
            ),
            const SizedBox(width: 8),
            OrvButton(
              key: const Key('vault-new'),
              label: 'New',
              small: true,
              variant: ButtonVariant.primary,
              icon: LucideIcons.plus,
              onPressed: () => showGlassSheet<void>(context, (_) => const _ItemSheet()),
            ),
          ],
        ),
        SizedBox(
          height: 44,
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.only(top: 8),
            children: [
              for (final k in ['', ...vaultKinds])
                Padding(
                  padding: const EdgeInsets.only(right: 6),
                  child: ChoiceChip(
                    label: Text(k.isEmpty ? 'All' : kindLabel[k]!),
                    selected: _kind == k,
                    showCheckmark: false,
                    visualDensity: VisualDensity.compact,
                    onSelected: (_) => setState(() => _kind = k),
                    selectedColor: l.accent.withValues(alpha: 0.16),
                    side: BorderSide(color: _kind == k ? l.accent : l.c.edge),
                    backgroundColor: Colors.transparent,
                  ),
                ),
            ],
          ),
        ),
        if (v.unreadable > 0)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              '${v.unreadable} item(s) couldn’t be opened with this key.',
              style: OrvText.muted(l).copyWith(color: l.c.warning),
            ),
          ),
        const SizedBox(height: 6),
        if (shown.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 20),
            child: Text(
              v.items.isEmpty
                  ? 'Your Vault is open and empty. Add a login, a card, an ID, an API key, recovery codes or a secure note.'
                  : 'Nothing matches. Try fewer words.',
              style: OrvText.muted(l),
            ),
          )
        else if (kinds.length > 1)
          for (final k in kinds) ...[
            Padding(
              padding: const EdgeInsets.fromLTRB(4, 10, 4, 6),
              child: Text(
                '${kindLabel[k]!.toUpperCase()}  ${shown.where((i) => i.kind == k).length}',
                style: OrvText.label(l),
              ),
            ),
            _VaultGroup(items: shown.where((i) => i.kind == k).toList()),
          ]
        else
          _VaultGroup(items: shown),
      ],
    );
  }
}

const _kindIcon = {
  'login': LucideIcons.keyRound,
  'card': LucideIcons.creditCard,
  'id': LucideIcons.idCard,
  'apikey': LucideIcons.code,
  'recovery': LucideIcons.lifeBuoy,
  'note': LucideIcons.notebookPen,
};

class _VaultGroup extends StatelessWidget {
  const _VaultGroup({required this.items});
  final List<OpenItem> items;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return Glass(
      blur: false,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
      child: Column(
        children: [
          for (var n = 0; n < items.length; n++) ...[
            if (n > 0) Divider(height: 1, color: l.c.edge),
            InkWell(
              onTap: () => showGlassSheet<void>(context, (_) => _ItemSheet(id: items[n].id)),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 10),
                child: Row(
                  children: [
                    Container(
                      width: 34,
                      height: 34,
                      decoration: BoxDecoration(color: l.c.field, borderRadius: BorderRadius.circular(10)),
                      child: Icon(_kindIcon[items[n].kind] ?? LucideIcons.lock, size: 17, color: l.c.muted),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            items[n].title.isEmpty ? kindLabel[items[n].kind]! : items[n].title,
                            style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          Text(
                            items[n].subtitle.isEmpty ? kindLabel[items[n].kind]! : items[n].subtitle,
                            style: OrvText.muted(l).copyWith(fontSize: 12.5),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ],
                      ),
                    ),
                    Icon(LucideIcons.chevronRight, size: 16, color: l.c.faint),
                  ],
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _ItemSheet extends ConsumerStatefulWidget {
  const _ItemSheet({this.id});
  final String? id;
  @override
  ConsumerState<_ItemSheet> createState() => _ItemSheetState();
}

class _ItemSheetState extends ConsumerState<_ItemSheet> {
  late String _kind = 'login';
  final _title = TextEditingController();
  final _notes = TextEditingController();
  final _fields = <String, TextEditingController>{};
  final _shown = <String>{};
  late bool _editing = widget.id == null;
  bool _loaded = false;

  TextEditingController _c(String k) => _fields.putIfAbsent(k, TextEditingController.new);

  @override
  void dispose() {
    _title.dispose();
    _notes.dispose();
    for (final c in _fields.values) {
      c.dispose();
    }
    super.dispose();
  }

  void _load(OpenItem i) {
    _loaded = true;
    _kind = i.kind;
    _title.text = i.title;
    _notes.text = i.notes;
    for (final e in i.fields.entries) {
      _c(e.key).text = e.value;
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final v = ref.watch(vaultProvider);
    final item = widget.id == null ? null : v.items.where((i) => i.id == widget.id).firstOrNull;
    if (widget.id != null && item == null) return const SizedBox(height: 80);
    if (item != null && !_loaded) _load(item);
    final fields = vaultFields[_kind]!;
    final toaster = Toaster.of(context);

    if (!_editing && item != null) {
      return SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 18, 20, 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(item.title.isEmpty ? kindLabel[item.kind]! : item.title, style: OrvText.heading(l)),
            Text(kindLabel[item.kind]!, style: OrvText.muted(l)),
            const SizedBox(height: 10),
            for (final f in fields)
              if ((item.fields[f.key] ?? '').isNotEmpty)
                _SecretRow(
                  label: f.label,
                  value: item.fields[f.key]!,
                  secret: f.secret,
                  shown: _shown.contains(f.key),
                  onToggle: () => setState(() => _shown.contains(f.key) ? _shown.remove(f.key) : _shown.add(f.key)),
                  onCopy: () async {
                    await ref.read(vaultProvider.notifier).copySecret(item.fields[f.key]!);
                    toaster.show('${f.label} copied', body: 'The clipboard clears in 30 seconds.');
                  },
                ),
            if (item.notes.isNotEmpty)
              _SecretRow(
                label: 'Notes',
                value: item.notes,
                secret: true,
                shown: _shown.contains('_notes'),
                onToggle: () =>
                    setState(() => _shown.contains('_notes') ? _shown.remove('_notes') : _shown.add('_notes')),
                onCopy: () => ref.read(vaultProvider.notifier).copySecret(item.notes),
              ),
            const SizedBox(height: 12),
            Row(
              children: [
                OrvButton(
                  label: 'Delete',
                  small: true,
                  variant: ButtonVariant.danger,
                  icon: LucideIcons.trash2,
                  onPressed: () async {
                    final nav = Navigator.of(context);
                    await ref.read(vaultProvider.notifier).removeItem(item.id);
                    toaster.show('Deleted', body: item.title);
                    nav.pop();
                  },
                ),
                const Spacer(),
                OrvButton(
                  label: 'Edit',
                  variant: ButtonVariant.primary,
                  onPressed: () => setState(() => _editing = true),
                ),
              ],
            ),
          ],
        ),
      );
    }

    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(widget.id == null ? 'New Vault item' : 'Edit item', style: OrvText.heading(l)),
          const SizedBox(height: 10),
          if (widget.id == null)
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final k in vaultKinds)
                  ChoiceChip(
                    label: Text(kindLabel[k]!),
                    selected: _kind == k,
                    showCheckmark: false,
                    onSelected: (_) => setState(() => _kind = k),
                    selectedColor: l.accent.withValues(alpha: 0.16),
                    side: BorderSide(color: _kind == k ? l.accent : l.c.edge),
                    backgroundColor: Colors.transparent,
                  ),
              ],
            ),
          const SizedBox(height: 10),
          OrvField(key: const Key('vault-title'), label: 'Title', controller: _title, autofocus: true),
          for (final f in fields) ...[
            const SizedBox(height: 10),
            if (f.generate)
              Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Expanded(
                    child: OrvField(label: f.label, controller: _c(f.key), keyboardType: f.input),
                  ),
                  const SizedBox(width: 8),
                  IconButton(
                    tooltip: 'Generate a password',
                    icon: Icon(LucideIcons.refreshCw, color: l.accent),
                    onPressed: () => setState(() => _c(f.key).text = generatePassword(length: 20)),
                  ),
                ],
              )
            else
              OrvField(
                label: f.label,
                controller: _c(f.key),
                keyboardType: f.multiline ? TextInputType.multiline : f.input,
                maxLines: f.multiline ? 4 : 1,
              ),
          ],
          if (_kind != 'note') ...[const SizedBox(height: 10), OrvField(label: 'Notes', controller: _notes)],
          const SizedBox(height: 14),
          Row(
            children: [
              OrvButton(
                label: 'Cancel',
                variant: ButtonVariant.ghost,
                onPressed: () => widget.id == null ? Navigator.of(context).pop() : setState(() => _editing = false),
              ),
              const Spacer(),
              OrvButton(
                label: 'Save',
                variant: ButtonVariant.primary,
                onPressed: () async {
                  final nav = Navigator.of(context);
                  await ref.read(vaultProvider.notifier).saveItem(widget.id, {
                    'kind': _kind,
                    'title': _title.text.trim().isEmpty ? kindLabel[_kind]! : _title.text.trim(),
                    'fields': {
                      for (final f in fields)
                        if (_c(f.key).text.isNotEmpty) f.key: _c(f.key).text,
                    },
                    'notes': _notes.text,
                  });
                  toaster.show('Saved to your Vault', tone: ToastTone.success);
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

class _SecretRow extends StatelessWidget {
  const _SecretRow({
    required this.label,
    required this.value,
    required this.secret,
    required this.shown,
    required this.onToggle,
    required this.onCopy,
  });
  final String label;
  final String value;
  final bool secret;
  final bool shown;
  final VoidCallback onToggle;
  final VoidCallback onCopy;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Container(
        padding: const EdgeInsets.fromLTRB(12, 8, 4, 8),
        decoration: BoxDecoration(color: l.c.track, borderRadius: BorderRadius.circular(12)),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(label.toUpperCase(), style: OrvText.muted(l).copyWith(fontSize: 11)),
                  Text(
                    secret && !shown ? '••••••••••' : value,
                    key: Key('secret-$label'),
                    style: OrvText.body(l).copyWith(fontFamily: 'monospace'),
                  ),
                ],
              ),
            ),
            if (secret)
              IconButton(
                tooltip: '${shown ? 'Hide' : 'Show'} $label',
                icon: Icon(shown ? LucideIcons.eyeOff : LucideIcons.eye, size: 18),
                onPressed: onToggle,
              ),
            IconButton(tooltip: 'Copy $label', icon: const Icon(LucideIcons.copy, size: 18), onPressed: onCopy),
          ],
        ),
      ),
    );
  }
}

class _VaultSettings extends ConsumerStatefulWidget {
  const _VaultSettings();
  @override
  ConsumerState<_VaultSettings> createState() => _VaultSettingsState();
}

class _VaultSettingsState extends ConsumerState<_VaultSettings> {
  final _old = TextEditingController();
  final _new = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _old.dispose();
    _new.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final v = ref.watch(vaultProvider);
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Vault settings', style: OrvText.heading(l)),
          const SizedBox(height: 12),
          const SectionLabel('Lock automatically'),
          const SizedBox(height: 6),
          Wrap(
            spacing: 6,
            children: [
              for (final (m, name) in const [(1, '1 min'), (5, '5 min'), (15, '15 min'), (30, '30 min'), (0, 'Never')])
                ChoiceChip(
                  label: Text(name),
                  selected: v.autoLockMin == m,
                  showCheckmark: false,
                  onSelected: (_) => ref.read(vaultProvider.notifier).setAutoLock(m),
                  selectedColor: l.accent.withValues(alpha: 0.16),
                  side: BorderSide(color: v.autoLockMin == m ? l.accent : l.c.edge),
                  backgroundColor: Colors.transparent,
                ),
            ],
          ),
          Text(
            'After this long without use, or away from the app, the Vault locks and the key leaves memory.',
            style: OrvText.muted(l).copyWith(fontSize: 12),
          ),
          const SizedBox(height: 16),
          const SectionLabel('Change passphrase'),
          const SizedBox(height: 6),
          OrvField(label: 'Current passphrase', controller: _old, obscure: true, error: _error),
          const SizedBox(height: 8),
          OrvField(label: 'New passphrase', hint: 'At least 10 characters', controller: _new, obscure: true),
          const SizedBox(height: 10),
          ListenableBuilder(
            listenable: Listenable.merge([_old, _new]),
            builder: (_, _) => OrvButton(
              label: 'Change passphrase',
              expand: true,
              onPressed: _old.text.isEmpty || _new.text.length < 10
                  ? null
                  : () async {
                      final toaster = Toaster.of(context);
                      setState(() => _error = null);
                      try {
                        await ref.read(vaultProvider.notifier).changePassphrase(_old.text, _new.text);
                        toaster.show(
                          'Passphrase changed',
                          body: 'Your items didn’t need re-locking.',
                          tone: ToastTone.success,
                        );
                        _old.clear();
                        _new.clear();
                      } on WrongPassphrase {
                        if (mounted) setState(() => _error = 'That current passphrase isn’t right.');
                      }
                    },
            ),
          ),
        ],
      ),
    );
  }
}
