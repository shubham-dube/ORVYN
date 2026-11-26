import 'dart:async';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:kterm/kterm.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:open_filex/open_filex.dart';
import 'package:path_provider/path_provider.dart';

import '../app/state.dart';
import '../design/controls.dart';
import '../design/theme.dart';
import '../design/toast.dart';
import '../pc/pc.dart';
import '../pc/pc_crypto.dart';
import 'common.dart';
import 'pc_deck.dart';
import 'pc_did.dart';
import 'sheets.dart';

/// My PC (spec 0021 step 3): a real terminal on the PC, from the phone.
class PcScreen extends ConsumerStatefulWidget {
  const PcScreen({super.key});
  @override
  ConsumerState<PcScreen> createState() => _PcScreenState();
}

class _PcScreenState extends ConsumerState<PcScreen> {
  final _code = TextEditingController();
  List<PcPairing>? _pcs;
  PcPairing? _at;
  String? _error;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final pcs = await ref.read(pcPairingsProvider).list();
    if (mounted) setState(() => _pcs = pcs);
  }

  Future<void> _add(String text) async {
    final p = PcPairing.read(text);
    if (p == null) {
      setState(() => _error = 'That isn’t a pairing code. On the PC: ORVYN tray icon → This PC from my phone.');
      return;
    }
    await ref.read(pcPairingsProvider).add(p);
    _code.clear();
    if (mounted) setState(() => _error = null);
    await _load();
    if (mounted) setState(() => _at = p);
  }

  Future<void> _scan() async {
    final text = await Navigator.of(context)
        .push<String>(MaterialPageRoute(builder: (_) => const _Scan(), fullscreenDialog: true));
    if (text != null && mounted) await _add(text);
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final at = _at;
    if (at != null) {
      return PopScope(
        canPop: false,
        onPopInvokedWithResult: (done, _) {
          if (!done) setState(() => _at = null);
        },
        child: PcTerminal(
          key: ValueKey(at.id),
          pair: at,
          onLeave: () => setState(() => _at = null),
          onForget: () async {
            await ref.read(pcPairingsProvider).remove(at.id);
            if (!context.mounted) return;
            Toaster.of(context).show('${at.name} is forgotten here', body: 'Remove this phone on the PC too.');
            setState(() => _at = null);
            await _load();
          },
        ),
      );
    }
    return Scaffold(
      body: SafeArea(
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
                const Expanded(child: PageTitle('My PC')),
              ],
            ),
            for (final p in _pcs ?? const <PcPairing>[])
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: OrvButton(
                  label: p.name,
                  icon: LucideIcons.monitor,
                  expand: true,
                  onPressed: () => setState(() => _at = p),
                ),
              ),
            if (_pcs?.isEmpty ?? false)
              Padding(
                padding: const EdgeInsets.only(bottom: 16),
                child: Text(
                  'On the PC: ORVYN tray icon → This PC from my phone. Choose a PIN, switch it on, add a device.',
                  style: OrvText.muted(l),
                ),
              ),
            const SizedBox(height: 12),
            OrvButton(
              label: 'Scan the PC’s code',
              icon: LucideIcons.scanQrCode,
              variant: ButtonVariant.primary,
              expand: true,
              onPressed: _scan,
            ),
            const SizedBox(height: 16),
            OrvField(
              label: 'Or paste its text',
              hint: 'ORVYN-PC1.…',
              controller: _code,
              error: _error,
              onSubmitted: _add,
            ),
            const SizedBox(height: 10),
            OrvButton(label: 'Pair', onPressed: () => _add(_code.text)),
          ],
        ),
      ),
    );
  }
}

class _Scan extends StatefulWidget {
  const _Scan();
  @override
  State<_Scan> createState() => _ScanState();
}

