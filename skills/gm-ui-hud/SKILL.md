---
name: gm-ui-hud
description: Lay out the game's own HUD and screens around the host's platform HUD, safe areas, and player settings.
---

# Game Maker UI and HUD

## Two HUDs

The host owns the platform HUD: pause, saves, settings (volume, mute, text size, reduced motion), achievement
toasts, and leaving the game. Never draw, restyle, cover, or duplicate it. The game owns only what the game knows:
score, health, timer, objective, inventory, prompts, and its title, won, and lost screens. Pause is the host's: the SDK
stops the clock and calls `GameInstance.pause`, then `GameInstance.resume`; the game draws no pause menu of its own.

## One model per player

Derive the HUD from game state as a `HudModel` per player: a flat record of strings, numbers, and booleans. Every
game implements `MultiplayerHooks.hud`; a single-player game returns player 0's model, and in multiplayer each model
leaves out every other player's private fields. Render the HUD from that model each frame, not from scattered
gameplay calls, so the same model drives the screen, tests, and spectators. Keep HUD text in the design doc's strings.

## Layout

Read the `Viewport` from `HostApi.viewport.current()` on the `host` that `mount` receives, and follow
`HostApi.viewport.onChange`; it carries size, `dpr`, orientation, and `safe` insets. Keep every HUD element inside the
safe insets. Lay out against the manifest's `presentation.minLogical` reference size and scale uniformly from it;
anchor elements to corners and edges, never to absolute pixels of one device. Re-layout on every viewport change,
including rotation.

Budget the HUD to at most 25% of the screen and keep the centre clear for play. The host's Pause button sits in its play
bar outside the game, so the top corners are the game's; on touch screens the host's overlay fills the lower-left
and lower-right corners. Put status top-left, score top-centre, and prompts bottom-centre. Hide what does
not matter in the current state.

On phones the host's on-screen buttons must never cover important content. Keep a 140 × 200 CSS px zone clear in each
lower corner of the screen: no HUD element, prompt, or tap target there, and frame the camera so the player,
threats, and goals stay out of it. On laptops the overlay is hidden; keep the same layout so a keyboard or gamepad
player sees what a phone player sees.

## Readable by default

- Text is at least 16 CSS px on a phone after scaling; multiply by `PlayerSettings.textScale` from
  `HostApi.settings.onChange`.
- Keep strong contrast against moving backgrounds: a solid or blurred plate behind text, not a thin outline alone.
- If the game draws its own button, primary targets are at least 64 px and secondary targets at least 44 px.
- Honour `reduceMotion`: no shaking, flashing, or sliding HUD; change values in place.
- Pair numbers with an icon or word, and keep a message on screen long enough to read aloud.
- Captions never depend on hearing. Show the first of `sentences()` before calling `play()`, then let the `onSentence`
  callback move the caption. A rendered line plays nothing and fires no callbacks while audio is muted or locked, so
  keep its caption up and advance on a tap or a timer. Spoken lines play through `SpokenText` from `@gm/sdk/audio`.

## State inventory

List the game's screens before building them: title, play, paused, won, and lost. Paused is the host's dialog over a
frozen game; the others are the game's, and each needs a clear way forward (start, retry, next) reachable by every
declared input.

- Title: `gm run --viewport both --frames 0,2,5`. Its stills come from a fresh run; inputs do not reach them.
- Play, won, and lost: write one input script that reaches each, then `gm test --inputs won.json --ticks 900`
  replays it and saves `hud.png` on the phone viewport at that tick. Choose ticks past the script's last step.

Look at every still: no clipped text, nothing under a notch, the centre clear, and the lower corners
empty. The stills show the game alone, without the host's HUD, so an empty corner is the check.

On the hosted build, the gm-qa journey `games/<name>/qa/journeys/hud-clear.json` reaches title, play, and a round end on
a phone with the on-screen buttons showing, and asks at each step whether a button covers the HUD, the player, or a goal
(Blobs' is in gm-qa's `journeys/blobs/`). Name the devices and screens it passed on; a won or lost screen it did not reach
is unchecked. Never claim every device.

## Reference

Open `.claude/skills/vendor/gamedev/game-ui-ux/SKILL.md` for anchors, focus order, and event-driven HUD patterns, and
`.claude/skills/vendor/phaser/scale-and-responsive/SKILL.md` or
`.claude/skills/vendor/phaser/text-and-bitmaptext/SKILL.md` only for engine details. The host contract wins when a
vendor reference suggests owning pause, settings, or device safe areas.

For the layout and type of menus, HUD and the title, won and lost screens, open
`.claude/skills/vendor/frontend-design/frontend-design/SKILL.md`. It defers: the game's approved targets (the picked
mock, approved renders) and the app's prototype palette tokens win over its suggestions, and it never touches the host's HUD.
