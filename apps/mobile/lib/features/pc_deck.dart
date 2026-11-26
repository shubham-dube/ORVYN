import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter/services.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:material_ui/material_ui.dart';

import '../core/files.dart';
import '../design/controls.dart';
import '../design/glass.dart';
import '../design/theme.dart';
import '../design/toast.dart';
import '../pc/pc.dart';

enum _Part { screen, files, controls }

String _size(int n) => n < 1024
    ? '$n B'
    : n < 1048576
    ? '${(n / 1024).round()} KB'
    : '${(n / 1048576).toStringAsFixed(1)} MB';

String _when(int? ms) {
  if (ms == null) return '';
  final d = DateTime.fromMillisecondsSinceEpoch(ms);
  final now = DateTime.now();
  if (d.year == now.year && d.month == now.month && d.day == now.day) {
    final h = d.hour % 12 == 0 ? 12 : d.hour % 12;
    return '$h:${d.minute.toString().padLeft(2, '0')} ${d.hour < 12 ? 'am' : 'pm'}';
  }
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return '${d.day} ${m[d.month - 1]} ${d.year % 100}';
}

/// The PC without the terminal (spec 0021 #11): its screen live, its files, and the small things.
class PcDeckView extends StatefulWidget {
  const PcDeckView({super.key, required this.link});
  final PcLink link;
  @override
  State<PcDeckView> createState() => _PcDeckViewState();
}

class _PcDeckViewState extends State<PcDeckView> {
  _Part _part = _Part.screen;

  @override
  void dispose() {
    widget.link.live(false); // nothing streams unseen
    super.dispose();
  }

  void _go(_Part p) {
    if (p != _Part.screen && widget.link.liveOn) widget.link.live(false);
    if (p == _Part.files) {
      widget.link.deck({'t': 'places'});
      if (widget.link.files == null) widget.link.deck({'t': 'files'});
    }
    if (p == _Part.controls) widget.link.deck({'t': 'deck'});
    setState(() => _part = p);
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
          child: SegmentedButton<_Part>(
            segments: const [
              ButtonSegment(value: _Part.screen, label: Text('Screen'), icon: Icon(LucideIcons.monitor, size: 16)),
              ButtonSegment(value: _Part.files, label: Text('Files'), icon: Icon(LucideIcons.folder, size: 16)),
              ButtonSegment(
                value: _Part.controls,
                label: Text('Controls'),
                icon: Icon(LucideIcons.slidersHorizontal, size: 16),
              ),
            ],
            selected: {_part},
            showSelectedIcon: false,
            onSelectionChanged: (s) => _go(s.first),
          ),
        ),
        Expanded(
          child: switch (_part) {
            _Part.screen => _Screen(link: widget.link),
            _Part.files => _Files(link: widget.link),
            _Part.controls => _Controls(link: widget.link),
          },
        ),
      ],
    );
  }
}

// ------------------------------------------------------------------ screen

const _keyList = [
  ('Enter', 'enter'),
  ('Esc', 'esc'),
  ('Tab', 'tab'),
  ('⌫', 'backspace'),
  ('Del', 'delete'),
  ('↑', 'up'),
  ('↓', 'down'),
  ('←', 'left'),
  ('→', 'right'),
  ('Win', 'win'),
  ('Alt+Tab', 'alt+tab'),
  ('Ctrl+C', 'ctrl+c'),
  ('Ctrl+V', 'ctrl+v'),
  ('Ctrl+Z', 'ctrl+z'),
  ('Ctrl+S', 'ctrl+s'),
  ('Win+D', 'win+d'),
];

/// The picture that clicks: a tap clicks at once (two taps are a double-click to Windows), a hold is a right
/// click, and in drag mode one finger drags. A ring shows where the tap went while the PC answers.
class _Picture extends StatefulWidget {
  const _Picture({required this.link, required this.screen, required this.drag, this.fill = false});
  final PcLink link;
  final Uint8List screen;
  final bool drag;

  /// as big as the space allows (full screen), not just as wide
  final bool fill;
  @override
  State<_Picture> createState() => _PictureState();
}

class _PictureState extends State<_Picture> {
  final _box = GlobalKey();
  Offset? _mark;
  int _marks = 0;

