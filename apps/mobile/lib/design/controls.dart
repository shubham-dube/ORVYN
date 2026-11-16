import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import 'theme.dart';

enum ButtonVariant { primary, secondary, ghost, danger }

/// The one button. Springy press, haptic tick, a spinner while busy, never a Material ripple.
class OrvButton extends StatefulWidget {
  const OrvButton({
    super.key,
    required this.label,
    this.onPressed,
    this.variant = ButtonVariant.secondary,
    this.icon,
    this.loading = false,
    this.expand = false,
    this.small = false,
    this.semanticLabel,
  });
  final String label;
  final VoidCallback? onPressed;
  final ButtonVariant variant;
  final IconData? icon;
  final bool loading;
  final bool expand;
  final bool small;
  final String? semanticLabel;
  @override
  State<OrvButton> createState() => _OrvButtonState();
}

class _OrvButtonState extends State<OrvButton> {
  bool _down = false;

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final enabled = widget.onPressed != null && !widget.loading;
    final (bg, fg, border) = switch (widget.variant) {
      ButtonVariant.primary => (null, Colors.white, Colors.transparent),
      ButtonVariant.secondary => (l.c.glassStrong, l.c.text, l.c.edge),
      ButtonVariant.ghost => (Colors.transparent, l.c.text, Colors.transparent),
      ButtonVariant.danger => (l.c.danger.withValues(alpha: 0.12), l.c.danger, l.c.danger.withValues(alpha: 0.3)),
    };
    final h = widget.small ? 36.0 : 50.0;
    final content = Row(
      mainAxisSize: widget.expand ? MainAxisSize.max : MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        if (widget.loading)
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: SizedBox.square(dimension: 16, child: CircularProgressIndicator(strokeWidth: 2, color: fg)),
          )
        else if (widget.icon != null)
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: Icon(widget.icon, size: 18, color: fg),
          ),
        Flexible(
          child: Text(
            widget.label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontFamily: fontFamily,
              fontSize: widget.small ? 13 : 15,
              fontWeight: FontWeight.w600,
              color: fg,
            ),
          ),
        ),
      ],
    );
    return Semantics(
      container: true,
      button: true,
      enabled: enabled,
      label: widget.semanticLabel,
      excludeSemantics: widget.semanticLabel != null,
      child: GestureDetector(
        onTapDown: enabled ? (_) => setState(() => _down = true) : null,
        onTapCancel: () => setState(() => _down = false),
        onTapUp: (_) => setState(() => _down = false),
        onTap: enabled
            ? () {
                HapticFeedback.selectionClick();
                widget.onPressed!();
              }
            : null,
        child: AnimatedScale(
          scale: _down ? 0.96 : 1,
          duration: OrvTokens.durationFast,
          curve: springSnappy,
          child: AnimatedOpacity(
            opacity: enabled || widget.loading ? 1 : 0.55,
            duration: OrvTokens.durationFast,
            child: Container(
              height: h,
              padding: EdgeInsets.symmetric(horizontal: widget.small ? 12 : 20),
              decoration: BoxDecoration(
                color: bg,
                gradient: widget.variant == ButtonVariant.primary ? l.accentGradient : null,
                borderRadius: BorderRadius.circular(widget.small ? OrvTokens.radiusSm : OrvTokens.radiusMd),
                border: Border.all(color: border),
                boxShadow: widget.variant == ButtonVariant.primary
                    ? [
                        BoxShadow(
                          color: l.accentFrom.withValues(alpha: 0.35),
                          blurRadius: 18,
                          offset: const Offset(0, 6),
                        ),
                      ]
                    : null,
              ),
              child: content,
            ),
          ),
        ),
      ),
    );
  }
}

class OrvField extends StatelessWidget {
  const OrvField({
    super.key,
    required this.label,
    required this.controller,
    this.hint,
    this.error,
    this.keyboardType,
    this.autofillHints,
    this.onSubmitted,
    this.autofocus = false,
  });
  final String label;
  final TextEditingController controller;
  final String? hint;
  final String? error;
  final TextInputType? keyboardType;
  final Iterable<String>? autofillHints;
  final ValueChanged<String>? onSubmitted;
  final bool autofocus;

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    OutlineInputBorder b(Color c, [double w = 1]) => OutlineInputBorder(
      borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
      borderSide: BorderSide(color: c, width: w),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: OrvText.muted(l).copyWith(fontWeight: FontWeight.w600)),
        const SizedBox(height: 6),
        TextField(
          controller: controller,
          autofocus: autofocus,
          keyboardType: keyboardType,
          autofillHints: autofillHints,
          onSubmitted: onSubmitted,
          style: OrvText.body(l).copyWith(fontSize: 16),
          decoration: InputDecoration(
            hintText: hint,
            hintStyle: OrvText.body(l).copyWith(color: l.c.faint, fontSize: 16),
            filled: true,
            fillColor: l.c.field,
            contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
            enabledBorder: b(l.c.edge),
            focusedBorder: b(l.accent, 2),
            errorBorder: b(l.c.danger),
            focusedErrorBorder: b(l.c.danger, 2),
            errorText: error,
            errorStyle: OrvText.muted(l).copyWith(color: l.c.danger),
          ),
        ),
      ],
    );
  }
}