class _ScanState extends State<_Scan> {
  bool _done = false;

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            Row(
              children: [
                IconButton(
                  onPressed: () => Navigator.of(context).pop(),
                  icon: Icon(LucideIcons.x, color: l.c.text),
                  tooltip: 'Close',
                ),
                Expanded(child: Text('Point at the code on the PC', style: OrvText.body(l))),
              ],
            ),
            Expanded(
              child: MobileScanner(
                onDetect: (c) {
                  final text = c.barcodes.map((b) => b.rawValue).nonNulls.where((t) => PcPairing.read(t) != null);
                  if (_done || text.isEmpty) return;
                  _done = true;
                  Navigator.of(context).pop(text.first);
                },
                errorBuilder: (context, _) => Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Text(
                      'The camera isn’t available. Allow it in Android’s settings, or paste the text instead.',
                      style: OrvText.muted(l),
                      textAlign: TextAlign.center,
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

const _words = {
  PcStatus.finding: 'Looking for the PC…',
  PcStatus.offline: 'The PC isn’t answering. It may be off, asleep or offline, or this phone was removed there.',
  PcStatus.off: 'The terminal is switched off on the PC.',
  PcStatus.locked: 'Locked after five wrong PINs. Unlock it at the PC.',
  PcStatus.pin: 'Enter the PIN you chose on the PC.',
  PcStatus.idle: 'Ended after 15 minutes without you. Your terminals are still running.',
  PcStatus.removed: 'This phone was removed at the PC.',
  PcStatus.ended: 'The session has ended. Your terminals may still be running.',
};

const _keys = [
  ('Esc', '\x1b'),
  ('Tab', '\t'),
  ('Ctrl C', '\x03'),
  ('↑', '\x1b[A'),
  ('↓', '\x1b[B'),
  ('←', '\x1b[D'),
  ('→', '\x1b[C'),
  ('|', '|'),
  ('\\', '\\'),
  ('~', '~'),
  ('-', '-'),
  ('/', '/'),
  ('Home', '\x1b[H'),
  ('End', '\x1b[F'),
  ('PgUp', '\x1b[5~'),
  ('PgDn', '\x1b[6~'),
];

class PcTerminal extends ConsumerStatefulWidget {
  const PcTerminal({super.key, required this.pair, required this.onLeave, required this.onForget});
  final PcPairing pair;
  final VoidCallback onLeave;
  final VoidCallback onForget;
  @override
  ConsumerState<PcTerminal> createState() => _PcTerminalState();
}

class _PcTerminalState extends ConsumerState<PcTerminal> {
  late final PcLink _link;
  final _pin = TextEditingController();
  final _screens = <String, Terminal>{};
  final _focus = FocusNode();
  String? _active;
  bool _ctrl = false;
  bool _writing = false;
  bool _deck = false;

  @override
  void initState() {
    super.initState();
    final rt = ref.read(realtimeProvider);
    _link = PcLink(
      widget.pair,
      send: rt.send,
      messages: rt.messages,
      deviceName: ref.read(deviceInfoProvider).name,
      output: (id, text, reset) {
        final t = _screens[id];
        if (t == null) return;
        // what a terminal answers by itself (where the cursor is, what it is) the PC has answered already
        _writing = true;
        t.write(reset ? '\x1bc$text' : text);
        _writing = false;
      },
      did: (what) => Toaster.of(context).show(pcDid[what] ?? 'Done', tone: ToastTone.success),
      clip: (text) async {
        await Clipboard.setData(ClipboardData(text: text));
        if (mounted) Toaster.of(context).show('Copied from the PC', tone: ToastTone.success);
      },
      file: (name, bytes) async {
        final dir = await getTemporaryDirectory();
        // only its name: never a path the PC chose
        final f = File('${dir.path}/pc-${name.replaceAll(RegExp(r'[^\w. -]'), '_')}');
        await f.writeAsBytes(bytes, flush: true);
        await OpenFilex.open(f.path);
      },
      opened: (id) => setState(() => _active = id),
      problem: (text) => Toaster.of(context).show(text, tone: ToastTone.danger),
    )..addListener(_changed);
    _link.connect();
  }

  void _changed() {
    if (!mounted) return;
    _screens.removeWhere((id, _) => !_link.terms.any((t) => t.id == id));
    for (final t in _link.terms) {
      _screens.putIfAbsent(t.id, () => _screen(t.id));
    }
    setState(() {});
  }

  Terminal _screen(String id) {
    final t = Terminal(maxLines: 5000);
    var attached = false;
    t.onOutput = (d) {
      if (_writing) return;
      if (_ctrl && d.length == 1 && RegExp(r'[a-z@\[\\\]^_]', caseSensitive: false).hasMatch(d)) {
        setState(() => _ctrl = false);
        _link.type(id, String.fromCharCode(d.toUpperCase().codeUnitAt(0) & 31));
      } else {
        _link.type(id, d);
      }
    };
    t.onResize = (cols, rows, _, _) {
      if (attached) {
        _link.resize(id, cols, rows);
      } else {
        attached = true;
        _link.attach(id, cols, rows);
      }
    };
    return t;
  }

  @override
  void dispose() {
    _link.dispose();
    _pin.dispose();
    _focus.dispose();
    super.dispose();
  }

  String? get _shown {
    if (_link.terms.any((t) => t.id == _active)) return _active;
    return _link.terms.isEmpty ? null : _link.terms.first.id;
  }

  Future<void> _close(PcTerm t) async {
    if (t.exit == null) {
      final yes = await showDialog<bool>(
        context: context,
        builder: (c) => AlertDialog(
          title: const Text('Close this terminal?'),
          content: const Text('What runs in it stops.'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Keep it')),
            TextButton(onPressed: () => Navigator.pop(c, true), child: const Text('Close')),
          ],
        ),
      );
      if (yes != true) return;
    }
    _link.close(t.id);
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final shown = _shown;
    final open = _link.status == PcStatus.open || (_link.status == PcStatus.finding && shown != null);
    return Scaffold(
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                IconButton(
                  onPressed: widget.onLeave,
                  icon: Icon(LucideIcons.arrowLeft, color: l.c.text),
                  tooltip: 'Back',
                ),
                Expanded(
                  child: Text(widget.pair.name, style: OrvText.heading(l), overflow: TextOverflow.ellipsis),
                ),
                if (open)
                  TextButton(
                    onPressed: () {
                      setState(() => _deck = !_deck);
                      if (!_deck) _link.live(false);
                    },
                    child: Text(_deck ? 'Terminal' : 'Deck'),
                  ),
                OrvBadge(
                  _link.status == PcStatus.open ? 'Live · encrypted' : (open ? 'Reconnecting…' : 'Not connected'),
                  tone: _link.status == PcStatus.open ? l.c.success : null,
                ),
                const SizedBox(width: 12),
              ],
            ),
            if (open && _deck)
              Expanded(child: PcDeckView(link: _link))
            else if (open)
              ..._terminal(l, shown)
            else
              Expanded(child: _outside(l)),
          ],
        ),
      ),
    );
  }

  List<Widget> _terminal(OrvLook l, String? shown) {
    final night = OrvTokens.phases[OrvPhase.night]!;
    final screen = shown == null ? null : _screens[shown];
    final current = _link.terms.where((t) => t.id == shown && t.exit == null).firstOrNull;
    return [
      SizedBox(
        height: 44,
        child: ListView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 8),
          children: [
            for (final (i, t) in _link.terms.indexed)
              InputChip(
                label: Text('${i + 1} · ${t.name}${t.exit != null ? ' (ended ${t.exit})' : ''}'),
                selected: t.id == shown,
                showCheckmark: false,
                onPressed: () => setState(() => _active = t.id),
                onDeleted: () => _close(t),
                deleteButtonTooltipMessage: 'Close terminal ${i + 1}',
              ),
            for (final s in _link.shells)
              TextButton.icon(
                onPressed: () => _link.open(s.id, screen?.viewWidth ?? 50, screen?.viewHeight ?? 24),
                icon: const Icon(LucideIcons.plus, size: 14),
                label: Text(s.name),
              ),
          ],
        ),
      ),
      if (current != null)
        Row(
          children: [
            TextButton.icon(
              onPressed: () => _sayIt(current),
              icon: const Icon(LucideIcons.wandSparkles, size: 14),
              label: const Text('Say it'),
            ),
            TextButton.icon(
              onPressed: () => _link.watch(current.id, !current.watch),
              icon: Icon(current.watch ? LucideIcons.bellRing : LucideIcons.bell, size: 14),
              label: Text(current.watch ? 'Will tell you' : 'Tell me when done'),
            ),
          ],
        ),
      Expanded(
        child: screen == null
            ? Center(child: Text('Open a shell above.', style: OrvText.muted(l)))
            : TerminalView(
                screen,
                key: ValueKey(shown),
                focusNode: _focus,
                autofocus: true,
                deleteDetection: true,
                padding: const EdgeInsets.all(6),
                textStyle: const TerminalStyle(fontSize: 12.5, fontFamily: monoFamily),
                // a terminal is dark in every light: its sixteen colours are made for that
                theme: TerminalTheme(
                  cursor: l.withModule('core').accentFrom,
                  selection: night.colors.track,
                  foreground: night.colors.text,
                  background: night.base,
                  black: TerminalThemes.defaultTheme.black,
                  red: TerminalThemes.defaultTheme.red,
                  green: TerminalThemes.defaultTheme.green,
                  yellow: TerminalThemes.defaultTheme.yellow,
                  blue: TerminalThemes.defaultTheme.blue,
                  magenta: TerminalThemes.defaultTheme.magenta,
                  cyan: TerminalThemes.defaultTheme.cyan,
                  white: TerminalThemes.defaultTheme.white,
                  brightBlack: TerminalThemes.defaultTheme.brightBlack,
                  brightRed: TerminalThemes.defaultTheme.brightRed,
                  brightGreen: TerminalThemes.defaultTheme.brightGreen,
                  brightYellow: TerminalThemes.defaultTheme.brightYellow,
                  brightBlue: TerminalThemes.defaultTheme.brightBlue,
                  brightMagenta: TerminalThemes.defaultTheme.brightMagenta,
                  brightCyan: TerminalThemes.defaultTheme.brightCyan,
                  brightWhite: TerminalThemes.defaultTheme.brightWhite,
                  searchHitBackground: TerminalThemes.defaultTheme.searchHitBackground,
                  searchHitBackgroundCurrent: TerminalThemes.defaultTheme.searchHitBackgroundCurrent,
                  searchHitForeground: TerminalThemes.defaultTheme.searchHitForeground,
                ),
              ),
      ),
      SizedBox(
        height: 48,
        child: ListView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          children: [
            _key(l, 'Ctrl', () => setState(() => _ctrl = !_ctrl), on: _ctrl),
            for (final (label, seq) in _keys)
              _key(l, label, () {
                if (shown != null) _link.type(shown, seq);
              }),
            _key(l, 'Paste', () async {
              final text = (await Clipboard.getData(Clipboard.kTextPlain))?.text;
              if (text != null && screen != null) screen.paste(text);
            }),
          ],
        ),
      ),
    ];
  }

  Future<void> _sayIt(PcTerm t) async {
    final command = await showGlassSheet<String>(context, (_) => _SayIt(shell: t.name));
    if (command == null || !mounted) return;
    if (!_link.type(t.id, '$command\r')) {
      Toaster.of(context).show('Not connected: nothing was run', tone: ToastTone.danger);
    }
  }

  Widget _key(OrvLook l, String label, VoidCallback onTap, {bool on = false}) => Padding(
    padding: const EdgeInsets.only(right: 6),
    child: Material(
      color: on ? l.accent : l.c.track,
      borderRadius: BorderRadius.circular(OrvTokens.radiusSm),
      child: InkWell(
        canRequestFocus: false, // the keyboard stays
        borderRadius: BorderRadius.circular(OrvTokens.radiusSm),
        onTap: () {
          HapticFeedback.selectionClick();
          onTap();
        },
        child: Container(
          constraints: const BoxConstraints(minWidth: 44),
          alignment: Alignment.center,
          padding: const EdgeInsets.symmetric(horizontal: 10),
          child: Text(
            label,
            style: OrvText.body(l).copyWith(fontFamily: monoFamily, fontSize: 13, color: on ? l.p.base : l.c.text),
          ),
        ),
      ),
    ),
  );

  Widget _outside(OrvLook l) {
    final s = _link.status;
    final left = _link.left;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Semantics(liveRegion: true, child: Text(_words[s] ?? '', style: OrvText.body(l))),
        const SizedBox(height: 16),
        if (s == PcStatus.pin) ...[
          OrvField(
            label: 'PIN',
            controller: _pin,
            obscure: true,
            autofocus: true,
            error: left == null ? null : 'Wrong PIN. $left ${left == 1 ? 'try' : 'tries'} left.',
            onSubmitted: (_) => _enter(),
          ),
          const SizedBox(height: 12),
          OrvButton(label: 'Open', variant: ButtonVariant.primary, onPressed: _enter),
        ] else if (s != PcStatus.finding) ...[
          OrvButton(label: 'Try again', variant: ButtonVariant.primary, onPressed: _link.connect),
          const SizedBox(height: 10),
          OrvButton(label: 'Forget this PC here', onPressed: widget.onForget),
        ],
      ],
    );
  }

  void _enter() {
    if (_pin.text.isEmpty) return;
    _link.enterPin(_pin.text);
    _pin.clear();
  }
}

