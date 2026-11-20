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

For a creator rebuild round, first generate a flat image mock using the original as reference, subject to its confirmed processing rights. Then use the actual previous round the creator saw:

```sh
python skills/gm-sprite-forge/scripts/compare.py review original.png image-gen.png previous.png rebuild.png --cell 64 --out review.png
```

The mock must have eight transparent-background views arranged horizontally. The sheet labels the original, image-gen option, previous 3D and current 3D for each direction. It fits each mock view to the original sprite's height and enlarges all cells with nearest-neighbour sampling at least 4×. It refuses a sheet if the first frame of any direction changes no more than 3% of the previous/current foreground union. Review the result by eye: that floor does not establish a meaningful change. Send one review Command with an independently judged card for each track; include the same sheet on each card, allow a note for changes, and state how the round addresses the creator's last feedback. Keep originals, generated mocks and review media outside the repository.
