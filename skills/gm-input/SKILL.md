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

## Every game, three devices

The default is that every game plays on a phone with ordinary translucent on-screen buttons, and on a laptop with the
keyboard and a connected gamepad. The host draws and styles the buttons; the game never does. Design the action list
so all three reach every mechanic and every screen's way forward:

- Phone: the host's overlay draws on-screen buttons only when the game declares a `stick` action; without one the
  phone gets no buttons at all. It draws one stick, for the first `stick`, and at most five buttons; the first
  declared button is the 64 px primary. Declare a `move` stick and keep button actions to five, most-used first.
  The game-2d scaffold declares `move: 'axis'`; change it to `stick` and read its `x`, or the phone has no controls.
- Use `stick` or `button` for anything a player must reach: `axis` actions get no touch or gamepad default.
- Keyboard: the default map binds WASD and arrows to `move`, Space to `jump`, and E or Enter to `use`. Give every
  other action a key: pass `{ keyboard: { KeyF: 'fire' } }` as the second argument to `defaultInputMapping`.
- Gamepad: the host's default map gives sticks to the left and right sticks and buttons to A, X, B, Y, LB, RB in
  declaration order.
- The overlay shows only on a coarse pointer and hides for 2 s after keyboard or gamepad input.

Never claim universal device support. Say which devices and viewports a journey actually demonstrated.

## Device ownership

The host owns gamepad discovery, standard mapping, connection changes, and rebinding. The host owns the touch overlay,
including safe areas and 64 px primary targets. Games declare actions; they do not draw duplicate touch buttons or
remember device bindings. Keyboard fallback and per-player device assignment are host settings.

## Verify

Write one input script per important action path, including a second `playerIndex`, an edge held across ticks, and
a value just below the deadzone. Run `gm run --inputs inputs.json` and inspect the resulting state and frames.
Check that the same action produces the same mechanic across keyboard, touch, gamepad, and network sources.

Then demonstrate the devices on the hosted build with two gm-qa journeys in `games/<name>/qa/journeys/`:
`phone-touch.json` plays with the on-screen buttons on a phone viewport, and `laptop-keys.json` plays from the title to a
round end with the keyboard alone on a desktop viewport. Blobs' pair in gm-qa's `journeys/blobs/` are the ones to copy.
A journey cannot drive a gamepad yet, so report the gamepad as unchecked unless someone played it on a real pad. Report
only the devices those journeys passed on.

## Reference

Open `vendor/gamedev/input-systems` for buffering and accessibility, and
`vendor/phaser/input-keyboard-mouse-touch` only for engine integration details. The host contract wins when a
vendor reference suggests reading devices inside game code. For platformers, open
`gm-genre-platformer/references/cards/jump-buffer-coyote.md` for mechanic-specific buffering.
