import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:orvyn/library/library.dart';

/// The same searches and expiry rules as packages/library (fixtures/search.json): same documents, same order.
void main() {
  final f = jsonDecode(File('../../packages/library/fixtures/search.json').readAsStringSync()) as Map<String, dynamic>;
  final docs = [for (final d in (f['docs'] as List).cast<Map<String, dynamic>>()) DocItem(d['id'] as String, d)];
  final today = f['today'] as String;

  for (final s in (f['searches'] as List).cast<Map<String, dynamic>>()) {
    test('search “${s['q']}”', () {
      expect([for (final d in searchDocs(docs, s['q'] as String)) d.id], (s['ids'] as List).cast<String>());
    });
  }
  for (final e in (f['expiry'] as List).cast<Map<String, dynamic>>()) {
    test('expiry ${e['on']}', () {
      final x = expiry(e['on'] as String, today);
      expect(x.days, e['days']);
      expect(x.urgency.name, e['urgency']);
      expect(expiryLabel(x.days), e['label']);
    });
  }
  test('what runs out first, expired ones included', () {
    expect([for (final d in expiringSoon(docs, today)) d.id], (f['expiringSoon'] as List).cast<String>());
    expect(expiry(null, today).urgency, Urgency.none);
  });
  test('sizes in words', () {
    expect(formatBytes(900), '900 B');
    expect(formatBytes(2048), '2.0 KB');
    expect(formatBytes(5 * 1024 * 1024), '5.0 MB');
  });
}