/// Say it, run it (spec 0021 #12): the command is shown and can be changed; only Run runs it.
class _SayIt extends ConsumerStatefulWidget {
  const _SayIt({required this.shell});
  final String shell;
  @override
  ConsumerState<_SayIt> createState() => _SayItState();
}

class _SayItState extends ConsumerState<_SayIt> {
  final _want = TextEditingController();
  final _command = TextEditingController();
  Map<String, dynamic>? _got;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _want.dispose();
    _command.dispose();
    super.dispose();
  }

  Future<void> _ask() async {
    if (_busy || _want.text.trim().length < 3) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final r = await ref.read(apiProvider).post<Map<String, dynamic>>('/pc/suggest', {
        'want': _want.text,
        'shell': widget.shell,
      });
      _command.text = r['command'] as String;
      _got = r;
    } catch (_) {
      _error = 'No suggestion this time. Try other words.';
    }
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final got = _got;
    final some = got != null && (got['command'] as String).isNotEmpty;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          OrvField(
            label: 'What do you want to do?',
            hint: 'free port 3000',
            controller: _want,
            error: _error,
            autofocus: true,
            onSubmitted: (_) => _ask(),
          ),
          const SizedBox(height: 10),
          OrvButton(label: 'Suggest', loading: _busy, onPressed: _ask),
          if (got != null) ...[
            const SizedBox(height: 14),
            if (some) OrvField(label: 'Command', controller: _command),
            const SizedBox(height: 6),
            Text(got['why'] as String? ?? (some ? '' : 'No single command does that.'), style: OrvText.muted(l)),
            if (some && got['careful'] == true)
              Text('Changes things: read it first.', style: OrvText.muted(l).copyWith(color: l.c.danger)),
            if (some) ...[
              const SizedBox(height: 10),
              OrvButton(
                label: 'Run',
                variant: ButtonVariant.primary,
                onPressed: () {
                  if (_command.text.trim().isNotEmpty) Navigator.of(context).pop(_command.text.trim());
                },
              ),
            ],
          ],
        ],
      ),
    );
  }
}
