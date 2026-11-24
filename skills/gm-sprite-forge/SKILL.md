---
name: gm-sprite-forge
description: Measure and make sprites that match the SmallScaleInt packs.
---

# Sprite forge

This is the `lane:clone` skill: a rebuild or variation clones the pack's existing style exactly (creator,
2026-11-20). No creative reinterpretation; creative screens and scenes belong to `lane:creative` (gm-image-mock).

Use this skill when a sprite needs to match the SmallScaleInt packs. First look for an existing asset to kitbash or recolour using `gm-assets` and `gm-asset-variants`; clone pack assets and never edit the originals. If that cannot meet the need, use a calibrated 3D render rig. Do not use a generated 2D image as the production sprite. Mark AI-assisted outputs `ai_generated: true` in their manifest; do not send pack files to cloud services.

Compare results against the [measured style reference](references/smallscaleint-style.md). The local measurement harness needs Python with Pillow, NumPy and SciPy installed:

```sh
python skills/gm-sprite-forge/scripts/measure_sheet.py path/to/sheet.png --cell 64
python skills/gm-sprite-forge/scripts/measure_sheet.py path/to/prop.png
```

The script reads the input and prints JSON; it does not modify the image. Use the matching cell size for the sheet. The numbers describe the reference packs, not an automatic pass/fail score.

For calibrated CPU rendering, install Pillow, NumPy, SciPy and scikit-image in a local Python environment and make Blender 4.3 available on PATH. Render a 15-frame, eight-direction sheet from a Blender file with:

```sh
python skills/gm-sprite-forge/scripts/render_sheet.py blend output/walk.png --mesh model.blend --start 1 --end 30 --cell 64 --derived-from "source model" --shadow-sheet output/walk-shadow.png
```

The Blender import keeps mesh materials and animation, but ignores source cameras and lights; prepare the mesh with the desired materials before rendering. The script samples the inclusive animation range evenly, renders at lowered CPU priority, and writes a JSON manifest beside the sheet. Add `--ai-generated` when the source or output is AI-assisted. `cube`, `rock`, and `hull` are also available; `hull` takes an OBJ via `--mesh`. The separate shadow sheet contains black partial-alpha shadow pixels; without it, those pixels remain in the main sheet. For four 256-pixel prop views or the tile calibration, run `blender -b --python skills/gm-sprite-forge/scripts/blender_iso_rig.py -- tile output/ samples=1`. The hull carver and finisher expose their arguments with `--help`. Never write into a pack directory.

The experimental `tree` rig scene accepts `dense=1` for a seeded clustered canopy and `leaf_count` (1–100000, default 24000) to control its detail. `canopy_scale`, `crown_width`, `crown_depth` and `crown_height` adjust the crown proportions. This is a blockout and has not passed the vegetation reference gates. Set `shadows=0` on the rig when the reference has no cast-shadow pixels. Render and score against the relevant original before using it.

After a variant is approved, render and package all four views in one command:

```sh
python skills/gm-sprite-forge/scripts/render_vegetation.py tree assets-local/sets/smallscaleint-vegetation/ tree-v1 --source-card source.card.json --source-collection collection.card.json --metadata provenance.json --seed 42 --dense --shadowless
```

`provenance.json` must provide `agent.backend`, `agent.model`, a nonempty `skills` list and `tool_versions.blender`. The recipe records those fields, the source ID, generator hashes, seed and parameters. Use `--yaw` to preserve the orientation selected in a matrix and `--sun-elev` to set the light elevation in degrees (default 65). Use `--fanout`, `--spread-min`, `--spread-max`, `--leaf-count`, `--crown-width`, `--crown-depth` and `--crown-height` to tune branch and crown shape. For `tree`, `--dense --fine-canopy` uses smaller, overlapping leaf geometry and a wider range of foliage shades. For `tree` and `bare`, `--attachment-min T` sets the earliest 3D branch attachment along each parent (default 0.55). For `bare`, `--organic-bare` selects a rooted, segmented branch layout; it cannot be combined with non-default `--lean`, `--levels`, `--fanout`, spread or attachment controls. `--branch-width W` scales the 3D branching spread horizontally (default 1); `--branch-radius R` sets trunk and branch thickness (default 0.07). For `bush`, `--bush-vertical-scale S` scales the 3D shrub vertically about its ground origin (default 1); `--bush-leaf-detail` adds seeded 3D surface leaf cards with palette-derived tones; `--bush-mass-count` and `--bush-mass-radius` set the number and size of 3D shrub masses. For `conifer`, `--branched --tiers N --spokes N` enables an experimental seeded bough model. For `plant`, `--leafy --count N --extent X --plant-height H --leaves-per-cluster N --leaf-width W` makes seeded leaf clumps with a width multiplier (default 1); `--leaf-length-scale` adjusts their 3D radial length (default 1). Add `--leaf-shading` for independently seeded leaf-tone variation. Use `--batch-size` and `--batch-radius` to scatter small groups instead of individual clumps. This remains a blockout. `--palette palette.json` supplies per-style `foliage` and `bark` objects, each with `hi`, `mid` and `lo` RGB integer arrays; the recipe records the supplied palette. Its geometry remains experimental; the command does not confer approval.

