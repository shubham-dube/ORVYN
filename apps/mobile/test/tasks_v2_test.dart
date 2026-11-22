import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import 'calendar_screen_test.dart' show seed, tapIt;
import 'support/fake_server.dart';
import 'support/harness.dart';

// The harness clock is Monday 16 Nov 2026, 09:30.
Future<FakeSyncBackend> openToday(WidgetTester tester, AppHarness h, void Function(FakeSyncBackend) seeds) async {
  final b = FakeSyncBackend()..attach(h.server);
  seeds(b);
  await h.pump(tester);
  await tester.tap(find.bySemanticsLabel('Today'));
  await settle(tester, 20);
  // a tall phone, so the whole list is built
  tester.view.physicalSize = const Size(1080, 4800);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await settle(tester);
  return b;
}

void main() {
  testWidgets('search, filters and saved filters narrow the list', (tester) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['today']));
    final b = await openToday(tester, h, (b) {
      seed(b, 'today.project', 'p-work', {'name': 'Work', 'colour': 'sky'});
      seed(b, 'today.task', 'a', {
        'title': 'Ship release notes',
        'dueDate': '2026-11-16',
        'tags': ['urgent'],
        'projectId': 'p-work',
        'priority': 3,
        'checklist': [
          {'id': 's1', 'text': 'draft', 'done': true},
          {'id': 's2', 'text': 'review', 'done': false},
        ],
      });
      seed(b, 'today.task', 'b', {'title': 'Buy milk', 'dueDate': '2026-11-16'});
    });
    expect(find.text('Ship release notes'), findsOneWidget);
    expect(find.text('Buy milk'), findsOneWidget);
    expect(find.text('1/2'), findsOneWidget); // checklist progress on the row
    expect(find.textContaining('#urgent'), findsWidgets);

    // words: found through the steps too
    await tester.tap(find.bySemanticsLabel('Search tasks'));
    await settle(tester);
    await tester.enterText(find.byKey(const Key('task-search')), 'review');
    await settle(tester);
    expect(find.text('Ship release notes'), findsOneWidget);
    expect(find.text('Buy milk'), findsNothing);
    await tester.enterText(find.byKey(const Key('task-search')), 'nothing like this');
    await settle(tester);
    expect(find.text('Nothing matches today.'), findsOneWidget);

    // a tag, saved under a name, comes back on a tap
    await tester.enterText(find.byKey(const Key('task-search')), '');
    await settle(tester);
    await tester.tap(find.bySemanticsLabel('Filters'));
    await settle(tester);
    await tester.tap(find.widgetWithText(ChoiceChip, '#urgent'));
    await settle(tester);
    await tester.tap(find.text('Show tasks'));
    await settle(tester);
    expect(find.bySemanticsLabel('Filters'), findsOneWidget);
    expect(find.text('Buy milk'), findsNothing);
    await tapIt(tester, find.text('Save this filter'));
    await tester.enterText(find.widgetWithText(TextField, '').last, 'Urgent');
    await tapIt(tester, find.text('Save'));
    final saved = b.rows.entries.where((e) => e.key.startsWith('today.filter/')).single.value;
    expect(saved, containsPair('name', 'Urgent'));
    expect(saved, containsPair('tag', 'urgent'));
    await tapIt(tester, find.widgetWithText(InputChip, 'Urgent'));
    expect(find.text('Buy milk'), findsOneWidget, reason: 'tapping the active filter turns it off');
    await finish(tester);
  });

  testWidgets('the sheet takes steps, tags, a duration and a repeat; the board and bulk actions move tasks', (
    tester,
  ) async {
    final h = AppHarness()..signedInAs(userJson(ent: ['today']));
    final b = await openToday(tester, h, (b) {
      seed(b, 'today.project', 'p-home', {'name': 'Home', 'colour': 'emerald'});
      seed(b, 'today.task', 'a', {'title': 'Plan offsite', 'dueDate': '2026-11-16'});
      seed(b, 'today.task', 'b', {'title': 'Buy milk', 'dueDate': '2026-11-16'});
      seed(b, 'today.task', 'c', {'title': 'Buy bread', 'dueDate': '2026-11-16'});
    });
    Map<String, dynamic> row(String id) => b.rows['today.task/$id']!;

    await tapIt(tester, find.text('Plan offsite'));
    // the sheet stays short: tags, checklist and repeat open from their "+" rows (spec 0012 A3)
    expect(find.byKey(const Key('task-tag-input')), findsNothing);
    await tapIt(tester, find.text('Tags'));
    await tester.enterText(find.byKey(const Key('task-tag-input')), 'work');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await settle(tester);
    await tapIt(tester, find.text('Checklist'));
    await tester.enterText(find.byKey(const Key('task-step-input')), 'book venue');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await settle(tester);
    await tester.tap(find.bySemanticsLabel('Done: book venue'));
    await settle(tester);
    await tapIt(tester, find.bySemanticsLabel('Duration'));
    await tapIt(tester, find.text('1h'));
    expect(find.bySemanticsLabel('1h'), findsOneWidget, reason: 'the pill now says how long');
    await tapIt(tester, find.text('Repeat'));
    await tapIt(tester, find.text('Weekly'));
    expect(find.text('Every week on Mon'), findsOneWidget);
    expect(find.textContaining('Next: 2026-11-16 · 2026-11-23'), findsOneWidget);
    await tapIt(tester, find.byKey(const Key('task-save')));
    expect(row('a')['tags'], ['work']);
    expect(row('a')['durationMin'], 60);
    expect(row('a')['rrule'], 'FREQ=WEEKLY;BYDAY=MO');
    expect((row('a')['checklist'] as List).single, containsPair('done', true));

    // the board has a column per status; ⋯ on a card moves it (long-press drags it)
    await tapIt(tester, find.bySemanticsLabel('Board'));
    expect(find.text('TO DO'), findsOneWidget);
    expect(find.text('DOING'), findsOneWidget);
    final card = find.ancestor(of: find.text('Buy bread'), matching: find.byType(Row)).first;
    await tapIt(tester, find.descendant(of: card, matching: find.byTooltip('Move to')));
    await tapIt(tester, find.text('Move to Doing'));
    expect(row('c')['status'], 'doing');

    // select: hold a row (or tap Select), tick two, move them with the floating bar
    await tapIt(tester, find.bySemanticsLabel('List'));
    await tester.longPress(find.text('Buy milk'));
    await settle(tester);
    expect(find.text('1 selected'), findsOneWidget);
    await tapIt(tester, find.text('Plan offsite'));
    expect(find.text('2 selected'), findsOneWidget);
    await tapIt(tester, find.bySemanticsLabel('Project'));
    await tapIt(tester, find.descendant(of: find.byType(BottomSheet), matching: find.text('Home')));
    expect(row('a')['projectId'], 'p-home');
    expect(row('b')['projectId'], 'p-home');
    expect(find.text('2 selected'), findsNothing, reason: 'select mode ends after the action');
    await tester.pump(const Duration(seconds: 5));
    await finish(tester);
  });
}