  /// Where on the PC's screens, 0..1.
  ({double x, double y}) _at(Offset local) {
    final box = _box.currentContext!.findRenderObject()! as RenderBox;
    return (x: (local.dx / box.size.width).clamp(0, 1), y: (local.dy / box.size.height).clamp(0, 1));
  }

  void _send(String k, Offset local, [Map<String, dynamic> more = const {}]) {
    final p = _at(local);
    widget.link.input({'k': k, 'x': p.x, 'y': p.y, ...more});
  }

  void _show(Offset at) {
    final n = ++_marks;
    setState(() => _mark = at);
    Future<void>.delayed(const Duration(milliseconds: 450), () {
      if (mounted && n == _marks) setState(() => _mark = null);
    });
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final picture = GestureDetector(
      key: _box,
      behavior: HitTestBehavior.opaque,
      // no double-tap listener: it would hold every tap back a third of a second
      onTapUp: (d) {
        _show(d.localPosition);
        _send('click', d.localPosition);
      },
      onLongPressStart: (d) {
        HapticFeedback.mediumImpact();
        _show(d.localPosition);
        _send('click', d.localPosition, {'right': true});
      },
      onPanStart: widget.drag ? (d) => _send('down', d.localPosition) : null,
      onPanUpdate: widget.drag ? (d) => _send('move', d.localPosition) : null,
      onPanEnd: widget.drag ? (_) => widget.link.input({'k': 'up', 'x': -1, 'y': -1}) : null,
      child: Stack(
        children: [
          Image.memory(
            widget.screen,
            gaplessPlayback: true,
            semanticLabel: 'The PC’s screen, live',
            width: widget.fill ? null : double.infinity,
          ),
          if (_mark != null)
            Positioned(
              left: _mark!.dx - 14,
              top: _mark!.dy - 14,
              child: IgnorePointer(
                child: Container(
                  width: 28,
                  height: 28,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(color: l.accent, width: 2.5),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
    return InteractiveViewer(
      maxScale: 6,
      // in drag mode one finger drags on the PC; pinch still zooms
      panEnabled: !widget.drag,
      child: widget.fill ? SizedBox.expand(child: FittedBox(child: picture)) : picture,
    );
  }
}

class _Screen extends StatefulWidget {
  const _Screen({required this.link});
  final PcLink link;
  @override
  State<_Screen> createState() => _ScreenState();
}

class _ScreenState extends State<_Screen> {
  bool _sharp = true;
  bool _drag = false;
  final _text = TextEditingController();

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _full() async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        fullscreenDialog: true,
        builder: (_) => _FullScreen(link: widget.link, drag: _drag),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final link = widget.link;
    final screen = link.screen;
    return ListView(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 24),
      children: [
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            link.liveOn
                ? OrvButton(label: 'Stop', small: true, icon: LucideIcons.square, onPressed: () => link.live(false))
                : OrvButton(
                    label: 'Show the screen live',
                    small: true,
                    icon: LucideIcons.play,
                    variant: ButtonVariant.primary,
                    onPressed: () => link.live(true, sharp: _sharp),
                  ),
            if (link.liveOn && screen != null)
              OrvButton(label: 'Full screen', small: true, icon: LucideIcons.maximize, onPressed: _full),
            OrvButton(
              label: _drag ? 'Drag mode' : 'Tap mode',
              small: true,
              icon: _drag ? LucideIcons.move : LucideIcons.mousePointer2,
              onPressed: () => setState(() => _drag = !_drag),
            ),
            OrvButton(
              label: _sharp ? 'Sharp' : 'Fast',
              small: true,
              onPressed: () {
                setState(() => _sharp = !_sharp);
                if (link.liveOn) link.live(true, sharp: _sharp);
              },
            ),
          ],
        ),
        const SizedBox(height: 10),
        if (screen == null)
          Container(
            height: 200,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              border: Border.all(color: l.c.edge),
              borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
            ),
            child: Text(
              link.liveOn ? 'Waiting for the first picture…' : 'Start it to see the PC as it is now.',
              style: OrvText.muted(l),
            ),
          )
        else
          ClipRRect(
            borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
            child: _Picture(link: link, screen: screen, drag: _drag),
          ),
        if (link.liveOn) ...[
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: OrvField(label: 'Type on the PC', controller: _text, onSubmitted: (_) => _type()),
              ),
              const SizedBox(width: 8),
              OrvButton(label: 'Type', small: true, onPressed: _type),
            ],
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final (label, key) in _keyList) _chip(l, label, () => link.input({'k': 'key', 'key': key})),
              _chip(l, 'Scroll ↑', () => link.input({'k': 'scroll', 'x': 0.5, 'y': 0.5, 'dy': -360})),
              _chip(l, 'Scroll ↓', () => link.input({'k': 'scroll', 'x': 0.5, 'y': 0.5, 'dy': 360})),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            'Tap to click, tap twice to double-click, hold for a right click. Drag mode drags on the PC; '
            'pinch to zoom. Full screen turns the phone sideways and types as you go. '
            'Windows’ sign-in screen and administrator windows don’t take input from here.',
            style: OrvText.muted(l).copyWith(fontSize: 12),
          ),
        ],
      ],
    );
  }

  void _type() {
    if (_text.text.isEmpty) return;
    widget.link.input({'k': 'text', 'text': _text.text});
    _text.clear();
  }
}

