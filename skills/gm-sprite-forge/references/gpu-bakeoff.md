# GPU bake-off

How to run a multi-tool 3D→2D comparison on a GPU host. Issue #1094 ran it for Tree E3, Flora B1 and Goblin 01 walk
on an RTX 4080.

## Setup

- **Blender:** portable Blender 4.3 or later in `~/opt/blender` (no sudo). Check that Cycles lists an OptiX or CUDA device:
  `gpu_bake_rig.py` exits rather than fall back to CPU.
- **One GPU job at a time:** on the PC, run every GPU job (Blender, TripoSR, Hunyuan3D-2, any local image-to-3D) through
  `~/.local/bin/gpu-run <cmd>` (creator rule after the 2026-11-21 PC freeze). It refuses below 4 GB free VRAM or while a
  game is running; exit 75 means retry later. `~/opt/blender/blender` already goes through it. fal calls do not.
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
# A procedural goblin walk sheet, 8 x 15 at 128 px (only after the static sprite is approved)
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

## Creator verdicts (2026-11-21)

The creator judged the arm E (fal) review cards (`Original | 3D | 2D pixel`) on the review page:

- **Characters (goblin, orc): TRELLIS v1 multi-view** (`fal-ai/trellis/multi`, about 0.02 USD), plain or with
  multidiffusion. In the creator's words: "stick to trellis, $0.02 is clearly good enough, higher isn't worth the [cost]. The model
  looks good, but too much detail is being expressed in the final sprite to match the original sprite style. The
  original sprite has fewer colors and chunkier pixels. Let's keep the 3D models and iterate on the shader next."
- **Tree E3: TRELLIS 2** (`fal-ai/trellis-2`, 0.25 USD at 512) was his pick, with "rodin is good too and cheaper, use it
  for others": use Rodin 2.5 fast (`fal-ai/hyper3d/rodin/v2.5/fast`, 0.10 USD) for the other non-character assets.
- **Final call (21:05–21:28Z):** on the orc cards the creator wrote "trellis sprites looks fine" and stopped the orc
  rounds; Tripo H3.1 multiview (0.30 USD) "looks best but too expensive". The Executor closed the 3D→2D bake-off on
  TRELLIS multi-view: no more goblin, orc or tree rounds and no more fal spend on the comparison. The routing above
  stays for production meshes.
