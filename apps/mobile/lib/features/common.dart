import 'package:material_ui/material_ui.dart';

import '../core/api.dart';
import '../design/theme.dart';

/// Friendly words for API failures; never raw codes.
String messageFor(Object e) {
  if (e is ApiError) {
    return switch (e.code) {
      'offline' => 'You’re offline. Try again when you’re connected.',
      'rate_limited' => 'Too many tries. Wait a few minutes and try again.',
      'invalid_code' => 'That code isn’t right, or it has expired. Check it or ask for a new one.',
      'too_many_attempts' => 'Too many wrong codes. Ask for a new one.',
      'invite_required' => 'You need a valid invite to join ORVYN.',
      'invite_used' => 'That invite has already been used.',
      'account_disabled' => 'This account is switched off. Ask the person who invited you.',
      _ => 'Something went wrong. Please try again.',
    };
  }
  return 'Something went wrong. Please try again.';
}

String greetingAt(DateTime t) {
  final h = t.hour;
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 22) return 'Good evening';
  return 'Good night';
}

const moduleInfo = <String, (String, String)>{
  'today': ('Today', 'Tasks and calendar on one river of time'),
  'drop': ('Drop', 'Photograph, say or forward anything — it files itself'),
  'money': ('Money', 'Spending captured from SMS, receipts and statements'),
  'library': ('Library', 'Documents that organise themselves'),
  'vault': ('Vault', 'Secrets only your devices can open'),
  'assistant': ('Assistant', 'Ask anything about your life, and act on it'),
  'chat': ('Chat', 'End-to-end encrypted conversations with friends'),
  'ipo': ('IPO desk', 'Every Indian IPO, read and reasoned for you'),
  'jobs': ('Jobs', 'JobOS reviews and applications from your phone'),
};

class PageTitle extends StatelessWidget {
  const PageTitle(this.text, {super.key, this.overline});
  final String text;
  final String? overline;
  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 8, 4, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (overline != null) Text(overline!, style: OrvText.muted(l)),
          Semantics(header: true, child: Text(text, style: OrvText.title(l))),
        ],
      ),
    );
  }
}

String timeAgo(DateTime t, DateTime now) {
  final d = now.difference(t);
  if (d.inMinutes < 1) return 'just now';
  if (d.inHours < 1) return '${d.inMinutes} min ago';
  if (d.inDays < 1) return '${d.inHours} h ago';
  if (d.inDays < 7) return '${d.inDays} d ago';
  return '${t.day}/${t.month}/${t.year}';
}
