---
title: "Hero sprite pipeline: 3D -> 2D class sprites for Dusk Helm"
status: 6 base bodies approved (Kevin 2026-11-22); Stage 2 rig/motion round running on them (#1202); Stages 3-4 held
date: 2026-11-21
origin: Kevin 2026-11-21 ~21:45Z; follows core #1120 (TRELLIS multi-view at $0.02 won the model bake-off)
---

# Hero sprite pipeline

Goal: the Warrior, Wizard and Ranger become the most expressive characters in Dusk Helm. They get rich animations with
many variations, made by one pipeline that matches the SmallScaleInt HD look. We prove each step on a render you can
judge before we spend more on the next one.

## What we start from

- **Characters** (first appearance in `src/features/character-select.ts`; the second appearance follows the same path):
  - Warrior = `smallscaleint-2d-hd-barbarian-pack-1/.../6Barbarian` (alt `3Nomad`)
  - Wizard = `smallscaleint-2d-hd-character-pack-1/.../3Wizard` (alt `6Mage`)
  - Ranger = `smallscaleint-2d-hd-barbarian-pack-1/.../5BarbArcher` (alt `7BowMan`)
- **The pack already ships about 30 animations per class.** Each has 8 directions, about 15 frames and 128 px cells:
  Idle, Idle2, Walk, Run, RunBackwards, Strafe L/R, 180Turn, Rolling, FrontFlip, Slide, Crouch, Attack1-3, AttackRun,
  Kick, Pummel, QuickShot, CastSpell, Special1-2, BlockStart/Mid, TakeDamage, Die, UnSheath, SittingChair.
  New animations must sit beside these with no visible jump in style.
- **Our walks are bad, and we can measure it.** In #1120, 12 different fal models all scored between 0.38 and 0.47 on
  walk motion against the pack. The model choice barely moved that score, so the motion is the problem, not the mesh.
  See Stage 2.
- **Budget:** fal ledger is at $7.43 of the $9.00 cap (`fal-arm-e/costs.json`). This plan books at most $0.12.
- **Host:** the NUC has no GPU, so Blender renders on its CPU. The PC has a GPU, but you said the PC does no asset work.

## Questions for you before Stage 1

1. **Appearance.** Should we use the first appearance per class (Barbarian, Wizard, BarbArcher)? Or do you want both?
2. **Pack-derived image to fal.** TRELLIS reads a Codex turnaround that was drawn with the pack sprite attached. The
   pack file never leaves the NUC, but the turnaround is derived from it. #1120 worked this way. OK to keep doing it
   for the heroes?
3. **Pack-derived mesh to a cloud rigger.** Mixamo, Meshy rigging, Tripo rigging and fal riggers would all receive the
   3D mesh made from the pack character. Yes or no? If no, we rig only locally (Stage 2 arms A and B).
4. **Non-commercial mocap.** Bandai Namco Research Motion and LaFAN1 are CC BY-NC. This is a family-only project, so
   they may be usable. Can we use them, or only CC0/CC BY sources?
5. **Your own video.** Will you film short clips (pushing a box, falling) for local pose extraction? Nothing leaves
   the NUC.

## Decisions

Kevin, 2026-11-21 ~22:45Z:

1. **Stage 1: approved.** Exact re-render of the Warrior (`6Barbarian`), Wizard (`3Wizard`) and Ranger (`5BarbArcher`):
   one TRELLIS multi-view call each, $0.06 total, $0.12 at most with one retry each. Use the first appearance per class.
2. **Pack-derived turnarounds to fal: yes.**
3. **Cloud auto-rigger for pack-derived meshes: allowed** (Stage 2 arm C may run).
4. **CC BY-NC mocap (100STYLE and the like): fine** (Stage 2).
5. **Kevin's own reference video:** not asked yet; do not plan on it.

Kevin, 2026-11-22 00:14Z (Stage 1 review, cards on #1120):

6. **Wizard: "Matches the pack". Ranger: "Matches the pack"** ("this looks good for modeling step").
7. **Stance changes happen in the rigging step, not the modeling step.** The modeling step only has to match the
   pack's body, face, palette and scale in a neutral A-pose; any pose or stance difference from the pack Idle is fixed
   by the rig and motion (Stage 2), never by re-generating the mesh.
8. **Warrior: "Close, fix details".** "Let's render weapons separately so player can carry many different" (step 3).

Kevin, 2026-11-22 ~13:10Z (supersedes 8 for now):

9. **Equipment is upgradeable, so the heroes start as base bodies.** Warrior, Wizard and Ranger, each **male and
   female** (6 bodies), "still based off original sprites": the same face, hair, build, proportions, palette and pixel
   scale as the pack sprite, with all gear removed and only plain white undergarments (male: white shirt + boxers;
   female: white bra + underwear). No armour, no weapons. The pack has no female version of these classes, so each
   female body is drawn from the same class sprite. One TRELLIS multi-view call each ($0.12 for 6, Kevin asked for these
   runs; cap raised to $9.75 for them only). The Warrior weapon-split round is paused.
10. **All gear is attachable layers on the base bodies:** armour, weapons, helmets and robes, for every class and both
    sexes, rendered at the pack camera and scale and swapped at runtime. This applies to Stage 3 (#1203), the Dusk
    Helm sprite sets (og #890) and the Stage 4 comparison (og #891).
11. **Stage 2 (#1202) rigs and animates the base bodies** once Kevin approves them.

Kevin, 2026-11-22 ~22:00Z onward (base-body reviews):

12. **All three female bodies approved.** The males are redone **shirtless, boxers only**: the Warrior large and muscular,
    the Wizard skinny and scrawny, the Ranger lean, somewhat muscular but skinny. Wizard and Ranger males: "Male matches".
13. **Warrior (both sexes): grey pixel artifacts and missing underwear at some angles.** The cause was the base-body
    colour pass (a per-pixel skin/cloth split), not the meshes. The v2 pass (a chroma-weighted hue shift, no classes) fixed it
    with no new spend. Warrior: "Both match". **All 6 base bodies are approved**, and Stage 2 runs on them.

---

## Stage 1: exact re-render of the three class sprites

**What you see**
- Three cards, one per class. Columns are Original | Re-render, with 8 directions as rows. The pose is the pack's Idle
  frame 0. The cards are phone-first, at 1x pack scale and at 4x zoom.
- One still of the three re-renders standing in a Dusk Helm scene beside the pack originals, in the same iso camera.
- One option per class.

**Steps**
1. Free Codex route (`executor/mock-broker.py`): make a front/right/back turnaround with the pack frames attached. The
   character should be in a relaxed A-pose with the weapon held clear of the body.
2. `fal-ai/trellis/multi` with the three views: $0.02 per class. Allow one retry per class only if the mesh is broken.
3. Cut the weapon (sword, staff, bow) into its own mesh. It then follows a hand bone and can be swapped later.
4. Bake through the calibrated pack camera rig (`gpu_bake_rig` on CPU): 128 px cells, 8 directions, then the colour
   pass to the pack palette.
5. Score each direction against the pack Idle with `score.py` (silhouette IoU, pixel similarity, palette distance).
6. Mark every output `ai_generated: true` in `recipe.json`.

**Research questions:** none new. This is the #1120 recipe applied to humans.

**Cost:** $0.06, at most $0.12 with retries. CPU render about 20 min per class.

**Gate:** you approve each class ("matches") or name what is off. A class you approve becomes the base mesh for every
later stage. Judge the modeling step on body, face, palette and scale only: stance and pose differences from the pack
Idle are fixed in the rigging step (Stage 2), never by re-generating the mesh.

---

## Stage 2: rigging and motion spike (research, local, $0)

### Why our walks were bad

The walks came from `gob_common.py` and `e_char.py` in `gm-sprite-forge/scripts/bakeoff`:

1. **The skeleton is not fitted to the mesh.** Joint positions are hard-coded for a hunched goblin and only squashed
   by a `HUNCH` factor. Knees and elbows land where the goblin's would be, so limbs bend mid-thigh or mid-forearm.
2. **The skin weights are crude.** Each vertex binds to its two nearest bones by straight-line distance. On fused
   image-to-3D meshes, an inner thigh can bind to the other leg, a hand to the hip, and the weapon to the body. Joints
   crease and tear instead of bending.
3. **One sine formula drives every character.** The thigh swings ±30°, the shin bends on only half the cycle, and the
   arms swing ±22° and ±14°. There are no contact, passing, down or up poses. There is no hip turn, no weight shift
   and no shoulder counter-rotation.
4. **The feet slide.** There is no foot IK and no root motion. The legs swing around a fixed hip, and the bob is just
   `abs(cos)` on the root.
5. **The scores agree.** Walk motion correlation is 0.38-0.47 for all 12 models, and silhouette IoU is about 0.3. The
   goblin card shows straight, stiff legs and dangling arms.

### Spike: same mesh, several rigs and motions, judged against the pack's own Walk

All work is on the Stage 1 Warrior mesh, rendered S and SE.

| Arm | Rig | Where it runs | Notes |
|---|---|---|---|
| A | Blender Rigify metarig, fitted to mesh landmarks by script; weights from bone heat, with voxel heat diffuse as fallback for non-manifold meshes | NUC, local | Free, scriptable, standard bone names make retargeting easy |
| B | UniRig (open-source learned auto-rigger) | NUC CPU if it runs; otherwise ask about the PC | Check its licence and CPU run time. The PC needs your OK (asset work) |
| C | Cloud auto-rigger: Mixamo, Meshy rigging (`fal-ai/meshy/rigging`, about $0.32) or Idol `rig=true` (already tried in #1120) | Cloud | **Only if you say yes to Question 3** |
| — | AccuRIG (ActorCore) | Windows desktop only, not headless | Listed but not planned. It does not fit an agent pipeline |
| — | Auto-Rig Pro (paid Blender add-on) | Local | Costs money. Only if A fails |

| Motion source | Examples | Licence / cloud |
|---|---|---|
| Animation libraries we already own | `kaykit-character-animations` (CC0, about 140 clips: walks, runs, 4 dodges, 22 melee incl. block/hit, bow draw/release, magic casts, death, lie down/stand up, push-ups, pick-up); Synty goblin locomotion (owned) | Local. KayKit's proportions are chunky, so it needs a retarget with proportion correction |
| Mocap libraries | CMU mocap (free for any use), 100STYLE (CC BY 4.0), Mixamo clips (free with an Adobe account, cloud download only, no mesh upload) | Bandai Namco and LaFAN1 are CC BY-NC (Question 4) |
| Video to motion | MediaPipe Pose (CPU, local) for rough motion; GVHMR / WHAM / 4D-Humans for better 3D (GPU); `fal-ai/sam-3/3d-body` (cloud, only for your own video, never pack images) | Your own clips stay local unless you say otherwise |
| Text to motion | MoMask, MDM, T2M-GPT | Research code. Most are trained on SMPL/AMASS, which are non-commercial. Weakest for snappy game attacks |
| Hand-keyed with IK | An agent-written Blender script with foot locks, contact frames, and anticipation -> strike -> recovery timing | Local, $0. Best for attacks and pushes that no library has |

**What you see**
- A walk matrix in S and SE, with the pack Walk as column 1. The other columns are the arm/motion pairs, at most 6
  cells, for example A+KayKit, A+CMU, A+hand-keyed, B+KayKit, and C+Mixamo if allowed. Each cell is a looping MP4/GIF
  for the phone.
- One row per cell with motion correlation against the pack, foot slide in pixels, and render minutes.
- The same matrix for one attack (pack Attack1 against KayKit `Melee_1H_Attack_Chop` and hand-keyed).

**Research questions**
- Can a scripted Rigify fit land knees and elbows within 1 px at 128 px cells?
- Does bone heat survive TRELLIS meshes (fused legs, welded hands)? If not, does re-meshing first fix it?
- Which retarget path keeps feet planted on SSI proportions: Blender's built-in tools, Rokoko's free retarget add-on, or
  our own IK pass?
- What is the lowest-cost source that reaches motion correlation of 0.7 or more against the pack Walk?

**Cost:** $0, plus about $0.32 only if you allow arm C. CPU render about 1-2 h.

**Gate:** you pick one rig and one or two motion sources. The pick becomes a `gm-sprite-forge` skill step.

---

## Stage 3: the animation list

The pack already gives the base set, so the pipeline fills gaps and adds variations. All directions are 8 iso
directions. We do not mirror: mirroring swaps the weapon hand.

| Animation | Pack has | New variations | Frames |
|---|---|---|---|
| Idle | Idle, Idle2 | +1 combat-ready, +1 tired/low HP | 15 loop |
| Walk | Walk | +1 weapon drawn, +1 injured | 15 loop |
| Run | Run, RunBackwards, Strafe | +1 sprint | 12-15 loop |
| Roll / dodge | Rolling, FrontFlip, Slide | dodge back, dodge left, dodge right | 12 |
| Attacks | Attack1-3, AttackRun, Kick | +2 heavy, +1 combo finisher, +1 jump attack (5+ per class) | 12-18 |
| Block | BlockStart, BlockMid | +block hit, +block break | 8-12 |
| Hit | TakeDamage | +hit from behind, +stagger | 8-12 |
| Knockdown / fall | — | knocked back, trip forward, fall from ledge, land | 12-18 |
| Get up | — | get up from back, get up from front | 15 |
| Push / pull box | — | push start, push loop, pull loop | 15 loop |
| Death | Die | +1 variant | 15-20 |
| Interact | — | pick up, open door/chest | 12 |

**Class specials** (+3-4 each, 15-20 frames):
- **Warrior:** shield bash, ground slam, whirlwind spin, charge.
- **Wizard:** bolt cast, channelled beam (loop), area burst, blink.
- **Ranger:** charged shot, volley, roll-and-shoot, trap set.

**Scale:** about 30 new animations per class x 8 directions x about 15 frames is about 3,600 frames per class. The first
batch is only the warrior's 6 missing basics: push loop, knockdown, get up, dodge back, heavy attack and block hit. You
see each one beside the closest pack animation.

**Gate:** you approve the list (add, cut, rename) and then the warrior's first 6. The other classes follow the same
recipe.

---

## Stage 4: 3D in engine with a pixel shader vs sprite sheets

The same Warrior and the same 3 animations (walk, Attack1, roll) run in one Dusk Helm scene (World), side by side.

- **Sprite sheets:** baked by Stages 1-3 and played by Phaser 4 as they are today.
- **Real 3D:** the rigged mesh is rendered with three.js into a small offscreen canvas at 128 px. A post pass does a
  nearest downscale, palette quantisation and the pack's outline and shading bands. The result is uploaded each frame
  as a Phaser texture. Phaser 4 has no 3D of its own, so this overlay is the cheapest honest version.

**What you see:** one side-by-side clip recorded on a phone, plus a table:

| Criterion | How we measure |
|---|---|
| Look vs pack style | Your eye, plus `score.py` on matching frames |
| Phone performance | Frame time on a mid-range Android device and your phone, with 1 and with 3 heroes on screen |
| Memory | GPU and JS heap. Sprites: 128x128 RGBA is 64 KB per frame, so one animation x 8 directions x 15 frames is 7.5 MB raw. About 40 animations x 3 classes is about 900 MB raw, which is too much for a phone without trimming, atlas packing and compressed textures (ASTC/ETC2) |
| Equipment swaps | Swap sword -> axe. 3D: swap a mesh. Sprites: a re-bake per item, or layered part sheets |
| Animation blending | Walk -> run and attack -> walk transitions. 3D crossfades. Sprites cut on a frame |
| Authoring cost | Minutes and USD per new animation on each path |

**Research questions:** Does the 3D path hold 60 fps on a phone with three heroes? Can the pixel pass make 3D frames
indistinguishable from the baked ones? Does a hybrid work, with 3D for heroes and sprites for everyone else?

**Cost:** $0.

**Gate:** you choose sprites, 3D plus shader, or a hybrid for the heroes.

---

## Stage 5: tickets after approval

Nothing is filed until you approve the plan. Stages 1-3 tickets are filed held: no `agent:todo`, so they do not
dispatch. We `--todo` each one only when you pass its gate.

**Core (open-game-maker), NUC, `build-lane:assets feature:sprite-rebuild`:**
- `gm-sprite-forge`: human class re-render recipe (Stage 1)
- Rig fit and weights (Stage 2 winner)
- Motion retarget and library index (KayKit, CMU, allowed others)
- Foot-lock IK and hand-keyed motion helper
- Per-animation bake and motion score with a foot-slide metric

**Core, PC (no assets):**
- `gm-sdk` pixel-art 3D overlay component for Phaser (Stage 4 prototype; only code, no pack files)

**Open-Games (`game:dusk-helm`):**
- Class sprite sets (re-renders plus new animations)
- Animation state machine for the new moves
- The Stage 4 comparison scene

Each ticket carries `role:*` and `lane:clone` for the re-render and `lane:creative` for new motion.

## Cost summary

| Stage | USD | Ledger after |
|---|---|---|
| 1 | 0.06-0.12 | <= 7.55 |
| 2 | 0 (0.32 if arm C) | <= 7.87 |
| 3 | 0 (the motion reuses the Stage 1 meshes) | same |
| 4 | 0 | same |