- The re-rendered PC matrices (#1120): Tree E3 liked C Hunyuan3D-2 (`dec_f324d605f82d98c9`); Flora B1 liked B CC0
  with "close but color is way off" (`dec_c7a5db3337cbf08d`); Goblin 01 disliked all four walk arms
  (`dec_eebc9455918f02f9`): "this step should have waited behind the pixel art sprites to be finalized", so
  animation now waits for an approved static sprite (SKILL.md). The PC skill arms
  (AnyMachine, AnyKit normalize) did not run: the bake-off closed first.
- The Tree E3 meshes came from the pack's own views, which the creator allowed for this comparison only. New fal
  calls get Codex turnarounds made with the original attached, never a pack file.

The verdict comments name the picked card, not the asset; the asset each one belongs to is read from which arms ran
for which asset (TRELLIS multidiffusion ran only for the goblin and orc, and TRELLIS 2 was the only pick with a tree
note). The mesh is settled; the open problem is the finish pass. The 2D sprite must use fewer colours and chunkier
pixels than `gpu_bake_finish.py` produces today. Keep the TRELLIS meshes and iterate on the finish pass, not the mesh
source. The GPU arms A–C below and the first three GPU matrices (`dec_4bea60ce4c10e8bd`, `dec_63c305f541835ca1`,
`dec_bf26410d0ca0dcc3`) have no separate verdict. For routing, the fal picks supersede both those matrices and the #1120 picks; the #1120
picks only guide the local fallback without fal.

## Results (#1094, 2026-11-20)

These are local evidence from the GPU arms, kept for the record; routing follows the creator verdicts above.

| Asset kind | Strongest by local evidence | Notes |
|---|---|---|
| Trees (bare) | C Hunyuan3D-2 from the original view, then A procedural | Hunyuan kept real branch structure (silhouette IoU 0.36 mean, best palette). TripoSR fails on thin branches. Leafless CC0 trees are close in look but not in shape. |
| Foliage (grass clump) | C Hunyuan3D-2, with A procedural close behind | Hunyuan IoU 0.73 against 0.62 for A and 0.61 for scattered CC0 grass. TripoSR produced a flat card. |
| Characters (walk) | A procedural | A scripted body with a scripted walk had the best 3D motion correlation (0.41). Freely available CC0 goblins are boxy low-poly. Image-to-3D from a 29×34 px frame misread the axe. D (2D) scores highest on silhouette but has the weakest motion. Superseded: the creator disliked all four walks on #1120. |
| Props | Not tested | — |
| Spinnable fake 3D (any game) | S sprite stacking (`vendor/sprite-stacking`), local and free | Stacked flat slices, not a mesh: for assets that must turn to any angle when the pack has four orthographic views. On Tree E3's isometric views (no top view) the hull filled the branches into a bush; silhouette IoU 0.37 mean, all prop gates but palette, lightness and shadow failed (NUC, 2026-11-21). |

No arm passed the gates. Single-view image-to-3D invents the unseen sides, so check all four views by eye.

## Arm E: fal image-to-3D (NUC host only)

The creator added a fal key on the NUC (2026-11-21) with a 9 USD cap across every fal call. Workers have no key: a
ticket writes the exact calls, and the NUC Executor runs them with `scripts/fal3d.py` against the one host ledger
(`OGM_FAL_LEDGER`; it refuses a call that would pass the cap). fal receives only images generated through the free Codex
route with the originals attached, never a pack file. Mark every fal mesh `"ai_generated": true` in its `recipe.json`.
Each mesh then goes through the same rig, finish pass and `score.py` as arms A–D (`b_model.py` for props and trees,
`c_goblin.py` for characters), so the only difference between columns is the mesh source.

```sh
S=skills/gm-sprite-forge/scripts
python3 -I $S/fal3d.py price fal-ai/trellis-2 meshy/v7.1/multi-image-to-3d
OGM_FAL_LEDGER=<ledger.json> python3 -I $S/fal3d.py run fal-ai/trellis-2 out/trellis2 0.25 image_url=@turn_front.png
```

Candidate arms, cheapest first (listed prices from fal's model pages, 2026-11-21; check `price` before a first call):

| Arm | Endpoint | USD per call | Notes |
|---|---|---|---|
| SAM 3D Objects / Body | `fal-ai/sam-3/3d-objects`, `fal-ai/sam-3/3d-body` | 0.02 per unit | Body is a human body fit; try it on characters |
| TRELLIS (v1), single and multi | `fal-ai/trellis`, `fal-ai/trellis/multi` | ~0.02 | Run in arm E, 2026-11-21 |
| Hunyuan3D 2 mini / multi-view | `fal-ai/hunyuan3d/v2/mini`, `fal-ai/hunyuan3d/v2/multi-view` | 0.10 / 0.16 (×3 textured) | Multi-view run in arm E |
| Rodin Gen-2.5 fast | `fal-ai/hyper3d/rodin/v2.5/fast` | 0.10 | Rodin v1 run in arm E at 0.40 |
| Idol Max turbo | `speridlabs/idol/max/turbo` | 0.10 (+0.10 PBR, +0.025 rig) | Rigged character output |
| Hyper3D low-poly | `hyper3d/lowpoly/image-to-3d` | 0.20 | |
| Meshy T2.5 | `meshy/t2.5/image-to-3d` | 0.20 mesh / 0.60 textured | |
| Hunyuan 3D 3.1 rapid / pro | `fal-ai/hunyuan-3d/v3.1/rapid/image-to-3d`, `.../pro/image-to-3d` | 0.225 / 0.375 (+0.15 multi-view, +0.15 PBR) | |
| TRELLIS 2 | `fal-ai/trellis-2` | 0.25 (512) – 0.35 (1536) | |
| Tripo H3.1 multiview | `tripo3d/h3.1/multiview-to-3d` | 0.30 textured (+0.20 detailed) | AnyKit's hard-surface pick; Tripo v2.5 run in arm E |
| Meshy 7.1 multi-image | `meshy/v7.1/multi-image-to-3d` | 0.80 mesh / 1.20 textured | AnyKit's pick for ~70% of props |
| Meshy rigging + walk | `fal-ai/meshy/rigging/multi-animation` | 0.20 + 0.12 per clip | On a fal mesh; compare with the shared scripted walk |

Skill arms on top of a fal mesh, each its own column: **AnyKit** (`vendor/anykit`: the same reference to Tripo and
Meshy, pick per item from clay renders, `normalize.py`), **AnyMachine** (`vendor/anymachine`: a Blender build script
written from the reference views, Blender 5 on the PC; no fal needed) and **video-to-game** (`vendor/video-to-game`
`references/fal-assets.md`: cutout, image-to-3D, Meshy rig and walk). The creator verdicts above set the routing:
TRELLIS v1 multi-view for characters, TRELLIS 2 for trees, Rodin 2.5 fast for foliage and props.
