# Comparison media

Run the renderer locally with Python, Pillow, NumPy, SciPy and ffmpeg (including libx264). It reads the originals without modifying them. Keep pack files local and save review media outside the pack.

For four prop views, supply one pair per label:

```sh
python skills/gm-sprite-forge/scripts/compare.py still --pairs north.png:north-rebuild.png east.png:east-rebuild.png south.png:south-rebuild.png west.png:west-rebuild.png --labels N,E,S,W --out review.png
```

Each row shows original, rebuild, difference heatmap, and the prop gate thresholds and verdicts. Green means identical pixels; red indicates differences.

For a character sheet, rows are directions and columns are frames. Choose the gate that matches the asset class:

```sh
python skills/gm-sprite-forge/scripts/compare.py sheet original.png rebuild.png --cell 64 --gates character-64 --out review --fps 12
```

The directory contains a GIF and phone-compatible H.264 MP4 per row, `still-8dir.png` with the gate and scores, and `scores.json` with per-frame scores and gate results. The still uses the first frame of each row, original above rebuild. `--zoom` controls pixel enlargement (default 4). Sheet dimensions must match and be divisible by the cell size. Undefined metrics fail their gates; the verdict does not replace visual review.
