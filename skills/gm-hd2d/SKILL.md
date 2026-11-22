---
name: gm-hd2d
description: Load when a Phaser or three.js game turns on HD-2D lighting, focus or particles, edits an HD-2D scene, or tunes its quality tiers.
---

# Turning on HD-2D lighting, focus, particles

Use `@gm/sdk/hd2d` when flat pixel art needs depth: canopy light shafts and dapple, lanterns, lit sprites, a crisp
hero against blurred depth bands, haze, and wind-driven leaves and motes. One call, `createHd2d`, runs all three on
the game's own renderer. Never write a second lighting, blur or particle system in a game.

## Turn it on

`createHd2d(target, scene, { quality, seed, budget })` returns `{ lighting, focus, particles, quality, setQuality,
setWind, applyScene, update, dispose }`. Call `update(timeMs)` once per frame and `dispose()` on shutdown.

```ts
// Phaser 4 (WebGL renderer): inside the scene's create()
import { createHd2d, HD2D_FOREST_DEFAULTS, pickQuality } from '@gm/sdk/hd2d';

hero.setName('hero');
const hd2d = createHd2d(
  { phaser: { scene: this, scale: 64 } }, // 64 screen pixels per particle unit
  { ...HD2D_FOREST_DEFAULTS, focus: { ...HD2D_FOREST_DEFAULTS.focus, hero: 'hero' } },
  { quality: pickQuality({ dpr: devicePixelRatio, isMobile, webgl: true }) },
);
this.events.on('update', (time: number) => hd2d.update(time));
this.events.once('shutdown', () => hd2d.dispose());
```

```ts
// three.js: sprites are Mesh planes with MeshBasicMaterial; the group's scale sets the particle units
import { Group } from 'three';
import { createHd2d, HD2D_FOREST_DEFAULTS, pickQuality } from '@gm/sdk/hd2d';

const motes = new Group();
motes.scale.setScalar(64);
scene.add(motes);
heroMesh.name = 'hero';
const hd2d = createHd2d(
  { three: { renderer, scene, camera, parent: motes } },
  { ...HD2D_FOREST_DEFAULTS, focus: { ...HD2D_FOREST_DEFAULTS.focus, hero: 'hero' } },
  { quality: pickQuality({ dpr: devicePixelRatio, isMobile, webgl: true }) },
);
renderer.setAnimationLoop((time) => {
  hd2d.update(time);
  renderer.render(scene, camera);
});
```

## The scene document

`Hd2dSceneConfig` is versioned JSON (`version: 1`) with four sections: `lighting` (ambient, grade, shafts, dapple,
clouds, lights with flicker), `focus` (mode, target, smoothing, strength, range, `hero`), `atmosphere` (haze,
pixelArt) and `particles` (emitters by preset name, wind, focusDepth). Store it in the game's scene data and read it
with `parseHd2dScene`: a bad field throws `Hd2dSceneError` with its path. Save it with `serializeHd2dScene`.
The map maker (#1191) edits the same document. Pass each edit to `hd2d.applyScene(doc)`. It changes the running
scene without a rebuild, and only the parts that changed restart. Quality is not in the document: it belongs to the
device.

## Presets and creator controls

Start from `HD2D_FOREST_DEFAULTS`, which holds Kevin's #1149 picks: soft shafts and dapple, depth bands with the
hero crisp, and pixel leaves plus soft motes on one wind. Then change only the fields the creator asks for:

| Creator says | Set |
|---|---|
| warmer, colder, more muted | `lighting.grade.temperature`, `saturation`, `contrast` |
| stronger or softer sun | `lighting.shafts.intensity`, `lighting.dapple.intensity` (0 to 1) |
| a lantern or a fire here | `lighting.lights[]`: `x, y, radius, color, intensity`, optional `flicker` |
| more or less blur | `focus.strength`, `focus.range`; `focus.mode`: `depthBands`, `tiltShift`, `depthOfField`, `off` |
| mist in the distance | `atmosphere.haze`: `color`, `distance`, `density` |
| more leaves, windier | emitter `density` (0 to 4), `particles.wind.strength`, `hd2d.setWind({...})` |

The particle presets are `forest-leaves`, `forest-motes`, `soft-motes` and `campfire-embers`. Show every change
before and after through `gm-verify`.

## Quality tiers and device policy

Tiers are `off`, `low` and `high`. `pickQuality` picks the starting tier. A device without WebGL gets `off`. Phones and
screens above 2× pixel ratio get `low`. Everything else gets `high`. `low` caps the lights at 4 instead of 8 and
renders the light field and the blur at half resolution. It also halves the particle counts, and it never uses true
depth of field. Per Kevin's phone-budget pick, keep the blur on at `low` and save the cost elsewhere: normal-map only
the hero and the nearest sprites. The default `budget` drops one tier after about 2 s below 30 fps, and it never
raises the tier again. Pass `budget: false` for deterministic captures (a stepped clock looks like slow frames).

## Normal maps

Sprites are flat unless you call `hd2d.lighting.setNormalMap(sprite, normal)`. `normal` is a canvas or an image, or
`'flat'` to go back to unlit. In Phaser the map belongs to the texture, so every sprite that shares the texture also
shares the map. Before you call it, check that the normal map has exactly the same size as the diffuse texture: the
SDK does not check this, and a size mismatch lights the wrong pixels.

## Known limits

- No cast shadows: lights brighten and grade, and nothing blocks them.
- Phone fps has not been measured yet. After every deploy, read the fps on a QA phone at `low` before you call it done.
- Phaser's Canvas renderer gets no focus effects; use `Phaser.WEBGL`.
- Clips of the procedural test scene at both tiers are in `docs/research/2026-11-21-hd2d/engine/`.
