---
title: "Hero animation tools: research spike"
date: 2026-11-23
origin: Kevin 2026-11-23 04:55Z on the #1202 Stage 2 round ("every one of these look terrible … find dedicated rigging and animation tools … none move like humans at all")
plan: docs/plans/2026-11-21-hero-sprite-pipeline.md (Stage 2)
status: research done; bake-off filed held as core #1282 (awaits Kevin's approval)
---

# Hero animation tools: research spike

## Problems observed

- **What Kevin saw.** #1202's round showed a walk plus one attack per class. It was rendered from the 6 approved base bodies (TRELLIS meshes) through finish B. Kevin's verdict: "none move like humans at all".
- **What we tried** (`gm-sprite-forge/scripts/motion/`, PRs #1233, #1262, #1245, #1248, #1279):
  - our own scripted Rigify fit, with bone-heat weights through a voxel proxy;
  - retargets from KayKit (CC0), CMU, Bandai Namco and LaFAN1;
  - hand-keyed IK walks and attacks;
  - additive stance layers;
  - a foot lock with a two-bone IK pass.
- **What we know.** The best cells scored about 0.6 motion correlation (hand-keyed). Retargeted mocap scored 0.33–0.40, where the pack's other characters' walks also land. Kevin rejected all of them, the higher-scoring ones too. The metric does not measure whether a motion looks human, so it cannot be the gate.
- **The common factor across every arm is our own code.** Every motion source went through the same chain:
  1. `retarget.py` rebuilds bone orientations from joint positions only.
  2. A stance layer is added on top.
  3. A foot-lock/IK pass re-solves the legs.
  4. Cycles renders the body at a 43 px figure height.
  5. Finish B is applied.

  Real mocap (Bandai, LaFAN1) should look human whatever the rig. It did not, so the chain is the first suspect. The bake-off must include arms that skip our chain, or we cannot tell a bad motion source from a broken pipeline.

## Diagnosis to test

| Hypothesis | How the bake-off tests it |
|---|---|
| H1: our retarget, stance layer and IK pass destroy good motion | Arms A and B: a vendor rig plays the vendor's own clips, so our retarget is not used. Arm C: a standard name-mapped retarget with no stance layer and no IK re-solve |
| H2: at 43 px with finish B, any 3D motion reads as mush | Arm 0: a professionally animated CC0 character on its own rig, through the same camera and finish |
| H3: 3D-to-pixel motion needs key-pose holds | A second render of each 3D cell: stepped keys on the pack's frame count, holding the contact, passing, strike and recovery poses |
| H4: a 2D-native generator beats any 3D path at this size | Arm D: PixelLab animates the base-body sprite in pixel space |

## Survey

Prices and terms were checked on 2026-11-22.

- "fal" means a fal.ai endpoint on our existing account. That spend goes to `fal-arm-e/costs.json`: $7.67 spent, against a $9.85 stop that is earmarked for approved runs only.
- Any other vendor needs a new account or key. That counts as consent to spend, so Kevin must OK it.

### Auto-riggers

| Tool | Skeleton | Automation | Cost per character | Fit and risks |
|---|---|---|---|---|
| Meshy rigging (`fal-ai/meshy/rigging`) | Templates: mixamo, ue5_mannequin, unity_humanoid, blender_rigify_basic_human, meshyrig and others. Fingers optional | fal REST, headless | $0.20, or $0.32 with one library clip. #1202's note of $0.80 is wrong | Needs a humanoid with clearly defined limbs, facing +Z, as a textured GLB. Returns GLB/FBX plus a basic walk and run. Fused thighs are a risk. Strongest fit |
| Hyper3D/Rodin rigging (`fal-ai/hyper3d/rigging`) | `human` template; `skinning_method: core` | fal REST | $0.20, including up to 10 stock clips or 10 of our own FBX clips | The vendor retargets our clips for us. Needs +Y up and +Z forward. No quality evidence yet |
| Tripo Rig v3.0 | mixamo, unreal, actorcore, vrm | REST, with a free Rig Check pre-flight | about $0.25–0.30 | New key needed. A second source if the others fail |
| Mixamo | Mixamo, with fingers | Web GUI only. Uploads and auto-rig broke for many users in mid-2025, and there is no 2026 status | free | Its skeleton is available through Meshy's mixamo template instead. Skip |
| AccuRIG 2 / ActorCore | CC skeleton | Windows GUI only, landmarks placed by hand | free | Skip |
| Anything World | — | API, sales-led pricing | unknown | Skip |
| UniRig / SkinTokens | learned skeleton | needs a CUDA GPU with 8 GB or more | free plus GPU | No GPU on the NUC. Skip |
| Make-It-Animatable (MIT) | Mixamo layout, trained with cartoon proportions | GPU | free plus GPU | Promising, but GPU only |
| RigAnything, Puppeteer, RigNet | no standard skeleton | research code | — | Skip |
| Auto-Rig Pro (Smart and Remap) | own rig | Blender add-on, mostly GUI | $50 | Fallback; buying it needs Kevin's OK |

### Motion sources

| Source | What | Automation | Cost | Licence | Fit |
|---|---|---|---|---|---|
| Meshy library (`animation_action_id` 0–696) | About 600 biped clips. Attack 4, Double_Combo_Attack 92, Heavy_Hammer_Swing 128, Archery_Shot 224, CastingSpell category, Roll_Dodge 158, Push 259–262, Knock_Down 187, Fall1 502, Block1 138, Sword_Parry 147, Hit_Reaction 178 | fal | $0.12 per clip on top of the rig. One clip per call, so each extra clip re-rigs ($0.32) | fal/Meshy terms; check before a public build | The only source found that covers all of Kevin's motions |
| Quaternius Universal Animation Library 1 and 2 | 130+ clips: melee, weapon handling, roll, hit | download | free | CC0 | Free baseline |
| Mixamo library | 2,000+ clips; good locomotion, dated attacks | GUI | free | royalty-free; no redistribution or ML training | Meshy covers the same ground |
| Cascadeur | Physics-assisted keyframing (AutoPosing) | GUI, Ubuntu build, Python `csc` module (headless unproven) | Indie $19/mo or $96/yr; the free plan cannot export FBX | Indie: under $100k revenue | For bespoke class attacks after a winner is picked, as its own ask |
| Uthana | Text-to-motion and video-to-motion; FBX, GLB, BVH | GraphQL API | $0.10/s (about $0.30 per attack) | commercial use on paid usage | Experimental; new key needed |
| DeepMotion, Move One, Rokoko Video, Plask | Video-to-motion | web or app | $9–18/mo | varies | Needs filmed footage. Not planned |
| ActorCore store | Sword-and-shield and fight packs | GUI store | about $1.5–12 per motion | Reallusion standard | Fallback |
| Kevin Iglesias packs | 356 basic motions plus melee sets | download | $18–130 | terms not found | Fallback |
| UE5 Game Animation Sample | 500+ clips | Unreal project | free | Unreal Engine only | Skip |
| HY-Motion 1.0, MoMask, MDM, MotionHiFlow | Text-to-motion on SMPL | GPU (24–26 GB) | GPU rental | varies | Little combat in training data. Skip |
| Bandai Namco Research Motion | BVH, 17 content types including fighting | already on the NUC | free | CC BY-NC (possibly -ND) | Re-test through arm C's plain retarget |
| LaFAN1 | Locomotion plus some fights | already on the NUC | free | CC BY-NC-ND | Private output only |
| 100STYLE, CMU | Locomotion | download | free | CC BY 4.0, free use | Locomotion only |

### Blender retargeting and the pixel pass

- **Retarget add-on (KBS-DEV).** GPL, the maintained successor to Expy Kit. It has Mixamo, Rigify and ARP presets and a "Bake Constrained Actions" step. It needs Blender 5.0 or newer; the NUC runs 4.3.
- **Two-armature standard retarget.** Copy rotations in rest-pose-matched space, then `nla.bake`. It is scriptable on 4.3 today, and arm C uses it.
- **Fallbacks.** Rokoko's add-on (free, GUI) and Auto-Rig Pro Remap ($50, GUI).
- **Dead Cells.** It renders 3D animation through a pixel shader. Vasseur's advice: set keyframes first, then add as few in-betweens as the timing needs.
- **ProPixelizer.** Stepped interpolation and snapped view angles.
- **Why evenly sampled 3D reads as floating:** sub-pixel drift and over-smooth easing. H3 tests the fix.

### 2D-native

- **PixelLab.** REST API.
  - Skeleton v3 handles up to 256 px and 3–15 frames. Animate-character Pro handles up to 128 px.
  - About $0.04–0.08 per call, and about $0.035 for 8 rotations.
  - Matching the pack's style is unproven.
  - Input must be our own base-body render, never a pack sprite.
- **Retro Diffusion.** 48 px default, too small for 128 px cells. Skip.
- **Ludo.ai, Scenario, God Mode.** Only vendor evidence. Skip.
- **Spine.** Essential $69, Pro $379. The CLI exports data only, and the Phaser runtime needs Phaser 4.2.1 or newer. Rotating pixel parts blurs them and breaks outlines, and 8 directions means 8 rigs. Last resort.
- **DragonBones, Creature.** Unmaintained. Skip.

## Recommendation: one bake-off on one body (core #1282)

### Setup

- **Subject:** the Warrior male base body.
- **Clips:** walk and one attack.
- **Render:** S and SE through the pack camera (height 43, origin row 88), with finish B.
- **Comparison:** beside the 6Barbarian Walk and Attack1, as 1x and 4x GIF/MP4.
- **Two samplings:** each 3D arm is rendered evenly sampled and key-pose stepped.
- **Defaults:** no stance layer and no IK re-solve unless the arm says otherwise. The KayKit axe goes on `hand.R`.

### Arms

| Arm | What | Cost | Kevin's OK |
|---|---|---|---|
| 0 Control | A Quaternius CC0 character playing its own clips on its own rig, no retarget | $0 | no |
| A Meshy | Mixamo template, with a one-call pre-flight. The vendor walk plus attacks 4, 128 and 92, played as delivered | $0.96, or $1.28 max | yes (fal) |
| B Hyper3D | `human` template with `core` skinning. The stock walk plus our FBX clips, retargeted by the vendor | $0.40 max | yes (fal) |
| C Plain retarget | Arm A's rig. Quaternius and Bandai clips through a name-mapped copy-rotation retarget and bake | $0 | no |
| D PixelLab | From our own base-body render: walk and one attack, in 2 directions | about $0.50–1.00 | yes (new key, spend) |

### Totals

- **fal:** $1.68 at most, needing a cap raise for these runs.
- **PixelLab:** about $1.
- **Overall:** about $2.70 at most.
- **CPU time:** 2–3 h, one Blender job at a time.

### Review

- One card per clip, with the pack original in column 1.
- The worker views every 4x clip before posting and writes one line per cell on whether it reads as human.
- Kevin's eye is the gate.
- One Command: pick an arm, or none.

## Risks

- **Vendor rigs may fail on fused TRELLIS thighs.** Arm A's one-call pre-flight catches this.
- **Vendor terms are unconfirmed.** We have not seen the output licences or whether uploads are used for training.
- **The render may be the fault.** If arm 0 also looks inhuman, the next spike is the pixel pass (key poses, smears, Stage 4 3D in engine), not motion sources.

## Sources

fal Meshy rigging (https://fal.ai/models/fal-ai/meshy/rigging/llms.txt), Meshy animation library (https://docs.meshy.ai/en/api/animation-library), fal Hyper3D rigging (https://fal.ai/models/fal-ai/hyper3d/rigging/llms.txt), Tripo (https://developers.tripo3d.com/en/models/rig), Mixamo FAQ (https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html) and forum (https://community.adobe.com/questions-696/mixamo-auto-rigging-not-working-1614892), AccuRIG 2 (https://www.cgchannel.com/2025/07/rig-and-animate-3d-characters-for-free-with-accurig-2-0/), UniRig (https://github.com/VAST-AI-Research/UniRig), SkinTokens (https://arxiv.org/html/2602.04805), Make-It-Animatable (https://github.com/jasongzy/Make-It-Animatable), RigAnything (https://arxiv.org/abs/2502.09615), Auto-Rig Pro (https://superhivemarket.com/products/auto-rig-pro/versions), Retarget add-on (https://extensions.blender.org/add-ons/retarget/), Cascadeur (https://cascadeur.com/plans), Uthana (https://uthana.com/pricing), DeepMotion (https://deepmotion.com/animate-3d-api), Quaternius UAL2 (https://quaternius.com/packs/universalanimationlibrary2.html), UE GASP licence (https://www.cgchannel.com/2024/06/get-500-free-game-ready-animations-for-use-in-unreal-engine), HY-Motion (https://github.com/Tencent-Hunyuan/HY-Motion-1.0), T2MBench (https://arxiv.org/html/2602.13751), Bandai Namco (https://github.com/BandaiNamcoResearchInc/Bandai-Namco-Research-Motiondataset), LaFAN1 (https://github.com/ubisoft/ubisoft-laforge-animation-dataset), 100STYLE (https://ianxmason.github.io/100style), Dead Cells (https://www.jikguard.com/news/art-design-deep-dive-using-a-3d-pipeline-for-2d-animation-in-dead-cells), ProPixelizer (https://propixelizer.github.io/docs/usage/tips), PixelLab (https://www.pixellab.ai/pixellab-api), Spine (https://esotericsoftware.com/spine-purchase), spine-phaser (https://esotericsoftware.com/spine-phaser).
