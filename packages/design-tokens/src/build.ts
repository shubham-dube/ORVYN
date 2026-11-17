/**
 * Generates platform outputs from tokens.json (ADR-0007):
 *   dist/tokens.css  — CSS variables; palettes switch with [data-phase], accents with [data-module]
 *   dist/theme.css   — Tailwind v4 @theme mapping (bg-orv-glass, text-orv-muted, rounded-orv-lg, …)
 *   dist/tokens.js + tokens.d.ts — typed tokens + helpers for TS apps
 *   dist/orvyn_tokens.dart — the same tokens for Flutter (also written to apps/mobile/lib/design/tokens.g.dart)
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toDartHex } from './color.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const T = JSON.parse(readFileSync(join(root, 'tokens.json'), 'utf8'));
const out = join(root, 'dist');
mkdirSync(out, { recursive: true });

type Mode = 'light' | 'dark';
const modeKeys = Object.keys(T.modes.light) as string[];
const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
const header = '/* Generated from packages/design-tokens/tokens.json — do not edit. */\n';

// ---------------------------------------------------------------- tokens.css
const css: string[] = [header, ':root {'];
for (const [k, v] of Object.entries(T.radius)) css.push(`  --orv-radius-${k}: ${v}px;`);
for (const [k, v] of Object.entries(T.space)) css.push(`  --orv-space-${k}: ${v}px;`);
css.push(`  --orv-font-sans: ${T.font.sans};`, `  --orv-font-mono: ${T.font.mono};`);
for (const [k, v] of Object.entries<Record<string, number>>(T.type)) {
  css.push(`  --orv-type-${k}-size: ${v.size}px;`, `  --orv-type-${k}-weight: ${v.weight};`);
  css.push(`  --orv-type-${k}-tracking: ${v.tracking}em;`, `  --orv-type-${k}-line: ${v.line};`);
}
for (const [k, v] of Object.entries<Record<string, number>>(T.glass)) {
  css.push(
    `  --orv-glass-${k}-blur: ${v.blur}px;`,
    `  --orv-glass-${k}-saturate: ${v.saturate};`,
    `  --orv-glass-${k}-radius: ${v.radius}px;`,
  );
}
for (const [k, v] of Object.entries(T.motion.duration)) css.push(`  --orv-duration-${k}: ${v}ms;`);
for (const [k, v] of Object.entries(T.motion.easing)) css.push(`  --orv-ease-${kebab(k)}: ${v};`);
css.push('}');

function phaseBlock(selector: string, phase: string): void {
  const p = T.phases[phase];
  const m = T.modes[p.mode as Mode];
  const core = T.modules.core;
  css.push(
    `${selector} {`,
    `  color-scheme: ${p.mode};`,
    `  --orv-phase: ${phase};`,
    `  --orv-base: ${p.base};`,
    `  --orv-veil: ${p.veil};`,
  );
  p.aurora.forEach((c: string, i: number) => css.push(`  --orv-aurora-${i + 1}: ${c};`));
  for (const k of modeKeys) css.push(`  --orv-${kebab(k)}: ${m[k]};`);
  css.push(
    ...Object.entries<Record<string, string>>(T.labels).map(([k, v]) => `  --orv-label-${k}: ${v[p.mode]};`),
    `  --orv-accent: ${core[p.mode]};`,
    `  --orv-accent-from: ${core.from};`,
    `  --orv-accent-to: ${core.to};`,
  );
  css.push(
    '  --orv-accent-grad: linear-gradient(135deg, var(--orv-accent-from), var(--orv-accent-to));',
    '}',
  );
}
phaseBlock(':root', 'day');
for (const phase of Object.keys(T.phases)) phaseBlock(`[data-phase='${phase}']`, phase);
for (const [mod, a] of Object.entries<Record<string, string>>(T.modules)) {
  for (const [phase, p] of Object.entries<{ mode: Mode }>(T.phases)) {
    css.push(
      `[data-phase='${phase}'] [data-module='${mod}'], [data-phase='${phase}'][data-module='${mod}'] {`,
    );
    css.push(
      `  --orv-accent: ${a[p.mode]};`,
      `  --orv-accent-from: ${a.from};`,
      `  --orv-accent-to: ${a.to};`,
      '  --orv-accent-grad: linear-gradient(135deg, var(--orv-accent-from), var(--orv-accent-to));',
      '}',
    );
  }
}
css.push('@media (prefers-reduced-motion: reduce) {', '  :root { --orv-duration-theme: 0ms; }', '}');
writeFileSync(join(out, 'tokens.css'), css.join('\n') + '\n');

