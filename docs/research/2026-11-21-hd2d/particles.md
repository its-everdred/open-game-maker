# HD-2D particles for Open Game Maker

Research spike for #1148. This compares viable particle approaches for the Phaser renderer in Dusk Helm and the three.js renderer in Blobs. The reference images in `assets-local/inspiration/hd2d-lighting/` set the mood only; their camera angle is not the game's isometric camera. The proofs use procedural geometry and generated colors, with no pack assets.

## Recommendation

Build a small OGM-owned particle layer around a renderer-neutral effect description and deterministic CPU simulation. Ship a Phaser adapter and a three.js adapter rather than forcing either renderer to host the other's runtime. Start with low-count CPU particles (roughly 100–300 visible particles per scene), instanced or batched where possible, and cap rates/counts per effect. Add a GPU path only for effects that profiling shows cannot meet mobile budgets. Use the same named controls—rate, lifetime, spread, wind response, depth range, palette, and blend style—across both adapters, while allowing renderer-specific material details.

Use two visual families: point-filtered, palette-matched pixel particles for leaves and debris; softly lit translucent motes/embers for dust and fireflies. Do not apply bloom or depth-of-field to every effect by default. Tie wind to a shared low-frequency vector field so foliage sway and particles move coherently; allow per-effect gust response. Biome presets should be data, not engine code: forest leaves, town dust, campfire embers, and fireflies can compile to either adapter.

## Options

| Approach | Phaser / three.js fit | License and maintenance | Phone cost and visual result | Authoring |
| --- | --- | --- | --- | --- |
| Phaser 4 native emitters | Direct fit in Dusk Helm; no three.js reuse | Phaser is MIT; built-in feature | Good for modest 2D counts, zones and gravity wells; CPU update and draw cost still scale with active particles. Pixel texture sampling is straightforward; scene-light interaction is limited to Phaser's 2D pipeline. | Code/config; Phaser particle skill documents flow/burst, zones, processors and callbacks. |
| `three.quarks` | Direct three.js fit; no Phaser adapter | MIT; active project; editor/tooling ecosystem | Feature-rich modules, spritesheets, trails and GPU-oriented options. GPU features and blending should be measured on mobile WebGL devices; it is not automatically cheap. | Visual editor plus serialized systems, then agent-friendly preset data. |
| `three-nebula` | Direct three.js fit; no Phaser adapter | MIT; mature ecosystem with JSON systems and a desktop designer | CPU particle engine is a useful baseline; renderer options and recent GPU capabilities need device testing. | JSON-authored systems and desktop designer; agents can edit declarative system configs. |
| Custom CPU pool + renderer adapters | Shared semantics, separate draw implementations | No third-party runtime; OGM owns maintenance | Best control of count caps, deterministic seeds, culling, and graceful quality tiers. CPU stepping is appropriate for low hundreds, not unbounded scenes. | Small typed effect schema and preset library; agents author declarative data. |
| Custom GPU particles | Separate shader implementations or a shared shader layer | OGM-owned; WebGL/WebGPU feature support varies | Moves large simulation work to GPU but adds shader, fill-rate, precision, and device-compatibility costs. Three.js `GPUComputationRenderer` uses ping-pong render targets; not a drop-in universal mobile path. | Shader authoring is specialist work; expose only safe tunables to creators. |

**Decision:** prototype the custom CPU adapter path first and keep `three.quarks` as the strongest three.js alternative to benchmark. Phaser's native system remains a valid implementation backend if parity tests show it can express the shared schema. Do not add a dependency before a measured comparison establishes a gain over the built-in Phaser path and a small OGM-owned three.js adapter.

## Visual and simulation trade-offs

