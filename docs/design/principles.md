# Design language — "Aurora Glass" (working name)

Interactive design direction (phone Today, Drop, Vault, Money, web app, language sheet):
https://claude.ai/artifact/CQxQcvSKWjeM5HQws4JdGA (private to the founder).

ORVYN should feel like a calm, luminous instrument: layers of frosted glass floating over living light.
Beautiful enough that opening it is a small pleasure; disciplined enough that it never gets in the way.

## Foundations

### 1. Living light (the signature)
The background is not a colour, it is **light that follows your day**. A soft, slowly drifting aurora of
gradients whose palette tracks the real sun at your location:
- **Dawn** — peach, rose, pale gold · **Day** — airy sky, mint, white · **Dusk** — amber, violet, coral ·
  **Night** — deep indigo, teal glow, near-black.
Light and dark mode still exist (and can be pinned), but the default is **Circadian**: the app quietly
becomes light with the morning and dark with the evening. Nobody else does this as a whole visual system.

### 2. Glass with discipline
- Three elevations of glass: *pane* (cards), *float* (sheets, popovers), *halo* (the capture orb, toasts).
  Each has a fixed blur, tint, border-light and shadow — never ad hoc.
- **Readability first:** glass always sits on a dimmed/tinted layer so text meets WCAG AA contrast in every
  palette. Text never sits directly on raw gradient.
- **Edge light:** a 1px inner highlight on the top edge of glass that subtly shifts with device tilt (mobile)
  or pointer position (web) — the glass catches the light.
- Performance budget: blur is expensive; at most three blurred layers on screen; low-power mode swaps blur for
  flat tint automatically.

### 3. Type
- One variable sans (**Inter Display / Inter** or **Geist**), tight tracking at large sizes, generous line
  height for reading. Numbers use tabular figures everywhere (money, times).
- A single expressive moment per screen — e.g. the time on "Today", the balance in "Money" — set large, with
  a gentle number-roll animation on change.

### 4. Colour
- Neutral glass + one accent per module so you always know where you are:
  Today · sky blue · Money · emerald · Library · amber · Vault · deep violet · Chat · coral · IPO · gold ·
  Jobs · cyan. The accent tints the aurora when you enter the module.
- Semantic colours (success, warning, danger) are fixed and tested on every palette.

### 5. Motion — physical, quick, meaningful
- **Springs, not curves.** One shared spring set (snappy, smooth, gentle) used by web (Framer Motion) and
  Flutter (physics simulations), defined in the tokens.
- Typical durations 120–320 ms; nothing that blocks input; everything interruptible.
- **Shared-element transitions:** a task card grows into its detail; a receipt photo flies into the expense it
  became.
- **Respect `prefers-reduced-motion`** — the aurora stops drifting, transitions become fades.

## Signature interactions (original to ORVYN)
1. **The Orb** — a small glowing glass orb, always reachable (bottom centre on phone, hotkey on desktop, the
   extension icon in the browser). Tap: type. Hold: speak (it ripples with your voice). Drop a file or photo
   on it: it swallows it with a little gravitational pull, then shows what it understood as a card to confirm.
   The orb's colour shows state: idle, listening, thinking (slow shimmer), needs you (gentle pulse).
2. **Time River** — the Today view is a vertical river of the day: the current moment is a bright line of
   light; past items soften and sink, upcoming ones float closer as their time approaches. Free time appears
   as open water you can drag tasks into.
3. **Settle** — completing a task doesn't just strike it through: it gives a soft haptic tick, a tiny burst of
   light in the module accent, and the card settles out of the river.
4. **Breath unlock** — opening the Vault dims everything else, the glass frosts over completely and clears as
   it unlocks — security you can feel.
5. **Pulse of money** — the month's spending drawn as a living line that breathes with each new transaction;
   overspend tints it warm, under budget cool.
6. **Quiet notifications** — in-app notifications arrive as a soft glow at the screen edge on the side of the
   module, not a banner that covers content.

## Layout
- Phone: one-hand reach — primary actions in the bottom third; the Orb and the module switcher there.
- Desktop/web: three columns that collapse gracefully — navigation, the river/list, a detail pane — with a
  command palette (⌘/Ctrl-K) that can do anything the Orb can.
- 8-pt grid, 4-pt for small adjustments. Corner radii: 12 / 20 / 28 (pane / float / halo).

## Craft rules (the "small things")
- Every interactive element has hover (web), press, focus-visible and disabled states designed, not defaulted.
- Empty states are illustrated with the aurora and one helpful action — never "No data".
- Loading: skeletons shaped like the real content with a light sweep; optimistic updates so most actions
  feel instant.
- Haptics on mobile for: complete, snooze, unlock, error — light and distinct.
- Icons: one consistent set (Lucide or Phosphor), 1.5 px stroke, optical sizes.
- Sound: off by default; optional subtle completion chime.

## Accessibility (non-negotiable)
Contrast AA in every palette and mode, full keyboard navigation on web/desktop, screen reader labels, dynamic
type on mobile, reduced motion, colour never the only signal.

## Implementation
All of the above lives as tokens in `packages/design-tokens` (colours per palette and mode, glass levels,
radii, spacing, type scale, springs, durations, haptics) and generates CSS variables + Tailwind theme (web,
extension, desktop) and a Dart `ThemeExtension` (Flutter). Components are built once per platform on those
tokens — never with hard-coded values.
