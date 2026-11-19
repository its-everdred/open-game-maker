# Sprite pipeline research: rebuilding SmallScaleInt sprites

2026-11-19. Scope: how the SmallScaleInt packs that Dusk Helm uses were made, a measured style spec, candidate pipelines, a recommended design, and a small rebuild proof. Plan: `docs/plans/sprite-pipeline/plan.md`. Requirements: `requirements.md` (beside this file).

All measurements come from the scripts in `scripts/` (run with `~/.local/share/ogm/forge-venv/bin/python -I`). Raw numbers are in `style-measurements.json`. Pack files were only read, never written or sent anywhere. Proof outputs are in `assets-local/experiments/sprite-pipeline/` (not committed).

## 1. Verdict: Kevin's hypothesis is right, with three corrections

**The sprites are 3D renders.** That is certain: the author says so, and the files agree. Three parts of the hypothesis are wrong:

- There is **no 2D outline shader**.
- There is **no palette quantisation**.
- There is **no pixelation pass**.

The pixel look comes from rendering a low-poly, smooth-shaded, stepped-lit model at native resolution with anti-aliasing off. Then the alpha is hardened, and for the 64 px "16-bit" sheets the shadow is removed by script.

| Evidence | What it shows | Source |
|---|---|---|
| Author, itch.io comments: "These are all pre-rendered graphics, not hand pixelated." / "I don't hand out the 3D models that are used for the characters" / "no blender files included" | 3D render, Blender implied | [HD character pack 1](https://smallscaleint.itch.io/hd-8-directional-top-down-character-pack-1) |
| Author: shadowless sheets "were programmatically removed rather than being rendered without them" | Post-render step | same page |
| Author: tiles lit by "a sun light coming from the right side… characters are lit straight from above"; tiles 256×256, characters 128×128, 128 px per unit, tile pivot (0.5, 0.18) | Light and camera rig | [2D fantasy tileset](https://smallscaleint.itch.io/2d-fantasy-tileset) |
| Per-frame files named `<Anim>_<yaw°>_<frame>.png`, yaw 0/45/…/315, frames **001, 003 … 029 only** (every second frame of a 30-frame timeline) | Output of an 8-direction turntable render. The naming matches FoozleCC's free Blender script `render_8_direction_sprites` (0=E, 45=NE…, model turned about Z), with its frame step set to 2 | `assets-local/packs/smallscaleint-2d-character-pack-1/*/extracted/1Knight/Idle/*/`; [FoozleCC script](https://github.com/FoozleCC/blender_scripts/blob/main/render_8_direction_sprites) |
| Prop views N/E/S/W are four camera angles on one solid: silhouette area spread across views 1.4–7% for stones, chests and walls, and a visual hull carved from the four views reprojects to **IoU 0.96** on each (§4) | A rotating 3D model, not redrawn views | `study.py`, `carve_hull.py` |
| Stone A1 and A17/A18/A20: silhouette IoU **1.000** (A19 0.977) with different materials (brown ore, coal, gold) and specular highlights | One mesh, swapped materials | §2.6 |
| Goblin cast shadow centroid sits at the same screen point, (63, 82) ±2 px, in all 8 directions, with a soft alpha ramp (1–200) | Fixed camera and light, character turned; soft shadow from a renderer | §2.5 |
| No k×k pixel-block repetition in any asset (best 2×2 match 0.25–0.53) | Rendered at native resolution, not upscaled | §2.4 |
| Animations: smooth consecutive-frame silhouettes (IoU 0.83 knight walk, 0.96 idle); every animation is exactly 15 frames per direction (Block 6), while the per-frame source had 17 for Walk | Keyed 3D animation, resampled to 15 | §2.3 |
| Every pack is tagged "No generative AI was used" | Not AI | itch pages above |

What it isn't: hand-pixelled (the author denies it, and the colour counts are too high), or AI.

Unknowns: the animation source (Mixamo-style names such as 180Turn and Pummel suggest it but don't prove it), the render engine, and the exact character light.

## 2. SmallScaleInt style spec (measured)

### 2.1 Projection (measured from tiles; the author's "45 degrees" is the yaw)
- **2:1 dimetric, not true isometric.** A ground tile's top face is a **128 × 64 px diamond** (rows 176 → 208 → 240, widest row 128 px), with 16 px of tile thickness below it (Ground A1: bbox 128×80).
- Camera: orthographic, **60° from vertical (30° elevation), yaw 45°**. 1 world unit = 128/√2 ≈ 90.5 px horizontally. World origin at pixel **(128, 208)** in a 256 px tile image. This matches the author's pivot of (0.5, 0.18): 0.18 × 256 = 46 px from the bottom, so row 210.
- Our Blender camera with these values reproduces the Ground A1 diamond **row for row (within 1 px)** (`blender_iso_rig.py tile`). `carve_hull.py`'s analytic projection puts the unit tile's corners at exactly (192, 208), (128, 176), (64, 208), (128, 240).

### 2.2 Sheets and directions
| Pack | Cell | Sheet | Rows (directions) | Frames |
|---|---|---|---|---|
| 2D Character Knight ("16-bit") | 64 | 960×512 | 8 | 15 per animation, 29 animations |
| HD Knight / Orcs and Goblins / tileset characters | 128 | 1920×1024 | 8 | 15 (Block 6) |
| Props, tiles, walls, roofs | one 256×256 PNG per view | | 4 views: N/E/S/W | animated props: separate frame sets |

Row order: **row r = yaw (360 − 45r) mod 360, so E, SE, S, SW, W, NW, N, NE**. Matched by silhouette against the per-angle folders `0/45/…/315`.

Prop view order: carving Stone A12 keeps the most volume with N, E, S, W = yaw 0°, 270°, 180°, 90°, meaning each view turns the model −90° from the last.

### 2.3 Per-sprite numbers (`study.py`)
| Sheet | bbox (w×h px) | feet y | colours/frame (90% cover) | sheet colours | lum bands | partial-alpha share | rim/interior lum | consec. IoU |
|---|---|---|---|---|---|---|---|---|
| Knight 64 Walk (Shadowless) | 14×22 | 42 | 15 (9) | 27 | 4.8 | 0.00 | 0.93 | 0.83 |
| Knight 64 Idle | 13×22 | 43 | 15 (9) | 26 | 4.9 | 0.00 | 0.88 | 0.96 |
| Knight HD Walk (shadow pixels excluded) | 35×56 | 95 | 144 (75) | 788 | 12.3 | 0.41 | 0.86 | 0.81 |
| Goblin 01 Walk (no shadow) | 29×34 | 90 | 89 (59) | 374 | 7.8 | 0.07 | 1.05 | 0.57 |
| Tileset Player Walk | 31×43 | 89 | 50 (25) | 193 | 7.8 | 0.14 | 0.93 | 0.72 |

The 64 px knight is not a downscale of the HD knight: the HD figure is about 2.5× taller in its cell (56 vs 22 px), and the downscaled IoU is 0.27–0.29. It is a separate low-resolution render.

Object masks exclude near-black, partial-alpha shadow pixels (`spritemetrics.mask`). Prop views (S): Stone A12 (boulder) is 74×61 px with 165 colours, 7–10 bands and rim/interior 0.65–0.71. Wall A1 is 82×168 with 190 colours. Roof A1 has 5,804 colours (textured). Tree A1 has 3,403.

### 2.4 Pixels, palette, outline, alpha
- **Native resolution.** No upscaling; see the block test in §1.
- **No fixed palette.** The tileset's 467 S views hold **51,860 distinct colours** (roofs 23k, trees 16k). Characters have few colours because they are tiny and flatly textured (knight 64: 27 per sheet), not because they are quantised.
- **No drawn outline.** The rim/interior luminance ratio is 0.8–1.05 everywhere; a drawn outline would sit near 0.3–0.5. The knight shield's black rim is a model detail: the head beside it has none.
- **Alpha.** The 64 px sheets have binary alpha. The HD sheets keep anti-aliased edges (41% of opaque pixels partial in the knight HD walk, mostly its shadow). Prop objects are hard-edged (alpha 255); only their shadows are partial.

### 2.5 Light and shadow
- **Props:** stepped shading with 3–4 plateaus plus a faint texture. On Stone A12 the luminance plateaus are **≈130 (top), ≈109 (upper sides), ≈62 (lower and camera-facing sides)**, ratios 1.0 / 0.84 / 0.48. Contact shadow: **pure black RGB (0, 0, 0) at alpha ≈165** (range 128–200), soft-edged.
- **Characters:** the light's screen angle is ≈90° (from the top of the screen) in every direction on the HD knight (88–97°) and the tileset player (84–97°). That fits "lit straight from above". Shadow (goblin): centred about 5 px up-screen of the feet in every direction, fixed in screen space, alpha 1–200 soft.
- **Shadow variants:** "Shadowless" (64 px knight; shadow removed by script), "With shadows" (HD), and "Separate shadows and effects" (goblins: a shadow-only sheet, one colour, alpha only).

### 2.6 Materials and variants
Ore stones (A1, A17–A20) share one mesh with different materials. Stone A3/A9–A11 are rubble walls; A6–A8 are wells with different liquids. Market stalls Misc B14/B17/B18 share a frame with different canopies. These are material swaps, which suits the gm-asset-variants recolour route for cheap variants.

## 3. Candidate pipelines

| Pipeline | Fidelity to the pack | Cost | Speed | Control | Licence | Verdict |
|---|---|---|---|---|---|---|
| **A. Blender re-render** (calibrated iso camera, stepped emission shading, shadow catcher, finishing) | Highest; it is the author's own process | Free (Blender 4.3 installed) | 15–60 s per 256 px view on CPU under fleet load | Full: geometry, light, bands, timing | Blender GPL (outputs ours) | **Recommended engine** |
| A + **carved hull** from the pack's views (rebuilds only) | Silhouette IoU 0.96 by construction | Free | About 7 min carve under load | Geometry fixed by the views; no concavities | n/a | Recommended for rebuilds: isolates renderer error |
| A + **CC0 meshes and animations** (Quaternius UAL, KayKit; Mixamo for clips) | High once refit to proportions | Free | Hours per character | High | CC0 / Mixamo royalty-free in games | Recommended mesh and animation source |
| A + **CPU image-to-3D** (Stable Fast 3D, SPAR3D, TripoSR) | Unknown at 20–40 px; meshes are blobby | Free (SF3D: Stability community licence, < $1M revenue) | Minutes per mesh on CPU | Low | MIT / Stability community | Try in the goblin rebuild |
| A + **TRELLIS.2 HF Space** | Best AI mesh quality | Free ZeroGPU quota (about 5 GPU-min a day) | Fast, rationed | Low | MIT | Only with non-pack references, or under the mock-reference exception |
| **B. 2D AI sprite tools** (PixelLab, Retro Diffusion, God Mode) | Shapes drift across directions and frames; not pixel-faithful | Paid for style reference and 8-direction | Fast | Low | Commercial OK, varies | Rejected for production; concept only |
| **C. Local SDXL + pixel LoRA + ControlNet** | Weak consistency | Free, but CPU-only is very slow | Slow | Medium | OpenRAIL++ | Rejected |
| **D. Kitbash / recolour pack sprites** (gm-asset-variants; how the author's Character Creator works: stacked 2D layers) | Exact | Near zero | Fast | Limited to existing poses and parts | Pack licence (derivatives OK, no redistribution) | **First resort** for variants (the elite goblin, recoloured props) |
| Paid tools (PixelOver, Auto-Rig Pro, Meshy, Rodin) | Varies | Money | | | | Excluded: no spending |

Licence notes: Hunyuan3D and HY-Motion exclude the EU, UK and South Korea (outputs included). Tripo and Rodin free-tier outputs are reportedly non-commercial. SMPL-based text-to-motion is non-commercial. SmallScaleInt's own licence allows modifying and recolouring but not redistributing the raw files. Sources: §5.

## 4. Proof: rebuilding Stone A12 (rock)

Renderer: Blender 4.3.2, Cycles on CPU, headless (`scripts/blender_iso_rig.py`), with the calibrated camera from §2.1. Shading: emission from `normal·sun` through a constant three-stop ColorRamp using the measured plateaus (130/109/62). Shadow catcher for the contact shadow; pixel filter 0.01. Then `finish.py`: hard object alpha, pure-black shadow at alpha 165. Scored with `score.py`; review sheets made with `compare.py` (original | rebuild | diff heatmap, with numbers). The host was at load ≈ 56 (agent fleet) throughout.

Scores are means over the 4 views (S view only for the sweep).

| Round | What changed | sil. IoU | best-shift IoU | pixel sim. | palette dist. | edge F1 | lum-hist L1 | shadow IoU |
|---|---|---|---|---|---|---|---|---|
| v1 | primitive: bevelled box + 3 pebbles; guessed light | 0.61 | 0.70 | 0.89 | 1.6 | 0.20 | 0.40 | 0.09 |
| sweep | 12 sun directions | | | best 0.927 at az +30°, el 65° | | | best 0.47 | |
| v2 | v1 footprint, sloped top, small pebbles, swept light, ramp 0.35/0.75 | 0.58 | 0.64 | 0.91 | 1.7 | 0.21 | 0.48 | 0.14 |
| **v3** | **visual hull carved from the pack's 4 views**, same rig and light | **0.96** | **0.96** | **0.92** | **1.6** | **0.96** | 0.70 | 0.53 |
| proposed prop gate | | ≥ 0.90 | | ≥ 0.95 | ≤ 4 | ≥ 0.70 | ≤ 0.20 | ≥ 0.60 |

Media (local, not committed): `assets-local/experiments/sprite-pipeline/proof/v1/compare.png`, `v2/compare.png`, `v3/compare.png`, plus `scores.json` per round. Pack inspection figures are in `assets-local/experiments/sprite-pipeline/look/`.

What the scores say (honest reading):
- **Camera, projection and pixel contract: solved.** The tile matches row for row. Rebuild edges are hard like the pack's, the palette distance is 1.4–2.0 (indistinguishable colours), and the hull's reprojection hits IoU 0.96 with a 0–1 px shift, which also confirms the camera.
- **Geometry: solved for rebuilds by carving, unsolved for new assets.** Hand-guessed primitives reached IoU 0.58–0.75 and edge F1 0.2. The carved hull reaches 0.96 / 0.96 and passes both gates. It still can't see concavities, and its voxel facets show as stair-step shading.
- **Shading and shadow: not solved, and now the main gap.** With the right silhouette the luminance distribution gets worse (L1 0.70): the hull's facets mostly land in the top band, and there is a single material, so the tan pebbles come out grey. The best-fitting single sun also puts part of the cast shadow on the wrong side (shadow IoU 0.53). Next: smooth or remesh the hull, give the pebbles their own material, and fit a sun plus fill light (or ambient term) jointly to the bands and the shadow.
- **Gate status:** v3 passes silhouette, edge and palette; it fails pixel similarity (0.92 against 0.95), shading (0.70 against 0.20) and shadow (0.53 against 0.60).

## 5. Sources

Web research on 2026-11-19 by two research agents; URLs checked through fetches and the GitHub API.
- SmallScaleInt: <https://smallscaleint.itch.io/hd-8-directional-top-down-character-pack-1>, <https://smallscaleint.itch.io/2d-fantasy-tileset>, <https://smallscaleint.itch.io/top-down-orcs-and-goblins>, <https://smallscaleint.itch.io/character-creator-2d-fantasy>, <https://smallscaleint.itch.io/character-creator-2d-modern>, <https://smallscaleinteractive.weebly.com>
- 8-direction render naming: <https://github.com/FoozleCC/blender_scripts/blob/main/render_8_direction_sprites>; the same names in third-party repos: <https://github.com/Lenfos/MiniJam>, <https://github.com/Pau-Escola/4us>
- 3D→pixel technique: Dead Cells <https://www.gamedeveloper.com/production/art-design-deep-dive-using-a-3d-pipeline-for-2d-animation-in-i-dead-cells-i->; BNPR <https://bnpr.gitbook.io/bnpr/pixel-art/pixel-art-basics>; Blender Studio <https://studio.blender.org/blog/3d-pixel-art-in-blender>; Lospec toolkit <https://lospec.com/blender-toolkit>; depth/normal edge outlines <https://davidholland.netlify.app/articles/3d-pixel-art-rendering>; 2:1 camera angles <https://samjross.github.io/programming/2024/05/05/calcluating-isometric-angles-blender-camera.html>; Godot Pixel Renderer <https://github.com/bukkbeek/GodotPixelRenderer>; PixelOver <https://pixelover.io/>
- Image-to-3D: TRELLIS.2 <https://github.com/microsoft/TRELLIS.2>; Stable Fast 3D (CPU backend) <https://github.com/Stability-AI/stable-fast-3d>; SPAR3D <https://github.com/Stability-AI/stable-point-aware-3d>; TripoSR <https://github.com/VAST-AI-Research/TripoSR>; Hunyuan3D licence <https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1/blob/main/LICENSE>; HF ZeroGPU quota <https://huggingface.co/docs/hub/spaces-zerogpu>
- Rigging and animation: UniRig <https://github.com/VAST-AI-Research/UniRig>; Rokoko add-on <https://github.com/Rokoko/rokoko-studio-live-blender>; Expy Kit <https://github.com/pKrime/Expy-Kit>; Quaternius UAL (CC0) <https://quaternius.itch.io/universal-animation-library>; KayKit animations (CC0) <https://kaylousberg.itch.io/kaykit-character-animations>; Mixamo licence FAQ <https://community.adobe.com/t5/mixamo-discussions/mixamo-faq-licensing-royalties-ownership-eula-and-tos/m-p/13234775>; SMPL licence <https://smpl-x.is.tue.mpg.de/modellicense.html>
- 2D AI: PixelLab <https://www.pixellab.ai/docs/faq>; Retro Diffusion <https://www.retrodiffusion.ai/>
- Post-processing: PixelOE <https://github.com/KohakuBlueleaf/PixelOE>; unfake <https://github.com/jenissimo/unfake.js>; libimagequant <https://github.com/ImageOptim/libimagequant>; hitherdither <https://github.com/hbldh/hitherdither>

## 6. Recommended design

1. **Engine:** `skills/gm-sprite-forge` in OGM core. It holds the measured style spec, the measurement harness, the scorer with `gates.json`, the comparison renderer (review media), and the calibrated Blender rig with finishing and hull carving. Everything runs headless on CPU.
2. **Order of means for any new sprite:** (a) kitbash or recolour pack sprites (gm-asset-variants); (b) a CC0 mesh refit plus a Mixamo or CC0 clip through the rig; (c) CPU image-to-3D as a starting blockout; (d) hand modelling. 2D AI tools are for concept art only.
3. **Trust gate:** four reference rebuilds (Stone A12, Misc B17 market stall, Knight 64 Walk, Goblin 01 Walk) must pass numeric gates and Kevin's "matches" in a standing review lane before any Dusk Helm asset is generated. Kevin's verdicts recalibrate the gates.

## 7. Open questions and risks
- **Character fidelity at 64 px:** limbs are 1–2 px wide, so silhouette IoU may plateau below 0.8 even when it looks right. Gates are per class and calibrated by verdicts.
- **Character mesh source:** no SmallScaleInt meshes exist outside the author's hands. Hull carving doesn't transfer to characters, because a single frame has only one view per direction and the limbs move. Image-to-3D quality at this size is unproven. Sending pack frames to a cloud service is allowed only under the mock-reference exception; local CPU tools are the default.
- **Light model:** one sun doesn't reproduce both the bands and the shadow side (§4). Next is a sun plus ambient or fill fit.
- **Worker sandbox:** Codex workers need `assets-local/experiments/sprite-pipeline` added to `writableRoots` before the rebuild tickets dispatch. Blender must also be visible inside the sandbox; the rig ticket proves that first.
- **Host load:** renders compete with the fleet (load ≈ 56 during this study). Keep it to one rebuild worker at a time, `nice`d.