/// Six boxes, one hidden field: paste, SMS autofill and the keyboard all just work.
class CodeInput extends StatefulWidget {
  const CodeInput({super.key, required this.onCompleted, this.enabled = true, this.controller});
  final ValueChanged<String> onCompleted;
  final bool enabled;
  final TextEditingController? controller;
  @override
  State<CodeInput> createState() => _CodeInputState();
}

class _CodeInputState extends State<CodeInput> {
  late final TextEditingController _c = widget.controller ?? TextEditingController();
  final _focus = FocusNode();

  @override
  void initState() {
    super.initState();
    _c.addListener(() {
      setState(() {});
      if (_c.text.length == 6) widget.onCompleted(_c.text);
    });
  }

  @override
  void dispose() {
    if (widget.controller == null) _c.dispose();
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final text = _c.text;
    return Semantics(
      label: '6-digit code',
      textField: true,
      child: GestureDetector(
        onTap: () => _focus.requestFocus(),
        child: Stack(
          children: [
            Opacity(
              opacity: 0,
              child: TextField(
                key: const Key('code-field'),
                controller: _c,
                focusNode: _focus,
                autofocus: true,
                enabled: widget.enabled,
                keyboardType: TextInputType.number,
                autofillHints: const [AutofillHints.oneTimeCode],
                inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)],
              ),
            ),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                for (var i = 0; i < 6; i++)
                  AnimatedContainer(
                    duration: OrvTokens.durationBase,
                    curve: springSmooth,
                    width: 46,
                    height: 56,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: l.c.field,
                      borderRadius: BorderRadius.circular(OrvTokens.radiusMd),
                      border: Border.all(
                        color: i == text.length && _focus.hasFocus ? l.accent : l.c.edge,
                        width: i == text.length && _focus.hasFocus ? 2 : 1,
                      ),
                    ),
                    child: Text(
                      i < text.length ? text[i] : '',
                      style: OrvText.title(l).copyWith(fontFamily: monoFamily),
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class OrvBadge extends StatelessWidget {
  const OrvBadge(this.text, {super.key, this.tone});
  final String text;
  final Color? tone;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final c = tone ?? l.c.muted;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: c.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(OrvTokens.radiusFull),
      ),
      child: Text(
        text,
        style: OrvText.muted(l).copyWith(color: c, fontSize: 11, fontWeight: FontWeight.w700),
      ),
    );
  }
}

class OrvAvatar extends StatelessWidget {
  const OrvAvatar({super.key, required this.name, this.size = 40});
  final String name;
  final double size;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final initial = name.trim().isEmpty ? '?' : name.trim()[0].toUpperCase();
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: l.accentGradient,
        border: Border.all(color: l.c.edge),
      ),
      child: Text(
        initial,
        style: TextStyle(
          fontFamily: fontFamily,
          color: Colors.white,
          fontWeight: FontWeight.w700,
          fontSize: size * 0.42,
        ),
      ),
    );
  }
}

class OrvSwitchRow extends StatelessWidget {
  const OrvSwitchRow({super.key, required this.label, required this.value, required this.onChanged, this.subtitle});
  final String label;
  final String? subtitle;
  final bool value;
  final ValueChanged<bool>? onChanged;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return MergeSemantics(
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: OrvText.body(l).copyWith(fontWeight: FontWeight.w600)),
                if (subtitle != null) Text(subtitle!, style: OrvText.muted(l)),
              ],
            ),
          ),
          Switch(
            value: value,
            onChanged: onChanged == null
                ? null
                : (v) {
                    HapticFeedback.selectionClick();
                    onChanged!(v);
                  },
            activeTrackColor: l.accent,
            inactiveTrackColor: l.c.track,
          ),
        ],
      ),
    );
  }
}

class SectionLabel extends StatelessWidget {
  const SectionLabel(this.text, {super.key});
  final String text;
  @override
  Widget build(BuildContext context) => Text(text.toUpperCase(), style: OrvText.label(context.orv));
}