Widget _chip(OrvLook l, String label, VoidCallback onTap) => Material(
  color: l.c.track,
  borderRadius: BorderRadius.circular(OrvTokens.radiusSm),
  child: InkWell(
    borderRadius: BorderRadius.circular(OrvTokens.radiusSm),
    onTap: () {
      HapticFeedback.selectionClick();
      onTap();
    },
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      child: Text(label, style: OrvText.body(l).copyWith(fontFamily: monoFamily, fontSize: 12.5)),
    ),
  ),
);

/// What the hidden box holds, so a backspace on an empty line can still be heard.
const _held = '​';

/// The PC's screen on the whole phone, sideways, with the keyboard a tap away.
class _FullScreen extends StatefulWidget {
  const _FullScreen({required this.link, required this.drag});
  final PcLink link;
  final bool drag;
  @override
  State<_FullScreen> createState() => _FullScreenState();
}

class _FullScreenState extends State<_FullScreen> {
  late bool _drag = widget.drag;
  bool _keys = false;
  bool _bar = true;
  final _typing = TextEditingController(text: _held);
  final _focus = FocusNode();

  @override
  void initState() {
    super.initState();
    SystemChrome.setPreferredOrientations([DeviceOrientation.landscapeLeft, DeviceOrientation.landscapeRight]);
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
    widget.link.addListener(_changed);
    _focus.addListener(_changed);
  }

  @override
  void dispose() {
    widget.link.removeListener(_changed);
    SystemChrome.setPreferredOrientations(const []);
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
    _typing.dispose();
    _focus.dispose();
    super.dispose();
  }

  bool _leaving = false;

  void _changed() {
    if (!mounted) return;
    if (!widget.link.liveOn || widget.link.status != PcStatus.open) {
      if (!_leaving) {
        _leaving = true;
        Navigator.of(context).maybePop();
      }
    } else {
      setState(() {});
    }
  }

  /// Each letter goes as it is typed; the box itself stays empty.
  void _typed(String v) {
    if (!v.startsWith(_held)) {
      widget.link.input({'k': 'key', 'key': 'backspace'});
    } else if (v.length > _held.length) {
      widget.link.input({'k': 'text', 'text': v.substring(_held.length)});
    }
    _typing.value = const TextEditingValue(text: _held, selection: TextSelection.collapsed(offset: 1));
  }

  void _keyboard() {
    if (_focus.hasFocus) {
      _focus.unfocus();
    } else {
      _focus.requestFocus();
      SystemChannels.textInput.invokeMethod<void>('TextInput.show');
    }
  }

