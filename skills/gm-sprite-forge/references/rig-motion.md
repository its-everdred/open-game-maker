# Rig and motion (hero Stage 2, #1202)

How a TRELLIS character mesh becomes an animated sprite sheet judged against the pack's own animation. Everything runs
locally on the CPU, costs nothing and sends nothing to a cloud service, except a vendor rig (see Rigged bodies), which
is a paid fal call the creator approves first and which uploads only our own mesh, never a pack file.

**Gate.** Animation waits behind an approved static sprite (SKILL.md). The one exception is the #1202 ticket's: the
tooling may be built and debugged on an existing mesh as a test subject, with no creator review of the result. Only an
approved mesh goes into review media. `run_cells.py` does not check this; you do.

**Modeling and rigging** (creator, 2026-11-22). A hero mesh is a base body: the pack sprite's face, hair, build,
proportions, palette and scale, plain white undergarments, no armour or weapons, in a neutral A-pose. Its review judges
only those. Stance and pose belong here: a stance or pose that differs from the pack's Idle is a stance layer (step 4)
or motion, never a re-generated mesh. Gear (armour, weapons, helmets, robes) is a separate mesh on a hand or body bone
rendered through the same camera so it can be swapped at runtime. `weapon` in `cells.json` attaches a rigid one;
worn gear that bends with the body is not built yet.

## What runs where

