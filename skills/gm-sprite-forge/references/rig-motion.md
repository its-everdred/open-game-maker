# Rig and motion (hero Stage 2, #1202)

How a TRELLIS character mesh becomes an animated sprite sheet that is judged against the pack's own animation. The
scripts are in `scripts/motion/`; they run in Blender 4.3 on the CPU (`tools/blender.sh` puts the forge venv's NumPy
and SciPy on Blender's path). Animation waits behind an approved static sprite (SKILL.md); the tooling can be
debugged on any mesh, but only an approved mesh goes to a creator review.

## Steps

1. **Rig (arm A).** `fit_rig.py` normalises the mesh (front -Y, feet at 0, 1.8 m: bone heat does not solve on tiny
   meshes) and finds joints from 200k surface samples: the centre line between the feet, the crotch where the gap
   between the thighs closes (a hem that flares above the gap is treated as cloth; then 0.44 H), ankles and knees on each
   leg's slices (the knee at 53% from ankle to hip), shoulders where the body widens below the head, and wrists and
   elbows along each arm's own connected component (a fused weapon is cut off 0.42 H from the shoulder). A Rigify
   basic-human metarig is moved onto those joints and used directly as the deform rig.
2. **Skin.** Bone heat. TRELLIS meshes are not manifold and heat leaves every vertex unweighted, so the fallback
   remeshes a copy into closed voxels, runs bone heat on it and transfers the weights back by nearest face. Below the
   crotch, weight on the other leg's bones is moved to this leg's (fused thighs).
3. **Motion.** `retarget.py` takes a KayKit GLB action or a BVH take. Each bone's orientation is built from joint
   positions only (its direction, plus an axis across the body or the knee/elbow hinge), on the source and on the
   target alike, so the source's rest pose does not matter (Bandai's BVH rest pose lies along +X). Walk takes are cut to
   one steady cycle (left heel strike to the next), turned to walk toward -Y and made in-place; attack takes are cut
   around the fastest hand movement. The hips' travel is scaled by the leg-length ratio, stance width is corrected to
   the target's hips, and the loop seam is spread over the cycle. `handkey.py` keys a walk (contact / down / passing /
   up, heel-to-toe roll, hip sway and turn, arms against the legs) and two attacks (`chop`, and `combo` on the pack
   Attack1 beat).
4. **Stance.** Kevin (#1120, 2026-11-22): stance changes belong to the rigging step. `retarget.STANCES` holds additive
   pose layers; `ssi-barbarian` hunches the chest, pushes the head out, hangs the arms in front and crouches 5% of a
   leg. Every motion source gets the same layer.
5. **Feet.** The foot lock keeps each planted ankle on one ground speed (a loop) or in place (an attack), then a
   two-bone IK pass solves thigh and shin to it and lowers the hips if a leg cannot reach.
6. **Render and score.** `render_motion.py` renders S and SE through the pack camera (same projection and scale rule as
   `gpu_bake_rig.py`), caching the fitted rig per mesh. `score_cell.py` finishes the frames with `gpu_bake_finish.py`,
   scores them with `score.py`, picks the loop's first frame by motion correlation (a walk has no fixed start), and
   measures foot slide: on contact frames (sole within 1 px of its lowest), how far the touching point (heel or ball)
   strays from the clip's ground speed, in pixels at the pack cell.
7. **Batch and media.** `run_cells.py` runs a list of cells one Blender at a time and writes each cell's `recipe.json`
   (`ai_generated: true`, motion licence). `matrix_media.py` builds the review matrix: the pack animation in column 1,
   up to six cells, S and SE, looping GIF and phone MP4 at 1x and 4x with kind, model, cost, skill and scores on every
   cell. `strip.py` makes a quick zoomed strip for looking.

```sh
B=assets-local/experiments/sprite-pipeline/fal-arm-e/tools/blender.sh   # Blender + forge venv
python -I scripts/motion/run_cells.py cells.json out/ --engine workbench   # fast mask-only pass for scoring
python -I scripts/motion/run_cells.py cells.json out/ --engine cycles      # review renders
python -I scripts/motion/matrix_media.py media/ <pack Walk sheet> "Walk" out/A-handkey-walk out/A-cmu-07_01 ...
$B --python scripts/motion/fit_accuracy.py -- fitacc.json 43 <rigged.fbx[:mesh]> ...   # landmark error in px
```

`cells.json`: `{"mesh", "rotz", "blender", "stance", "model", "pack": {"walk", "attack"}, "render": {...},
"cells": [{"name", "clip": "walk"|"attack", "motion": {"kind": "kaykit"|"bvh"|"handkey", "path", "action",
"params", "loop", "foot_ik"}}]}`.

## Motion sources and licences

| Source | Licence | Notes |
|---|---|---|
| KayKit Character Animations (owned) | CC0 | Rig_Medium GLBs; chunky proportions (arms held wide) |
| CMU mocap (BVH mirror `una-dinosauria/cmu-mocap`) | free for any use | 120 fps takes; cycle picked automatically |
| Bandai Namco Research Motion | CC BY-NC 4.0 | styled walks (giant, proud, ...) and slashes; rest pose along +X |
| LaFAN1 (Ubisoft) | CC BY-NC-ND 4.0 | ND: retargeted output stays private |
| 100STYLE | CC BY 4.0 | 1.5 GB zip; not downloaded in #1202 |
| Hand-keyed (`handkey.py`) | own | the only source tuned to the pack's timing |

Mocap files live under `assets-local/experiments/sprite-pipeline/hero-s2/mocap/` with their licence files; never in the
repository.

## Findings (#1202, Stage 1 Warrior mesh, debug only)

See the PR for the full tables. In short:

- **Calibration.** Pack walks scored against the 6Barbarian Walk: reskins of the same animation (3Nomad, 4Berserker)
  0.97; every other SmallScaleInt character's walk 0.0-0.6. Motion correlation >= 0.7 therefore means "the pack's own
  animation", not "a good walk"; retargeted libraries score where the pack's other walks do (0.2-0.5).
- **Rig fit.** On rigged ground-truth characters in A-pose (Kenney, Synty), knees and elbows land within about 1-2 px
  at a 43 px sprite; knees are placed by proportion, so a mesh with unusual leg proportions moves them.
- **Bone heat** fails on every vertex of raw TRELLIS meshes; the voxel proxy fixes it.
- **Feet.** Copying rotations (Blender's built-in route) slides 2.5 px per contact frame; the own lock + IK pass keeps
  0.1-0.5 px. Rokoko's retarget add-on was not tried (it needs an account sign-in).
- **Not run:** arm B (UniRig needs a CUDA GPU with 8 GB or more; the NUC has none, the PC is off-limits) and arm C
  (`fal-ai/meshy/rigging` is listed at 0.80 USD per call, not the planned 0.32; skipped without spend).
