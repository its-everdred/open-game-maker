---
title: "feat: Sprite rebuild pipeline (gm-sprite-forge) and review lane"
type: feat
status: active
date: 2026-11-19
origin: docs/research/2026-11-19-sprite-pipeline/requirements.md
---

# feat: Sprite rebuild pipeline (gm-sprite-forge) and review lane

## Overview

New pack-matching sprites will be made the way SmallScaleInt made theirs: render 3D models through a calibrated isometric Blender rig, then finish them to the pack's sprite contract. The pipeline earns trust by rebuilding four existing pack sprites to numeric score gates, reviewed by Kevin in a standing review lane, before it makes anything new. Evidence and measurements: `docs/research/2026-11-19-sprite-pipeline/report.md`.

Plan written non-interactively (ce-plan in pipeline mode). Repo research was done directly in this session (report §1–§6), so the research-agent fan-out was skipped.

---

## Problem Frame

See origin. In short: Dusk Helm needs sprites the packs lack, AI image mocks were rejected as off-style, and the packs are 3D renders. That leaves copying the render as the only route that holds a style across 8 directions × 15 frames.

---

## Requirements Trace

- R1–R3 style spec, harness, scorer → U1, U2
- R4 four rebuilds → U5–U8
- R5–R9 review lane (rounds, non-blocking Commands, standing feature, verdict calibration, reusable comparison renderer) → U3, U4, U9
- R10–R11 generation through the same gates, AI-generated marking → U10–U12 (Phase 3)

**Origin actors:** A1 Kevin, A2 Codex worker, A3 Executor
**Origin flows:** F1 rebuild round (U4, U5–U8), F2 new sprite (U10–U12)

---

## Scope Boundaries

- No 2D AI sprite generator as the production path (concept art only). No paid tools, keys or GPU.
- One animation per reference character (Walk) proves the rig; the full animation sets come later, on demand.
- No Dusk Helm sprite generation until Phase 2's gate passes.

### Deferred to Follow-Up Work

- `gm sprite` CLI verbs wrapping the scripts: after Phase 2 shows which calls workers actually repeat.
- Moving the review lane into the OGM app Review screen: core #843.

---

## Context & Research

### Relevant Code and Patterns

