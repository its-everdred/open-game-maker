# HD-2D lighting: research and prototype notes

**Scope.** This is the lighting slice of the HD-2D engine epic (#1145): pixel sprites with directional light, canopy shafts and moving dapple, colored practical lights, shadows, and finishing effects. The target scenes use Phaser 4 for Dusk Helm and three.js for Blobs. The demonstrations below use only procedural shapes; they are not representative of either game's final art.

**Evidence checked:** 2026-11-21. Package versions are the workspace pins (Phaser 4.2.1 and three.js 0.186.1). External feature claims are linked to upstream documentation. Phone costs below are engineering estimates to validate on target devices, not measured results.

## Options and trade-offs

| Capability | Options | Renderer fit | Authoring | License / cost | Recommendation and risk |
|---|---|---|---|---|---|
| Light on pixel sprites | Phaser 4 `LightsManager` + `setLighting(true)`; three.js lit planes with `MeshStandardMaterial.normalMap`; custom shaders only for exact pixel/alpha handling | Phaser 4 has native WebGL-only per-pixel lighting, normal-map lookup, ambient color, and normal-map self-shadowing. It culls distant lights at a fixed configured maximum. three.js has native normal-map materials and point/directional lights. There is no need to replace either renderer with a cross-renderer shader. | Import diffuse and normal textures as a pair; allow per-asset normal-map overrides and a flat default. Hand-painted normals give control; generated normals are a starting point, not truth. A 3D→2D bake can provide consistent normals when source geometry and camera exist. | Phaser and three.js are MIT. Laigter is GPL-3.0-or-later; it is a desktop authoring tool, not a runtime dependency. SpriteIlluminator's current single-user license is listed at USD $49.99 perpetual. Check current terms before purchase. | Keep game-facing light intent renderer-neutral, but use native adapters. Prefer artist-reviewed maps. Phaser 4 self-shadowing is on the surface; it is not scene-casting shadows. Both Phaser lighting and custom filters are WebGL-only, so define a graceful fallback. |
| Light shafts / canopy | Screen-space radial blur; tapered light-shaft meshes/quads; low-resolution ray-march or volumetric fog | Screen-space radial blur is easy to add after scene render but requires another image pass. Mesh/quads work in Phaser and three.js with different shader adapters. Ray marching is the most flexible and the most expensive. | Place a small number of authored shaft directions; use a tileable procedural or authored gobo mask for canopy breaks and animate it slowly. | Custom implementation adds no third-party license. Phaser and three.js remain MIT. | Prototype with a small number of translucent shafts plus a moving gobo, not full-screen ray marching. Add radial blur only if an actual forest mock needs it; it can wash out pixel edges and costs a full-screen pass. |
| Moving dapple | Animated canopy shadow map / cookie; procedural low-resolution mask; per-leaf projected shadows | A gobo/cookie can be sampled by a custom shader in either renderer. Phaser's standard Light2D map is not a shadow-casting system. three.js shadow maps support real geometry but add draw and fill cost. | A few large canopy layers with slow wind motion; keep intensity and speed adjustable by scene preset. | No extra dependency for custom masks. | Start with one low-resolution dapple mask shared across the scene. Reserve geometry shadow maps for scenes that demonstrate a clear gain. The key risk is temporal shimmer against pixel art. |
| Lantern, campfire, colored point lights | Phaser Light2D lights; three.js point/area lights; custom screen-space light accumulation | Native renderer lights are simplest within each backend. A shared descriptor can carry position, radius, color, intensity and flicker seed; falloff is a backend-specific hint because native APIs differ. | Place as scene objects or named presets; flicker must be seeded/deterministic for replay and screenshots. | Built-in engines are MIT. | Start with a capped list of a few nearby lights, stable attenuation, and deterministic flicker. Light count and normal-map sampling need phone profiling; no device result is claimed here. |
| Shadows | Painted blob/contact shadow; authored occlusion mask; geometry shadow maps | Painted contact shadows are renderer-neutral and cheap. Phaser Light2D does not cast occlusion shadows. three.js can use shadow maps for real proxy geometry. | Attach a soft ground shadow to an actor/prop; use a simple silhouette/occlusion mask only where the light direction makes it legible. | No extra dependency. | Use contact shadows as the baseline and treat cast shadows as an optional renderer-specific feature. Isometric art has fixed baked shading; dynamic shadows can conflict with it. |
| Bloom, grading, vignette, grain | Selective low-resolution bloom; scene color matrix; vignette; film grain | Phaser 4 Filters provide color-matrix, glow, blur and vignette controls; camera filters are full-screen, while object-internal filters can use smaller bounds. three.js post-processing supports pass chains, with output transform at the end. | Per-scene preset with restrained exposure, warm/cool balance and optional bloom threshold; preserve a pixel-art focal range. | Phaser and three.js MIT; official addons ship with three.js under its license. | Use subtle color grading first and selective bloom for emitters. Treat vignette as optional. Avoid always-on film grain: it adds noise to already textured pixel art without adding scene depth. Phaser Filters are WebGL-only. |

## Normal-map authoring options

| Method | Current evidence | Fit and risk |
|---|---|---|
| Manual | SpriteIlluminator has angle/height brushes and presets; its free edition previews but does not export normal maps. | Best control on hero sprites and trees where branch/leaf planes matter. Its single-user export license is currently listed at USD $49.99 perpetual; no purchase is part of this spike. |
| Local generator | Laigter generates normal, specular, occlusion and parallax maps; its repository is GPL-3.0-or-later. | Useful artist-reviewed starting point with no runtime dependency. Automatic shape guesses can flatten separated pixel planes or add bevels that do not exist. |
| Legacy generator | Sprite DLight appears in 2014-era tutorials and previews. | No current official download, supported platform, price or license was verified; do not select until those are checked. |
| 3D→2D bake | `gm-sprite-forge` contains an existing Blender isometric pipeline and records render recipe/provenance. | Best when source mesh, pose and orthographic camera are available; bakes coherent surface normals. It cannot help pack sprites with no source mesh and needs atlas/frame alignment checks. |
| AI / hosted estimation | SpriteLight advertises generation using free credits and says uploaded sprites are processed then discarded. | Adds external processing and service/credit terms to art ingestion. Do not make it the default or send pack art without reviewing data handling and rights. Generated estimates can be inconsistent across animation frames. |

## Runtime budget and authoring notes

At 60 fps, the full frame has 16.67 ms for gameplay, draw, compositing and browser work. This spike has not measured iPhone or Android hardware. Use a provisional effect budget of **≤2 ms median on a representative mid-range phone**, then revise from device traces. Begin with one low-resolution dapple/shaft layer, a small capped light list, and no full-resolution blur. Reuse render targets, avoid per-frame allocation, and expose a quality-off path. Track GPU time and frame-time percentiles on both iOS Safari and Android Chrome before making a shipping claim.

Phaser 4's `LightsManager` fixes `maxLights` at game configuration and culls the furthest lights; lighting changes the shader and can split batches, so group lit objects together. In three.js, keep lights allocated and animate intensity instead of adding/removing them in play, which can recompile lit materials. Every shadow-casting point light needs six depth faces; leave cast shadows disabled for decorative point lights. A renderer-neutral authoring API should map to these backend rules rather than promise unlimited lights or free shadows.

For creators, keep the authoring surface small: a scene preset (`ambient`, `grade`, `shafts`, `dapple`, `lights`), placed light objects, and an optional normal map per sprite. Defaults should make a scene visibly better without a creator tuning shader parameters. Give agent-authored scenes a deterministic seed and a capture mode. Do not require artists to generate four texture maps for every sprite.

## Proofs

From the repository root, serve the proofs on loopback:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open the pages:

- `http://127.0.0.1:8000/prototypes/hd2d-lighting/sprite-lighting.html` — point-light response from a procedural normal map, shown beside an unlit pixel sprite.
- `http://127.0.0.1:8000/prototypes/hd2d-lighting/canopy-shafts.html` — moving gobo dapple plus soft shafts over procedural isometric trees.

Both pages accept `?capture` and expose `window.__frame(seconds)` for deterministic capture. With Chromium, FFmpeg, and ffprobe installed, refresh the stills and WebM captures with `node prototypes/hd2d-lighting/capture.mjs`; the helper checks fixed-time rendering, animation, decoded clip duration/frame count, and that decoded frames change. Then encode the clips as H.264:

```sh
for demo in sprite-lighting canopy-shafts; do
  ffmpeg -y -i "prototypes/hd2d-lighting/$demo.webm" -an -vf scale=960:528:flags=neighbor -c:v libx264 -profile:v main -pix_fmt yuv420p -movflags +faststart "prototypes/hd2d-lighting/$demo.mp4"
done
```

Each demo has desktop and phone stills and a 6-second clip beside its source. No game pack assets or external image assets are used.

## Engine API sketch for the prototype ticket

```ts
type LightingPreset = {
  ambient: { color: string; intensity: number };
  grade?: { temperature: number; saturation: number; contrast: number };
  shafts?: { direction: number; color: string; intensity: number; mask?: string };
  dapple?: { mask: string; scale: number; speed: number; intensity: number };
  lights?: Array<{
    id: string;
    x: number;
    y: number;
    radius: number;
    color: string;
    intensity: number;
    falloff?: number; // backend hint; native lights may ignore it
    flicker?: { amount: number; rate: number; seed: number };
  }>;
};

type LightingQuality = 'low' | 'high' | 'off';

scene.lighting.apply(preset);
scene.lighting.addLight({ id, x, y, radius, color, intensity, falloff });
scene.lighting.setQuality('low');
sprite.setNormalMap(asset.normalMap ?? 'flat');
```

The contract describes intent; Phaser 4 and three.js backends map it to native lights/materials, and custom passes only for shafts/dapple. Phaser requires `this.lights.enable()`, then maps per-sprite lighting to `setLighting(true)` and `this.lights.addLight(...)`; it uses its normal texture or the flat default. The native Phaser light controls radius, intensity and height, but not a caller-defined falloff curve; treat `falloff` as a hint or implement custom attenuation in a separate shader path. three.js maps sprite planes to `MeshStandardMaterial.normalMap` and scene lights. Asset import should validate diffuse/normal dimensions, matching animation frames and normal encoding, and use nearest filtering for pixel textures. Do not make the generic engine API promise cast shadows or volumetric scattering until the prototype ticket tests those across both renderers.

## Decisions for creator review

The real product choices are restrained-vs-obvious shafts, generated-vs-reviewed normal maps, and whether emissive bloom belongs in the default scene preset. These should be answered after comparing the procedural clips with the real-pack forest mock; the mock and reference angle are outside this research ticket. Silence should leave the prototype authoring defaults as proposed and continue implementation.

## Sources

- Phaser 4 lights, ambient color, normal maps, configured light cap, and Canvas fallback: [Phaser LightsManager](https://docs.phaser.io/api-documentation/class/gameobjects-lightsmanager) and [Light](https://docs.phaser.io/api-documentation/4.0.0/class/gameobjects-light).
- Phaser 4 `setLighting` and self-shadow controls: [Lighting component](https://docs.phaser.io/api-documentation/4.0.0/namespace/gameobjects-components-lighting).
- Phaser 4 Filters and WebGL-only constraint: [Phaser Filters](https://docs.phaser.io/phaser/concepts/filters).
- Phaser license: [Phaser repository license](https://github.com/phaserjs/phaser/blob/master/LICENSE.md).
- three.js renderer output color space, tone mapping and optional shadow maps: [WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer).
- three.js lit material map support: [MeshStandardMaterial](https://threejs.org/docs/pages/MeshStandardMaterial.html) and [Texture](https://threejs.org/docs/pages/Texture.html).
- three.js custom shader material and WebGLRenderer constraint: [ShaderMaterial](https://threejs.org/docs/pages/ShaderMaterial.html).
- three.js bloom addon trade-off: [BloomPass](https://threejs.org/docs/pages/BloomPass).
- three.js license: [three.js repository](https://github.com/mrdoob/three.js).
- Laigter features and GPL-3.0-or-later license: [Laigter repository](https://github.com/azagaya/laigter).
- SpriteIlluminator normal painting/export conventions and license tiers: [drawing tools](https://www.codeandweb.com/spriteilluminator/documentation/draw-tools), [normal-map export](https://www.codeandweb.com/spriteilluminator/documentation/export), and [license comparison](https://www.codeandweb.com/spriteilluminator/licenses-comparison).
- Sprite DLight evidence is limited to historical [2Dee Game Art tutorials](https://www.youtube.com/@2DeeGameArt); current release/license details were not located.
- SpriteLight's current service and data-handling statement: [Studio](https://spritelight.com/studio.html).
- Repo skills consulted: Phaser 4 `skills/vendor/phaser/v4-new-features` and `filters-and-postfx`; three.js `skills/vendor/threejs/threejs-lighting`, `threejs-materials`, `threejs-postprocessing`, and `threejs-shaders`; `skills/gm-sprite-forge`; Sprite Forge `codeart2d` and `generate2dmedia`.
- `skills/vendor/impeccable/impeccable` is for frontend interface design, so it fits future editor controls rather than renderer effects. `codeart2d` fits deterministic procedural art, while `generate2dmedia` routes generated image/video requests through configured local or hosted providers; neither is needed for these procedural canvas proofs. The Phaser and three.js shader skills informed backend feasibility; no extra VFX runtime library was needed.

## Limits

The demos use code-drawn procedural shapes, not SmallScaleInt HD art; they do not use an image model or third-party image service. They do not prove visual compatibility with real sprites, rendering cost on phones, actual shadow occlusion, a Phaser or three.js integration, or accessibility of any eventual editor controls. Those belong in the real-pack mock and the cross-renderer prototype ticket.
