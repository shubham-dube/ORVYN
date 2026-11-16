/// Build-time configuration (`--dart-define`). Nothing secret lives here.
abstract final class Config {
  /// The API base URL. The Android emulator reaches the host's localhost at 10.0.2.2.
  static const apiUrl = String.fromEnvironment('ORVYN_API_URL', defaultValue: 'http://10.0.2.2:4000');

  /// Public web origin, used for invite links and the passkey relying party.
  static const webUrl = String.fromEnvironment('ORVYN_WEB_URL', defaultValue: 'http://10.0.2.2:3000');

  static const appVersion = String.fromEnvironment('ORVYN_APP_VERSION', defaultValue: '0.1.0');
}
