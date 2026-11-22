# Rig and motion (hero Stage 2, #1202)

How a TRELLIS character mesh becomes an animated sprite sheet judged against the pack's own animation. Everything runs
locally on the CPU, costs nothing and sends nothing to a cloud service.

**Gate.** Animation waits behind an approved static sprite (SKILL.md). The one exception is the #1202 ticket's: the
tooling may be built and debugged on an existing mesh as a test subject, with no creator review of the result. Only an
approved mesh goes into review media. `run_cells.py` does not check this; you do.

## What runs where

| Script | Runs in | Role |
|---|---|---|
| `scripts/motion/run_cells.py` | `gm py --` | Batch driver: one Blender at a time per cell, then scoring and `recipe.json` |
| `scripts/motion/render_motion.py` | Blender | One cell: fit (or reuse the cached fit), skin, motion, render S and SE, write `feet.json` |
| `scripts/motion/fit_rig.py`, `retarget.py`, `handkey.py` | Blender (modules) | Reached through `render_motion.py`; not commands |
| `scripts/motion/score_cell.py` | `gm py --` | Finish frames, `score.py` metrics, loop phase, foot slide -> `scores.json` |
| `scripts/motion/matrix_media.py` | `gm py --` (needs ffmpeg with libx264) | Review matrix: pack column plus at most 6 cells, GIF + MP4, 1x and 4x |
| `scripts/motion/strip.py` | `gm py --` | Quick zoomed strip for looking: `strip.py <cell_dir> <out.png> [rows=1,2] [zoom=3] [ref=<pack sheet>]` |
| `scripts/motion/fit_accuracy.py` | Blender | Landmark error against rigged characters; exits 1 if any case fails |

Blender 4.3 needs the `gm py setup` environment's NumPy and SciPy (the glTF importer needs NumPy too). Use a wrapper
such as `PYTHONPATH=<gm py env>/lib/python3.13/site-packages nice -n 10 blender -b --factory-startup
--python-use-system-env --python-exit-code 1 "$@" < /dev/null` and give its path as `blender` in `cells.json`. Run one
Blender at a time on the NUC.

## Steps (what `render_motion.py` does per cell)

1. **Rig (arm A).** `fit_rig.py` normalises the mesh (front -Y, feet at 0, 1.8 m: bone heat does not solve on tiny
   meshes) and finds joints from 200k surface samples: the centre line between the feet, the crotch where the gap
   between the thighs closes (a hem that flares above the gap counts as cloth; then 0.44 H), ankles and knees on each
   leg's slices (the knee at 53% from ankle to hip), shoulders where the body widens below the head, and wrists and
   elbows along each arm's own connected component (a fused weapon is cut off 0.42 H from the shoulder). A Rigify
   basic-human metarig is moved onto those joints and used directly as the deform rig. `landmarks.png` shows the fit.
2. **Skin.** Bone heat. TRELLIS meshes are not manifold and heat leaves every vertex unweighted, so the fallback
   remeshes a copy into closed voxels, runs bone heat on it and transfers the weights back by nearest face. Below the
   crotch, weight on the other leg's bones moves to this leg's (fused thighs). The fit is cached in
   `<out>/rig_cache.blend` and refitted when the mesh, its turn or `fit_rig.py` changes.
3. **Motion.** `retarget.py` takes a KayKit GLB action or a BVH take. Each bone's orientation is built from joint
   positions only (its direction, plus an axis across the body or the knee or elbow hinge), on the source and on the
   target alike, so the source's rest pose does not matter (Bandai's BVH rest pose lies along +X). A walk take is cut to
   one steady cycle (left heel strike to the next), turned to walk toward -Y and made in place; an attack take is cut
   around its fastest hand movement. Hip travel is scaled by the leg-length ratio, stance width is corrected to the
   target's hips and the loop seam is spread over the cycle. `handkey.py` keys a walk (contact, down, passing, up,
   heel-to-toe roll, hip sway and turn, arms against the legs) and two attacks: `chop`, and `combo` on the pack Attack1
   beat.