- Prototype scripts (measured and run on this host 2026-11-19): `docs/research/2026-11-19-sprite-pipeline/scripts/`. These are `spritemetrics.py`, `measure_sheet.py`, `study.py`, `score.py`, `compare.py`, `finish.py`, `blender_iso_rig.py` and `carve_hull.py`. Phase 1 ports them into the skill. It doesn't rewrite them.
- `skills/gm-asset-variants/SKILL.md`: the clone-never-edit rules, variant manifests, `style-check.py` pattern (a script that fails a variant off the pack's numbers).
- `skills/gm-image-mock/`, `skills/gm-3d/`: neighbouring skills; the new skill links rather than duplicates.
- `skills/vendor/`, `.aiur/config` `skills.by_label`: how a skill reaches workers (core workers read `skills/`; OGS workers get `~/ogm-stack/skills` after auto-update).

### External References

See report §5 (author statements, FoozleCC's 8-direction render script, Blender pixel-art settings, CPU image-to-3D options and licences).

---

## Key Technical Decisions

- **Home layer: OGM core**, as a new skill `skills/gm-sprite-forge/` with its scripts, the SmallScaleInt style spec as a reference, and `gates.json`. Every game on any SmallScaleInt-style pack uses it. Dusk Helm-specific assets (Phase 3) live in open-games `games/dusk-helm/sprites/variants/` with a manifest, per gm-asset-variants.
- **Blender 4.3 + Cycles on CPU**, headless. No GPU here; EEVEE headless is unproven. Shading is emission by `normal·light` through a constant ColorRamp: deterministic, three or four bands, no sampling noise on the object. A shadow catcher gives the soft contact shadow. Pixel filter 0.01 gives hard edges.
- **Camera from measurement, not from the author's words.** The author said "45 degrees". The tiles measure 2:1 dimetric: orthographic, 60° from vertical, yaw 45°, a 1×1 tile drawn as a 128×64 diamond, origin at pixel (128, 208) in a 256 px view. Our render matches the pack diamond row for row.
- **Silhouette-carved proxies for rebuilds.** A visual hull carved from the pack's own views separates "is the renderer right?" from "is the model right?". Rebuild gates use it for props. New assets can't (they have no views), so Phase 3 relies on models.
- **Characters need a mesh source.** In order of preference: (1) an existing CC0 rigged humanoid (Quaternius, KayKit) refit to the knight's proportions; (2) image-to-3D on CPU (Stable Fast 3D, TripoSR) or the free TRELLIS.2 HF Space from a pack frame used as a reference, which is allowed as a mock reference only and is decided per ticket (see Risks); (3) hand blockout. Animation comes from Mixamo or the CC0 libraries, retargeted with Rokoko or Expy Kit. Every sheet resamples each animation to 15 frames per direction.
- **Gates are data**: `gates.json` per asset class (prop, character-64, character-128). Kevin's verdicts move them (U9).

### Proposed initial gates (calibrated by Kevin's verdicts)

| Metric (mean over views/frames) | Prop | Character | Rock v2 (primitive) | Rock v3 (carved hull) |
|---|---|---|---|---|
| silhouette_iou (at the pack anchor) | ≥ 0.90 | ≥ 0.80 | 0.58 | 0.96 |
| pixel_similarity | ≥ 0.95 | ≥ 0.93 | 0.91 | 0.92 |
| palette_distance | ≤ 4 | ≤ 6 | 1.7 | 1.6 |
| edge_f1 (1 px tolerance) | ≥ 0.70 | ≥ 0.60 | 0.21 | 0.96 |
| lum_hist_l1 | ≤ 0.20 | ≤ 0.25 | 0.48 | 0.70 |
| shadow_iou | ≥ 0.60 | ≥ 0.50 | 0.14 | 0.53 |
| frames_match / motion_corr | n/a | true / ≥ 0.70 | n/a | n/a |

---

## Open Questions

### Resolved During Planning

- Which rock and shop: Stone A12 (simple boulder) and Misc B17 (red-canopy market stall). Both are in `smallscaleint-fantasy-tileset-2d-isometric`.
- Which knight and goblin: `smallscaleint-2d-character-knight` 1Knight `Walk_Shadowless` (64 px cells) and `smallscaleint-2d-orcs-and-goblins-topdown` "Seperate shadows and effects/Goblin 01/Walk" (128 px cells).
- Direction order of sheet rows: row r is yaw (360 − 45r) mod 360, so E, SE, S, SW, W, NW, N, NE (matched against the per-angle frame folders).

### Deferred to Implementation

- The characters' light and render scale. The author says they are lit "straight from above"; the cell foot line sits at y ≈ 42 (64 px) and y ≈ 90 (128 px). Fit these in U7.
- Whether a CPU image-to-3D mesh holds up at 20–40 px tall: the U8 experiment.
- Prop yaw order (N/E/S/W against the rig's turns). The carve picks the order that keeps the most volume; confirm it in U5.

---

## Output Structure

    skills/gm-sprite-forge/
      SKILL.md
      references/smallscaleint-style.md      # the measured spec (report section 2)
      references/review-lane.md              # how to post a round
      gates.json                             # thresholds per asset class
      calibration.jsonl                      # verdict log (round, scores, verdict)
      scripts/  spritemetrics.py measure_sheet.py score.py compare.py finish.py
                blender_iso_rig.py carve_hull.py calibrate.py
      tests/    test_metrics.py test_score.py test_compare.py test_calibrate.py (synthetic sprites only)

---

## Implementation Units

### Phase 1: style spec, harness, scorer, review tool (core)

- [ ] U1. **gm-sprite-forge skill + SmallScaleInt style spec + measurement harness**

**Goal:** A worker can measure any sheet or prop and compare it with the written spec.
**Requirements:** R1, R2
**Dependencies:** none
**Files:** create `skills/gm-sprite-forge/SKILL.md`, `references/smallscaleint-style.md`, `scripts/spritemetrics.py`, `scripts/measure_sheet.py`; test `skills/gm-sprite-forge/tests/test_metrics.py`
**Approach:** Port the research scripts. The spec is report §2's numbers, each naming the script that measured it. Pack files are read in place and never written (gm-asset-variants rules).
**Test scenarios:** Happy path: a synthetic 64 px sheet with known silhouettes gives the right frame counts, bbox and colours. Edge case: an empty cell is not counted as a frame. A near-black partial-alpha shadow is excluded from the object mask and counted by the shadow mask. An all-transparent image returns `None` metrics, not a crash.
**Verification:** `measure_sheet.py` on the knight Walk sheet reproduces the report's numbers (15×8 grid, 27 sheet colours, binary alpha).

- [ ] U2. **Comparison scorer + gates**

**Goal:** `score.py` gives every metric in the gates table for props (per view) and sheets (per frame, plus frame and motion checks), and says pass or fail against `gates.json`.
**Requirements:** R3
**Dependencies:** U1
**Files:** `scripts/score.py`, `gates.json`; test `tests/test_score.py`
**Test scenarios:** An identical image scores IoU 1, similarity 1, palette 0. A 3 px shift drops raw IoU but keeps best IoU at 1 and reports shift [3,0]. A recoloured copy keeps IoU 1 and raises palette distance. A sheet with one frame missing gives `frames_match` false. A size mismatch is a clear error. The pass/fail verdict flips exactly at the gate value.
**Verification:** scoring the 2026-11-19 rock proof reproduces the logged numbers.

- [ ] U3. **Comparison renderer (review media tool)**

**Goal:** Any worker makes Kevin's review media for any asset with one call: for sheets, an animated original|rebuild GIF and an H.264 MP4 per direction (phone-safe: ≤ 1280 px, Main ≤ 4.1), a still of all 8 directions, and scores; for props, a still sheet of all 4 views with a diff heatmap and scores.
**Requirements:** R5, R9
**Dependencies:** U2
**Files:** `scripts/compare.py`; test `tests/test_compare.py`
**Test scenarios:** A synthetic 2-direction sheet makes 2 GIFs with 15 frames each at the requested fps. The MP4 passes an ffprobe check (yuv420p, even dimensions, Main profile). The still carries the score line. The diff heatmap of an identical pair is all green.
**Verification:** media for the rock proof opens on a phone (gm-verify rule: look before sending).

- [ ] U4. **Calibrated iso render rig + finishing + hull carving**

**Goal:** Render any mesh in the pack's projection, shading, shadow and alpha contract, for 4 prop views or 8 directions × N frames, laid out as the pack's sheets.
**Requirements:** R4 (enabler), R10
**Dependencies:** U1
**Files:** `scripts/blender_iso_rig.py`, `scripts/finish.py`, `scripts/carve_hull.py`; test `tests/test_rig.py` (headless Blender, a 1×1 tile and a cube)
**Approach:** Port the research rig. Add: 8-direction yaw order matching the sheet rows; animation frame sampling (render N frames, keep 15 evenly spaced); sheet assembly (15×8 cells); a `--shadow-sheet` output (the goblin pack's separated shadows); output manifest with `ai_generated` and `derived_from`.
**Test scenarios:** The calibration tile's top-face rows match Ground A1 within 1 px at rows 176/192/208. A cube turned 90° gives the 4 views in the pack's order. Sheet assembly puts yaw 0 in row 0 and yaw 45 in row 7. `finish.py` leaves no partial-alpha coloured pixels, and shadow pixels end up pure black.
**Verification:** the rig test passes in a worker sandbox on CPU within 5 minutes.

### Phase 2: four reference rebuilds (core, one ticket each, under the review lane)

Each rebuild runs F1 rounds (U9) until its gates pass and Kevin marks "matches".

- [ ] U5. **Rebuild Stone A12 (rock).** Start from the proof's v3 carved hull (it already passes silhouette and edge). Remesh or smooth it, give the pebbles their own material, and fit a sun plus fill light jointly to the bands and the shadow. Gate: prop gates on all 4 views. Dependencies: U2, U3, U4.
- [ ] U6. **Rebuild Misc B17 (market stall).** A multi-material prop: canopy cloth, wooden frame, goods. Gate: prop gates on all 4 views. Dependencies: U2, U3, U4. Note: a 4-view hull fails on the open frame (thin poles, see-through), so this one needs a modelled mesh. It is the test case for hard-surface modelling.
- [ ] U7. **Rebuild Knight Walk (64 px).** Humanoid mesh, rig, walk clip, 8 directions × 15 frames, Shadowless sheet. Gate: character gates. Dependencies: U2, U3, U4. Fits the character light and scale.
- [ ] U8. **Rebuild Goblin 01 Walk (128 px) + shadow sheet.** Tests image-to-3D on CPU against a hand blockout for the mesh; reports which one passed. Gate: character gates plus shadow_iou on the separate shadow sheet. Dependencies: U2, U3, U4; U7's character light and scale findings.

### Review lane (core; standing)

- [ ] U9. **Standing review lane + verdict calibration**

**Goal:** Rounds keep flowing and Kevin's verdicts set the gates.
**Requirements:** R5–R8
**Dependencies:** U2, U3
**Files:** `skills/gm-sprite-forge/references/review-lane.md`, `scripts/calibrate.py`, `calibration.jsonl`; test `tests/test_calibrate.py`
**Approach:** A round is the U3 media plus scores, raised as a non-blocking aiur Command on the rebuild ticket. Options: "Matches" and "Needs changes" (note), with the media on each option. The worker keeps iterating. The Executor relays answers (CLAUDE.md flow) and appends `{asset, round, scores, verdict, note}` to `calibration.jsonl`. `calibrate.py` then proposes new gates. A "matches" round below a gate lowers that gate to the lowest matching score; a "needs changes" round that passed every gate raises the gate on its weakest metric to just above its score. A gate change is a PR, and the review page shows the gate in force for each round.
**Test scenarios:** A "matches" verdict at IoU 0.86 against a gate of 0.90 proposes 0.86. A "needs changes" verdict at IoU 0.93 that passed every gate proposes raising the weakest metric. Conflicting verdicts on the same scores: the later verdict wins, and the conflict is reported. An unknown asset class is an error.
**Verification:** the first two relayed verdicts appear in `calibration.jsonl`, and the proposed gates diff is readable.

### Phase 3: new assets (open-games, Dusk Helm; after Phase 2 passes)

- [ ] U10. **A Dusk Helm townsperson** (character pipeline, 8 directions × Idle and Walk).
- [ ] U11. **Elite goblin variant**: kitbash or recolour first (gm-asset-variants); the 3D route only if a recolour can't carry it.
- [ ] U12. **Market stall variant**: from U6's model, with new cloth and goods.

Each U10–U12 asset passes the spec-level gates (palette, bands, alpha, outline, frame count) and an in-game lineup beside pack sprites, then gets a Kevin round. AI-generated marking goes in each manifest. Tickets are filed when Phase 2 closes.

---

## System-Wide Impact

- **Worker sandbox:** rebuild outputs go to `assets-local/experiments/sprite-pipeline/<asset>/`. Codex workers can write only `assets-local/sets` (plus review on Open-Games), so that folder needs adding to `writableRoots` in `.aiur/config` before U5–U8 dispatch (CLAUDE.md, #686).
- **Host load:** Cycles on CPU at 256 px renders in about 10–60 s per view on this host under fleet load (load 56). A character sheet (120 frames) is roughly 20–60 min. Keep renders `nice`d, and one rebuild worker at a time.
- **Unchanged:** pack files (read only), gm-image-mock (mocks stay mocks), the Dusk Helm hold.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Character meshes at 20–40 px can't reach IoU 0.80 because limbs are 1–2 px | Character gates are per-class and calibrated by Kevin; motion_corr and the eye matter more than exact pixels |
| Paid-pack frames sent to cloud image-to-3D | Default to local CPU tools. A cloud HF Space gets pack frames only under the mock-reference exception, and the ticket must say so. Otherwise use a description and hand blockout |
| Blender not reachable in the worker sandbox | U4 test proves it first; fallback is host-run renders staged by the Executor (host-steps) |
| Score gates reward the wrong thing (numbers pass, eye fails) | Every round goes to Kevin; U9 moves the gates |
| Licences: Hunyuan3D excludes the EU, UK and KR; Tripo and Rodin free tiers are non-commercial | Use MIT or Stability-community tools only (report §5) |

---

## Sources & References

- Origin: `docs/research/2026-11-19-sprite-pipeline/requirements.md`
- Report: `docs/research/2026-11-19-sprite-pipeline/report.md`; measurements in `style-measurements.json`
- Related: `skills/gm-asset-variants/SKILL.md`, `skills/gm-image-mock/SKILL.md`
