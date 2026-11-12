---
name: gm-dream-loop
description: Compare concept art to a game render with a gated visual judge and iterate on the largest mismatches.
license: MIT
---

# Concept fidelity loop

Adapted from Anshu Chimala's MIT-licensed dream-loop, as distributed by Nous Research. The goal is the creator's
approved style and composition, including stylized art. Search the existing asset library before making assets and follow the project’s creator-decision rules. Never replace an approved concept with a new one without the creator's direction.

1. Use the approved concept and a render of the same subject, view, aspect ratio, size and game state. Fix the camera
   and let the scene settle. Capture a Playwright still using the repository's browser flags; keep inputs and evidence
   locally and obey the asset and broker privacy rules in `gm-image-mock`.
2. Run `gm look score <target.png> <candidate.png> --out <sheet.png> > <score.json>`, then
   `gm look judge <sheet.png> --rubric tiers > <judge.json>`. The broker supplies a fresh-context comparison. Keep
   both JSON outputs, the sheet, and its `<sheet.png>.json` provenance sidecar together for every iteration. Read the result and inspect the actual images: a model can mistake
   a crop, game state, orientation or background for an asset defect. Do not treat a numerical score as proof alone.
3. Work in the judge's gated order: silhouette and shape, light and colour, material and shine, then fine detail. A
   later tier counts only after the preceding tiers reach 7. Fix the largest concrete differences first, then capture,
   score and judge again. Measure important positions and sizes as fractions of the image instead of relying on prose.
4. Stop when every tier is at least 8 and inspection confirms matched subject and framing with no unresolved visible
   mismatch. If the judge passed a bad capture or missed a defect, fix the capture or defect and judge again. To detect a stall, select the first tier below 8 and compare its value at the
   start of a three-iteration window with its best value in that window; reset the window when a tier unlocks or
   the first tier below 8 changes. If the gain between medians is less than 0.5 or smaller than either judgment’s reported tier spread after three iterations and no tier unlocks, make one
   structural change and recheck. For example, `[6,null,null,null]`
   to `[7,5,null,null]` unlocks the second tier and counts as progress; continue comparing the first tier until it
   reaches 8, then compare the second tier. Three gains of 0.4 in the same tier total 1.2 and are not a stall;
   if the structural change also stalls, raise a Command with the scored sheet and the remaining differences.
   After judging, rerun `gm look score` to include the cached default-run `judge_spread` in its JSON; it is null until that judgment exists. The spread is the largest absolute deviation from each tier median among the sampled runs, not a guarantee for a new image. Include the latest score JSON, judge JSON and sheet in ready evidence. Publish a sanitized copy of the score JSON
   with workspace-relative or placeholder paths; keep the original score and provenance sidecar local for the judge.
   Never claim a broker failure is a pass.

The upstream reference is `NousResearch/hermes-agent`, `optional-skills/creative/dream-loop`, commit
`78abaafcccec20a546c94e8734a70e38c08a6a69`; its MIT license is included alongside this file.
