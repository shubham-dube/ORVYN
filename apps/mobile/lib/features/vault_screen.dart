import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../app/lock.dart' show authenticatorProvider;
import '../design/controls.dart';
import '../design/glass.dart';
import '../design/theme.dart';
import '../design/toast.dart';
import '../vault/smart.dart';
import '../vault/vault.dart';
import '../vault/vault_crypto.dart' show WrongPassphrase, WrongRecoveryKey, generatePassword;
import 'common.dart';
import 'money_ui.dart' show Segment, SheetCard, SheetRule;
import 'sheets.dart';
import 'today_calendar.dart' show labelColour;

/// Vault (spec 0004, spec 0015 A): secrets locked on this phone with a passphrase only the person knows — and, if
/// they like, behind their fingerprint. Found and copied in a second. The server, the AI and backups only ever hold
/// scrambled data they cannot read.
class VaultScreen extends ConsumerStatefulWidget {
  const VaultScreen({super.key, this.quick});

  /// "find" or "add": opened from the app icon's shortcuts
  final String? quick;
  @override
  ConsumerState<VaultScreen> createState() => _VaultScreenState();
}

class _VaultScreenState extends ConsumerState<VaultScreen> {
  /// shown once, right after setup — even though the vault is already open behind it
  String? _recovery;
  bool _quickDone = false;

  @override
  Widget build(BuildContext context) {
    final v = ref.watch(vaultProvider);
    // a shortcut's "Add to Vault" opens the new-item sheet as soon as the Vault is open
    if (widget.quick == 'add' && !_quickDone && v.status == VaultStatus.unlocked) {
      _quickDone = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) unawaited(showGlassSheet<void>(context, (_) => const _ItemSheet()));
      });
    }
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
                        onPressed: () {
                          unawaited(HapticFeedback.mediumImpact());
                          ref.read(vaultProvider.notifier).lock();
                        },
                      ),
                    ),
                  ],
                ],
              ),
              if (v.status == VaultStatus.loading) const SizedBox(height: 120),
              if (v.status == VaultStatus.none || _recovery != null)
                _Setup(recovery: _recovery, onRecovery: (k) => setState(() => _recovery = k)),
              if (v.status == VaultStatus.locked && _recovery == null) const _Locked(),
              if (v.status == VaultStatus.unlocked && _recovery == null) _Open(focusSearch: widget.quick == 'find'),
            ],
          ),
        ),
      ),
    );
  }
}

// ------------------------------------------------------------------ the look of each kind

const _kindIcon = {
  'login': LucideIcons.keyRound,
  'card': LucideIcons.creditCard,
  'id': LucideIcons.idCard,
  'apikey': LucideIcons.code,
  'recovery': LucideIcons.lifeBuoy,
  'note': LucideIcons.notebookPen,
};
const _kindColour = {
  'login': 'violet',
  'card': 'amber',
  'id': 'sky',
  'apikey': 'cyan',
  'recovery': 'coral',
  'note': 'emerald',
};
Color kindColour(OrvLook l, String kind) => labelColour(l, _kindColour[kind]);

/// A rounded tile in the kind's colour: the item's first letter (logins) or its kind's icon.
class _Monogram extends StatelessWidget {
  const _Monogram({required this.item, this.size = 42});
  final OpenItem item;
  final double size;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final c = kindColour(l, item.kind);
    final letter = item.kind == 'login' && item.title.trim().isNotEmpty ? item.title.trim()[0].toUpperCase() : null;
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(size * 0.3),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [c.withValues(alpha: 0.95), c.withValues(alpha: 0.65)],
        ),
      ),
      alignment: Alignment.center,
      child: letter != null
          ? Text(
              letter,
              style: TextStyle(
                fontFamily: fontFamily,
                fontSize: size * 0.42,
                fontWeight: FontWeight.w700,
                color: Colors.white,
              ),
            )
          : Icon(_kindIcon[item.kind] ?? LucideIcons.lock, size: size * 0.45, color: Colors.white),
    );
  }
}

/// A live one-time code with its countdown; a tap copies it.
class TotpChip extends ConsumerStatefulWidget {
  const TotpChip({super.key, required this.secret, this.big = false});
  final String secret;
  final bool big;
  @override
  ConsumerState<TotpChip> createState() => _TotpChipState();
}

class _TotpChipState extends ConsumerState<TotpChip> {
  Timer? _t;
  String _code = '';
  int _left = 30;
  Totp? _totp;

  @override
  void initState() {
    super.initState();
    _totp = parseTotp(widget.secret);
    _tick();
    _t = Timer.periodic(const Duration(seconds: 1), (_) => _tick());
  }

  Future<void> _tick() async {
    final t = _totp;
    if (t == null) return;
    final c = await totpCode(t);
    if (mounted) {
      setState(() {
        _code = c;
        _left = totpLeft(t);
      });
    }
  }