Once a vegetation variant has passed the applicable review gate, package four rig renders named `N.png`, `E.png`, `S.png` and `W.png` outside the pack:

```sh
python skills/gm-sprite-forge/scripts/vegetation_export.py renders/ assets-local/sets/smallscaleint-vegetation/ tree-v1 --source-card source.card.json --source-collection collection.card.json --recipe recipe.json
```

The exporter finishes the PNGs, copies the source collection rights into the generated collection and asset cards, records the source card and recipe, and refuses pack paths or existing variant names. It does not approve the output or run a style gate.

For a draped canopy, build a subdivided mesh above the frame in a local Blender Python script, then use the cloth helper:

```python
import sys
sys.path.insert(0, "skills/gm-sprite-forge/scripts")
from cloth import drape

drape(canopy, pin_indices=[0, 12, 156, 168], colliders=[front_rail, rear_rail], frames=45)
```

Choose pin indices for the actual mesh and place them at the support points; they are zero-based vertex indices, not coordinates. The helper simulates frames 1 through `frames`, applies the cloth modifier to freeze the settled shape, and removes its temporary pin group and collision modifiers. It restores the scene frame and selection; it does not open or save a file. The cloth and collision meshes must be in the current scene, and colliders must not already have collision modifiers. Subdivide the cloth enough to make folds, and model an irregular hem in the mesh before simulating it. Inspect the baked mesh and all reference-matched views for gaps, intersections and unnatural stretching; the simulation alone does not guarantee a match. Save the result only to a new local experiment file, never over a pack original.

Score a rebuild against its original with the same dependencies:

```sh
python skills/gm-sprite-forge/scripts/score.py original.png rebuild.png --gates prop
python skills/gm-sprite-forge/scripts/score.py original.png rebuild.png --cell 64 --gates character-64 --json scores.json
```

The sheet report includes each occupied frame, row counts and motion correlations; gates apply to the mean metrics and require matching frame positions. A missing palette or undefined motion correlation fails its gate. The shift is the displacement applied to the rebuild to align it with the original. `--json` writes the numeric report and gate results; the console also prints PASS or FAIL per gate.

For every rebuild or variation review, prepare both an image-gen option and a 3D pipeline option for each original (when the creator asks to compare approaches, one labelled option per skill or tool, each with the minutes it took), and follow the [comparison media instructions](references/review-lane.md). Use the free Codex image generation route. Attach the original pack frames as references every time: this is permitted for every pack in the library, including ones marked `processing: local-only` (that field forbids other cloud processing, not image-generation references through the mock broker; Kevin, 2026-11-20). Never ask about it, and never post an image option that was generated without the original attached or that covers fewer directions than the original shows. Generated images are review options, not production sprites.

Every review image ships with a sidecar `recipe.json` (or `<image>.meta.json`) naming kind (pack original, image generation, 3D model render, 3D→2D render), model, cost, skill and arm, tools and time, which the review page prints under it, and every candidate is shown next to its original, as one row per candidate (`Original | 3D | 2D pixel`) when it went through a 3D model (creator, 2026-11-21).

