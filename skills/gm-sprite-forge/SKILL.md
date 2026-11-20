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

The experimental `tree` rig scene accepts `dense=1` for a seeded clustered canopy and `leaf_count` (1–100000, default 24000) to control its detail. `canopy_scale`, `crown_width`, `crown_depth` and `crown_height` adjust the crown proportions. This is a blockout and has not passed the vegetation reference gates. Set `shadows=0` on the rig when the reference has no cast-shadow pixels. Render and score against the relevant original before using it.

After a variant is approved, render and package all four views in one command:

```sh
python skills/gm-sprite-forge/scripts/render_vegetation.py tree assets-local/sets/smallscaleint-vegetation/ tree-v1 --source-card source.card.json --source-collection collection.card.json --metadata provenance.json --seed 42 --dense --shadowless
```

`provenance.json` must provide `agent.backend`, `agent.model`, a nonempty `skills` list and `tool_versions.blender`. The command records those fields, the source ID, rig hash, seed and parameters in the variant recipe. Use `--fanout`, `--spread-min`, `--spread-max`, `--leaf-count`, `--crown-width`, `--crown-depth` and `--crown-height` to tune branch and crown shape. For `plant`, `--leafy --count N --extent X --plant-height H --leaves-per-cluster N` makes seeded leaf clumps scattered within the given extent. Add `--leaf-shading` for independently seeded leaf-tone variation. This remains a blockout. `--palette palette.json` supplies per-style `foliage` and `bark` objects, each with `hi`, `mid` and `lo` RGB integer arrays; the recipe records the supplied palette. Its geometry remains experimental; the command does not confer approval.

Once a vegetation variant has passed the applicable review gate, package four rig renders named `N.png`, `E.png`, `S.png` and `W.png` outside the pack:

```sh
python skills/gm-sprite-forge/scripts/vegetation_export.py renders/ assets-local/sets/smallscaleint-vegetation/ tree-v1 --source-card source.card.json --source-collection collection.card.json --recipe recipe.json
```

The exporter finishes the PNGs, copies the source collection rights into the generated collection and asset cards, records the source card and recipe, and refuses pack paths or existing variant names. It does not approve the output or run a style gate.

Score a rebuild against its original with the same dependencies:

```sh
python skills/gm-sprite-forge/scripts/score.py original.png rebuild.png --gates prop
python skills/gm-sprite-forge/scripts/score.py original.png rebuild.png --cell 64 --gates character-64 --json scores.json
```

The sheet report includes each occupied frame, row counts and motion correlations; gates apply to the mean metrics and require matching frame positions. A missing palette or undefined motion correlation fails its gate. The shift is the displacement applied to the rebuild to align it with the original. `--json` writes the numeric report and gate results; the console also prints PASS or FAIL per gate.

For side-by-side stills, animations and gate verdicts, follow the [comparison media instructions](references/review-lane.md). To prepare seven-column vegetation review cells, run:

```sh
python skills/gm-sprite-forge/scripts/vegetation_matrix_media.py matrix.json review-output/ --recipe recipe.json
```

The manifest has a `rows` array of 10–16 entries; each entry has an `id` slug, display `name`, `original` PNG path, five `variants` PNG paths and a `mock` PNG path. The tool writes individually labelled media and `options.json`, alongside the supplied recipe. It checks for duplicate variant images and never submits the review or approves the assets.
