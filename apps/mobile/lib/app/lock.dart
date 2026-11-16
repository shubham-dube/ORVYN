import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:local_auth/local_auth.dart';

import 'state.dart';

/// Fingerprint / face / device PIN, behind an interface for tests.
abstract interface class Authenticator {
  Future<bool> available();
  Future<bool> authenticate(String reason);
}

class DeviceAuthenticator implements Authenticator {
  final _auth = LocalAuthentication();
  @override
  Future<bool> available() async {
    try {
      return await _auth.isDeviceSupported();
    } catch (_) {
      return false;
    }
  }

  @override
  Future<bool> authenticate(String reason) async {
    try {
      return await _auth.authenticate(localizedReason: reason, persistAcrossBackgrounding: true);
    } catch (_) {
      return false;
    }
  }
}

final authenticatorProvider = Provider<Authenticator>((_) => DeviceAuthenticator());

/// App lock: when on, ORVYN asks for the device's biometric/PIN at launch and after five minutes away.
/// (The Vault adds its own, stronger unlock on top — ADR-0004.)
class LockState {
  const LockState({required this.enabled, required this.locked});
  final bool enabled;
  final bool locked;
}

final lockProvider = NotifierProvider<LockController, LockState>(LockController.new);

class LockController extends Notifier<LockState> {
  static const _key = 'orvyn.lock';
  static const awayLimit = Duration(minutes: 5);
  DateTime? _wentAway;

  @override
  LockState build() {
    unawaited(
      ref.read(storeProvider).read(_key).then((v) {
        if (v == '1') state = const LockState(enabled: true, locked: true);
      }),
    );
    return const LockState(enabled: false, locked: false);
  }

  Future<bool> setEnabled(bool on) async {
    if (on) {
      final auth = ref.read(authenticatorProvider);
      if (!await auth.available() || !await auth.authenticate('Turn on app lock')) return false;
    }
    await ref.read(storeProvider).write(_key, on ? '1' : null);
    state = LockState(enabled: on, locked: false);
    return true;
  }

  void paused() => _wentAway = ref.read(clockProvider)();

  void resumed() {
    final away = _wentAway;
    _wentAway = null;
    if (state.enabled && away != null && ref.read(clockProvider)().difference(away) >= awayLimit) {
      state = const LockState(enabled: true, locked: true);
    }
  }

  Future<void> unlock() async {
    if (await ref.read(authenticatorProvider).authenticate('Unlock ORVYN')) {
      state = const LockState(enabled: true, locked: false);
    }
  }
}
