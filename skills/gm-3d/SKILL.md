---
name: gm-3d
description: Author and verify rights-cleared 3D assets offline with Blender, then use Three.js at runtime.
---

# Game Maker 3D

Use Blender for offline mesh, material, rig, animation, GLB, still, and turntable work. Do not rebuild offline authoring
inside Three.js or put game rules in a Blender script. For the runtime step, load its skill:

| Runtime step | Skill |
|---|---|
| lighting and shadows | `vendor/threejs/threejs-lighting/SKILL.md` |
| materials | `vendor/threejs/threejs-materials/SKILL.md` |
| textures and colour spaces | `vendor/threejs/threejs-textures/SKILL.md` |
| loading a GLB and its clips | `vendor/gamedev/threejs-gltf-loading/SKILL.md` |
| scene, renderer, and loop | `vendor/gamedev/threejs-scene-setup/SKILL.md` |
| cameras | `vendor/gamedev/camera-systems/SKILL.md` |
| post-processing | `vendor/threejs/threejs-postprocessing/SKILL.md` |
| performance | `vendor/threejs/threejs-performance/SKILL.md` |

## Author deterministically

Start with installed asset cards or procedural geometry. Record asset provenance before opening a source file, and
keep paid-pack sources and derivatives under ignored `assets-local/`; never upload them. A script must create or open
an exact input, set units and transforms, name important objects, set an explicit renderer and camera, and write to an
explicit local path.

Run scripts headlessly as `blender --background --python-exit-code 1 --python scene.py`; the error-code option must
precede the script option or Blender can still exit zero after a Python exception. Seed randomness, avoid GUI
state, and fail on missing inputs. Apply only the transforms the runtime contract requires. For GLB, inspect scale,
axes, material slots, textures, animation names, and triangle count before the game consumes it.

Blender MCP is optional operator tooling. Document the upstream server when an operator wants an interactive session,
but do not install its add-on, edit MCP configuration, open a local control socket, or make a build depend on it.

## Prepare an item for a set

A model is ready for a game when it is the right size and stands on its own origin, not when the export finished. For
every item: real metres from a looked-up height (a desk phone is about 0.12 m, a mug 0.095 m) or exact dims for a boxy
prop the generator invented depth for; bottom-centre origin, which in glTF's Y-up space means the model stands on min Y
and is centred on X and Z; one forward axis for the whole set, recorded beside it, because glTF has no facing
convention and a set that faces six ways reads as six sets; and the mesh data rotated and scaled, never the object, so
later imports do not compound the transform. Importing from a generator? Drop its framing rotation before turning the
mesh, or the model arrives 20-30 degrees off.

Budgets per item, with a LOD1 at about a quarter of LOD0 and textures at 2K or less:

| Detail | Triangles | Textures | LOD1 |
|---|---|---|---|
| low | 20,000 | 1K | ~5,000 |
| medium | 100,000 | 2K | ~25,000 |
| high | 200,000 | 2K | ~50,000 |

Gate the export before anything loads it, and keep the report with the item:

```sh
python3 -I scripts/assets/check_glb.py --budget medium --height 0.32 --require-lod1 out/items/mug/mug.glb
```

`--lineup` prints the to-scale x positions for the set and the scale bar to draw under them; put the bar under the
still and look at it, because proportion between items is what a single thumbnail cannot show. A rebuild is retry-safe:
`--jobs scenes/prep.json` lists what is still `pending` and treats an item whose `stats.json` is newer than its GLB and
than the jobs file as done, so a rerun never redoes a finished item. Where each of these comes from, and what was
skipped: `docs/research/anykit-lessons-2026-11.md`.

## Gate the output

Render diagnostic angles with a neutral world and explicit lights. For a turntable, keep the object fixed and move the
camera or an empty by a known angle per frame. Encode locally through FFmpeg, then require H.264, `yuv420p`, expected
duration and dimensions, and top-level `moov` before `mdat`. Load `gm-verify` and inspect silhouette, normals,
materials, clipping, scale cues, and at least three angles.

## Worked example

The local example procedurally builds a bevelled cube with a ring and three colored axis markers, renders a short
Workbench turntable, and writes `assets-local/sets/examples/gm-3d/turntable.mp4`. It contains no downloaded asset; its Blender
source, frames, and MP4 remain ignored local evidence.