| Script | Runs in | Role |
|---|---|---|
| `scripts/motion/run_cells.py` | `gm py --` | Batch driver: one Blender at a time per cell, then scoring and `recipe.json` |
| `scripts/motion/render_motion.py` | Blender | One cell: fit (or reuse the cached fit), skin, motion, render S and SE, write `feet.json` |
| `scripts/motion/fit_rig.py`, `retarget.py`, `handkey.py` | Blender (modules) | Reached through `render_motion.py`; not commands |
| `scripts/motion/score_cell.py` | `gm py --` | Finish frames, `score.py` metrics, loop phase, foot slide -> `scores.json` |
| `scripts/pixel_finish.py` | `gm py --` | Pack-style pixel finish (few colours, cloth on its own ramp); `score_cell.py` runs it for `pixel` |
| `scripts/motion/matrix_media.py` | `gm py --` (needs ffmpeg with libx264) | Review matrix: pack column plus at most 10 cells, GIF + MP4, 1x and 4x |
| `scripts/motion/strip.py` | `gm py --` | Quick zoomed strip for looking: `strip.py <cell_dir> <out.png> [rows=1,2] [zoom=3] [ref=<pack sheet>]` |
| `scripts/motion/fit_accuracy.py` | Blender | Landmark error against rigged characters; exits 1 if any case fails |
| `scripts/motion/rigged.py`, `sampling.py` | Blender module / plain | A body that arrives rigged (#1282): its own clip or a plain copy retarget, sampled evenly or on key poses |
| `scripts/motion/pose_overlay.py` | `gm py --` | Frame-by-frame silhouettes over the pack clip (pack red, ours cyan) with per-frame IoU |

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
4. **Stance.** Kevin (2026-11-22): stance changes belong to the rigging step, not the modeling step.
   `retarget.STANCES` holds additive pose layers: `ssi-barbarian` hunches the chest, pushes the head out, hangs the
   arms in front and crouches 5% of a leg; `ssi-wizard` and `ssi-ranger` turn the torso 35 degrees off the facing,
   bend the knees and hold the arms out, as in those packs' Idles; `ssi-wizard-walk` raises the casting hand ahead
   at face height, as the pack Wizard walks. Every motion source in a batch gets the same layer unless a cell names
   its own.
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
- `finish`: `"base"` for a base body (white undergarments). The pack colour match paints the pack character's dark
  trousers onto bare legs, so `finish_base.py` matches only the skin, to `pack.idle` (the class's Idle sheet: attack
  sheets carry light, warm effect pixels): each pixel's hue moves toward the pack skin in proportion to its own chroma,
  with one lightness scale, so white undergarments stay white. Never split skin from cloth per pixel: that greyed pale
  skin and erased underwear (Kevin, 2026-11-22). `pack.idle` is required: `run_cells.py` refuses to start without
  it, and the pass fails if either sheet has no skin pixels. The sheet before that pass is kept as
  `out/sheet_finish.png`. Without `finish`, the whole sheet is matched to the clip's pack sheet.
- `pixel`: `{"colours": 8, "cloth": 6, "smooth": true}` runs `scripts/pixel_finish.py` after the colour pass: one
  palette over the whole sheet, `colours` for everything but the cloth and `cloth` for the cloth (14 in all) (the same colours in every frame), a 3x3 median first with `smooth`. This is Kevin's
  pick "B" (hero-finish1-warrior, 2026-11-22: fewer shades, less detail, as the pack). `cloth` renders a cloth mask
  per frame (`mask_<row>_<col>.png`: white where the base-colour texture is pale and unsaturated) and gives the
  undergarments their own colours: on one palette they merge into pale skin. The sheet before it is kept as
  `out/sheet_colour.png`. `render` keys `mask_s` and `mask_v` (0.16, 0.5) set the cloth thresholds; stricter ones
  lose the briefs.
- `render` keys: `rows` (default `1,2`; scoring follows it), `frames` (15), `cell` (128), `height_px`, `origin_row`,
  `samples`, `supersample`, `threads`, `sun_elev`, `sun_az`, `sun_energy`, `sky`, `mask_s`, `mask_v` (`mask=1` is added
  for you when `pixel.cloth` is set). Use the pack class's Stage 1 values
  for `height_px` and `origin_row` (Warrior 43 and 88).
- `motion`: `kind` is `kaykit`, `bvh`, `handkey` or `none` (`own` and `copy` for a rigged cell, below). `loop` defaults to true for a walk and false for an attack.
  `foot_ik` defaults to true (false copies rotations only). `frames: [f0, f1]` overrides the automatic cut. For an
  attack BVH, `seconds` (1.1) and `fps` (30; CMU is 120) size the window.
- Hand-keyed `params`: walk `stride`, `lift`, `bob`, `sway` (fractions of leg length), `yaw`, `lean`, `arm` (degrees),
  `elbow` ([min, max] degrees); attack `keys` (`chop`, `combo`, `cast` for the pack Wizard CastSpell, `bow` for the
  pack Archer QuickShot) and `step`.
- `stance` (top level, or in a cell's `motion` to override it for that cell): a name in `retarget.STANCES`.
- `weapon` (per cell or top level): `{"path": glb, "bone": "hand.R", "length": 0.3, "grip": 0.25, "spin": 0, "roll": 0}`
  puts a separate weapon mesh on a hand bone, its long axis across the fist. `spin` turns it about that axis, `roll`
  about the hand bone (a bow needs `"roll": 90` to stand upright). Shape keys are dropped (the KayKit bow's `Draw` key
  otherwise kept it in its import pose).

Run from the repository root:

```sh
gm py -- skills/gm-sprite-forge/scripts/motion/run_cells.py cells.json <out> --engine workbench   # fast scoring pass
gm py -- skills/gm-sprite-forge/scripts/motion/run_cells.py cells.json <out> --engine cycles --only A-handkey-walk
gm py -- skills/gm-sprite-forge/scripts/motion/run_cells.py cells.json <out> --rescore   # new finish/pixel, same renders
gm py -- skills/gm-sprite-forge/scripts/motion/matrix_media.py <media> <pack Walk sheet> "Walk" <out>/A-handkey-walk ...
<blender wrapper> --python skills/gm-sprite-forge/scripts/motion/fit_accuracy.py -- fitacc.json 43 <rigged.fbx[:mesh]> ...
```

Each cell directory gets `raw_<row>_<col>.png`, `out/sheet.png`, `scores.json`, `recipe.json` (`ai_generated: true`,
motion licence), `fit.json`, `feet.json`, `landmarks.png` (first fit only) and `render.log`; `<out>/summary.txt` lists
the batch and `run_cells.py` exits 1 if any cell failed. A rerun clears a cell's old results first. `--rescore` keeps
the renders and runs the finish and scoring again (after a new `finish` or `pixel`), rendering only the cloth masks
when `pixel.cloth` needs them and the cell lacks them. It refuses a cell whose mesh, motion, stance or weapon in
`cells.json` changed since its render: render that cell again.
`matrix_media.py` reads `out/sheet.png`, `scores.json` and `recipe.json` from each cell directory.

## Rigged bodies (#1282 bake-off)

**Round scope (Kevin, 2026-11-23; holds for every later rung until he widens it):** a motion round carries exactly
one walk and one basic attack per arm, on the one body under test. No roll, push, block or extra attacks, no second
attack clip in any arm, and no other classes or bodies. The attack recreates the pack's own clip (Warrior: 6Barbarian
Attack1): the same beats, frame count and directions. Post the round as soon as every arm has rendered; the next
motions wait for his pick.

**Recreate the pack's clip, not a look-alike (Kevin, 2026-11-23, every later rung).** Study the pack frames first and
write the key pose of each one down. Then match every arm to those poses: a vendor arm takes its closest clip,
retimed and key-posed onto the pack's frames (`sample: keys`). The control and the plain copy retarget or hand-pose
to the same poses. Keep the pack's frame count, timing and directions. Score every cell frame by frame with
`pose_overlay.py`, and show it beside the pack (pack in column 1) at 1x and 4x. The walk matches the pack's Walk the
same way. For the Warrior (6Barbarian, 15 frames, S = sheet row 2, SE = row 1):

| Frame | Attack1 key pose | `holds` |
|---|---|---|
| 0 | ready crouch, axe low in front | 1 |
| 1 | axe drawn back low | 1 |
| 2 | axe out level at head height (wind-up) | 1 |
| 3-4 | axe high overhead, off arm out; then vertical, torso twisting | 2 |
| 5 | strike 1: diagonal chop to low front, lunge | 1 |
| 6-7 | axe raised again; behind the head, crouch (second wind-up) | 2 |
| 8 | wide horizontal sweep, low lunge | 1 |
| 9 | axe overhead again | 1 |
| 10 | strike 2 down the right side | 1 |
| 11-12 | recovery crouch, axe at waist | 2 |
| 13-14 | settle back to ready | 2 |

Walk: a 15-frame hunched heavy walk, axe low in the right hand, small arm swing; key-posed as 8 phases from the left
heel strike (the frame where the feet are farthest apart), each held 2 frames and the last 1. A one-swing source
replays its wind-up and strike for the pack's second swing (`keys` may repeat a source frame).

Bake-off result (#1282, mean silhouette IoU against Attack1, S / SE): Quaternius sword chop on the mannequin
0.29 / 0.22-0.24, on the Hyper3D rig 0.34-0.35 / 0.28-0.29, and on the Meshy rig (plain copy) 0.33 / 0.25. Meshy's
Double_Combo_Attack scored 0.22-0.23 / 0.02 (it turns away). No library attack reaches the pack's wide overhead arcs
and low lunges; the walks score 0.46-0.60 / 0.39-0.52.

A cell with `rigged` skips steps 1-5 (the top-level `mesh` and `pack` are still required; `recipe.json` names the
rigged file as the cell's mesh): the body arrives rigged (a vendor rig such as Meshy or Hyper3D, or a library
character such as the Quaternius mannequin) and nothing of ours touches the motion but the sampling.

```json
{"name": "A-meshy-combo-keys", "clip": "attack", "model": "...", "cost_usd": 0.8, "licence": "...",
 "rigged": {"path": "<rigged>.glb", "action": "Double_Combo", "hips": "mixamorig:Hips",
            "feet": {"L": ["mixamorig:LeftFoot", "mixamorig:LeftToeBase"], "R": ["mixamorig:RightFoot", "mixamorig:RightToeBase"]}},
 "motion": {"kind": "own", "in_place": true, "sample": "keys", "keys": [0, 2.4, 4.9], "holds": [5, 5, 5]},
 "weapon": {"path": "<axe>.gltf", "bone": "mixamorig:RightHand", "length": 0.75}}
```

- `action` is the action's name, or a part of it that only one action contains (importers add `_Armature`); an
  ambiguous or missing name fails. `colour` (linear RGB) paints an untextured library mannequin flat so the skin pass
  has skin to match.
- `kind: own` plays the file's action as delivered. `kind: copy` (with `path`, `action` or `frames`, `map`: target
  bone -> source bone, `src_hips`) is the plain retarget: each mapped bone takes its source bone's world rotation away
  from the source rest pose, applied to the target's rest bone first turned to point where the source rest bone
  points (a T-pose clip drives an A-pose body), and the hips take the source travel scaled by hip height. No stance,
  no foot lock, no IK. `in_place` removes a clip's straight-line travel and keeps its sway.
- The body is turned to face -Y from its feet (heel to toe), the source of a copy from its first posed frame. The
  weapon's roll is set so it points forward out of the fist at rest (unless the cell gives `roll`), and its `length`
  (sized for a 1.8 m body) is always scaled to the rig's height (Hyper3D's rig comes back about 1 m tall). A rigged
  cell does not inherit the top-level `rotz`.
