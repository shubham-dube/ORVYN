/// The ways a reminder can reach the person (D22) — same rules as `reminderPlan` in packages/contracts.
const reminderWays = ['push', 'urgent', 'alarm', 'email', 'whatsapp'];

const wayLabels = {
  'push': 'Notification',
  'urgent': 'Hard notification',
  'alarm': 'Alarm',
  'email': 'Email',
  'whatsapp': 'WhatsApp',
};

const wayHelp = {
  'push': 'A normal notification on your devices.',
  'urgent': 'Ignores quiet hours and comes back every 5 minutes until you act on it.',
  'alarm': 'Rings like an alarm, full-screen, even if the app is closed.',
  'email': 'An email to your account address.',
  'whatsapp': 'A WhatsApp message to your confirmed number.',
};

/// Nothing chosen counts as a normal notification.
List<String> waysOf(Object? via) {
  final l = [
    for (final w in (via as List?) ?? const [])
      if (reminderWays.contains(w)) w as String,
  ];
  return l.isEmpty ? ['push'] : reminderWays.where(l.contains).toList();
}

String waysLabel(Object? via) {
  final l = [for (final w in waysOf(via)) wayLabels[w]!];
  return l.length > 1 ? '${l.sublist(0, l.length - 1).join(', ')} and ${l.last}' : l.first;
}

typedef PlannedReminder = ({int? minutes, String? at, List<String> via});

/// Everything a task's reminders call for, each with when and the ways (its own, else the person's defaults).
/// `reminders` null = the person's defaults; [] = none for this task. `defaults` is the `reminders` map of the
/// person's Today settings (null before they've saved any: only a task's own reminders count, D17).
List<PlannedReminder> reminderPlan(Map<String, dynamic> task, Map<String, dynamic>? defaults) {
  final dflt = waysOf(defaults?['via']);
  final own = task['reminders'] as List?;
  if (own != null) {
    return [
      for (final r in own.cast<Map<dynamic, dynamic>>())
        if (r['kind'] == 'before')
          (
            minutes: (r['minutes'] as num).toInt(),
            at: null,
            via: (r['via'] as List?)?.isNotEmpty ?? false ? waysOf(r['via']) : dflt,
          )
        else
          (
            minutes: null,
            at: r['at'] as String,
            via: (r['via'] as List?)?.isNotEmpty ?? false ? waysOf(r['via']) : dflt,
          ),
    ];
  }
  if (defaults == null || (task['dueAt'] == null && task['scheduledStart'] == null)) return const [];
  return [
    for (final m in (defaults['timed'] as List? ?? const []).cast<num>()) (minutes: m.toInt(), at: null, via: dflt),
  ];
}