- **Pixel particles:** use tiny authored or procedural pixel shapes, nearest-neighbor sampling, palette limits, and sprite-scale sizing. Falling leaves can rotate in discrete steps and retain crisp edges. This supports the sprite layer without requiring postprocessing.
- **Soft lit particles:** use small translucent sprites with restrained additive or premultiplied blending. In three.js they can receive scene light only with a compatible material/shader; ordinary Points materials are not physically lit. Phaser needs its own blend/color treatment. Fake a warm core and soft halo before adding bloom.
- **Depth:** attach each particle to a world-space depth band and let the renderer project it with scene occlusion. Blur is an optional postprocess, not a particle feature; it costs fill rate and conflicts with crisp pixel art. Start with size/alpha falloff and occlusion.
- **Wind:** sample a shared, slowly varying 2D/3D field by world position. Clamp acceleration and velocity so an effect remains legible during gusts. Foliage sway can sample the same field at lower frequency.
- **Physics:** support gravity, drag, bounded turbulence, and one simple attract/repel force. Avoid general collision by default; scenery collision and arbitrary force graphs increase CPU and authoring cost. Phaser exposes gravity wells and death zones; third-party three.js engines offer richer behaviour modules.
- **Depth of field and lighting interaction:** reserve for the soft layer and only where the game's camera pipeline already supports it. Evaluate with overdraw and GPU timing on representative mobile hardware.

## Authoring and engine API sketch

Creators should choose a named preset and change a few bounded controls, not assemble a graph of forces. Agents can author effect JSON with a deterministic seed, texture/palette reference, emitter shape, rate, lifetime, velocity range, gravity, wind response, depth band, and quality tier. Validation rejects unsafe counts, invalid references, and excessive rates.

```ts
game.fx.emit('forest-leaves', { at: { x, y, z }, intensity: 0.7 });
game.fx.setWind({ direction: [0.8, 0.2, 0], strength: 0.35 });
game.fx.setQuality('balanced'); // low | balanced | high; device policy may lower it
```

An effect handle should support `stop()`, `setIntensity(value)`, and disposal with its owning scene. The renderer adapter selects Phaser or three.js at scene boot. Presets should not expose GPU-only controls; both adapters must accept the common fields and may ignore documented optional rendering hints.

## Mobile budget proposal

Target 60 fps on a representative current iPhone and midrange Android, treating the whole game as the budget owner. Initially cap particles to 300 visible per scene and 8 active emitters; cap soft particles to 80 and use a low-resolution or no halo on low quality. Keep simulation time bounded with fixed-step updates and a maximum catch-up count. Cull offscreen emitters and particles, pause emitters outside the active scene, and avoid per-particle allocations. Measure CPU frame time, GPU frame time, overdraw, and memory separately. These are prototype starting ceilings, not proven device guarantees; the prototype ticket must measure and revise them.

## Proofs and follow-up

- `prototypes/hd2d-pixel-leaves/`: Phaser 4 native emitter with procedural pixel leaves, wind sway, a [7-second clip](../../../prototypes/hd2d-pixel-leaves/captures/pixel-leaves.webm), and a [still](../../../prototypes/hd2d-pixel-leaves/captures/still.png).
- `prototypes/hd2d-lit-motes/`: three.js points with procedural warm motes, depth bands, and a simple lighting cue; see the [7-second clip](../../../prototypes/hd2d-lit-motes/captures/lit-motes.webm) and [still](../../../prototypes/hd2d-lit-motes/captures/still.png).
- Neither proof uses licensed pack files. Each README records exact run and capture commands; phone performance measurements remain for device testing.
- Prototype ticket #PROTO should compare both backends, validate preset parity, record CPU/GPU timing on iPhone and Android, and decide whether to adopt Quarks or keep the thin custom adapters.

## Sources

- [Phaser particle concepts](https://docs.phaser.io/phaser/concepts/gameobjects/particles) — emitters, zones, bounds, processors and gravity wells.
- [Phaser 4 ParticleEmitter API](https://phaser.io/oss/docs/api-documentation/4.0.0/class/gameobjects-particles-particleemitter) — emitter behavior/API.
- [three.quarks repository](https://github.com/Alchemist0823/three.quarks) and [documentation](https://docs.quarks.art/docs) — MIT license, three.js VFX runtime and authoring tools.
- [three-nebula repository](https://github.com/creativelifeform/three-nebula) — MIT license, JSON systems and three.js integration.
- [Three.js GPUComputationRenderer docs](https://threejs.org/docs/pages/GPUComputationRenderer.html) — GPU ping-pong compute model and explicit addon requirement.

No third-party package has been installed or added. License and active repository status were checked on 2026-11-21; recheck before selecting a dependency.
