import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../app/state.dart';
import '../design/controls.dart';
import '../design/glass.dart';
import '../design/orb.dart';
import '../design/theme.dart';
import 'common.dart';

/// Email code today. Passkeys and Google join on Android once the app is signed with its release key
/// (they need Digital Asset Links on orvyn.dubey.app and an OAuth client) — see docs/specs/0001-foundation.
class SignInScreen extends ConsumerStatefulWidget {
  const SignInScreen({super.key, this.invite, this.heading, this.sub, this.lockedEmail});
  final String? invite;
  final String? heading;
  final String? sub;
  final String? lockedEmail;
  @override
  ConsumerState<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends ConsumerState<SignInScreen> {
  late final _email = TextEditingController(text: widget.lockedEmail ?? '');
  final _code = TextEditingController();
  bool _codeStep = false;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _code.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _email.dispose();
    _code.dispose();
    super.dispose();
  }

  Future<void> _sendCode() async {
    final email = _email.text.trim().toLowerCase();
    if (!RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(email)) {
      setState(() => _error = 'Enter a valid email address.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(sessionProvider.notifier).startEmail(email, invite: widget.invite);
      setState(() => _codeStep = true);
    } catch (e) {
      setState(() => _error = messageFor(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _verify(String code) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref
          .read(sessionProvider.notifier)
          .verifyEmail(_email.text.trim().toLowerCase(), code, invite: widget.invite);
    } catch (e) {
      _code.clear();
      if (mounted) setState(() => _error = messageFor(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    final revoked = switch (ref.watch(sessionProvider)) {
      SignedOut(reason: 'revoked') => true,
      _ => false,
    };
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Glass(
                level: GlassLevel.halo,
                padding: const EdgeInsets.all(28),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Orb(size: 56, label: 'ORVYN'),
                    const SizedBox(height: 16),
                    Semantics(
                      header: true,
                      child: Text(
                        widget.heading ?? 'Welcome back',
                        style: OrvText.title(l),
                        textAlign: TextAlign.center,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(widget.sub ?? 'Sign in to your ORVYN.', style: OrvText.muted(l), textAlign: TextAlign.center),
                    if (revoked) ...[
                      const SizedBox(height: 12),
                      Text(
                        'This phone was signed out from another device.',
                        style: OrvText.muted(l).copyWith(color: l.c.warning),
                        textAlign: TextAlign.center,
                      ),
                    ],
                    const SizedBox(height: 24),
                    AnimatedSwitcher(
                      duration: context.reduceMotion ? Duration.zero : OrvTokens.durationSlow,
                      switchInCurve: springSmooth,
                      transitionBuilder: (child, a) => FadeTransition(
                        opacity: a,
                        child: SlideTransition(
                          position: Tween(begin: const Offset(0.06, 0), end: Offset.zero).animate(a),
                          child: child,
                        ),
                      ),
                      child: _codeStep ? _codeView(l) : _emailView(l),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _emailView(OrvLook l) => Column(
    key: const ValueKey('email'),
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      AutofillGroup(
        child: OrvField(
          label: 'Email',
          controller: _email,
          hint: 'you@example.com',
          keyboardType: TextInputType.emailAddress,
          autofillHints: const [AutofillHints.email],
          error: _error,
          onSubmitted: (_) => _sendCode(),
        ),
      ),
      const SizedBox(height: 14),
      OrvButton(
        label: 'Email me a code',
        icon: Icons.mail_outline_rounded,
        variant: ButtonVariant.primary,
        expand: true,
        loading: _busy,
        onPressed: _sendCode,
      ),
    ],
  );

  Widget _codeView(OrvLook l) => Column(
    key: const ValueKey('code'),
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Center(child: SectionLabel('Check your inbox')),
      const SizedBox(height: 6),
      Text(
        'If ${_email.text.trim().toLowerCase()} can sign in, a 6-digit code is on its way.',
        style: OrvText.muted(l),
        textAlign: TextAlign.center,
      ),
      const SizedBox(height: 18),
      CodeInput(controller: _code, onCompleted: _verify, enabled: !_busy),
      if (_error != null) ...[
        const SizedBox(height: 10),
        Semantics(
          liveRegion: true,
          child: Text(
            _error!,
            style: OrvText.muted(l).copyWith(color: l.c.danger),
            textAlign: TextAlign.center,
          ),
        ),
      ],
      const SizedBox(height: 16),
      OrvButton(
        label: 'Sign in',
        variant: ButtonVariant.primary,
        expand: true,
        loading: _busy,
        onPressed: _code.text.length == 6 ? () => _verify(_code.text) : null,
      ),
      const SizedBox(height: 4),
      OrvButton(
        label: 'Use a different email',
        variant: ButtonVariant.ghost,
        small: true,
        onPressed: () => setState(() {
          _codeStep = false;
          _error = null;
          _code.clear();
        }),
      ),
    ],
  );
}

/// `orvyn.dubey.app/join/<token>`: shows who invited you, then the same sign-in.
class JoinScreen extends ConsumerStatefulWidget {
  const JoinScreen({super.key, required this.token});
  final String token;
  @override
  ConsumerState<JoinScreen> createState() => _JoinScreenState();
}

class _JoinScreenState extends ConsumerState<JoinScreen> {
  Map<String, dynamic>? _preview;

  @override
  void initState() {
    super.initState();
    ref
        .read(apiProvider)
        .call<Map<String, dynamic>>('GET', '/invites/${Uri.encodeComponent(widget.token)}', auth: false)
        .then((p) => setState(() => _preview = p), onError: (_) => setState(() => _preview = {'valid': false}));
  }

  @override
  Widget build(BuildContext context) {
    final p = _preview;
    if (p == null) {
      return const Scaffold(
        body: Center(
          child: Orb(size: 56, state: OrbState.thinking, label: 'Loading'),
        ),
      );
    }
    if (p['valid'] != true) {
      return Scaffold(
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Glass(
              level: GlassLevel.halo,
              padding: const EdgeInsets.all(28),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text('This invite can’t be used', style: OrvText.title(context.orv), textAlign: TextAlign.center),
                  const SizedBox(height: 8),
                  Text(
                    'It may have expired or already been used. Ask for a new link.',
                    style: OrvText.muted(context.orv),
                    textAlign: TextAlign.center,
                  ),
                ],
              ),
            ),
          ),
        ),
      );
    }
    final email = p['email'] as String?;
    return SignInScreen(
      invite: widget.token,
      heading: '${p['invitedBy']} invited you',
      sub: email != null ? 'Join ORVYN with $email.' : 'Create your ORVYN account.',
      lockedEmail: email,
    );
  }
}