// ---------------------------------------------------------------- theme.css (Tailwind v4)
const theme: string[] = [header, '@theme inline {'];
for (const k of [...modeKeys.filter((k) => !k.startsWith('shadow')), 'base', 'veil', 'accent']) {
  theme.push(`  --color-orv-${kebab(k)}: var(--orv-${kebab(k)});`);
}
for (const k of Object.keys(T.radius)) theme.push(`  --radius-orv-${k}: var(--orv-radius-${k});`);
theme.push('  --shadow-orv: var(--orv-shadow);', '  --shadow-orv-big: var(--orv-shadow-big);');
theme.push('  --font-sans: var(--orv-font-sans);', '  --font-mono: var(--orv-font-mono);');
for (const k of Object.keys(T.type)) {
  theme.push(
    `  --text-${k}: var(--orv-type-${k}-size);`,
    `  --text-${k}--line-height: var(--orv-type-${k}-line);`,
  );
  theme.push(
    `  --text-${k}--letter-spacing: var(--orv-type-${k}-tracking);`,
    `  --text-${k}--font-weight: var(--orv-type-${k}-weight);`,
  );
}
theme.push('}');
writeFileSync(join(out, 'theme.css'), theme.join('\n') + '\n');

// ---------------------------------------------------------------- tokens.js / .d.ts
const js = `${header}export const tokens = ${JSON.stringify(T, null, 2)};

export const PHASES = ['dawn', 'day', 'dusk', 'night'];

/** Phase for a local time when sunrise/sunset are unknown: the boundaries in tokens.json. */
export function phaseAt(date = new Date()) {
  const m = date.getHours() * 60 + date.getMinutes();
  const at = (p) => { const [h, mm] = tokens.phases[p].starts.split(':').map(Number); return h * 60 + mm; };
  if (m >= at('night') || m < at('dawn')) return 'night';
  if (m >= at('dusk')) return 'dusk';
  if (m >= at('day')) return 'day';
  return 'dawn';
}

/** Phase from real sunrise/sunset (minutes since local midnight): dawn ±90 min around sunrise, dusk ±90 min around sunset. */
export function phaseFromSun(date, sunriseMin, sunsetMin) {
  const m = date.getHours() * 60 + date.getMinutes();
  if (m >= sunriseMin - 60 && m < sunriseMin + 90) return 'dawn';
  if (m >= sunriseMin + 90 && m < sunsetMin - 60) return 'day';
  if (m >= sunsetMin - 60 && m < sunsetMin + 90) return 'dusk';
  return 'night';
}

export function modeOf(phase) { return tokens.phases[phase].mode; }
`;
writeFileSync(join(out, 'tokens.js'), js);
writeFileSync(
  join(out, 'tokens.d.ts'),
  `${header}export type Phase = 'dawn' | 'day' | 'dusk' | 'night';
export type Mode = 'light' | 'dark';
export type ModuleKey = ${Object.keys(T.modules)
    .map((k) => `'${k}'`)
    .join(' | ')};
export type LabelKey = ${Object.keys(T.labels)
    .map((k) => `'${k}'`)
    .join(' | ')};
export interface Spring { stiffness: number; damping: number; mass: number }
export declare const tokens: {
  modes: Record<Mode, Record<string, string>>;
  phases: Record<Phase, { mode: Mode; base: string; aurora: string[]; veil: string; starts: string }>;
  modules: Record<ModuleKey, { light: string; dark: string; from: string; to: string }>;
  labels: Record<LabelKey, { light: string; dark: string }>;
  glass: Record<'pane' | 'float' | 'halo', { blur: number; saturate: number; radius: number }>;
  radius: Record<string, number>;
  space: Record<string, number>;
  font: { sans: string; mono: string };
  type: Record<string, { size: number; weight: number; tracking: number; line: number }>;
  motion: { springs: Record<'snappy' | 'smooth' | 'gentle', Spring>; duration: Record<string, number>; easing: Record<string, string> };
  haptics: Record<string, string>;
};
export declare const PHASES: Phase[];
export declare function phaseAt(date?: Date): Phase;
export declare function phaseFromSun(date: Date, sunriseMin: number, sunsetMin: number): Phase;
export declare function modeOf(phase: Phase): Mode;
`,
);

