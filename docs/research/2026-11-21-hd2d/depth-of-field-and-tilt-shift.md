# HD-2D focus, miniature blur and occlusion

Research snapshot: 2026-11-21. Scope: engine-side rendering capabilities for pixel-art sprites over a lit, layered scene. The supplied inspiration images were not in this issue workspace; recommendations below use the verbal brief and synthetic proofs, not a claim of exact visual matching.

## Decision frame

These are different effects and should not share one vague `blur` switch. **Tilt-shift** is a screen-space band and is an intentional miniature illusion; it needs no scene depth. **Depth of field (DOF)** blurs by camera distance and needs a depth source. **Pixel protection** keeps sprite texels sharp while geometry, light and atmosphere soften around them. **Distance haze** attenuates color by distance or height. **Occlusion** is geometry coverage; fading an occluder is a separate, authored accessibility/style response and must never be confused with depth sorting.

| Approach | Depth source / focus | Sharp pixel sprites | Dusk Helm (Phaser) and Blobs (three.js) fit | License and trade-offs |
|---|---|---|---|---|
| Camera/layer bands | Explicit `depthBand`/camera-space layer; focus is a 2D interval. | Strong: render pixel sprites after band passes, or exclude them from the blur target. | Shared layer metadata and common uniforms; Phaser camera FX can do band blur but are WebGL-only, while three.js uses a full-screen shader. | No new dependency. Deterministic, cheap and authorable. Not lens DOF; isometric diagonal planes need an authored focus mask, not a naive horizontal strip. |
| Phaser built-in Bokeh/TiltShift | Built-in shader approximates bokeh or a tilt-shift band; it is not a per-pixel scene depth API. Expose focus as game-space Y or normalized camera-space. | Global camera postFX smears all pixels. Use per-object preFX selectively or render foreground sprite layer after the effect. | Native to Dusk Helm; `camera.postFX.addBokeh()` / `addTiltShift()`. Not directly portable to Blobs. Must require WebGL; no Canvas FX fallback. | Phaser is MIT. No additional dependency. Great for a fast 2D preset; weaker as an engine-wide physical DOF contract. |
| three.js BokehPass | Scene render depth texture; distance is camera-space. Update focus from player `worldToView` distance, with smoothing. | Global composer pass blurs sprites too. Put sprites in a later crisp overlay or preserve a sprite mask and composite them after blur. | Direct fit for Blobs; cannot be imported into Phaser. | three.js is MIT; official addon source ships with three.js. Standard and inspectable but an extra full-scene render target, depth sampling and blur work. |
| pmndrs postprocessing DepthOfField | Depth-aware DOF effect in EffectComposer; focus distance/range and bokeh parameters. | Same global blur limitation; use a mask/composite or second crisp sprite pass. Avoid relying on alpha sprites to carry reliable depth. | Three.js only. A common authoring facade can map shared parameters, but Phaser needs another backend. | Zlib license; original DOF basis MIT. More tunable composer, but library and effect graph increase bundle and integration surface. |
| Custom shared shader + masks | Provide normalized view depth for 3D and authored camera depth for 2D. Optional depth mask texture. Focus tracks player with damping. | Best control: class masks (`sharp`, `blur`, `occluder`) and nearest-neighbor sprite source; composite sharp pass last. | Common parameters and authoring map; separate Phaser WebGL pipeline and three.js ShaderPass implementations. | No dependency; full ownership, more shader maintenance and cross-device testing. Avoid presenting 2D layer values as physically comparable to 3D meters. |
| CSS/Canvas overlays or multiple composited layers | Scene author assigns z/focus bands; blur a duplicate/background canvas or HTML layer. | Strong if sprite canvas stays separate; CSS `filter: blur()` works on an element, not selectively by world depth. | Shared only for deliberately separated canvas layers; poor match to Dusk Helm and Blobs' render internals. | Platform-native, no new dependency. Easy tilt-shift proof, limited lighting/depth semantics; extra surfaces and memory. |

