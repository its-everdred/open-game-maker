---
name: anymachine
description: Build a custom Blender rig, moving machine or static prop from references when no pack part fits; check and export GLB.
source: apekshik/anymachine@d5e8889eef0b33e0bbe62ddca6f713f94b154b68 PIPELINE.md
license: MIT
modified: true
---

# AnyMachine

Use for a custom moving machine or complicated static prop in a 3D game. Project rules below override upstream.

## Rules and host

Load `gm-assets` first when available; otherwise use `gm assets search` and `gm assets info` to search installed packs. Use fitting parts before building a part; match the pack style and run `python3 .claude/skills/vendor/anymachine/scripts/style-check.py <variant.glb> <source.glb>...`. Never send paid-pack assets or derivatives to the cloud. Do not use fal, Meshy or Tripo, provider keys, or paid services. Make references with our own Sprite Forge / Codex imagegen (mark them AI-generated) or local pack renders.

The upstream method requires Blender 5.x (5.2 for its current pipeline). This host has Blender 4.3.2 at `/usr/bin/blender`, not 5.x. A worker sandbox must have a Blender 5.x executable and its libraries exposed to it before running this workflow; do not install it as part of the task. Check `blender --version` inside the worker; host availability alone does not prove sandbox access.

## Build from references

1. Establish the whole object's proportions with six orthographic views, then close-up plates of mechanisms, materials and connections. Record source and scale; never invent unseen detail without noting it.
2. Write one deterministic Blender Python build script. Model real parts one at a time, with distinct materials, pivots and names; use pack parts wherever they fit. Set transforms, units, cameras and output paths explicitly. Run headlessly with `blender --background --python-exit-code 1 --python build.py`.
3. Render matching views beside the reference plates. Compare silhouette, proportions, joints and surface detail; make a second pass on the regions that came out plainer, then render and compare again. For static objects, apply the same part-by-part and close-up process without a rig.
4. For each joint, expose a 0–1 custom property with enforced physical limits. Bake each control to a separate linear glTF action whose one-second timeline represents 0–1, so an engine can pose it by `seek(t = value)`. Validate endpoints and intermediate values after export; don't assume Blender drivers survive glTF export.

## Machine checks before visual review

Sweep every control throughout its range and check evaluated world-space triangle overlaps between moving and fixed parts, distinguishing intentional rest contacts. Measure planted-foot displacement during stance for walking actions; report slip and fix it. Export GLB, re-import it into an empty scene, and compare geometry, transforms, materials, joints, action names, durations and sampled poses against the source. Fail or report missing coverage rather than claiming a pass. Then load `gm-verify` for visual inspection.

The laptop and stilt scripts in `scripts/` are upstream **examples**, tied to their original laptop or stilt object names and paths, not generic validators. Adapt their BVH sweep and re-import checks to the current build and write results locally; inspect the scripts before running them. They do not supply a general foot-slip check. Keep the build script and check evidence with the local asset, not in the skill library.