4. **Stance.** Kevin (#1120): stance changes belong to the rigging step. `retarget.STANCES` holds additive pose layers;
   `ssi-barbarian` (the only one so far) hunches the chest, pushes the head out, hangs the arms in front and crouches 5%
   of a leg. Every motion source in a batch gets the same layer.
5. **Feet.** The foot lock keeps each planted ankle on one ground speed (a loop) or in place (an attack). A two-bone IK
   pass then solves thigh and shin to it and lowers the hips when a leg cannot reach.
6. **Render.** S and SE (sheet rows 2 and 1) through the pack camera, with the same projection and scale rule as
   `gpu_bake_rig.py`: the rig's rest pose in the S view is scaled to `height_px`. `engine=workbench` renders flat
   silhouettes in seconds for scoring; `engine=cycles` renders the review frames.

`score_cell.py` then finishes the frames with `gpu_bake_finish.py` (colour pass against the pack sheet), scores them with
`score.py`, picks a loop's first frame by motion correlation (a walk has no fixed start; an attack is scored as
rendered) and measures foot slide. On contact frames (sole within 1 px of its lowest), it follows the point touching
the ground (heel or ball) and measures how far it strays from the ground's motion: one speed against the facing for a
loop, none for an attack, in pixels at the pack cell.

## cells.json

```json
{"mesh": "assets-local/.../model_mesh.glb", "rotz": 0, "blender": "<wrapper above>", "stance": "ssi-barbarian",
 "model": "TRELLIS multi-view mesh (Stage 1 Warrior, $0.02)", "cost_usd": 0,
 "pack": {"walk": "<pack>/Walk_Shadowless.png", "attack": "<pack>/Attack1_Shadowless.png"},
 "render": {"height_px": 43, "origin_row": 88, "samples": 32, "supersample": 2, "threads": 6},
 "cells": [
  {"name": "A-handkey-walk", "clip": "walk", "motion": {"kind": "handkey", "params": {"stride": 0.65, "arm": 16}}},
  {"name": "A-kaykit-chop", "clip": "attack",
   "motion": {"kind": "kaykit", "path": "<KayKit>/Rig_Medium_CombatMelee.glb", "action": "Melee_1H_Attack_Chop"}},
  {"name": "A-bandai-walk", "clip": "walk", "motion": {"kind": "bvh", "path": "<mocap>/bandai/<take>.bvh"}}]}
```

- `pack` needs only the clips used. `model`, `cost_usd` and a cell's `arm` go into `recipe.json`.
- `render` keys: `rows` (default `1,2`; scoring follows it), `frames` (15), `cell` (128), `height_px`, `origin_row`,
  `samples`, `supersample`, `threads`, `sun_elev`, `sun_az`, `sun_energy`, `sky`. Use the pack class's Stage 1 values
  for `height_px` and `origin_row` (Warrior 43 and 88).
- `motion`: `kind` is `kaykit`, `bvh`, `handkey` or `none`. `loop` defaults to true for a walk and false for an attack.
  `foot_ik` defaults to true (false copies rotations only). `frames: [f0, f1]` overrides the automatic cut. For an
  attack BVH, `seconds` (1.1) and `fps` (30; CMU is 120) size the window.
- Hand-keyed `params`: walk `stride`, `lift`, `bob`, `sway` (fractions of leg length), `yaw`, `lean`, `arm` (degrees),
  `elbow` ([min, max] degrees); attack `keys` (`chop` or `combo`) and `step`.
- `weapon` (per cell or top level): `{"path": glb, "bone": "hand.R", "length": 0.3, "grip": 0.25, "spin": 0}` puts a
  separate weapon mesh on a hand bone.

Run from the repository root:

```sh
gm py -- skills/gm-sprite-forge/scripts/motion/run_cells.py cells.json <out> --engine workbench   # fast scoring pass
gm py -- skills/gm-sprite-forge/scripts/motion/run_cells.py cells.json <out> --engine cycles --only A-handkey-walk
gm py -- skills/gm-sprite-forge/scripts/motion/matrix_media.py <media> <pack Walk sheet> "Walk" <out>/A-handkey-walk ...
<blender wrapper> --python skills/gm-sprite-forge/scripts/motion/fit_accuracy.py -- fitacc.json 43 <rigged.fbx[:mesh]> ...
```

