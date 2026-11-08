# Roles

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