Phaser documents Bokeh as shallow DOF and TiltShift as a center-focused miniature treatment; its FX pipeline applies at camera or object level and is WebGL-only. three.js `DepthTexture` explicitly stores rendered depth; `BokehPass` exposes focus/aperture/maxblur; pmndrs offers a separate depth-of-field effect. Sources: [Phaser FX guide](https://phaser.io/oss/docs/phaser/concepts/fx), [Phaser Bokeh API](https://phaser.io/oss/docs/api-documentation/3.90.0/class/fx-bokeh), [Phaser license](https://phaser.io/download/license), [three.js DepthTexture](https://threejs.org/docs/pages/DepthTexture.html), [three.js BokehPass](https://threejs.org/docs/pages/BokehPass.html), [pmndrs postprocessing docs/license](https://pmndrs.github.io/postprocessing/public/docs/).

## Sprite crispness and miniature vs depth blur

Tilt-shift should be an explicit stylistic preset, not called “realistic DOF”: a narrow plane of focus near the image center with top and bottom bands softened produces the miniature look. Real DOF follows camera-space distance and can blur any object, including the player. Keep crispness as an independent material/render-layer property: render filtered scene/lighting first, composite pixel sprites at native asset resolution with nearest filtering and integer-aligned positions after blur. If a sprite must receive scene lighting, light it in its own pass, then composite it sharply; do not solve crispness with a post-effect sharpen filter, which creates halos and cannot restore smeared texels.

A cheap approximation is one blur per authored depth band (far/mid/near), with the active band following the player. A stronger 2D DOF approximation uses a scene-depth mask rendered from object depth and a blur shader; it still cannot create physically correct bokeh from a 2D composite without extra samples and a depth-aware gather. For isometric compositions the focus mask should follow projected ground distance/height or a soft 2D ellipse around the player, not assume screen Y equals world distance.

## Haze, lighting and foreground occluders

- **3D height/distance haze:** use `Fog`/`FogExp2` for distance; height fog needs a shader/material hook based on world Y or a low-resolution fog volume. Match scene background to fog color to avoid a visible horizon seam. three.js fog is evaluated on rendered material fragments; transparent cutout sprites need explicit material/shader support.
- **2D aerial perspective:** per-layer color/contrast shift plus a distance alpha/color LUT is robust and cheap; supply a light estimate or normal only when the asset format contains it. A 2D height fog can use a low-resolution fullscreen mask, but it should not pretend to know depth hidden in a flat sprite.
- **Lighting pixel sprites:** nearest-sampled albedo plus a small normal map or palette-derived normal, lit before crisp compositing. Prefer a few broad lights, ambient fill, and baked/painted contact shadows. Dynamic shadow maps are a separate cost center; default off for phone.
- **Foreground occlusion:** preserve normal depth/anchor sorting first. For a tree canopy or wall that covers the player, allow an author-chosen `occlusionResponse` (`none`, `fade`, `fadeAndTint`) on the occluder, with bounded opacity and a short easing. Blur-only-on-overlap requires an overlap mask, which can create halos at sprite silhouettes; do not default it on. Never fade every foreground object based only on screen overlap, or characters look transparent in dense scenes.

Sources: [three.js Fog/FogExp2 guide](https://threejs.org/manual/pages/fog.html), [FogExp2 API](https://threejs.org/docs/pages/FogExp2.html), [three.js material depth controls](https://threejs.org/docs/pages/Material.html), [Phaser pixelArt config/API](https://docs.phaser.io/api-documentation/3.90.0/typedef/types-core).

## Phone performance and authoring

60 fps is a 16.7 ms *total frame* budget shared by game logic, scene rendering, effects, browser and compositing; it is not a safe allocation target for this feature. Treat postprocessing as opt-in. Start at half-resolution effect buffers, 1–2 blur taps/separable passes, clamp device pixel ratio (the proof caps at 1.5), skip depth blur below a device capability threshold, and expose `quality: off | low | full`. Measure frame time on representative older iPhones and midrange Android devices after the backend exists; the proofs here do not assert a measured mobile cost. Full-screen passes are bandwidth-sensitive on mobile GPUs and can consume multiple high-resolution buffers. Source: [Arm mobile graphics postprocessing guidance](https://developer.arm.com/community/arm-community-blogs/b/mobile-graphics-and-gaming-blog/posts/finding-and-fixing-hidden-performance-problems-in-mobile-games-with-arm-performance-studio), [three.js renderer pixel ratio/buffer sizing](https://threejs.org/docs/pages/WebGLRenderer.html).

Creator/agent authoring should be preset-first with a small number of meaningful controls: `focus.target: 'player' | {x,y,z}`, `focus.smoothing`, `depthOfField.enabled`, `depthOfField.range`, `depthOfField.strength`, `tiltShift.bandCenter`, `tiltShift.bandWidth`, `haze.color`, `haze.distance`, `haze.height`, plus per-asset `depthBand`, `pixelArt`, and `occlusionResponse`. A creator can say “keep the hero crisp, soften distant trees, make the foreground leaves fade over the hero”; the agent sets typed values and shows a before/after render. Keep backend-only knobs like bokeh sample counts out of the first creator UI. Provide “none” and verify snapshot mode to ensure deterministic captures.

## Small runnable proofs

Both experiments use procedural geometric sprites/shapes only. They are intentionally isolated under `prototypes/hd2d-depth-focus/` and do not load packs or alter product rendering.

1. [Layered experiment](../../../prototypes/hd2d-depth-focus/layered.html): compare no blur, tilt-shift bands, per-layer blur and a separately composited crisp hero. This tests the miniature-look vs pixel-protection trade-off and demonstrates authored 2D depth. It is not physically depth-buffer DOF.
2. [three.js experiment](../../../prototypes/hd2d-depth-focus/three.html): compare no blur, BokehPass, a tilt-shift focus change and haze. The BokehPass reads scene depth; haze in this minimal proof is a height-gradient screen shader, not distance fog. It runs three.js 0.180.0 as an import map for the standalone prototype.
3. Phaser's camera-plane API fit is documented against the official FX reference: `camera.postFX.addTiltShift(radius, amount, contrast, blurX, blurY, strength)` (Phaser 3.90). It remains a documented adapter option rather than a second live proof because this workspace's installed render path is three.js; the Phaser WebGL-only constraint is explicit above.

Captures: [layered no blur](../../../prototypes/hd2d-depth-focus/captures/layered.png), [layered tilt-shift](../../../prototypes/hd2d-depth-focus/captures/layered-tilt.png), [layered pixel protect](../../../prototypes/hd2d-depth-focus/captures/layered-pixel-protect.png), [three no blur](../../../prototypes/hd2d-depth-focus/captures/three-no-blur.png), [three BokehPass](../../../prototypes/hd2d-depth-focus/captures/three-bokeh.png), [three haze](../../../prototypes/hd2d-depth-focus/captures/three-haze.png), [5-second comparison clip](../../../prototypes/hd2d-depth-focus/captures/layered.mp4). Recreate them with `node prototypes/hd2d-depth-focus/capture.mjs` in a checkout with Playwright and Chromium installed.

## Engine API sketch

```ts
interface FocusConfig {
  mode: 'off' | 'tiltShift' | 'depthOfField';
  target: 'player' | { x: number; y: number; z?: number };
  smoothing: number;
  strength: number; // normalized 0..1
  range: number;   // world units in 3D; normalized scene range in 2D
  quality: 'low' | 'full';
}
interface SceneAtmosphere {
  haze?: { color: string; distance?: number; height?: number; density?: number };
  pixelArt?: { filter: 'nearest'; sharp: boolean };
}
interface OcclusionStyle { response: 'none' | 'fade' | 'fadeAndTint'; opacity?: number }

scene.focus.configure(config);
scene.atmosphere.set({ haze: { color: '#9ba99a', distance: 32, height: 2 }, pixelArt: { filter: 'nearest', sharp: true } });
assets.setStyle('front-canopy', { depthBand: 'foreground', occlusion: { response: 'fade', opacity: 0.35 } });
```

Backend adapters map shared intent to Phaser postFX/passes and three.js depth-aware passes. `range` must be translated per renderer; APIs should not claim that 2D authored depth equals 3D camera meters. `quality: low` should use a half-resolution target and bypass DOF on unsupported/slow devices.

## Recommendation and risks

Recommend a **shared semantic focus/atmosphere API with renderer-specific backends**, starting with a low-cost 2D depth-band and crisp-sprite compositor, plus optional true depth-buffer DOF for the 3D renderer. Keep tilt-shift as a separate artistic mode. This gives the visual language common authoring without pretending both renderers have the same physical depth. Make haze and crispness work with DOF disabled; ship all expensive blur as opt-in quality tiers.

Risks: Phaser 3 camera FX require WebGL; depth-buffer DOF can blur the player and increase mobile bandwidth; transparent cutouts need correct depth behavior; fog and 2D atmosphere do not map perfectly; filtered sprite masks can halo; a focus target that chases every tiny player motion can visibly pump. The proofs are desktop Chromium visual experiments, not 60 fps evidence on phones. The inspiration reference files were not present in this workspace, so a final art-direction comparison remains useful for the prototype ticket.

## Decisions for Kevin

1. Should V1 use a stylized depth-band preset as the default, or keep every blur effect off until a creator opts in?
2. For 3D scenes, should true depth-buffer DOF be in the first engine milestone, given its mobile cost, or should that milestone use the cheaper layered focus mode first?
3. Should a foreground asset default to normal occlusion only, or may the creator explicitly set it to fade when it covers the player?
4. Should the default focus follow the player automatically with easing, or require an explicit scene focus target?