  Widget _tool(IconData icon, String tip, VoidCallback onTap, {bool on = false}) => Padding(
    padding: const EdgeInsets.only(bottom: 6),
    child: IconButton(
      tooltip: tip,
      onPressed: onTap,
      style: IconButton.styleFrom(
        backgroundColor: on ? context.orv.accent : context.orv.c.glassStrong,
        foregroundColor: on ? OrvTokens.dark.text : context.orv.c.text,
      ),
      icon: Icon(icon, size: 20),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final link = widget.link;
    final screen = link.screen;
    return Scaffold(
      backgroundColor: OrvTokens.light.text, // the darkest ink: around a screen, nothing else
      body: Stack(
        children: [
          Positioned.fill(
            child: screen == null ? const SizedBox() : _Picture(link: link, screen: screen, drag: _drag, fill: true),
          ),
          // off screen: it only brings up the keyboard and hears it
          Positioned(
            left: -1000,
            top: 0,
            width: 200,
            child: TextField(
              controller: _typing,
              focusNode: _focus,
              autocorrect: false,
              enableSuggestions: false,
              keyboardType: TextInputType.visiblePassword,
              onChanged: _typed,
              onSubmitted: (_) {
                link.input({'k': 'key', 'key': 'enter'});
                _focus.requestFocus();
              },
            ),
          ),
          SafeArea(
            child: Align(
              alignment: Alignment.topRight,
              child: Padding(
                padding: const EdgeInsets.all(6),
                child: _bar
                    ? Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          _tool(LucideIcons.minimize, 'Leave full screen', () => Navigator.of(context).pop()),
                          _tool(LucideIcons.keyboard, 'Keyboard', _keyboard, on: _focus.hasFocus),
                          _tool(LucideIcons.command, 'Keys', () => setState(() => _keys = !_keys), on: _keys),
                          _tool(
                            LucideIcons.move,
                            _drag ? 'Drag mode: one finger drags' : 'Tap mode: one finger moves the view',
                            () => setState(() => _drag = !_drag),
                            on: _drag,
                          ),
                          _tool(LucideIcons.chevronsRight, 'Hide these', () => setState(() => _bar = false)),
                        ],
                      )
                    : _tool(LucideIcons.chevronsLeft, 'Show the buttons', () => setState(() => _bar = true)),
              ),
            ),
          ),
          if (_keys)
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: SafeArea(
                child: Container(
                  color: l.c.glassStrong,
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  height: 50,
                  child: ListView(
                    scrollDirection: Axis.horizontal,
                    padding: const EdgeInsets.symmetric(horizontal: 8),
                    children: [
                      for (final (label, key) in _keyList)
                        Padding(
                          padding: const EdgeInsets.only(right: 6),
                          child: _chip(l, label, () => link.input({'k': 'key', 'key': key})),
                        ),
                      _chip(l, 'Scroll ↑', () => link.input({'k': 'scroll', 'x': 0.5, 'y': 0.5, 'dy': -360})),
                      const SizedBox(width: 6),
                      _chip(l, 'Scroll ↓', () => link.input({'k': 'scroll', 'x': 0.5, 'y': 0.5, 'dy': 360})),
                    ],
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

// ------------------------------------------------------------------ files

enum _Sort { name, newest, largest }

IconData _iconOf(PcEntry e) {
  if (e.dir) return LucideIcons.folder;
  final n = e.name.toLowerCase();
  bool any(List<String> ext) => ext.any((x) => n.endsWith('.$x'));
  if (any(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'heic', 'svg'])) return LucideIcons.fileImage;
  if (any(['mp4', 'mkv', 'mov', 'avi', 'webm'])) return LucideIcons.fileVideo;
  if (any(['mp3', 'wav', 'flac', 'm4a', 'ogg'])) return LucideIcons.fileMusic;
  if (any(['zip', 'rar', '7z', 'tar', 'gz'])) return LucideIcons.fileArchive;
  if (any([
    'ts',
    'tsx',
    'js',
    'py',
    'rs',
    'dart',
    'java',
    'kt',
    'go',
    'json',
    'yaml',
    'yml',
    'sh',
    'ps1',
    'html',
    'css',
  ])) {
    return LucideIcons.fileCode;
  }
  if (any(['pdf', 'doc', 'docx', 'txt', 'md', 'xls', 'xlsx', 'ppt', 'pptx', 'csv'])) return LucideIcons.fileText;
  return LucideIcons.file;
}

class _Files extends ConsumerStatefulWidget {
  const _Files({required this.link});
  final PcLink link;
  @override
  ConsumerState<_Files> createState() => _FilesState();
}

class _FilesState extends ConsumerState<_Files> {
  final _find = TextEditingController();
  _Sort _sort = _Sort.name;
  String? _path;

  @override
  void dispose() {
    _find.dispose();
    super.dispose();
  }

  void _open(String? path) => widget.link.deck({'t': 'files', 'path': path});

  Future<void> _send() async {
    final toaster = Toaster.of(context);
    final f = await ref.read(anyFilePickerProvider)();
    if (f == null) return;
    if (f.bytes.length > 25 * 1048576) {
      toaster.show('Files up to 25 MB can be sent', tone: ToastTone.danger);
      return;
    }
    final at = await widget.link.put(f.name, f.bytes);
    if (at != null) toaster.show('On the PC', body: at, tone: ToastTone.success);
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final link = widget.link;
    final files = link.files;
    if (files?.path != _path) {
      _path = files?.path;
      _find.clear();
    }
    final q = _find.text.trim().toLowerCase();
    final shown = [...?files?.list.where((e) => q.isEmpty || e.name.toLowerCase().contains(q))]
      ..sort((a, b) {
        if (a.dir != b.dir) return a.dir ? -1 : 1;
        return switch (_sort) {
          _Sort.name => a.name.toLowerCase().compareTo(b.name.toLowerCase()),
          _Sort.newest => (b.modified ?? 0).compareTo(a.modified ?? 0),
          _Sort.largest => b.size.compareTo(a.size),
        };
      });
    final parts = (files?.path ?? '').split(RegExp(r'[\\/]+')).where((p) => p.isNotEmpty).toList();
    final busy = link.progress ?? link.sending;
    return ListView(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 24),
      children: [
        SizedBox(
          height: 40,
          child: ListView(
            scrollDirection: Axis.horizontal,
            children: [
              for (final p in link.places)
                Padding(
                  padding: const EdgeInsets.only(right: 6),
                  child: ChoiceChip(
                    avatar: Icon(p.name.startsWith('Drive') ? LucideIcons.hardDrive : LucideIcons.folder, size: 16),
                    label: Text(p.name),
                    selected: files?.path == p.path,
                    showCheckmark: false,
                    onSelected: (_) => _open(p.path),
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: 8),
        if (files != null)
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                if (files.parent != null)
                  IconButton(
                    tooltip: 'Up one folder',
                    icon: const Icon(LucideIcons.folderUp, size: 18),
                    onPressed: () => _open(files.parent),
                  ),
                for (final (i, name) in parts.indexed) ...[
                  TextButton(
                    onPressed: () {
                      final to = parts.sublist(0, i + 1).join('\\');
                      _open(i == 0 && to.endsWith(':') ? '$to\\' : to);
                    },
                    child: Text(
                      name,
                      style: OrvText.body(l).copyWith(fontWeight: i == parts.length - 1 ? FontWeight.w700 : null),
                    ),
                  ),
                  if (i < parts.length - 1) Icon(LucideIcons.chevronRight, size: 14, color: l.c.faint),
                ],
              ],
            ),
          ),
        Row(
          children: [
            Expanded(
              child: OrvField(label: 'Find in this folder', controller: _find, prefix: LucideIcons.search),
            ),
            const SizedBox(width: 8),
            PopupMenuButton<_Sort>(
              tooltip: 'Sort',
              icon: const Icon(LucideIcons.arrowUpDown),
              initialValue: _sort,
              onSelected: (s) => setState(() => _sort = s),
              itemBuilder: (_) => const [
                PopupMenuItem(value: _Sort.name, child: Text('Name')),
                PopupMenuItem(value: _Sort.newest, child: Text('Newest')),
                PopupMenuItem(value: _Sort.largest, child: Text('Largest')),
              ],
            ),
          ],
        ),
        const SizedBox(height: 8),
        OrvButton(
          label: 'Send a file to the PC',
          small: true,
          icon: LucideIcons.upload,
          onPressed: link.sending == null ? _send : null,
        ),
        if (busy != null) ...[const SizedBox(height: 8), LinearProgressIndicator(value: busy)],
        const SizedBox(height: 8),
        if (files == null)
          Text('Opening your home folder…', style: OrvText.muted(l))
        else if (shown.isEmpty)
          Text('Nothing here.', style: OrvText.muted(l))
        else
          Glass(
            blur: false,
            padding: EdgeInsets.zero,
            child: Material(
              type: MaterialType.transparency,
              child: Column(
                children: [
                  for (final f in shown)
                    ListTile(
                      leading: Icon(_iconOf(f), color: f.dir ? l.accent : l.c.muted),
                      title: Text(f.name, maxLines: 1, overflow: TextOverflow.ellipsis),
                      subtitle: Text(
                        [_when(f.modified), if (!f.dir) _size(f.size)].where((x) => x.isNotEmpty).join(' · '),
                        style: OrvText.muted(l),
                      ),
                      onTap: () => f.dir ? _open(f.path) : link.deck({'t': 'get', 'path': f.path}),
                      trailing: f.dir
                          ? null
                          : PopupMenuButton<String>(
                              tooltip: 'More for ${f.name}',
                              onSelected: (v) => link.deck(
                                v == 'get' ? {'t': 'get', 'path': f.path} : {'t': 'openfile', 'path': f.path},
                              ),
                              itemBuilder: (_) => const [
                                PopupMenuItem(value: 'get', child: Text('Download to this phone')),
                                PopupMenuItem(value: 'open', child: Text('Open on the PC')),
                              ],
                            ),
                    ),
                ],
              ),
            ),
          ),
        if (files?.cut ?? false)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text('Only the first 1,000 are shown: use the terminal.', style: OrvText.muted(l)),
          ),
      ],
    );
  }
}

// ------------------------------------------------------------------ controls

class _Controls extends StatefulWidget {
  const _Controls({required this.link});
  final PcLink link;
  @override
  State<_Controls> createState() => _ControlsState();
}

class _ControlsState extends State<_Controls> {
  final _url = TextEditingController();
  final _clip = TextEditingController();
  double? _level;

  @override
  void dispose() {
    _url.dispose();
    _clip.dispose();
    super.dispose();
  }

  Future<void> _sleep() async {
    final yes = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Put the PC to sleep?'),
        content: const Text('You can’t wake it from here unless it is set up for that.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('No')),
          TextButton(onPressed: () => Navigator.pop(c, true), child: const Text('Sleep')),
        ],
      ),
    );
    if (yes == true) widget.link.deck({'t': 'do', 'what': 'sleep'});
  }

  @override
  Widget build(BuildContext context) {
    final link = widget.link;
    final sound = link.sound;
    return ListView(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 24),
      children: [
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            OrvButton(
              label: 'Lock',
              small: true,
              icon: LucideIcons.lock,
              onPressed: () => link.deck({'t': 'do', 'what': 'lock'}),
            ),
            OrvButton(label: 'Sleep', small: true, icon: LucideIcons.moon, onPressed: _sleep),
            if (sound != null)
              OrvButton(
                label: sound.muted ? 'Unmute' : 'Mute',
                small: true,
                icon: sound.muted ? LucideIcons.volumeX : LucideIcons.volume2,
                onPressed: () => link.deck({'t': 'do', 'what': 'mute', 'v': sound.muted ? 0 : 1}),
              ),
          ],
        ),
        if (sound != null)
          Slider(
            value: _level ?? sound.volume.toDouble(),
            max: 100,
            label: 'Volume',
            onChanged: (v) => setState(() => _level = v),
            onChangeEnd: (v) {
              link.deck({'t': 'do', 'what': 'volume', 'v': v.round()});
              setState(() => _level = null);
            },
          ),
        const SizedBox(height: 10),
        OrvField(label: 'Open a link on the PC', controller: _url, keyboardType: TextInputType.url),
        const SizedBox(height: 6),
        OrvButton(
          label: 'Open on the PC',
          small: true,
          onPressed: () {
            final u = _url.text.trim();
            if (u.isEmpty) return;
            link.deck({'t': 'open', 'url': u.startsWith(RegExp('https?://')) ? u : 'https://$u'});
            _url.clear();
          },
        ),
        const SizedBox(height: 14),
        OrvField(label: 'Text for the PC’s clipboard', controller: _clip),
        const SizedBox(height: 6),
        Wrap(
          spacing: 8,
          children: [
            OrvButton(
              label: 'Send',
              small: true,
              onPressed: () {
                if (_clip.text.isEmpty) return;
                link.deck({'t': 'clip', 'text': _clip.text});
                _clip.clear();
              },
            ),
            OrvButton(label: 'Get the PC’s', small: true, onPressed: () => link.deck({'t': 'clip'})),
          ],
        ),
      ],
    );
  }
}
