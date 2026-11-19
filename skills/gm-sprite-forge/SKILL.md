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