- `sample`: `even` spreads the sheet's 15 frames over the clip (a loop leaves out its closing frame); `keys` holds
  key poses (`keys` source frames, `holds` sheet frames each, summing to 15) on the pack clip's beats, and may replay
  poses (a one-swing clip swung twice for the pack's two-swing Attack1); `times` gives every frame outright.
- The pack 6Barbarian Walk and Attack1 face about 45 degrees off the travel direction in every row (the Idle does
  not): the rows are right (all 8 Idle rows match the render's), the pack's walk and attack carry a turned stance.

**Vendors (fal, 2026-11-23).** `fal3d.py price` lists `fal-ai/meshy/rigging` at $0.80 and `fal-ai/hyper3d/rigging`
at $0.40 a call, not the model pages' $0.32 and $0.20; book the higher. Meshy (`skeleton_template: mixamo`,
`height_meters`, `enable_animation` with one `animation_action_id`) returns the rig, a walk, a run and the one library
clip as GLB and FBX in about a minute; one clip per call. Hyper3D's `animation_urls` must already be on its own rig
(it does not retarget them): our Quaternius and Bandai FBX clips were rejected with a 422, and its stock presets need
ids from a catalog only a billed call reaches, so the rig alone was taken and played through `kind: copy`. Run one
through the ledger, uploading only our own base-body mesh:

```sh
OGM_FAL_LEDGER=<costs.json> OGM_FAL_STOP_USD=<cap> gm py -- skills/gm-sprite-forge/scripts/fal3d.py run fal-ai/meshy/rigging \
  <out>/gen 0.80 model_url=@<base body>.glb skeleton_template=mixamo height_meters=1.8 enable_animation=true animation_action_id=92
```

Check every cell frame by frame against the pack clip: `gm py -- skills/gm-sprite-forge/scripts/motion/pose_overlay.py
<out.png> <pack sheet> <cell_dir> ... [--rows 1,2] [--zoom 3]` lays each frame's silhouette over the pack's (pack red,
ours cyan, both white) and writes the per-frame IoU to `<out>.json`.

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

Round-1 review cells (Cycles, S and SE, `ssi-barbarian` stance, foot lock and IK unless noted), scored against the
6Barbarian Walk and Attack1. Motion correlation is the mean of the rows, SE then S:

| Cell | Motion corr (SE, S) | Silhouette IoU | Foot slide px | Render min |
|---|---|---|---|---|
| Walk: hand-keyed, best of a 10-setting search | 0.61 (0.78, 0.44) | 0.45 | 0.40 | 1.5 |
| Walk: Bandai giant | 0.40 (0.53, 0.26) | 0.35 | 0.42 | 0.9 |
| Walk: KayKit Walking_C | 0.38 (0.42, 0.34) | 0.35 | 0.69 | 0.6 |
| Walk: KayKit Walking_A, rotations copied, no lock or IK | 0.38 (0.43, 0.33) | 0.37 | 2.54 | 1.0 |
| Walk: CMU 07_01 | 0.33 (0.26, 0.40) | 0.41 | 0.69 | 0.5 |
| Walk: LaFAN1 walk1 | 0.33 (0.27, 0.40) | 0.41 | 0.77 | 1.7 |
| Attack: hand-keyed `chop` | 0.62 (0.63, 0.62) | 0.28 | 0.35 | 1.0 |
| Attack: hand-keyed `combo` (closest by eye) | 0.51 (0.52, 0.50) | 0.30 | 0.62 | 0.9 |
| Attack: Bandai slash | 0.45 (0.42, 0.48) | 0.24 | 0.21 | 1.8 |
| Attack: KayKit `Melee_1H_Attack_Chop` | -0.16 (-0.19, -0.14) | 0.23 | 0.07 | 0.8 |

An earlier silhouette pass over all 11 retargeted walks (KayKit A/B/C, CMU 02_01/07_01/08_01, four Bandai styles,
LaFAN1; before the loop-seam fix) put every one between 0.23 and 0.52.

- **Calibration.** Pack walks scored against the 6Barbarian Walk: reskins of the same animation (3Nomad, 4Berserker)
  0.97; every other SmallScaleInt character's walk 0.0-0.6. Motion correlation of 0.7 or more therefore means "the
  pack's own animation", not "a good walk". Retargeted libraries score where the pack's other walks do.
- **Rig fit** (`fit_accuracy.py`, 43 px sprite). On seven realistic rigged bodies in A-pose (Kenney, Synty), knees
  land within 1 px on 4 of 7 (worst 2.05 px, a kilted Synty warrior: knees are placed by proportion) and elbows within
  1 px on 5 of 7 (Kenney Medium fails at 10.7 px). In T-pose the shoulders drift 4-13 px; KayKit's big-headed bodies
  fail at the arms. Within 1 px is likely, not guaranteed: look at `landmarks.png` for every new mesh.
- **Bone heat** fails on every vertex of raw TRELLIS meshes; the voxel proxy fixes it, and a raised arm or a swung
  leg deforms cleanly with a fused weapon following the hand.
- **Feet.** Copying rotations (Blender's built-in route) slides 2.5 px per contact frame; the lock and IK pass keeps
  0.2-0.5 px. Rokoko's free retarget add-on was not tried in this spike.
- **Not run:** arm B (UniRig needs a CUDA GPU with 8 GB or more; the NUC has none and the PC is off-limits) and arm C
  (`fal-ai/meshy/rigging` is listed at 0.80 USD per call, not the planned 0.32; skipped without spend).

## Next rung: the creator round on base bodies

Kevin's Stage 1 verdicts (2026-11-22) carry into this round: Wizard and Ranger matched the pack as models, the Warrior
was close, and its weapon is to be rendered separately so the player can carry many. The round runs on the approved
base bodies, not on those meshes:

- One `cells.json` per approved body (Warrior, Wizard and Ranger, each male and female:
  `hero-base/<class>-<m|f>/gen/model_mesh.glb`) as `mesh`, scored against that class's pack sheets (6Barbarian,
  3Wizard, 5BarbArcher): a walk and one attack, with phone clips.
- One stance layer per class in `retarget.STANCES`, matched to that class's pack Idle (`ssi-barbarian`,
  `ssi-wizard`, `ssi-ranger`). Fix stance here, not by asking for a new mesh. An Idle stance does not fit every
  clip: on the base-body dry run it raised the Ranger's hand-keyed walk from 0.43 to 0.53 but lowered the Wizard's
  from 0.37 to 0.21, because the pack Wizard walks with its casting arm raised ahead. Give such a clip its own layer
  in the cell's `motion` (`"stance": "ssi-wizard-walk"`).
