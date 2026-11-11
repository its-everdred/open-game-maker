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
2. Run `gm look score <target.png> <candidate.png> --out <sheet.png>`, then
   `gm look judge <sheet.png> --rubric tiers`. The broker supplies a fresh-context comparison. Save the score JSON,
   sheet and judge JSON together for every iteration. Read the result and inspect the actual images: a model can mistake
   a crop, game state, orientation or background for an asset defect. Do not treat a numerical score as proof alone.
3. Work in the judge's gated order: silhouette and shape, light and colour, material and shine, then fine detail. A
   later tier counts only after the preceding tiers reach 7. Fix the largest concrete differences first, then capture,
   score and judge again. Measure important positions and sizes as fractions of the image instead of relying on prose.
4. Stop when every tier is at least 8. If three iterations fail to gain 0.5, make one structural change and recheck;
   if that also stalls, raise a Command with the scored sheet and the remaining differences.
   Include the latest score JSON, judge JSON and sheet in ready evidence. Never claim a broker failure is a pass.

The upstream reference is `NousResearch/hermes-agent`, `optional-skills/creative/dream-loop`, commit
`78abaafcccec20a546c94e8734a70e38c08a6a69`; its MIT license is included alongside this file.
