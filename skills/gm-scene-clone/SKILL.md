---
name: gm-scene-clone
description: Use when rebuilding an approved visual scene mock in a real game, especially during prototype work. Identify available assets and gaps, preserve scene intent and compare an in-engine capture with the approved mock.
---

# Rebuild an approved scene

Start from the creator's approved image and notes. Record its identity and image dimensions, the game revision,
viewport and camera; keep private images and pack files local. Follow `gm-assets` for pack search and rights,
`gm-asset-variants` for derived pieces, and `gm-verify` for real-game captures and review media.

1. Read the scene as a whole: focal point, action, mood, light, paths and depth. Identify objects and connected
   structures, including small dressing. For each, record an image region, likely pack candidates, facing, ground
   contact, scale relative to a character, layer and occlusion. Mark an unknown as unknown, with its reason; a
   top-three miss or an incomplete search is not proof that the kit lacks an asset. Inspect candidate sprites at
   the intended camera and facing. Mixed crops, transparent padding and generated details can mislead embeddings.
   Write the regions as a brief (format in `docs/reference/cli.md`), run `gm scene match` once per pack and facing,
   then `gm scene identify` on its output; read `complete` and `truncated` before calling anything a gap.
2. Record structure as intent: fence runs and openings, building footprint and door, and routes between entries.
   Use the game's editable scene data and its pack adapter; do not substitute a baked picture or one-off drawing
   for scene data. Use connected-structure assemblers when available, and identify missing pieces for a variant
   or assembly instead of silently omitting them. Do not claim that provisional grid anchors or an unverified
   cardinal facing are measured facts. Check the placed scene with `gm verify scene`.
3. Register the mock's ground plane only from validated image-to-grid correspondences; check footpoints and height
   separately. Preserve paths, entries and creator-authored edits while placing and dressing the scene. A single
   homography cannot recover height or make different cameras and layouts equivalent.
   `gm scene compare-ground` takes four reviewed reference-to-render ground points and the regions to score.
4. Capture the actual game at the mock's viewport, camera centre and character scale. Inspect the reference,
   render and overlay at phone size and relevant close-ups. Report framing or coverage failures before pixel
   metrics: an unregistered pair cannot produce a valid per-region fidelity score. Its `--out` sheet is the overlay.
   Keep score history and rank
   concrete differences such as missing elements, facing, scale, sparse dressing and broken structures; do not
   infer their cause from SSIM alone. Fix the worst observed difference, recapture and repeat.
5. Deliver the real-game comparison and playable evidence required by the current prototype rung. State what was
   inferred, checked by eye, measured or left unknown. Do not call a scene complete solely because it rendered or
   a metric improved. Follow the current creator-review workflow on the same ticket.
