---
name: gm-sprite-forge
description: Measure and make sprites that match the SmallScaleInt packs.
---

# Sprite forge

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

For a requested multi-tool bake-off, do not treat this default image-gen-versus-3D comparison as sufficient. Label each requested tool as its own arm, use the same asset references, cell size, camera, light, palette and shadow treatment wherever the methods allow, and record tool and version, setup, active time, peak GPU memory, and unavailable capabilities in a `recipe.json` beside the local render outputs. Score every arm against the original with `score.py`; for animated sheets, also require matching directions and frame counts. Keep missing or failed arms explicit rather than substituting an unrelated result. A local score is diagnostic only: the creator's visual verdict is required before recording a winning approach in the capability matrix. Keep source pack files and experiment renders outside the repository.

When the request specifies GPU rendering, first verify that Blender reports an available GPU backend and that device memory can be measured. The bundled `blender_iso_rig.py` is CPU-only; it does not satisfy a GPU-render requirement. Do not label CPU renders as GPU arms or infer a GPU winner from them. If the active workspace has no device access, record GPU setup/rendering as a post-deploy check and hand off the other completed evidence without claiming the bake-off has a winner.

For approved reusable assets, see the [generated library and recipe workflow](references/generated-library.md).