  @override
  void dispose() {
    _t?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final t = _totp;
    if (t == null || _code.isEmpty) return const SizedBox.shrink();
    final pretty = _code.length == 6 ? '${_code.substring(0, 3)} ${_code.substring(3)}' : _code;
    final low = _left <= 5;
    final colour = low ? l.c.danger : l.accent;
    return Semantics(
      button: true,
      label: 'One-time code $_code, $_left seconds left',
      child: InkWell(
        borderRadius: BorderRadius.circular(20),
        onTap: () async {
          final toaster = Toaster.of(context);
          unawaited(HapticFeedback.selectionClick());
          await ref.read(vaultProvider.notifier).copySecret(_code);
          toaster.show('Code copied', body: '$_left seconds left on it.');
        },
        child: Container(
          padding: EdgeInsets.symmetric(horizontal: widget.big ? 12 : 8, vertical: widget.big ? 6 : 3),
          decoration: BoxDecoration(color: colour.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(20)),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              SizedBox(
                width: widget.big ? 16 : 11,
                height: widget.big ? 16 : 11,
                child: CircularProgressIndicator(
                  value: _left / t.period,
                  strokeWidth: widget.big ? 2.6 : 2,
                  color: colour,
                  backgroundColor: colour.withValues(alpha: 0.2),
                ),
              ),
              SizedBox(width: widget.big ? 8 : 5),
              Text(
                pretty,
                style: TextStyle(
                  fontFamily: 'GeistMono',
                  fontSize: widget.big ? 22 : 12.5,
                  fontWeight: FontWeight.w700,
                  letterSpacing: widget.big ? 2 : 0.5,
                  color: colour,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ------------------------------------------------------------------ set up, locked

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
                style: OrvText.body(l).copyWith(fontFamily: 'GeistMono', fontSize: 17, letterSpacing: 1.5),
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
    return Glass(
      level: GlassLevel.float,
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const _LockHero(open: false),
          const SizedBox(height: 14),
          Text('Set up your Vault', style: OrvText.heading(l), textAlign: TextAlign.center),
          const SizedBox(height: 6),
          Text(
            'Passwords, cards, IDs, API keys and recovery codes — locked on your phone with a passphrase only you know. '
            'The server, the AI and backups only ever hold scrambled data they cannot read.',
            style: OrvText.muted(l),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 14),
          OrvField(
            key: const Key('vault-pass'),
            label: 'Passphrase',
            hint: 'At least 10 characters — a sentence works well',
            controller: _pass,
            obscure: true,
          ),
          const SizedBox(height: 10),
          ListenableBuilder(
            listenable: Listenable.merge([_pass, _again]),
            builder: (_, _) => OrvField(
              key: const Key('vault-pass2'),
              label: 'Again',
              controller: _again,
              obscure: true,
              error: _again.text.isNotEmpty && _again.text != _pass.text ? 'These don’t match yet.' : null,
            ),
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
          const SizedBox(height: 8),
          Text(
            'Your passphrase never leaves this phone. If you lose it and the recovery key, the contents are gone for good.',
            style: OrvText.muted(l).copyWith(fontSize: 12, color: l.c.faint),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}

/// The big lock: a soft glowing circle in the Vault's colour.
class _LockHero extends StatelessWidget {
  const _LockHero({required this.open});
  final bool open;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return Center(
      child: Container(
        width: 76,
        height: 76,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          gradient: l.accentGradient,
          boxShadow: [BoxShadow(color: l.accent.withValues(alpha: 0.35), blurRadius: 30, offset: const Offset(0, 10))],
        ),
        child: Icon(open ? LucideIcons.lockOpen : LucideIcons.lockKeyhole, size: 34, color: Colors.white),
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
  bool _typing = false;
  bool _asked = false;

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
      unawaited(HapticFeedback.lightImpact());
    } on WrongPassphrase {
      unawaited(HapticFeedback.heavyImpact());
      if (mounted) setState(() => _error = 'That passphrase isn’t right.');
    } catch (_) {
      if (mounted) setState(() => _error = 'Couldn’t open the Vault.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _finger() async {
    final ok = await ref.read(vaultProvider.notifier).unlockWithFingerprint();
    if (ok) unawaited(HapticFeedback.lightImpact());
    if (!ok && mounted) setState(() => _typing = true);
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final finger = ref.watch(vaultProvider.select((v) => v.fingerprint));
    // with the fingerprint set up, it is asked for at once
    if (finger && !_asked) {
      _asked = true;
      WidgetsBinding.instance.addPostFrameCallback((_) => mounted ? unawaited(_finger()) : null);
    }
    final showPass = !finger || _typing;
    return Glass(
      level: GlassLevel.float,
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const _LockHero(open: false),
          const SizedBox(height: 14),
          Text('Vault is locked', style: OrvText.heading(l), textAlign: TextAlign.center),
          const SizedBox(height: 4),
          Text(
            finger && !_typing ? 'Touch the sensor to open it.' : 'Enter your passphrase to open it.',
            style: OrvText.muted(l),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 16),
          if (finger)
            OrvButton(
              key: const Key('vault-finger'),
              label: 'Unlock with fingerprint',
              variant: showPass ? ButtonVariant.secondary : ButtonVariant.primary,
              expand: true,
              icon: LucideIcons.fingerprint,
              onPressed: _finger,
            ),
          if (finger && !showPass)
            TextButton(onPressed: () => setState(() => _typing = true), child: const Text('Use my passphrase instead')),
          if (showPass) ...[
            if (finger) const SizedBox(height: 12),
            OrvField(
              key: const Key('vault-unlock'),
              label: 'Passphrase',
              controller: _pass,
              obscure: true,
              error: _error,
              autofocus: _typing,
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
              child: const Text('Forgot it? Use my recovery key'),
            ),
          ],
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

// ------------------------------------------------------------------ open: quick find

class _Open extends ConsumerStatefulWidget {
  const _Open({this.focusSearch = false});
  final bool focusSearch;
  @override
  ConsumerState<_Open> createState() => _OpenState();
}

class _OpenState extends ConsumerState<_Open> {
  final _search = TextEditingController();
  String _kind = '';
  bool _offerDismissed = false;
  bool? _canFinger;

  @override
  void initState() {
    super.initState();
    unawaited(
      ref.read(authenticatorProvider).available().then((v) {
        if (mounted) setState(() => _canFinger = v);
      }),
    );
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _copy(OpenItem i, String label, String value) async {
    final toaster = Toaster.of(context);
    unawaited(HapticFeedback.selectionClick());
    ref.read(vaultProvider.notifier).used(i.id);
    await ref.read(vaultProvider.notifier).copySecret(value);
    toaster.show('$label copied', body: 'From ${i.title}. The clipboard clears in 30 seconds.');
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final v = ref.watch(vaultProvider);
    final q = _search.text.trim().toLowerCase();
    final rank = {for (var n = 0; n < v.recent.length; n++) v.recent[n]: n};
    final shown = [
      for (final i in v.items)
        if ((_kind.isEmpty || i.kind == _kind) &&
            (q.isEmpty || '${i.title} ${i.subtitle} ${i.fields['url'] ?? ''}'.toLowerCase().contains(q)))
          i,
    ]..sort((a, b) => (rank[a.id] ?? 999).compareTo(rank[b.id] ?? 999));
    final recent = q.isEmpty && _kind.isEmpty
        ? [for (final id in v.recent.take(6)) ?v.items.where((i) => i.id == id).firstOrNull]
        : <OpenItem>[];
    final counts = {for (final k in vaultKinds) k: v.items.where((i) => i.kind == k).length};
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // fingerprint: offered once the Vault has been opened with the passphrase
        if (!v.fingerprint && _canFinger == true && !_offerDismissed)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Container(
              padding: const EdgeInsets.fromLTRB(14, 10, 6, 10),
              decoration: BoxDecoration(
                gradient: LinearGradient(colors: [l.accent.withValues(alpha: 0.16), l.accent.withValues(alpha: 0.06)]),
                borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
                border: Border.all(color: l.accent.withValues(alpha: 0.25)),
              ),
              child: Row(
                children: [
                  Icon(LucideIcons.fingerprint, color: l.accent, size: 26),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Open with your fingerprint',
                          style: OrvText.body(l).copyWith(fontWeight: FontWeight.w700),
                        ),
                        Text(
                          'No passphrase every time. The key stays in this phone’s secure chip.',
                          style: OrvText.muted(l).copyWith(fontSize: 12),
                        ),
                      ],
                    ),
                  ),
                  TextButton(
                    key: const Key('vault-finger-on'),
                    onPressed: () async {
                      final toaster = Toaster.of(context);
                      if (await ref.read(vaultProvider.notifier).enableFingerprint()) {
                        toaster.show(
                          'Fingerprint on',
                          body: 'Next time, just touch the sensor.',
                          tone: ToastTone.success,
                        );
                      }
                    },
                    child: const Text('Turn on'),
                  ),
                  IconButton(
                    tooltip: 'Not now',
                    icon: Icon(LucideIcons.x, size: 16, color: l.c.faint),
                    onPressed: () => setState(() => _offerDismissed = true),
                  ),
                ],
              ),
            ),
          ),
        Row(
          children: [
            Expanded(
              child: FocusRing(
                radius: 16,
                padding: const EdgeInsets.symmetric(horizontal: 8),
                child: TextField(
                  key: const Key('vault-search'),
                  controller: _search,
                  autofocus: widget.focusSearch,
                  textInputAction: TextInputAction.search,
                  onChanged: (_) => setState(() {}),
                  onSubmitted: (_) {
                    // Enter copies the first match's main secret: find and go in one step
                    final first = shown.firstOrNull;
                    final p = first == null ? null : primarySecret(first.kind, first.fields);
                    if (first != null && p != null) unawaited(_copy(first, p.label, p.value));
                  },
                  style: OrvText.body(l),
                  decoration:
                      bareInput(
                        l,
                        hint: 'Find — Enter copies the password',
                        fontSize: 15,
                        padding: const EdgeInsets.symmetric(vertical: 12),
                      ).copyWith(
                        prefixIcon: Icon(LucideIcons.search, size: 17, color: l.c.faint),
                        prefixIconConstraints: const BoxConstraints(minWidth: 32),
                        suffixIcon: _search.text.isEmpty
                            ? null
                            : IconButton(
                                tooltip: 'Clear',
                                icon: Icon(LucideIcons.x, size: 16, color: l.c.faint),
                                onPressed: () => setState(_search.clear),
                              ),
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
        const SizedBox(height: 10),
        // kinds: icons in their colours, with how many each holds
        SizedBox(
          height: 36,
          child: ListView(
            scrollDirection: Axis.horizontal,
            children: [
              for (final k in ['', ...vaultKinds])
                if (k.isEmpty || counts[k]! > 0)
                  Padding(
                    padding: const EdgeInsets.only(right: 6),
                    child: _KindPill(
                      kind: k,
                      count: k.isEmpty ? v.items.length : counts[k]!,
                      selected: _kind == k,
                      onTap: () => setState(() => _kind = _kind == k ? '' : k),
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
        if (recent.isNotEmpty) ...[
          const SizedBox(height: 14),
          Padding(
            padding: const EdgeInsets.only(left: 4, bottom: 6),
            child: Text('RECENT', style: OrvText.label(l)),
          ),
          SizedBox(
            height: 92,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: recent.length,
              separatorBuilder: (_, _) => const SizedBox(width: 8),
              itemBuilder: (_, n) {
                final i = recent[n];
                final p = primarySecret(i.kind, i.fields);
                return Glass(
                  blur: false,
                  padding: EdgeInsets.zero,
                  child: InkWell(
                    borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
                    onTap: p == null ? () => _openItem(i) : () => _copy(i, p.label, p.value),
                    onLongPress: () => _openItem(i),
                    child: SizedBox(
                      width: 104,
                      child: Padding(
                        padding: const EdgeInsets.all(10),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                _Monogram(item: i, size: 30),
                                const Spacer(),
                                if (p != null) Icon(LucideIcons.copy, size: 14, color: l.c.faint),
                              ],
                            ),
                            const Spacer(),
                            Text(
                              i.title.isEmpty ? kindLabel[i.kind]! : i.title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: OrvText.body(l).copyWith(fontSize: 13, fontWeight: FontWeight.w600),
                            ),
                            Text(
                              p == null ? 'Open' : 'Tap: copy ${p.label.toLowerCase()}',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: OrvText.muted(l).copyWith(fontSize: 10.5),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
        ],
        const SizedBox(height: 12),
        if (shown.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 24),
            child: Column(
              children: [
                Icon(v.items.isEmpty ? LucideIcons.sparkles : LucideIcons.searchX, color: l.c.faint, size: 28),
                const SizedBox(height: 8),
                Text(
                  v.items.isEmpty
                      ? 'Your Vault is open and empty. Add a login, a card, an ID, an API key, recovery codes or a secure note.'
                      : 'Nothing matches. Try fewer words.',
                  style: OrvText.muted(l),
                  textAlign: TextAlign.center,
                ),
              ],
            ),
          )
        else
          Glass(
            blur: false,
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 2),
            child: Material(
              type: MaterialType.transparency,
              child: Column(
                children: [
                  for (var n = 0; n < shown.length; n++) ...[
                    if (n > 0) Divider(height: 1, color: l.c.edge),
                    _Row(item: shown[n], onOpen: () => _openItem(shown[n]), onCopy: _copy),
                  ],
                ],
              ),
            ),
          ),
      ],
    );
  }

  void _openItem(OpenItem i) {
    ref.read(vaultProvider.notifier).used(i.id);
    unawaited(showGlassSheet<void>(context, (_) => _ItemSheet(id: i.id)));
  }
}

class _KindPill extends StatelessWidget {
  const _KindPill({required this.kind, required this.count, required this.selected, required this.onTap});
  final String kind;
  final int count;
  final bool selected;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final c = kind.isEmpty ? l.accent : kindColour(l, kind);
    return Semantics(
      selected: selected,
      button: true,
      label: kind.isEmpty ? 'All' : kindLabel[kind],
      child: InkWell(
        borderRadius: BorderRadius.circular(18),
        onTap: () {
          unawaited(HapticFeedback.selectionClick());
          onTap();
        },
        child: AnimatedContainer(
          duration: OrvTokens.durationBase,
          padding: const EdgeInsets.symmetric(horizontal: 11),
          decoration: BoxDecoration(
            color: selected ? c.withValues(alpha: 0.16) : Colors.transparent,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: selected ? c : l.c.edge),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(kind.isEmpty ? LucideIcons.layoutGrid : _kindIcon[kind], size: 14, color: selected ? c : l.c.muted),
              const SizedBox(width: 6),
              Text(
                kind.isEmpty ? 'All' : kindLabel[kind]!,
                style: OrvText.body(l)
                    .copyWith(fontSize: 13, color: selected ? c : l.c.text, fontWeight: FontWeight.w600),
              ),
              const SizedBox(width: 5),
              Text('$count', style: OrvText.muted(l).copyWith(fontSize: 12)),
            ],
          ),
        ),
      ),
    );
  }
}

/// One item in the list: what it is, its live code, and its secrets one tap away.
class _Row extends StatelessWidget {
  const _Row({required this.item, required this.onOpen, required this.onCopy});
  final OpenItem item;
  final VoidCallback onOpen;
  final Future<void> Function(OpenItem, String, String) onCopy;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final p = primarySecret(item.kind, item.fields);
    final user = item.fields['username'] ?? '';
    final totp = item.fields['totp'] ?? '';
    return InkWell(
      onTap: onOpen,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: Row(
          children: [
            _Monogram(item: item),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    item.title.isEmpty ? kindLabel[item.kind]! : item.title,
                    style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 2),
                  if (totp.isNotEmpty && parseTotp(totp) != null)
                    Align(
                      alignment: Alignment.centerLeft,
                      child: TotpChip(secret: totp),
                    )
                  else
                    Text(
                      item.subtitle.isEmpty ? kindLabel[item.kind]! : item.subtitle,
                      style: OrvText.muted(l).copyWith(fontSize: 12.5),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                ],
              ),
            ),
            if (user.isNotEmpty)
              IconButton(
                tooltip: 'Copy username for ${item.title}',
                visualDensity: VisualDensity.compact,
                icon: Icon(LucideIcons.user, size: 17, color: l.c.muted),
                onPressed: () => onCopy(item, 'Username', user),
              ),
            if (p != null)
              IconButton(
                tooltip: 'Copy ${p.label.toLowerCase()} for ${item.title}',
                visualDensity: VisualDensity.compact,
                icon: Icon(LucideIcons.copy, size: 17, color: l.accent),
                onPressed: () => onCopy(item, p.label, p.value),
              ),
          ],
        ),
      ),
    );
  }
}

// ------------------------------------------------------------------ one item: view, new, edit

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
  final _paste = TextEditingController();
  final _fields = <String, TextEditingController>{};
  final _shown = <String>{};
  late bool _editing = widget.id == null;
  bool _loaded = false;
  bool _saving = false;

  TextEditingController _c(String k) => _fields.putIfAbsent(k, () => TextEditingController()..addListener(_changed));
  void _changed() => setState(() {});

  @override
  void initState() {
    super.initState();
    _paste.addListener(_changed);
    _title.addListener(_changed);
  }

  @override
  void dispose() {
    _title.dispose();
    _notes.dispose();
    _paste.dispose();
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

  void _fill(Guess g) {
    unawaited(HapticFeedback.lightImpact());
    setState(() {
      _kind = g.kind;
      _title.text = g.title;
      for (final c in _fields.values) {
        c.clear();
      }
      for (final e in g.fields.entries) {
        _c(e.key).text = e.value;
      }
      _paste.clear();
    });
  }

  Future<void> _save() async {
    final nav = Navigator.of(context);
    final toaster = Toaster.of(context);
    final fields = vaultFields[_kind]!;
    setState(() => _saving = true);
    try {
      final id = await ref.read(vaultProvider.notifier).saveItem(widget.id, {
        'kind': _kind,
        'title': _title.text.trim().isEmpty ? kindLabel[_kind]! : _title.text.trim(),
        'fields': {
          for (final f in fields)
            if (_c(f.key).text.isNotEmpty) f.key: _c(f.key).text,
        },
        'notes': _notes.text,
      });
      ref.read(vaultProvider.notifier).used(id);
      unawaited(HapticFeedback.lightImpact());
      toaster.show('Saved to your Vault', tone: ToastTone.success);
      nav.pop();
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final v = ref.watch(vaultProvider);
    final item = widget.id == null ? null : v.items.where((i) => i.id == widget.id).firstOrNull;
    if (widget.id != null && item == null) return const SizedBox(height: 80);
    if (item != null && !_loaded) _load(item);
    if (!_editing && item != null) return _view(item);
    return _edit();
  }

  Widget _view(OpenItem item) {
    final l = context.orv;
    final fields = vaultFields[item.kind]!;
    final toaster = Toaster.of(context);
    final c = kindColour(l, item.kind);
    final changed = DateTime.tryParse(item.payload['updatedAt'] as String? ?? '')?.toLocal();
    final totp = item.fields['totp'] ?? '';
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Center(
            child: Container(
              width: 36,
              height: 4,
              decoration: BoxDecoration(color: l.c.track, borderRadius: BorderRadius.circular(2)),
            ),
          ),
          const SizedBox(height: 14),
          // the hero: the item in its kind's colour
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(OrvTokens.radiusLg),
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [c.withValues(alpha: 0.22), c.withValues(alpha: 0.06)],
              ),
              border: Border.all(color: c.withValues(alpha: 0.25)),
            ),
            child: Row(
              children: [
                _Monogram(item: item, size: 52),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        item.title.isEmpty ? kindLabel[item.kind]! : item.title,
                        style: OrvText.heading(l).copyWith(fontSize: 19),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 2),
                      Text(
                        [kindLabel[item.kind]!, if (changed != null) 'changed ${_ago(changed)}'].join(' · '),
                        style: OrvText.muted(l).copyWith(fontSize: 12.5),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          if (totp.isNotEmpty && parseTotp(totp) != null) ...[
            const SizedBox(height: 12),
            Row(
              children: [
                Icon(LucideIcons.timer, size: 16, color: l.c.muted),
                const SizedBox(width: 8),
                Text('One-time code', style: OrvText.muted(l)),
                const Spacer(),
                TotpChip(secret: totp, big: true),
              ],
            ),
          ],
          const SizedBox(height: 12),
          SheetCard(
            children: [
              for (final (n, f)
                  in fields.where((f) => (item.fields[f.key] ?? '').isNotEmpty && f.key != 'totp').indexed) ...[
                if (n > 0) const SheetRule(),
                _SecretRow(
                  label: f.label,
                  value: item.fields[f.key]!,
                  secret: f.secret,
                  shown: _shown.contains(f.key),
                  onToggle: () => setState(() => _shown.contains(f.key) ? _shown.remove(f.key) : _shown.add(f.key)),
                  onCopy: () async {
                    unawaited(HapticFeedback.selectionClick());
                    ref.read(vaultProvider.notifier).used(item.id);
                    await ref.read(vaultProvider.notifier).copySecret(item.fields[f.key]!);
                    toaster.show('${f.label} copied', body: 'The clipboard clears in 30 seconds.');
                  },
                ),
              ],
              if (item.notes.isNotEmpty) ...[
                const SheetRule(),
                _SecretRow(
                  label: 'Notes',
                  value: item.notes,
                  secret: true,
                  shown: _shown.contains('_notes'),
                  onToggle: () =>
                      setState(() => _shown.contains('_notes') ? _shown.remove('_notes') : _shown.add('_notes')),
                  onCopy: () => ref.read(vaultProvider.notifier).copySecret(item.notes),
                ),
              ],
            ],
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              TextButton.icon(
                style: TextButton.styleFrom(foregroundColor: l.c.danger),
                icon: const Icon(LucideIcons.trash2, size: 16),
                label: const Text('Delete'),
                onPressed: () async {
                  final nav = Navigator.of(context);
                  final sure = await showDialog<bool>(
                    context: context,
                    builder: (ctx) => AlertDialog(
                      title: Text('Delete ${item.title}?'),
                      content: const Text('It goes from every device. This can’t be undone.'),
                      actions: [
                        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Keep')),
                        TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Delete')),
                      ],
                    ),
                  );
                  if (sure != true) return;
                  await ref.read(vaultProvider.notifier).removeItem(item.id);
                  toaster.show('Deleted', body: item.title);
                  nav.pop();
                },
              ),
              const Spacer(),
              OrvButton(
                label: 'Edit',
                icon: LucideIcons.pencil,
                variant: ButtonVariant.primary,
                onPressed: () => setState(() => _editing = true),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _edit() {
    final l = context.orv;
    final fields = vaultFields[_kind]!;
    final g = _paste.text.trim().isEmpty ? null : guess(_paste.text);
    final isNew = widget.id == null;
    return StickySheet(
      title: isNew ? 'New Vault item' : 'Edit item',
      footer: Row(
        children: [
          OrvButton(
            label: 'Cancel',
            variant: ButtonVariant.ghost,
            onPressed: () => isNew ? Navigator.of(context).pop() : setState(() => _editing = false),
          ),
          const Spacer(),
          OrvButton(
            label: 'Save',
            icon: LucideIcons.check,
            variant: ButtonVariant.primary,
            loading: _saving,
            onPressed: _save,
          ),
        ],
      ),
      children: [
        if (isNew) ...[
          // paste anything: understood here, on the phone (D-0015-6)
          Container(
            padding: const EdgeInsets.fromLTRB(12, 8, 8, 8),
            decoration: BoxDecoration(
              color: l.accent.withValues(alpha: 0.06),
              borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
              border: Border.all(color: l.accent.withValues(alpha: 0.35)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Icon(LucideIcons.sparkles, size: 15, color: l.accent),
                    const SizedBox(width: 6),
                    Text(
                      'Paste anything',
                      style: OrvText.body(l).copyWith(fontSize: 13, fontWeight: FontWeight.w700, color: l.accent),
                    ),
                    const Spacer(),
                    TextButton.icon(
                      icon: const Icon(LucideIcons.clipboardPaste, size: 15),
                      label: const Text('Paste'),
                      onPressed: () async {
                        final d = await Clipboard.getData(Clipboard.kTextPlain);
                        if (d?.text != null) _paste.text = d!.text!;
                      },
                    ),
                  ],
                ),
                TextField(
                  key: const Key('vault-paste'),
                  controller: _paste,
                  minLines: 1,
                  maxLines: 4,
                  style: OrvText.body(l).copyWith(fontFamily: 'GeistMono', fontSize: 13),
                  decoration: InputDecoration(
                    isDense: true,
                    border: InputBorder.none,
                    enabledBorder: InputBorder.none,
                    focusedBorder: InputBorder.none,
                    hintText: 'A card, “netflix me@mail.com p4ss”, an API key, backup codes…',
                    hintStyle: OrvText.muted(l).copyWith(fontSize: 13),
                  ),
                ),
                if (g != null)
                  Row(
                    children: [
                      Icon(_kindIcon[g.kind], size: 15, color: kindColour(l, g.kind)),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          'Looks like: ${g.found}',
                          style: OrvText.muted(l).copyWith(fontSize: 12.5),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      OrvButton(
                        label: 'Fill it in',
                        small: true,
                        variant: ButtonVariant.primary,
                        onPressed: () => _fill(g),
                      ),
                    ],
                  ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          // the kinds as a grid of coloured tiles
          GridView.count(
            crossAxisCount: 3,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 8,
            crossAxisSpacing: 8,
            childAspectRatio: 1.9,
            children: [
              for (final k in vaultKinds)
                Builder(
                  builder: (_) {
                    final on = _kind == k;
                    final c = kindColour(l, k);
                    return Semantics(
                      selected: on,
                      button: true,
                      label: kindLabel[k],
                      child: InkWell(
                        borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
                        onTap: () {
                          unawaited(HapticFeedback.selectionClick());
                          setState(() => _kind = k);
                        },
                        child: AnimatedContainer(
                          duration: OrvTokens.durationBase,
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
                            color: on ? c.withValues(alpha: 0.16) : l.c.field,
                            border: Border.all(color: on ? c : l.c.edge, width: on ? 1.5 : 1),
                          ),
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Icon(_kindIcon[k], size: 18, color: on ? c : l.c.muted),
                              const SizedBox(height: 3),
                              Text(
                                kindLabel[k]!,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: OrvText.body(l)
                                    .copyWith(fontSize: 12, fontWeight: FontWeight.w600, color: on ? c : l.c.text),
                              ),
                            ],
                          ),
                        ),
                      ),
                    );
                  },
                ),
            ],
          ),
          const SizedBox(height: 12),
        ],
        SheetCard(
          padding: const EdgeInsets.fromLTRB(12, 2, 4, 2),
          children: [
            TextField(
              key: const Key('vault-title'),
              controller: _title,
              autofocus: !isNew,
              textCapitalization: TextCapitalization.words,
              style: OrvText.body(l).copyWith(fontSize: 17, fontWeight: FontWeight.w700),
              decoration: InputDecoration(
                isDense: true,
                border: InputBorder.none,
                enabledBorder: InputBorder.none,
                focusedBorder: InputBorder.none,
                contentPadding: const EdgeInsets.symmetric(vertical: 13),
                hintText: _kind == 'login' ? 'Netflix, Bank, Gmail…' : kindLabel[_kind],
                hintStyle: OrvText.body(l).copyWith(fontSize: 17, color: l.c.faint, fontWeight: FontWeight.w600),
              ),
            ),
            for (final f in fields) ...[
              const SheetRule(),
              _FieldRow(
                field: f,
                controller: _c(f.key),
                shown: _shown.contains(f.key),
                onToggle: () => setState(() => _shown.contains(f.key) ? _shown.remove(f.key) : _shown.add(f.key)),
                onGenerate: f.generate ? () => _generate(f.key) : null,
              ),
              if (f.generate && _c(f.key).text.isNotEmpty) _Strength(value: _c(f.key).text),
            ],
            if (_kind != 'note') ...[
              const SheetRule(),
              TextField(
                controller: _notes,
                minLines: 1,
                maxLines: 4,
                style: OrvText.body(l).copyWith(fontSize: 14.5),
                decoration: InputDecoration(
                  isDense: true,
                  border: InputBorder.none,
                  enabledBorder: InputBorder.none,
                  focusedBorder: InputBorder.none,
                  contentPadding: const EdgeInsets.symmetric(vertical: 12),
                  hintText: 'Notes',
                  hintStyle: OrvText.body(l).copyWith(fontSize: 14.5, color: l.c.faint),
                ),
              ),
            ],
          ],
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Icon(LucideIcons.shieldCheck, size: 13, color: l.c.success),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                'Locked on this phone before it’s saved. Nobody else can read it.',
                style: OrvText.muted(l).copyWith(fontSize: 11.5),
              ),
            ),
          ],
        ),
      ],
    );
  }

  Future<void> _generate(String key) async {
    final r = await showGlassSheet<String>(context, (_) => const _GeneratorSheet());
    if (r != null) {
      setState(() {
        _c(key).text = r;
        _shown.add(key);
      });
    }
  }
}

String _ago(DateTime d) {
  final days = DateTime.now().difference(d).inDays;
  if (days < 1) return 'today';
  if (days == 1) return 'yesterday';
  if (days < 30) return '$days days ago';
  if (days < 365) return '${days ~/ 30} months ago';
  return '${days ~/ 365} years ago';
}

/// One field of the form: its label above, the value, and show / generate where they make sense.
class _FieldRow extends StatelessWidget {
  const _FieldRow({
    required this.field,
    required this.controller,
    required this.shown,
    required this.onToggle,
    this.onGenerate,
  });
  final VaultField field;
  final TextEditingController controller;
  final bool shown;
  final VoidCallback onToggle;
  final VoidCallback? onGenerate;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final hide = field.secret && !field.multiline && !shown;
    return Padding(
      padding: const EdgeInsets.only(top: 8, bottom: 2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(field.label, style: OrvText.muted(l).copyWith(fontSize: 11.5, fontWeight: FontWeight.w600)),
                TextField(
                  controller: controller,
                  obscureText: hide,
                  autocorrect: false,
                  enableSuggestions: false,
                  keyboardType: field.multiline ? TextInputType.multiline : field.input,
                  minLines: 1,
                  maxLines: field.multiline ? 6 : 1,
                  style: OrvText.body(l).copyWith(fontSize: 15, fontFamily: field.secret ? 'GeistMono' : null),
                  decoration: const InputDecoration(
                    isDense: true,
                    border: InputBorder.none,
                    enabledBorder: InputBorder.none,
                    focusedBorder: InputBorder.none,
                    contentPadding: EdgeInsets.only(top: 4, bottom: 8),
                  ),
                ),
              ],
            ),
          ),
          if (field.secret && !field.multiline)
            IconButton(
              tooltip: '${shown ? 'Hide' : 'Show'} ${field.label}',
              visualDensity: VisualDensity.compact,
              icon: Icon(shown ? LucideIcons.eyeOff : LucideIcons.eye, size: 17, color: l.c.muted),
              onPressed: onToggle,
            ),
          if (onGenerate != null)
            IconButton(
              tooltip: 'Generate a password',
              visualDensity: VisualDensity.compact,
              icon: Icon(LucideIcons.wandSparkles, size: 17, color: l.accent),
              onPressed: onGenerate,
            ),
        ],
      ),
    );
  }
}

class _Strength extends StatelessWidget {
  const _Strength({required this.value});
  final String value;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final s = strength(value);
    final c = s.score <= 1 ? l.c.danger : (s.score == 2 ? l.c.warning : l.c.success);
    return Padding(
      padding: const EdgeInsets.only(bottom: 10, right: 8),
      child: Row(
        children: [
          for (var n = 1; n <= 4; n++) ...[
            Expanded(
              child: AnimatedContainer(
                duration: OrvTokens.durationBase,
                height: 4,
                decoration: BoxDecoration(color: n <= s.score ? c : l.c.track, borderRadius: BorderRadius.circular(2)),
              ),
            ),
            const SizedBox(width: 4),
          ],
          const SizedBox(width: 4),
          Text(s.label, style: OrvText.muted(l).copyWith(fontSize: 11.5, color: c)),
        ],
      ),
    );
  }
}

/// A password made to measure: length and what it may hold, previewed live.
class _GeneratorSheet extends StatefulWidget {
  const _GeneratorSheet();
  @override
  State<_GeneratorSheet> createState() => _GeneratorSheetState();
}

class _GeneratorSheetState extends State<_GeneratorSheet> {
  double _length = 20;
  bool _symbols = true;
  late String _value = _make();

  String _make() {
    final p = generatePassword(length: _length.round());
    return _symbols ? p : p.replaceAll(RegExp('[^A-Za-z0-9]'), '').padRight(_length.round(), 'x');
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final s = strength(_value);
    return StickySheet(
      title: 'New password',
      footer: OrvButton(
        label: 'Use this password',
        variant: ButtonVariant.primary,
        expand: true,
        onPressed: () => Navigator.of(context).pop(_value),
      ),
      children: [
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: l.c.field,
            borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
            border: Border.all(color: l.c.edge),
          ),
          child: Row(
            children: [
              Expanded(
                child: SelectableText(
                  _value,
                  style: OrvText.body(l).copyWith(fontFamily: 'GeistMono', fontSize: 17, letterSpacing: 0.5),
                ),
              ),
              IconButton(
                tooltip: 'Another one',
                icon: Icon(LucideIcons.refreshCw, color: l.accent),
                onPressed: () => setState(() => _value = _make()),
              ),
            ],
          ),
        ),
        const SizedBox(height: 6),
        _Strength(value: _value),
        Row(
          children: [
            Text('Length', style: OrvText.body(l)),
            Expanded(
              child: Slider(
                value: _length,
                min: 8,
                max: 40,
                divisions: 32,
                label: '${_length.round()}',
                onChanged: (v) => setState(() {
                  _length = v;
                  _value = _make();
                }),
              ),
            ),
            SizedBox(
              width: 28,
              child: Text('${_length.round()}', style: OrvText.body(l).copyWith(fontWeight: FontWeight.w700)),
            ),
          ],
        ),
        OrvSwitchRow(
          label: 'Symbols (!@#…)',
          value: _symbols,
          onChanged: (v) => setState(() {
            _symbols = v;
            _value = _make();
          }),
        ),
        Text('${s.label}. Made on this phone.', style: OrvText.muted(l).copyWith(fontSize: 12)),
      ],
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
    return InkWell(
      onTap: onCopy,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(label, style: OrvText.muted(l).copyWith(fontSize: 11.5, fontWeight: FontWeight.w600)),
                  const SizedBox(height: 2),
                  Text(
                    secret && !shown ? '••••••••••' : value,
                    key: Key('secret-$label'),
                    style: OrvText.body(l).copyWith(fontFamily: 'GeistMono', fontSize: 15),
                  ),
                ],
              ),
            ),
            if (secret)
              IconButton(
                tooltip: '${shown ? 'Hide' : 'Show'} $label',
                visualDensity: VisualDensity.compact,
                icon: Icon(shown ? LucideIcons.eyeOff : LucideIcons.eye, size: 17, color: l.c.muted),
                onPressed: onToggle,
              ),
            IconButton(
              tooltip: 'Copy $label',
              visualDensity: VisualDensity.compact,
              icon: Icon(LucideIcons.copy, size: 17, color: l.accent),
              onPressed: onCopy,
            ),
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
    return StickySheet(
      title: 'Vault settings',
      footer: const SizedBox.shrink(),
      children: [
        SheetCard(
          children: [
            OrvSwitchRow(
              label: 'Open with fingerprint on this phone',
              value: v.fingerprint,
              onChanged: (on) async {
                final toaster = Toaster.of(context);
                if (on) {
                  if (!await ref.read(vaultProvider.notifier).enableFingerprint()) {
                    toaster.show('Fingerprint isn’t available', body: 'Set up a screen lock on this phone first.');
                  }
                } else {
                  await ref.read(vaultProvider.notifier).forgetFingerprint();
                }
              },
            ),
          ],
        ),
        const SizedBox(height: 16),
        const SectionLabel('Lock automatically'),
        const SizedBox(height: 8),
        Segment<int>(
          value: v.autoLockMin,
          options: const [
            (1, '1 min', null, null),
            (5, '5 min', null, null),
            (15, '15 min', null, null),
            (30, '30 min', null, null),
            (0, 'Never', null, null),
          ],
          onChanged: (m) => ref.read(vaultProvider.notifier).setAutoLock(m),
        ),
        const SizedBox(height: 6),
        Text(
          'After this long without use, or away from the app, the Vault locks and the key leaves memory.',
          style: OrvText.muted(l).copyWith(fontSize: 12),
        ),
        const SizedBox(height: 18),
        const SectionLabel('Change passphrase'),
        const SizedBox(height: 8),
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
    );
  }
}
