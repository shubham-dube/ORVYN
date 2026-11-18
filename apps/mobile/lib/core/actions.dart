import 'api.dart';

/// Press a notification's action button (Done, Snooze 10 min, …) on the server. Works from a background isolate:
/// with no access token in memory it refreshes first, using the refresh token in secure storage. Returns false when
/// offline or signed out — the notification then stays, so nothing is lost.
Future<bool> runNotificationAction(Api api, String notificationId, String actionId, {String? text}) async {
  try {
    if (api.accessToken == null && await api.refresh() == null) return false;
    await api.post<dynamic>(
      '/notifications/$notificationId/actions/${Uri.encodeComponent(actionId)}',
      text == null ? null : {'text': text},
    );
    return true;
  } on ApiError {
    return false;
  }
}

/// Android shows at most three buttons in the shade; the app shows all of them.
const maxShadeActions = 3;