Each cell directory gets `raw_<row>_<col>.png`, `out/sheet.png`, `scores.json`, `recipe.json` (`ai_generated: true`,
motion licence), `fit.json`, `feet.json`, `landmarks.png` (first fit only) and `render.log`; `<out>/summary.txt` lists
the batch and `run_cells.py` exits 1 if any cell failed. A rerun clears a cell's old results first.
`matrix_media.py` reads `out/sheet.png`, `scores.json` and `recipe.json` from each cell directory.

## Files stay local

Outputs embed pack pixels (the colour pass and the matrix's pack column) and some motion is non-commercial: write
`<out>` and media under `assets-local/` (for example `assets-local/experiments/sprite-pipeline/hero-s2/`), never in the
repository, and never send them to a cloud service. Creator review media go only through the review lane.

## Motion sources and licences

Keep mocap under `assets-local/experiments/sprite-pipeline/hero-s2/mocap/` in folders named `cmu/`, `bandai/` and
`lafan1/`, with their licence files: `run_cells.py` reads the licence for `recipe.json` from that folder name (or
`kaykit` in the path), and writes `unknown` otherwise.

| Source | Licence | Notes |
|---|---|---|
| KayKit Character Animations (owned) | CC0 | Rig_Medium GLBs; chunky proportions (arms held wide) |
| CMU mocap (BVH mirror `una-dinosauria/cmu-mocap`) | free for any use | 120 fps; the cycle is picked automatically |
| Bandai Namco Research Motion | CC BY-NC 4.0 | styled walks (giant, proud, ...) and slashes; rest pose along +X |
| LaFAN1 (Ubisoft) | CC BY-NC-ND 4.0 | ND: retargeted output stays private, never in shared media |
| 100STYLE | CC BY 4.0 | 1.5 GB zip; not downloaded in #1202 |
| Hand-keyed (`handkey.py`) | own | the only source tuned to the pack's timing |

## Findings (#1202, Stage 1 Warrior mesh as test subject)

Walk, scored on workbench silhouettes against the 6Barbarian Walk (S and SE), `ssi-barbarian` stance, foot lock and
IK unless noted:

| Cell | Motion corr (SE, S) | Silhouette IoU | Foot slide px |
|---|---|---|---|
| Hand-keyed, best of a 10-setting search | 0.61 (0.79, 0.44) | 0.44 | 0.37 |
| CMU 07_01 | 0.52 (0.70, 0.33) | 0.45 | 0.45 |
| KayKit Walking_C | 0.47 | 0.35 | 0.24 |
| CMU 08_01 | 0.45 | 0.42 | 1.44 |
| KayKit Walking_A, rotations copied, no lock or IK | 0.42 | 0.37 | 2.52 |
| Bandai giant / masculinity / proud / normal | 0.41 / 0.32 / 0.25 / 0.23 | 0.37-0.45 | 0.17-0.76 |
| LaFAN1 walk1 | 0.30 | 0.43 | 0.80 |
| KayKit Walking_A / Walking_B | 0.28 / 0.35 | 0.36-0.37 | 0.19-0.20 |

Attack against the 6Barbarian Attack1: hand-keyed `chop` 0.63, `combo` 0.52 (closest by eye), Bandai slash 0.46,
KayKit 1H chop -0.18, 2H chop -0.24.

- **Calibration.** Pack walks scored against the 6Barbarian Walk: reskins of the same animation (3Nomad, 4Berserker)
  0.97; every other SmallScaleInt character's walk 0.0-0.6. Motion correlation of 0.7 or more therefore means "the
  pack's own animation", not "a good walk". Retargeted libraries score where the pack's other walks do.
- **Rig fit.** On rigged ground-truth characters in A-pose (Kenney, Synty), knees and elbows land within about 1-2 px
  at a 43 px sprite. Knees are placed by proportion, so a mesh with unusual legs moves them.
- **Bone heat** fails on every vertex of raw TRELLIS meshes; the voxel proxy fixes it, and a raised arm or a swung
  leg deforms cleanly with a fused weapon following the hand.
- **Feet.** Copying rotations (Blender's built-in route) slides 2.5 px per contact frame; the lock and IK pass keeps
  0.2-0.5 px. Rokoko's free retarget add-on was not tried in this spike.
- **Not run:** arm B (UniRig needs a CUDA GPU with 8 GB or more; the NUC has none and the PC is off-limits) and arm C
  (`fal-ai/meshy/rigging` is listed at 0.80 USD per call, not the planned 0.32; skipped without spend).
