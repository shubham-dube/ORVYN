import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../app/state.dart';
import '../core/models.dart';
import '../design/controls.dart';
import '../design/glass.dart';
import '../design/orb.dart';
import '../design/theme.dart';
import '../design/toast.dart';

/// Every primitive in every light — for design review and screenshots. Reached from the command sheet in
/// debug builds only.
class GalleryScreen extends ConsumerStatefulWidget {
  const GalleryScreen({super.key});
  @override
  ConsumerState<GalleryScreen> createState() => _GalleryScreenState();
}

class _GalleryScreenState extends ConsumerState<GalleryScreen> {
  bool _on = true;
  final _field = TextEditingController();

  @override
  void dispose() {
    _field.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.orv;
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text('Aurora Glass', style: OrvText.title(l)),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              children: [
                for (final p in ThemePreference.values.skip(1))
                  OrvButton(
                    label: p.name,
                    small: true,
                    onPressed: () => ref.read(themePreferenceProvider.notifier).set(p),
                  ),
              ],
            ),
            const SizedBox(height: 16),
            for (final g in GlassLevel.values) ...[
              Glass(
                level: g,
                padding: const EdgeInsets.all(16),
                child: Text('${g.name}: text on glass stays readable in every light.', style: OrvText.body(l)),
              ),
              const SizedBox(height: 10),
            ],
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final v in ButtonVariant.values) OrvButton(label: v.name, variant: v, onPressed: () {}),
                const OrvButton(label: 'Disabled'),
                const OrvButton(label: 'Loading', variant: ButtonVariant.primary, loading: true),
              ],
            ),
            const SizedBox(height: 16),
            OrvField(label: 'Field', controller: _field, hint: 'Type here'),
            const SizedBox(height: 10),
            OrvField(
              label: 'With an error',
              controller: TextEditingController(text: 'oops'),
              error: 'Something isn’t right',
            ),
            const SizedBox(height: 10),
            OrvSwitchRow(label: 'A switch', value: _on, onChanged: (v) => setState(() => _on = v)),
            const SizedBox(height: 16),
            Wrap(
              spacing: 8,
              children: [
                const OrvBadge('neutral'),
                OrvBadge('accent', tone: l.accent),
                OrvBadge('success', tone: l.c.success),
                OrvBadge('warning', tone: l.c.warning),
                OrvBadge('danger', tone: l.c.danger),
              ],
            ),
            const SizedBox(height: 16),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final k in moduleKeys)
                  OrvModule(
                    module: k,
                    child: Builder(builder: (c) => OrvBadge(k, tone: c.orv.accent)),
                  ),
              ],
            ),
            const SizedBox(height: 24),
            const Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                Orb(label: 'Idle'),
                Orb(state: OrbState.thinking, label: 'Thinking'),
                Orb(state: OrbState.needsYou, label: 'Needs you'),
              ],
            ),
            const SizedBox(height: 24),
            OrvButton(
              label: 'Show a toast',
              onPressed: () => Toaster.of(context).show('Hello from ORVYN', body: 'Quiet, at the edge.'),
            ),
          ],
        ),
      ),
    );
  }
}
