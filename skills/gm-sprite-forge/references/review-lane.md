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

## Review checkpoints

Keep every render and score in `round-N/` and append scores to the local `scores.json`; internal rounds do not create Commands. Maintain exactly one open review Command per ticket. Never replace a Command younger than 10 minutes. Once it is at least 10 minutes old, create the next Command only when a checkpoint occurs:

- a gate passes for the first time;
- the best score improves by the configured margin since the last round Kevin saw; or
- 10 rounds or 20 minutes have elapsed since the last Command, whichever comes first.

If a verdict includes a note, wait until the first round that changes the part it names. Its question must say which part of the note changed, and its comparison must show the judged round beside the new round. Do not send an unrelated round as the response to the note.

When choosing a direction, put up to three candidates (A/B/C) with their media into one Command. Do not raise a separate Command for each candidate.

On “Matches”, record the identified verdict in `calibration.jsonl` as below, apply U9 gate calibration, stop raising Commands for that asset, and finish the PR. Do not continue generating review rounds after acceptance.

For each checkpoint, post one non-blocking `decision.requested` on the rebuild ticket. Include the comparison still, eight-direction still and animated GIF or MP4 as applicable, plus the score JSON and gates in force. Inspect the media first. Attach the same media to **both** verdict options so either answer can be made from the Command:

```json
{
  "question": "Does this rebuild match the original?",
  "blocking": false,
  "authority": "human_required",
  "reversibility": "reversible",
  "audience": "creator",
  "context": {"authority_basis": "product", "short_summary": "Review this rebuild against its original.", "long_context_markdown": "Give a note with Needs changes. Include the round and gate scores here."},
  "options": [
    {"id": "matches", "label": "Matches", "description": "Accept this visual match.", "media": [{"kind": "image", "mime_type": "image/png", "locator": "/absolute/workspace/path/compare.png", "alt_text": "Original and rebuild comparison"}]},
    {"id": "changes", "label": "Needs changes", "description": "Describe what still differs.", "media": [{"kind": "image", "mime_type": "image/png", "locator": "/absolute/workspace/path/compare.png", "alt_text": "Original and rebuild comparison"}]}
  ],
  "consequence_of_delay": "No answer: internal rounds continue; the open Command stays available."
}
```

Add all applicable still and video entries to each option (local paths must be inside the workspace); do not upload pack assets to cloud services. A variant choice uses up to three labeled candidates with their media and scores, alongside the verdict choices. Record only an identified, relayed verdict in `calibration.jsonl`, one JSON object per line: `asset`, `class` (a key in `gates.json`), `round`, `head` (the actual full commit SHA for that round), `scores` (the unmodified `score.py` JSON or `compare.py still` per-view JSON), `verdict` (`matches` or `needs changes`), `note`, and ISO 8601 `date`. Keep missing provenance unresolved rather than guessing it.

Use `skills/gm-sprite-forge/scripts/review_checkpoints.py` as the reference checkpoint policy. Its fixture test scripts 30 local rounds and asserts at most four Commands, with at least 10 minutes between them.

Run `python skills/gm-sprite-forge/scripts/calibrate.py skills/gm-sprite-forge/calibration.jsonl > proposal.json`. The proposal is reviewable JSON, never an automatic edit of `gates.json`. For props, the strictest view of each metric is used. A matching verdict relaxes failed numeric gates; recorded gate snapshots determine whether a rejection passed (legacy reports without snapshots use the supplied baseline); a rejection that passes all gates tightens the numeric gate with the smallest relative passing margin, using the next representable value. Conflicting changes are reported and processed in timestamp order, with the later verdict winning. Equality gates cannot be calibrated numerically. Review the proposed changes and land approved gate changes in a PR; regenerate comparisons so they show the gates in force.
