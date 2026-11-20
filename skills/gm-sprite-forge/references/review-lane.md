# Comparison media

Run the renderer locally with Python, Pillow, NumPy, SciPy and ffmpeg (including libx264). It reads the originals without modifying them. Keep pack files local and save review media outside the pack.

For each review round, generate a flat image option through the free Codex route (`request-mock.py` or `image_gen`), attaching the original as reference and asking for the same sprite and style (or the requested variation). Produce a Blender rig render as the 3D pipeline option. Never send paid-pack assets to cloud processing; use a locally made, non-pack reference instead when the original is a paid-pack asset, and note this limitation in the review.

Render one enlarged review sheet with all directions. For a first round use `--first-round` and three images per view:

```sh
python skills/gm-sprite-forge/scripts/compare.py round --first-round --views original.png:image.png:pipeline.png --labels N --out review.png
```

For later rounds supply the exact image-gen and pipeline images Kevin last saw for every view, in that order:

```sh
python skills/gm-sprite-forge/scripts/compare.py round --views original.png:image.png:pipeline.png:previous-image.png:previous-pipeline.png --labels N --out review.png
```

Repeat `--views` entries for each direction. Every view shows original | image gen | 3D pipeline, then previous | this round for each track. Enlargement is nearest-neighbour and at least 4×. The renderer refuses to save a follow-up sheet unless more than 3% of the visible pixels change in every view of each track, measured against the last-seen image on the review background. This floor is not the goal: inspect the sheet and make a meaningful, visible change before posting. Start from Kevin's last note and make fewer, larger rounds instead of parameter tweaks.

For diagnostic prop scoring, supply one pair per label:

```sh
python skills/gm-sprite-forge/scripts/compare.py still --pairs north.png:north-rebuild.png east.png:east-rebuild.png south.png:south-rebuild.png west.png:west-rebuild.png --labels N,E,S,W --out review.png
```

Each row shows original, rebuild, difference heatmap, and the prop gate thresholds and verdicts. Green means identical pixels; red indicates differences.

For a character sheet, rows are directions and columns are frames. Choose the gate that matches the asset class:

```sh
python skills/gm-sprite-forge/scripts/compare.py sheet original.png rebuild.png --cell 64 --gates character-64 --out review --fps 12
```

The directory contains a GIF and phone-compatible H.264 MP4 per row, `still-8dir.png` with the gate and scores, and `scores.json` with per-frame scores and gate results. The still uses the first frame of each row, original above rebuild. `--zoom` controls pixel enlargement (default 4). Sheet dimensions must match and be divisible by the cell size. Undefined metrics fail their gates; the verdict does not replace visual review.

For a creator rebuild round, first generate a flat image mock with the original attached as reference (always permitted; see SKILL.md). Then use the actual previous round the creator saw:

```sh
python skills/gm-sprite-forge/scripts/compare.py review original.png image-gen.png previous.png rebuild.png --cell 64 --out review.png
```

The mock must have eight transparent-background views arranged horizontally. The sheet labels the original, image-gen option, previous 3D and current 3D for each direction. It fits each mock view to the original sprite's height and enlarges all cells with nearest-neighbour sampling at least 4×. It refuses a sheet if the first frame of any direction changes no more than 3% of the previous/current foreground union. Review the result by eye: that floor does not establish a meaningful change. Send one review Command with an independently judged card for each track; include the same sheet on each card, allow a note for changes, and state how the round addresses the creator's last feedback. Keep originals, generated mocks and review media outside the repository.
## Review and calibration

For each meaningful rebuild round, post one non-blocking Command on the rebuild ticket. Ask separately whether image gen matches and whether the 3D pipeline matches. The Command schema has one question and at most three suggested responses, so put both questions in that field and use the three outcomes below; when one needs changes, identify that track in the note. Ask for a note on each track needing changes. Include the round sheet, eight-direction still and animated GIF or MP4 as applicable, plus the score JSON and gates in force. In the Command text list each point from Kevin's last note and what changed for it, one line per point. Inspect the media first. Attach the same media to every option:

```json
{
  "question": "Does image gen match? Does the 3D pipeline match? Give a note for each that needs changes.",
  "blocking": false,
  "authority": "human_required",
  "reversibility": "reversible",
  "audience": "creator",
  "context": {"authority_basis": "product", "short_summary": "Review this rebuild against its original.", "long_context_markdown": "Give a note with Needs changes. Include the round and gate scores here."},
  "options": [
    {"id": "both-match", "label": "Both match", "description": "Image gen matches; 3D pipeline matches.", "media": [{"kind": "image", "mime_type": "image/png", "locator": "/absolute/workspace/path/compare.png", "alt_text": "Original and both options"}]},
    {"id": "one-changes", "label": "One needs changes", "description": "Name the track needing changes in your note; the other matches.", "media": [{"kind": "image", "mime_type": "image/png", "locator": "/absolute/workspace/path/compare.png", "alt_text": "Original and both options"}]},
    {"id": "both-change", "label": "Both need changes", "description": "Image gen and 3D pipeline need changes.", "media": [{"kind": "image", "mime_type": "image/png", "locator": "/absolute/workspace/path/compare.png", "alt_text": "Original and both options"}]}
  ],
  "consequence_of_delay": "No answer: rebuilding continues while the verdict is pending."
}
```

Add all applicable still and video entries to each option (local paths must be inside the workspace); do not upload pack assets to cloud services. Record only an identified, relayed verdict in `calibration.jsonl`, one JSON object per line: `asset`, `class` (a key in `gates.json`), `round`, `head` (the actual full commit SHA for that round), `scores` (the unmodified `score.py` JSON or `compare.py still` per-view JSON), `verdict` (`matches` or `needs changes`), `note`, and ISO 8601 `date`. Keep missing provenance unresolved rather than guessing it.

Run `python skills/gm-sprite-forge/scripts/calibrate.py skills/gm-sprite-forge/calibration.jsonl > proposal.json`. The proposal is reviewable JSON, never an automatic edit of `gates.json`. For props, the strictest view of each metric is used. A matching verdict relaxes failed numeric gates; recorded gate snapshots determine whether a rejection passed (legacy reports without snapshots use the supplied baseline); a rejection that passes all gates tightens the numeric gate with the smallest relative passing margin, using the next representable value. Conflicting changes are reported and processed in timestamp order, with the later verdict winning. Equality gates cannot be calibrated numerically. Review the proposed changes and land approved gate changes in a PR; regenerate comparisons so they show the gates in force.
