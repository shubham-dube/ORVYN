import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:orvyn/app/task_query.dart';
import 'package:orvyn/app/today.dart';

/// The same searches as packages/today-plan (fixtures/task-query.json): both keep the same tasks.
void main() {
  final f = jsonDecode(File('../../packages/today-plan/fixtures/task-query.json').readAsStringSync()) as Map;
  final now = DateTime.parse(f['now'] as String).toLocal();
  final tasks = [for (final (i, t) in (f['tasks'] as List).cast<Map<String, dynamic>>().indexed) TaskItem('t$i', t)];
  for (final c in (f['queries'] as List).cast<Map<String, dynamic>>()) {
    test(jsonEncode(c['q']), () {
      final q = TaskQuery.fromJson(c['q'] as Map<String, dynamic>);
      expect([
        for (final t in tasks)
          if (taskMatches(t, q, now)) t.title,
      ], (c['matches'] as List).cast<String>());
    });
  }

  test('checklist progress, tags by use, and the words for a query', () {
    expect(checklistProgress(tasks[2]), (done: 1, total: 2));
    expect(allTags(tasks), ['home', 'money', 'urgent', 'work']);
    expect(TaskQuery.empty.isEmpty, isTrue);
    const q = TaskQuery(text: 'bank', projectId: 'p-work', tag: 'urgent', minPriority: 3, when: 'week');
    expect(
      describeQuery(q, projectName: (id) => id == 'p-work' ? 'Work' : null),
      '“bank” · Work · #urgent · high priority · next 7 days',
    );
    expect(describeQuery(TaskQuery.empty), 'Everything');
  });
}