// ---------------------------------------------------------------- Dart
const dc = (c: string) => `Color(${toDartHex(c)})`;
const dart: string[] = [
  '// Generated from packages/design-tokens/tokens.json — do not edit.',
  '// ignore_for_file: constant_identifier_names',
  "import 'package:flutter/painting.dart';",
  '',
  'enum OrvPhase { dawn, day, dusk, night }',
  '',
  'class OrvModeColors {',
  '  const OrvModeColors({' +
    modeKeys
      .filter((k) => !k.startsWith('shadow'))
      .map((k) => `required this.${k}`)
      .join(', ') +
    '});',
  ...modeKeys.filter((k) => !k.startsWith('shadow')).map((k) => `  final Color ${k};`),
  '}',
  '',
  'class OrvPhaseColors {',
  '  const OrvPhaseColors({required this.dark, required this.base, required this.aurora, required this.veil, required this.colors});',
  '  final bool dark;',
  '  final Color base;',
  '  final List<Color> aurora;',
  '  final Color veil;',
  '  final OrvModeColors colors;',
  '}',
  '',
  'class OrvAccent {',
  '  const OrvAccent({required this.light, required this.dark, required this.from, required this.to});',
  '  final Color light;',
  '  final Color dark;',
  '  final Color from;',
  '  final Color to;',
  '}',
  '',
  'class OrvLabel {',
  '  const OrvLabel({required this.light, required this.dark});',
  '  final Color light;',
  '  final Color dark;',
  '}',
  '',
  'class OrvSpring {',
  '  const OrvSpring(this.stiffness, this.damping, this.mass);',
  '  final double stiffness;',
  '  final double damping;',
  '  final double mass;',
  '}',
  '',
  'abstract final class OrvTokens {',
];
for (const mode of ['light', 'dark'] as Mode[]) {
  const m = T.modes[mode];
  dart.push(
    `  static const OrvModeColors ${mode} = OrvModeColors(` +
      modeKeys
        .filter((k) => !k.startsWith('shadow'))
        .map((k) => `${k}: ${dc(m[k])}`)
        .join(', ') +
      ');',
  );
}
dart.push('  static const Map<OrvPhase, OrvPhaseColors> phases = {');
for (const [name, p] of Object.entries<{ mode: Mode; base: string; aurora: string[]; veil: string }>(
  T.phases,
)) {
  dart.push(
    `    OrvPhase.${name}: OrvPhaseColors(dark: ${p.mode === 'dark'}, base: ${dc(p.base)}, aurora: [${p.aurora.map(dc).join(', ')}], veil: ${dc(p.veil)}, colors: ${p.mode}),`,
  );
}
dart.push('  };');
dart.push('  static const Map<String, OrvAccent> modules = {');
for (const [k, a] of Object.entries<Record<string, string>>(T.modules)) {
  dart.push(
    `    '${k}': OrvAccent(light: ${dc(a.light!)}, dark: ${dc(a.dark!)}, from: ${dc(a.from!)}, to: ${dc(a.to!)}),`,
  );
}
dart.push('  };');
dart.push('  /// Colours people pick for projects and calendars (readable as text on glass in both modes).');
dart.push('  static const Map<String, OrvLabel> labels = {');
for (const [k, a] of Object.entries<Record<string, string>>(T.labels)) {
  dart.push(`    '${k}': OrvLabel(light: ${dc(a.light!)}, dark: ${dc(a.dark!)}),`);
}
dart.push('  };');
dart.push(
  '  /// Minutes after midnight at which each phase begins (clock fallback when sunrise is unknown).',
);
dart.push(
  `  static const Map<OrvPhase, int> phaseStarts = {${Object.entries<{ starts: string }>(T.phases)
    .map(([k, v]) => {
      const [h, m] = v.starts.split(':').map(Number);
      return `OrvPhase.${k}: ${h! * 60 + m!}`;
    })
    .join(', ')}};`,
);
for (const [k, v] of Object.entries(T.radius))
  dart.push(`  static const double radius${k[0]!.toUpperCase()}${k.slice(1)} = ${v};`);
