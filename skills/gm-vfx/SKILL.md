---
name: gm-vfx
description: Load when a game needs an authored effect (fire, torch, spell cast, item aura, hit) or tunes the effects budget. Effects are Effekseer files written by script and exported headless, drawn by @gm/sdk/vfx.
---

# Effects with Effekseer

`@gm/sdk/vfx` plays [Effekseer](https://github.com/effekseer/Effekseer) effects (MIT) over a Phaser or three.js game.
Use it for authored, one-place effects: campfires, torches, casts, hits, item auras. Ambient wind, leaves and motes stay
in `@gm/sdk/hd2d` particles, and glow stays in the game's lights. Never write a particle system in a game.

## Play effects

The runtime (about 410 KB gzipped) loads when a scene first calls `createVfx`, so create it only in scenes that use
effects, and `destroy()` it when the scene ends.

```ts
import { createVfx, phaserCamera } from '@gm/sdk/vfx';
import wasmUrl from '@gm/sdk/vfx/effekseer.wasm?url';

const palette = ['#3a1408', '#a8320c', '#f07818', '#ffc040', '#fff0c0']; // from the game's art
const vfx = await createVfx({ canvas: game.canvas, wasmUrl, pixelSize: 3, palette });
await vfx.load('campfire', 'vfx/campfire.efk', 24); // 24 world pixels per authored unit
const fire = vfx.play('campfire', camp.x, camp.y); // world pixels; null when off or at the cap
// every frame, after the camera moves:
vfx.setCamera(phaserCamera(scene.cameras.main));
vfx.frame(deltaMs);
// on shutdown:
vfx.destroy();
```

- **Files:** copy each `.efk` and the `Texture/` folder it uses into the game's public files, side by side. For a
  starter: `cp -r .claude/skills/gm-vfx/effects/{campfire.efk,Texture} public/vfx/`.
- **Positions:** Phaser worlds use world pixels (y down); `handle.moveTo(x, y)` follows a moving thing, such as a
  weapon. In three.js pass `threeCamera(camera)` and world units.
- **Pixel games:** set `pixelSize` to the art's scale, so effects render that coarse and upscale with hard pixels. Add a
  `palette` (5–6 colours from the game's art, at most 16) to clamp every kept pixel to it, opaque. Faint pixels under
  `alphaCutoff` (0.25 with a palette) are dropped. A soft glow becomes a hard disc under a palette, so leave glow nodes
  out of pixel effects and let the game's light do it.
- **Layering:** effects draw on their own canvas over the game, above every sprite. Put an effect where nothing should
  cover it (flames, sparks, motes, a cast at the hand), not behind scenery.

## Budget

- **Caps:** `maxEffects` (24) effects play at once; `play` refuses past it. `maxInstances` (800) and `maxSprites` (1600)
  cap Effekseer's particles for the scene.
- **Governor:** slow frames step quality from high to low (half the effects; the oldest stop) to off (canvas hidden).
  It uses the same 30 fps budget as HD-2D. Start phones at `pickQuality(...)` from `@gm/sdk/hd2d`.
- **Cost:** `vfx.stats()` gives effects, instances and the last frame's `updateMs` and `drawMs`. Campfire, cast and
  legendary together simulate in about 0.4 ms per frame under a 4x CPU slowdown.
- **WebKit:** WebKit is Kevin's phone. Before shipping a scene with effects, run its scenario in WebKit (gm-qa) for
  at least 30 s and check it does not freeze.

## Author an effect

Effects are written as `.efkproj` XML by Python and exported to `.efk` by the editor's command line, with no GUI and
no display. Never use a paid pack's textures. The starters need none of this and work offline; a new effect needs the
editor, which `fetch` downloads, so author on a host with network (or one where `GM_EFFEKSEER_HOME` already holds it).
Paths below are from a game repo; in the Game Maker repo drop `.claude/`.

1. Once per host, fetch the pinned editor (Effekseer 1.80.8 Linux, checksum verified):
   `.claude/skills/gm-vfx/scripts/effekseer.sh fetch`.
2. Write the effect with `Generator` from `scripts/efkgen.py`: each `node()` is one sprite emitter (lifetime, spawn
   rate, spawn shape, velocity, size, colour ramp, fades, blend). Start from `scripts/effects.py`, which builds the
   starters, and keep each effect a function there.
3. Write the projects and export them:
   `python3 -I .claude/skills/gm-vfx/scripts/effects.py <dir>`, then
   `.claude/skills/gm-vfx/scripts/effekseer.sh export <dir>/*.efkproj`. `effects.py` copies the textures into
   `<dir>/Texture`. Keep the `.efkproj` out of the game; ship the `.efk` and `Texture/` side by side.
4. Look at it in the game at phone size (gm-verify) and tune. Times are frames at 60 fps; one unit is what `scale`
   makes it at load.

Starters in `effects/`, already exported:
- `campfire`: flickering flames, a core glow and rising sparks.
- `torch`: a smaller campfire with fewer sparks.
- `cast`: a one-second spell cast, with motes gathering, a flash, a star flare and a spark burst.
- `legendary`: gold motes, glints and a breathing glow along a two-unit blade, to sit on a legendary weapon's outline
  and tint.

The textures are Effekseer's CC0 samples. Credit "Effekseer" in the game's credits.