Gate animation behind the static sprite (creator, 2026-11-21): do not render, score or post a walk or any other animation for a character until the creator has approved its static eight-direction sprite. This covers every walk or animation step in this skill and its references (`render_sheet.py` walks, GPU walk sheets, rig-and-walk arms). Review the static sprite as stills, one frame per direction: the character gates' motion and frame-match checks cannot pass on stills, so judge the still metrics and leave those two to the first walk round. A "Matches" on the stills Command approves the static sprite and opens the animation round. For side-by-side stills, animations and gate verdicts, follow the [comparison media instructions](references/review-lane.md). To prepare seven-column vegetation review cells, run:

```sh
python skills/gm-sprite-forge/scripts/vegetation_matrix_media.py matrix.json review-output/ --recipe recipe.json
```

The manifest has a `rows` array of 10–16 entries; each entry has an `id` slug, display `name`, `original` PNG path, five `variants` PNG paths and a `mock` PNG path. The tool writes individually labelled media and `options.json`, alongside the supplied recipe. It checks for duplicate variants and requires each finished render's alpha bounding-box width, height, coverage and ground-shadow coverage to be within 15% of the original. Ground-shadow coverage counts visible partial-alpha pixels with near-black RGB (0–3), excluding alpha-1 specks and dark-green foliage. Cells are enlarged 4×. It never submits the review or approves the assets. For a single row, check the five finished render paths with `python skills/gm-sprite-forge/scripts/vegetation_footprint.py original.png v1.png v2.png v3.png v4.png v5.png` before posting.

For a requested multi-tool bake-off, do not treat the default image-gen-versus-3D comparison as sufficient. Label each requested tool as its own arm, use the same references, cell size, camera, light, colour pass and shadow treatment, record tool and version, setup, active time, peak GPU memory and unavailable capabilities in a `recipe.json` beside the local outputs, and score every arm with `score.py`. Keep missing or failed arms explicit, and mark each AI-assisted arm `"ai_generated": true` in its `recipe.json` entry. A local score is diagnostic only: record a capability-matrix winner as provisional, with its review Command ID, until the creator's visual verdict arrives, then update the matrix row and the routing below. Keep pack files and renders outside the repository.

When GPU rendering is requested, use `scripts/gpu_bake_rig.py` and `scripts/gpu_bake_finish.py`. The rig refuses to fall back to CPU; `blender_iso_rig.py` is CPU-only and does not count as a GPU arm. The [GPU bake-off guide](references/gpu-bakeoff.md) covers setup, the arm builders in `scripts/bakeoff/` (procedural, CC0, Hunyuan3D-2, TripoSR), the #1094 results and the fal image-to-3D candidate arms (NUC host only, through the `scripts/fal3d.py` ledger; fal receives Codex-generated references, never pack files). On the PC, run every GPU job through `~/.local/bin/gpu-run` (see the guide). Route the mesh source by the creator's verdicts (2026-11-21, in the guide): characters use fal TRELLIS v1 multi-view (about 0.02 USD; Tripo H3.1 looked best but 0.30 USD is too much, and the bake-off is closed), trees use TRELLIS 2 (0.25 USD), and foliage and props use Rodin 2.5 fast (0.10 USD). Send fal a Codex turnaround made with the original attached, never the pack file: the creator allowed pack uploads for the #1094 comparison only. The meshes are good enough; the finish pass is not. The creator wants fewer colours and chunkier pixels than `gpu_bake_finish.py` gives on its own: after the colour pass, run `scripts/pixel_finish.py` with his pick (8 skin and 6 cloth colours, smoothed, the cloth from a mask; hero-finish1-warrior "B", 2026-11-22; `pixel` in the [rig and motion cells](references/rig-motion.md#cellsjson)). The next rung is static sprites from the kept TRELLIS meshes through that finish ([#1195](references/gpu-bakeoff.md#next-rung-static-trellis-sprites-1195)), not new mesh sources. Without fal, try Hunyuan3D-2 locally from the original view for trees (check its licence region first) and CC0 models for foliage (both liked on #1120; the foliage colour was still off), then the procedural builders; for characters build the procedural body as a static sprite first and add its scripted walk only after approval. The vegetation renderer above stays the CPU blockout path. Single-view image-to-3D invents the unseen sides, so check every direction. No arm has passed the gates; every result is a review option, not a production sprite.

