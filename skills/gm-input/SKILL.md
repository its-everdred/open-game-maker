---
name: gm-input
description: Declare gameplay actions and consume host-normalized input for every local player and device.
---

# Game Maker input

## Start with actions

Declare the game's vocabulary in `manifest.inputs.actions` before wiring controls. Use `button` for on/off intent,
`axis` for one dimension, and `stick` for two dimensions. Name intent (`jump`, `move`, `interact`), never a key or
device (`space`, `leftStick`). Import `ActionFrame` from `@ogm/contracts`; gameplay reads only its declared values
and never polls DOM keyboard, pointer, touch, or gamepad APIs. `input.rawKey` is for host hotkeys, not mechanics.

Read `ActionFrame.playerIndex` and update that player's state only. Treat `ActionFrame.source` as provenance for
hints or telemetry, never as a reason to change the mechanic. Network and local frames follow the same action map.

## Held, edges, and buffers

A button value is held state. Compare the current frame with the previous frame to derive `justPressed` and
`justReleased`; do not fire one-shot actions every tick while held. Buffer time-sensitive presses in simulation
state for a tunable window, consume them once, and test the boundary with the fixed-step hooks.

Clamp axes and sticks before use. Apply a radial deadzone to a stick, then rescale the remaining magnitude to the
full range. Keep deadzone, repeat delay, buffer duration, and similar feel values in `src/tunables.ts`; start from
the range in [the action-map card](references/cards/action-map.md), then choose from the brief's feel words.

## Device ownership

The host owns gamepad discovery, standard mapping, connection changes, and rebinding. The host owns the touch overlay,
including safe areas and 64 px primary targets. Games declare actions; they do not draw duplicate touch buttons or
remember device bindings. Keyboard fallback and per-player device assignment are host settings.

## Verify

Write one input script per important action path, including a second `playerIndex`, an edge held across ticks, and
a value just below the deadzone. Run `gm run --inputs inputs.json` and inspect the resulting state and frames.
Check that the same action produces the same mechanic across keyboard, touch, gamepad, and network sources.

## Reference

Open `vendor/gamedev/input-systems` for buffering and accessibility, and
`vendor/phaser/input-keyboard-mouse-touch` only for engine integration details. The host contract wins when a
vendor reference suggests reading devices inside game code. For platformers, open
`gm-genre-platformer/references/cards/jump-buffer-coyote.md` for mechanic-specific buffering.
