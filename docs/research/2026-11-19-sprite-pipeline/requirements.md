---
date: 2026-11-19
topic: sprite-rebuild-pipeline
---

# Sprite rebuild pipeline: requirements

Brainstorm output (ce-brainstorm, run non-interactively: the brief's author answered from the evidence in `report.md`). Scope: Deep, feature tier: OGM's product shape is settled; this adds one capability to it.

## Problem Frame

Dusk Helm is built on SmallScaleInt packs. Kevin rejected every AI image mock on 2026-11-19: they were painted and far more detailed than the packs. After the mock phase the game needs sprites the packs don't have, such as new enemies, props, buildings, class variants and animations. They must be indistinguishable from the pack. 2D image generation can't hold a 3D-rendered style across 8 directions × 15 frames. The pack itself was made by rendering 3D models (the author's own words plus our measurements), so the reliable route is to copy that process. We prove it by rebuilding existing pack sprites and scoring the rebuilds against the originals.

## Actors

- A1. Kevin: reviews rebuild rounds and new sprites; his "matches" verdicts set what "close enough" means.
- A2. Codex worker: runs the rig, iterates a rebuild until it meets the score gates, and posts each round.
- A3. Executor: relays Kevin's verdicts, runs host-only steps, and recalibrates thresholds from verdicts.

## Key Flows

- F1. Rebuild round
  - **Trigger:** a rebuild ticket for one reference asset runs, or the rig improves.
  - **Actors:** A2, A1, A3
  - **Steps:** The worker renders the asset, scores it and makes the comparison media: an animated original-vs-rebuild clip per direction plus an 8-direction still, with the numbers. It raises a non-blocking Command ("matches" / "needs changes" + note) with the media on each option, then keeps iterating. Kevin answers. The Executor relays the answer and records the verdict against that round's scores.
  - **Outcome:** a scored, reviewed round. A "matches" verdict becomes a calibration point.
  - **Covered by:** R5–R9
- F2. New sprite
  - **Trigger:** a game needs a sprite the packs lack (gated until Phase 2 passes).
  - **Actors:** A2, A1
  - **Steps:** Kitbash or recolour if that covers the need. Otherwise model or source a mesh, rig it, retarget a clip, render it through the same rig, and pass the style gates (no original exists, so only the spec-level metrics apply). Kevin reviews it in-game.
  - **Covered by:** R10, R11

## Requirements

**Style spec and measurement**
- R1. A written, measured SmallScaleInt style spec: projection, cell sizes, direction order, frame counts, colour counts, shading bands, light, shadow handling, alpha, and HD vs 64 px.
- R2. A measurement harness that reports the same numbers for any sheet or prop, so a new asset can be checked against the spec.
- R3. A comparison scorer for original vs rebuild: per-frame pixel similarity, palette distance, silhouette IoU, edge (outline) match, luminance distribution, shadow match, frame count and motion.

**Rebuilds**
- R4. Rebuild four references to agreed score gates: Knight (64 px warrior), Goblin 01 (orcs and goblins), Stone A12 (rock) and a shop or market building (isometric tileset, assembled from its modular wall and roof pieces).

**Review lane (Kevin, 2026-11-19)**
- R5. Every rebuild iteration posts a review round: original vs rebuild side by side as an animated GIF or MP4 of the same animation and direction, plus a still sheet of all 8 directions (all 4 views for props), with the scorer's numbers.
- R6. A round is a non-blocking aiur Command on its rebuild ticket, with media on each option ("matches" / "needs changes" + note). The worker keeps iterating meanwhile.
- R7. One standing feature/epic, "Sprite rebuild review lane", holds the per-asset rebuild tickets so rounds keep flowing as the pipeline improves.
- R8. Kevin's verdicts feed the scorer thresholds. A round marked "matches" makes its scores a passing example, and a "needs changes" above the gate tightens the gate.
- R9. The comparison renderer is a reusable tool in the harness: any worker can produce the side-by-side for any asset.

**Generation (after Phase 2)**
- R10. New sprites go through the same rig and must pass the spec-level gates before review.
- R11. Every generated or AI-assisted output is marked AI-generated in its metadata. Pack files leave the host only as image-generation references for mocks.

## Success Criteria

- Kevin marks all four references "matches" in the review lane, and their scores sit inside the gates.
- A worker given only the skill, the harness and a ticket can produce a scored round without Executor help.

## Scope Boundaries

- No 2D AI sprite generator (PixelLab, Retro Diffusion and similar) as the production path. It is paid, and it can't keep shape consistent across directions. It may be used for concept art only.
- No paid tools or keys (PixelOver, Auto-Rig Pro, Meshy paid). CPU only; no GPU on this host.
- Not reproducing every pack animation; one animation per reference character proves the rig.
- No new Dusk Helm sprites until Phase 2 passes.

## Key Decisions

- **Re-render, don't paint:** the author says "These are all pre-rendered graphics, not hand pixelated", and the measurements agree (report §3).
- **Kitbash before modelling:** recolours and part swaps of pack sprites (how the author's own Character Creator works) come first when they cover the need. They are exact in style at near-zero cost.
- **Score against the pack, calibrate with Kevin:** numbers gate each round, and Kevin's verdicts set the numbers.

## Dependencies / Assumptions

- Blender 4.3 headless with CPU Cycles works here (proved in the rock proof). EEVEE headless without a GPU is unverified.
- Character meshes do not exist anywhere we can get them (the author keeps them private), so the knight and goblin need new or AI-made meshes.

## Outstanding Questions

- Can AI image-to-3D (Stable Fast 3D / TripoSR on CPU, TRELLIS.2 via a free HF Space) give meshes good enough at 20–40 px tall? It decides how much hand modelling Phase 2 needs. Resolve in Phase 2's goblin ticket.
- The exact character render scale and light, which the props don't share (sun from the right for tiles, straight down for characters). Resolve in the knight ticket.

## Next Steps

→ `docs/plans/sprite-pipeline/plan.md` (ce-plan), then tickets for Phases 1–2 and the review lane.
