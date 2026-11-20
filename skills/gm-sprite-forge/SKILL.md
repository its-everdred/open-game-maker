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

For side-by-side stills, animations and gate verdicts, follow the [comparison media instructions](references/review-lane.md).
