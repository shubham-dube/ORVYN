# ADR-0007: One design-token source for all platforms

- Status: Accepted · Date: 2026-11-16 · Related: design/principles.md

## Decision
Tokens (palettes per circadian phase × mode, glass levels, type, spacing, radii, springs, haptics) live in
`packages/design-tokens` as JSON and are generated into CSS variables/Tailwind (web, extension, desktop) and
Dart (Flutter). Hard-coded visual values are lint errors.

## Consequences
The look stays identical across platforms and can evolve in one place.
