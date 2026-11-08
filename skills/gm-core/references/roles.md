# Ticket roles

Every game ticket carries `game:<slug>` and one or more `role:*` labels. aiur inlines each label's mandatory skills at
the start of the ticket (`agent.skills.by_label`), so the labels decide what the worker knows before it reads a file.
Pick roles by the work the ticket does; a ticket that spans two kinds of work gets both.

This table is the one source: `gm skills config` prints the aiur config from it, the builder writes its role labels
into each game daemon's config, and `gm plan check` refuses a ticket whose roles are not in it.

| Label | Work | Mandatory skills |
|---|---|---|
| `role:visual` | screens, HUD, menus, look and layout | gm-core, gm-verify, gm-ui-hud, gm-image-mock |
| `role:3d` | models, scenes, cameras and 3D assets | gm-core, gm-3d, gm-verify |
| `role:gameplay` | rules, controls, entities and game feel | gm-core, gm-input, gm-verify, gm-qa |
| `role:audio` | music, sound effects and voice | gm-core, gm-audio, gm-voiceover |
| `role:qa` | playtests, journeys and verification | gm-core, gm-qa, gm-verify |
| `role:multiplayer` | rooms, shared state and netcode | gm-core, gm-multiplayer-ready, gm-qa |
| `role:game-design` | scope, flow, plans and creator options | gm-core, gm-new-game-design, gm-new-game-plan, gm-image-mock, gm-scope-options |
| `role:assets` | pack adapters, variants and showcases | gm-core, gm-asset-variants, gm-pack-adapter, gm-asset-showcase |

## The game label

`game:<slug>` maps to `gm-core` and the set skill `gm-set-<set>`, where `<set>` is the `set` in
`games/<slug>/gm.lock.json` (a game with no set gets `gm-core` alone). It carries game-wide context only; the work
skills come from the roles.

## Recommended vendored skills

A role's recommended skills are loaded on demand: open one when the step it names comes up. They never replace the
role's mandatory skills, which are inlined at the start. Paths are relative to `.claude/skills/`; each vendored skill is
also installed flat under its own name (`.claude/skills/threejs-lighting/`), so a skill index lists it.

Three.js games load the `threejs` rows, Phaser games the `phaser` rows; `gamedev` rows suit both.

### role:3d

| Skill | Load when |
|---|---|
| `vendor/threejs/threejs-lighting/SKILL.md` | adding or tuning lights, shadows, or environment lighting |
| `vendor/threejs/threejs-materials/SKILL.md` | choosing or tuning a material |
| `vendor/threejs/threejs-textures/SKILL.md` | colour spaces, UVs, or texture memory |
| `vendor/threejs/threejs-postprocessing/SKILL.md` | bloom, ambient occlusion, or another screen effect |
| `vendor/threejs/threejs-performance/SKILL.md` | draw calls, instancing, LOD, or a frame budget |
| `vendor/gamedev/threejs-scene-setup/SKILL.md` | the renderer, scene, resize, or render loop |
| `vendor/gamedev/threejs-materials-lighting/SKILL.md` | a model that looks black, flat, or wrong |
| `vendor/gamedev/camera-systems/SKILL.md` | a follow, orbit, or framing camera |

### role:visual

| Skill | Load when |
|---|---|
| `vendor/gamedev/game-ui-ux/SKILL.md` | HUD, menus, anchors, safe areas, or focus order |
| `vendor/threejs/threejs-postprocessing/SKILL.md` | a screen effect in a three.js game |
| `vendor/phaser/scale-and-responsive/SKILL.md` | scaling and aspect in a Phaser game |
| `vendor/phaser/text-and-bitmaptext/SKILL.md` | readable text in a Phaser game |
| `vendor/phaser/filters-and-postfx/SKILL.md` | a screen effect in a Phaser game |
| `vendor/frontend-design/frontend-design/SKILL.md` | layout and type of menus, HUD and app screens; the approved targets and the Gruvbox palette win |
| `vendor/sprite-forge/generate2dsprite/SKILL.md` | a 2D sprite no pack has (gm-asset-variants' rules: ask first, `--route codex-cli`) |
| `vendor/video-to-game/references/study-the-video.md` | the creator's clip is the look to match, or a build is compared with it |

### role:gameplay

| Skill | Load when |
|---|---|
| `vendor/gamedev/game-feel/SKILL.md` | shake, hit-stop, easing, knockback, or feedback |
| `vendor/gamedev/input-systems/SKILL.md` | actions, buffering, coyote time, rebinding, or touch |
| `vendor/phaser/input-keyboard-mouse-touch/SKILL.md` | pointer, keyboard, or touch input in a Phaser game |
| `vendor/phaser/physics-arcade/SKILL.md` | movement and collision in a Phaser game |
| `vendor/phaser/tweens/SKILL.md` | eased motion in a Phaser game |
| `vendor/phaser/cameras/SKILL.md` | follow, shake, or zoom in a Phaser game |

### role:audio

| Skill | Load when |
|---|---|
| `vendor/gamedev/audio-design/SKILL.md` | buses, ducking, adaptive music, or SFX variation |
| `vendor/phaser/audio-and-sound/SKILL.md` | playing sound in a Phaser game |

### role:game-design

| Skill | Load when |
|---|---|
| `vendor/gamedev/prototype-fast/SKILL.md` | a timeboxed slice that answers one question |
| `vendor/gamedev/level-design/SKILL.md` | blockout, pacing, gating, or encounters |
| `vendor/phaser/tilemaps/SKILL.md` | a tile-based level in a Phaser game |
| `vendor/video-to-game/references/study-the-video.md` | the creator's clip is the look to match |

### role:assets

| Skill | Load when |
|---|---|
| `vendor/sprite-forge/generate2dsprite/SKILL.md` | a 2D character, prop or FX sheet no pack has |
| `vendor/sprite-forge/generate2dmap/SKILL.md` | a 2D tilemap, prop pack or parallax background |
| `vendor/sprite-forge/video2dsprite/SKILL.md` | turning a clip the creator supplies into 2D frames |

Sprite Forge rows are for 2D games and follow gm-asset-variants' rules: ask the Executor before any generation, every
generating call passes `--route codex-cli`, no provider key, no paid-pack references.

## Everything else is on demand

Skills outside a ticket's mandatory set are found with `gm skills search <words>` and read with
`gm skills show <name>`. That catalog is for discovery; it never replaces the inlined set.
