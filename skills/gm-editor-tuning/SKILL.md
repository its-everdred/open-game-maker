---
name: gm-editor-tuning
description: Load when gameplay values must be exposed to the editor or tuned by feel.
---

# Editor tuning

## Keep gameplay values game-owned

Put every gameplay constant in `src/tunables.ts` as exported data. Gameplay code reads that data instead of repeating
numeric literals. Pick initial values from the agreed scope; do not copy a pattern card's example values.

Declare each editable value as a `ControlDecl` in `GameModule.controls`; the build emits that list as
`manifest.controls`. Give it a stable dotted id, plain label, correct scope, design-document path, default, and a
widget whose kind matches the value. Take slider/count ranges and steps from the pattern card that introduced the
knob; use `gm docs pattern` to recover that card rather than inventing a wider range.

Adapters consume those game-owned values and `manifest.controls` as inputs when needed. Adapters never declare
controls, own ranges, choose defaults, or hide a gameplay constant inside set-specific code.

## Apply editor changes

`GameInstance.applyDesign` receives the complete next design plus its patches. Read changed tunables from `next`,
replace the runtime's current design, and update active systems from that design; do not reread imported defaults.
Use patches only to decide which runtime work is required.

Return `'live'` after values that can update the active scene are applied. Return `'restart-scene'` only for structural
changes that require rebuilding scene topology, physics, or placement state. A numeric change is not structural just
because it was previously a constant. Keep the result deterministic for the same `next` document and patches.

Test one live control and one genuinely structural control. Assert both the visible/runtime value and the exact
result string so an editor change cannot appear accepted while the game keeps stale data.

## Tune from outcomes

Use [Tune by outcome](references/tune-by-outcome.md). Name the observed problem, change one knob within its card range,
run the same scenario, and keep or revert the change before touching another knob. Tune interactions only after the
single-knob result is understood.

Run `gm check`, `gm test`, and `gm run` after settling the values. Record what improved, the evidence used, and any
remaining tradeoff instead of calling a number "better" without an observable outcome.

## Keep debug UI out of the game

Never ship lil-gui, a tuning overlay, or a debug panel in production. The editor controls are the product surface.
Temporary test-only controls may use the existing draft/test hooks, must be unreachable in published builds, and must
not become a second source of defaults.
