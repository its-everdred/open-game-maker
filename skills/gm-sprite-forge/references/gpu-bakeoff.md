# GPU bake-off

How to run a multi-tool 3D→2D comparison on a GPU host. Issue #1094 ran it for Tree E3, Flora B1 and Goblin 01 walk
on an RTX 4080.

## Setup

- **Blender:** portable Blender 4.3 or later in `~/opt/blender` (no sudo). Check that Cycles lists an OptiX or CUDA device:
  `gpu_bake_rig.py` exits rather than fall back to CPU.
- **Image-to-3D:** a separate Python 3.11 environment in `~/opt/ogm-i23d` (or set `OGM_I23D`), with torch 2.5.1+cu124
  and the clones `TripoSR/` and `Hunyuan3D-2/`. Pin `torchvision` 0.20.1 and `accelerate` below 1.6, or newer packages
  pull in a torch that the pinned torchvision cannot load. Without `nvcc`, `torchmcubes` will not build, so patch TripoSR's
  `tsr/models/isosurface.py` to fall back to `skimage.measure.marching_cubes`. Hunyuan3D-2's shape model
  (`hunyuan3d-dit-v2-0`, fp16) downloads about 5 GB on first use. Check its licence before use: it excludes the EU, the UK and
  South Korea, and its outputs are not model derivatives.
- **CC0 models:** Poly Haven (`api.polyhaven.com/files/<id>`, 1k glTF) for vegetation; poly.pizza for animated characters
  (check that each model page says CC0; many are CC-BY).

## Run

Every arm goes through the same rig and the same finish pass. A builder is a Python file with `build(P)` that returns
root objects (Z up, front −Y). Ready-made builders are in `scripts/bakeoff/`:

| Builder | Arm |
|---|---|
| `a_tree.py`, `a_flora.py`, `a_goblin.py` | A procedural (the goblin uses `gob_common.py`: skeleton, 15-frame walk, axe) |
| `b_model.py` (`MODEL=`, `DROP=` material regex, `TINT=r,g,b`, `SCATTER=N`, `VH=`) | B CC0 model, also image-to-3D meshes (`VCOL=1`, `ROTX=`, `ROTZ=`) |
| `b_goblin.py` (`MODEL=`) | B Quaternius goblin with its own walk |
| `c_goblin.py` (`MODEL=`) | C image-to-3D mesh bound to the shared skeleton and walk |

Run from the repository root with `~/opt/blender` on `PATH`. Use the Pillow/NumPy/SciPy/scikit-image environment from
SKILL.md for the finish and score steps. `REF` is a local folder of originals outside the repository, and `raw/` and
`out/` are local scratch folders.

```sh
S=skills/gm-sprite-forge/scripts
# A procedural tree, four views
blender -b --factory-startup --python $S/gpu_bake_rig.py -- raw/ $S/bakeoff/a_tree.py height_px=147 samples=64 sun_elev=70 shadow=0
python $S/gpu_bake_finish.py raw/ out/ --colour-ref "$REF/Tree E3_N.png" "$REF/Tree E3_E.png" "$REF/Tree E3_S.png" "$REF/Tree E3_W.png"
python $S/score.py "$REF/Tree E3_S.png" out/S.png --gates prop
# C image-to-3D: mesh from the original's S view (local GPU), then the same rig; builder options are environment variables
~/opt/ogm-i23d/venv/bin/python $S/bakeoff/hy_run.py "$REF/Tree E3_S.png" mesh.glb
MODEL=mesh.glb VCOL=1 ROTZ=225 blender -b --factory-startup --python $S/gpu_bake_rig.py -- raw/ $S/bakeoff/b_model.py height_px=147 samples=64 shadow=0
# A procedural goblin walk sheet, 8 x 15 at 128 px
blender -b --factory-startup --python $S/gpu_bake_rig.py -- raw/ $S/bakeoff/a_goblin.py mode=sheet cell=128 origin_row=90 height_px=34 samples=32 shadow=0
python $S/gpu_bake_finish.py raw/ out/ --cell 128 --colour-ref "$REF/Walk.png"
python $S/score.py "$REF/Walk.png" out/sheet.png --cell 128 --gates character-128
```

`tsr_run.py in.png out.glb` runs TripoSR the same way as `hy_run.py`.

`height_px` is the original's object height in its S view: the rig scales the model uniformly to it and fits nothing
else. Props write `N/E/S/W.png`. Sheets write `sheet.png` (rows E, SE, S, SW, W, NW, N, NE; 15 frames from
`frame_start` to just before `frame_end`, so set `frame_end` to the first frame of the next loop). `render.json` records the
Blender version, backend, samples, scale, minutes and device memory. For an image-to-3D mesh, try a few `ROTX`/`ROTZ`
values and keep the one whose S view best matches the input. Hunyuan3D-2 needs none; TripoSR comes back on its side
and tilted by the reference camera's 30°.

## Results (#1094, 2026-11-20)

These are local evidence only. The creator's verdicts arrive on review Commands `dec_4bea60ce4c10e8bd` (Tree E3),
`dec_63c305f541835ca1` (Flora B1) and `dec_bf26410d0ca0dcc3` (Goblin 01 walk). When one is answered, update this table,
the matching capability-matrix row and the routing paragraph in SKILL.md together.

| Asset kind | Strongest by local evidence | Notes |
|---|---|---|
| Trees (bare) | C Hunyuan3D-2 from the original view, then A procedural | Hunyuan kept real branch structure (silhouette IoU 0.36 mean, best palette). TripoSR fails on thin branches. Leafless CC0 trees are close in look but not in shape. |
| Foliage (grass clump) | C Hunyuan3D-2, with A procedural close behind | Hunyuan IoU 0.73 against 0.62 for A and 0.61 for scattered CC0 grass. TripoSR produced a flat card. |
| Characters (walk) | A procedural | A scripted body with a scripted walk had the best 3D motion correlation (0.41). Freely available CC0 goblins are boxy low-poly. Image-to-3D from a 29×34 px frame misread the axe. D (2D) scores highest on silhouette but has the weakest motion. |
| Props | Not tested | — |

No arm passed the gates. Single-view image-to-3D invents the unseen sides, so check all four views by eye.
