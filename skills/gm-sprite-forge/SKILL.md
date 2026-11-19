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

Score a rebuild against its original with the same dependencies:

```sh
python skills/gm-sprite-forge/scripts/score.py original.png rebuild.png --gates prop
python skills/gm-sprite-forge/scripts/score.py original.png rebuild.png --cell 64 --gates character-64 --json scores.json
```

The sheet report includes each occupied frame, row counts and motion correlations; gates apply to the mean metrics and require matching frame positions. A missing palette or undefined motion correlation fails its gate. The shift is the displacement applied to the rebuild to align it with the original. `--json` writes the numeric report and gate results; the console also prints PASS or FAIL per gate.

For side-by-side stills, animations and gate verdicts, follow the [comparison media instructions](references/review-lane.md).