- Base bodies set `"finish": "base"` with `pack.idle`, and `"pixel": {"colours": 8, "cloth": 6, "smooth": true}`:
  Kevin's finish "B" (hero-finish1-warrior) carries to every hero cell and every later rung. The attack is scored against the class's own clip: Warrior
  Attack1 (`chop`), Wizard CastSpell (`cast`), Ranger QuickShot (`bow`).
- The class weapon goes in `weapon` on the hand bone, never fused into the body. With nothing fused, the fit's
  weapon cut-off does nothing. Size it to the pack clip, not the default: the Warrior's KayKit `axe_1handed` needs
  `"length": 0.75` (at 0.35 it vanished into the fist at 1x), the Ranger's `bow_withString` `0.9` with `"roll": 90`.

Dry run (2026-11-22, unapproved base bodies, workbench, debug only): the fit lands knees, elbows, wrists and ankles on
the joints of all six bodies (`landmarks.png`), with no tearing at sprite scale. Hand-keyed walks score 0.32-0.58 with
0.15-0.38 px foot slide; KayKit `Walking_C` scores 0.29-0.66 with about 1 px slide and reads as a lunging high-knee
gait on every body.

## Creator verdict on the round (2026-11-23)

Kevin rejected every cell of the round: hand-keyed, KayKit, Bandai and CMU, walks and attacks, on all six bodies
("none move like humans at all"). No rig or motion source in this step is approved, and its correlation and foot-slide
scores did not predict his verdict. Do not post another round from these tools; the next step is the dedicated
rigging and animation bake-off in #1282, which waits on his approval. The static base bodies and finish B stay approved.