for (const [k, v] of Object.entries<Record<string, number>>(T.glass))
  dart.push(`  static const double glass${k[0]!.toUpperCase()}${k.slice(1)}Blur = ${v.blur};`);
for (const [k, v] of Object.entries<Record<string, number>>(T.motion.springs)) {
  dart.push(
    `  static const OrvSpring spring${k[0]!.toUpperCase()}${k.slice(1)} = OrvSpring(${v.stiffness}, ${v.damping}, ${v.mass});`,
  );
}
for (const [k, v] of Object.entries(T.motion.duration))
  dart.push(
    `  static const Duration duration${k[0]!.toUpperCase()}${k.slice(1)} = Duration(milliseconds: ${v});`,
  );
type TypeToken = { size: number; weight: number; tracking: number; line: number };
for (const [k, v] of Object.entries<TypeToken>(T.type)) {
  dart.push(
    `  static const TextStyle ${k} = TextStyle(fontSize: ${v.size}, fontWeight: FontWeight.w${Math.round(v.weight / 100) * 100}, letterSpacing: ${(v.tracking * v.size).toFixed(2)}, height: ${v.line});`,
  );
}
dart.push('}', '');
writeFileSync(join(out, 'orvyn_tokens.dart'), dart.join('\n'));
// The Flutter app builds without Node, so it gets a committed copy; CI fails if the copy drifts.
const mobile = join(root, '..', '..', 'apps', 'mobile', 'lib', 'design');
mkdirSync(mobile, { recursive: true });
writeFileSync(join(mobile, 'tokens.g.dart'), dart.join('\n'));
// Native Android views (the home-screen widget) read the same palette as resources: day = light, night = dark.
const androidRes = join(root, '..', '..', 'apps', 'mobile', 'android', 'app', 'src', 'main', 'res');
const ax = (c: string) => `#${toDartHex(c).slice(2)}`;
for (const [dir, phase] of [
  ['values', 'day'],
  ['values-night', 'night'],
] as const) {
  const p = T.phases[phase];
  const m = T.modes[p.mode as Mode];
  const a = T.modules.today;
  const xml = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<!-- Generated from packages/design-tokens/tokens.json. Do not edit. -->',
    '<resources>',
    `    <color name="orvyn_surface">${ax(p.base)}</color>`,
    `    <color name="orvyn_edge">${ax(m.hairline)}</color>`,
    `    <color name="orvyn_text">${ax(m.text)}</color>`,
    `    <color name="orvyn_muted">${ax(m.muted)}</color>`,
    `    <color name="orvyn_faint">${ax(m.faint)}</color>`,
    `    <color name="orvyn_danger">${ax(m.danger)}</color>`,
    `    <color name="orvyn_accent">${ax(a[p.mode])}</color>`,
    `    <color name="orvyn_accent_from">${ax(a.from)}</color>`,
    `    <color name="orvyn_accent_to">${ax(a.to)}</color>`,
    `    <dimen name="orvyn_radius">${T.radius.lg}dp</dimen>`,
    '</resources>',
    '',
  ];
  mkdirSync(join(androidRes, dir), { recursive: true });
  writeFileSync(join(androidRes, dir, 'orvyn_colors.xml'), xml.join('\n'));
}
console.warn(
  `design-tokens: wrote ${['tokens.css', 'theme.css', 'tokens.js', 'tokens.d.ts', 'orvyn_tokens.dart'].join(', ')}`,
);
