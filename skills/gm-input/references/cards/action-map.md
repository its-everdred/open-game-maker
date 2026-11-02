---
topic: action-map
aliases: [input, actions, deadzone, button-edges]
engine: both
tokens: ~560
tunables:
  - { name: deadzone, range: [0.15, 0.30], unit: ratio, from: "precise vs forgiving" }
  - { name: repeatDelayMs, range: [150, 300], unit: ms, from: "quick vs deliberate menus" }
license: Apache-2.0
source: gamedev-skills/awesome-gamedev-agent-skills@184b72b input-systems (ideas; action maps and deadzones)
---

# Action map

## Pattern

Keep physical devices outside gameplay. The manifest declares stable action names, the host maps every device to
those names, and simulation consumes one `ActionFrame` per player. This keeps keyboard, touch, gamepad, replay,
and network input on the same deterministic path.

Derive button edges from adjacent frames. Held state drives continuous behavior; `justPressed` starts a one-shot;
`justReleased` ends a charge or hold. Save the previous action values in simulation state so fixed-step tests and
replays see the same edges.

```ts
type Edges = { held: boolean; justPressed: boolean; justReleased: boolean };
export function buttonEdges(now: ActionFrame, before: ActionFrame, id: string): Edges {
  const held = now.actions[id] === true;
  const wasHeld = before.actions[id] === true;
  return { held, justPressed: held && !wasHeld, justReleased: !held && wasHeld };
}
export function radialDeadzone(x: number, y: number, threshold: number) {
  const magnitude = Math.hypot(x, y);
  if (magnitude <= threshold) return { x: 0, y: 0 };
  const clamped = Math.min(1, magnitude);
  const scaled = (clamped - threshold) / ((1 - threshold) * magnitude);
  return { x: x * scaled, y: y * scaled };
}
```

Use radial, not per-axis, deadzones so diagonal input keeps its direction. Clamp an axis or stick before applying
the deadzone. A repeat timer is for menu navigation and other discrete repeats; gameplay movement reads held state
each tick. Buffer a press only when the mechanic needs a grace window, and consume it once.

## When to use / When not

Use this card for every player-controlled mechanic and any menu driven by declared actions. Do not use it for host
hotkeys, text entry, pointer coordinates, or editor gestures. Those stay in the host surface.

## No extras

An action map does not add moves, alternate inputs, aim assist, or control schemes absent from the scope. It only
normalizes the actions the scope already names.

## Tunables

Choose `deadzone` from the card range using the brief's precision language and the target controllers. Choose
`repeatDelayMs` from the range only for repeatable discrete actions. Store both as exported data in
`src/tunables.ts`; do not bury them in event handlers or device adapters.

## Test

```ts
hooks.inject({ playerIndex: 0, tick: 1, source: 'gamepad', actions: { move: { x: 0.1, y: 0 } } });
hooks.advanceTime(16);
expect(readMove(0)).toBe(0);
```