Heroes are base bodies (creator, 2026-11-22): Warrior, Wizard and Ranger, each male and female, every one a body with the pack sprite's face, hair, build, proportions, palette and pixel scale, all gear removed and plain white undergarments only, in a neutral A-pose. Armour, weapons, helmets and robes are separate meshes attached to hand or body bones and rendered at the same camera and scale, so the game can swap them. Judge the modeling step on body, face, palette and scale in that A-pose only. A stance or pose difference from the pack's Idle is fixed in the rigging step (the stance layer in [rig and motion](references/rig-motion.md)), never by re-generating the mesh.

Sprite stacking ([vendored skill](../vendor/sprite-stacking/skills/sprite-stacking/SKILL.md), local, free) fits when an object has four orthographic pixel views (top, side, front, back) and must turn smoothly: it carves a visual hull into a slice strip and renders any angle. It is arm S of the bake-off, scored with `score.py` like every other arm. The SmallScaleInt N/E/S/W views are isometric and have no top view, so a stack built from them is an approximation: a visual hull fills the gaps between thin branches and twigs, and a stack is one rigid pose with no walk cycle. Run its slicer with the forge Python, never install it with `npx skills add`.

To rig and animate an approved character mesh, follow [rig and motion](references/rig-motion.md): a Rigify metarig fitted to the mesh by script, bone heat on a voxel proxy, retargeted or hand-keyed motion with a stance layer, a foot lock and IK, rendered S and SE through the pack camera, finished with the picked pixel finish (`pixel` in `cells.json`) and scored against the pack's own animation with motion correlation and foot slide. Building and debugging that tooling on an existing mesh as a test subject is allowed (#1202); its results are never posted for review. The rig and motion source the creator picks in the #1202 review will be recorded there as the default. A body that arrives rigged (a vendor rig, a library character) skips the fit, stance and IK: set `rigged` on the cell and sample its clip evenly or on the pack's key poses ([rigged bodies](references/rig-motion.md#rigged-bodies-1282-bake-off), #1282), and check each frame against the pack clip with `scripts/motion/pose_overlay.py`.

To see how any 3D model or whole pack looks in engine, run `scripts/pixel_preview.py <model|dir> --out <dir> [--dirs S,SE] [--anim rig.glb]` (forge Python, Blender on PATH): one Blender run renders each model through the pack camera at pack scale (characters 43 px, idle when an idle action exists), applies finish B, and writes raw and pixel PNGs plus one raw | pixel contact sheet per group (characters, armor, weapons or weapon kinds, props, environment). `--finish C --variant C1|C2|C3` applies finish C instead (#1338, `scripts/pixel_finish_c.py`, `presets/finish-c.json`): Kevin found B fuzzy beside the pack ("sharper edges and sharper shade/color transitions. clear lines separating clothing from skin"). It renders at 4x without anti-aliasing plus albedo and depth passes, downsamples by majority vote, finds materials from the albedo, and gives each 2-4 hard bands, 1 px lines where materials or depths meet and a darkened local outline. C1 takes the pack's tones in 3 soft bands, C2 the pack's tones in 4 bands with darker lines and outline, C3 keeps the model's own colours in 4 crisp bands. C1 and C2 need `--ssi` with pack sprites of the same kind (the HD character Idle frames for heroes and weapons, the fantasy tileset for props and buildings); the command refuses to run without them. Add `--cloth-split` for the hero base bodies, or their white undergarments merge into pale skin. A hero motion cell takes finish C with `"pixel": {"finish": "C", "variant": "C1"}` ([rig and motion](references/rig-motion.md#cellsjson)); its cloth and weapon masks are its materials. To score crispness against the pack, call `spritemetrics.crispness(sm.load(png))` (pack Idle frames: 13-52% of differing neighbours are hard steps, B 1%). B stays the default until Kevin picks a C variant on the finish C card; then make his pick the default here, in `pixel_preview.py` and in the hero cells. For either finish, `scripts/pixel_lineup.py <out> --ground base.png,overlay.png --refs <pack original> <base bodies> --holder <hero>` composites each group in engine: the game's ground tiles in its daylight, every item at 1x beside the hero and the pack original, weapons at real-world size in the hand (1x and 3x).

For approved reusable assets, see the [generated library and recipe workflow](references/generated-library.md).
