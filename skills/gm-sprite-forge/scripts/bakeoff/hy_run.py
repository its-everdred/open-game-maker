"""Hunyuan3D-2 shape (DiT v2-0) on the GPU: RGBA sprite -> untextured mesh, then vertex colours projected from
the input image along the view axis. Usage: hy_run.py in.png out.glb"""
import os
import sys
import time

sys.path.insert(0, os.path.expanduser(os.environ.get('OGM_I23D', '~/opt/ogm-i23d')) + '/Hunyuan3D-2')
import numpy as np
import torch
import trimesh
from PIL import Image
from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline

src, out = sys.argv[1], sys.argv[2]
t0 = time.time()
torch.cuda.reset_peak_memory_stats()
pipe = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained('tencent/Hunyuan3D-2', subfolder='hunyuan3d-dit-v2-0',
                                                        variant='fp16')
im = Image.open(src).convert('RGBA')
im = im.crop(im.getbbox())
side = int(max(im.size) / 0.85)
canvas = Image.new('RGBA', (side, side), (255, 255, 255, 0))
canvas.alpha_composite(im, ((side - im.width) // 2, (side - im.height) // 2))
canvas = canvas.resize((512, 512), Image.LANCZOS)
mesh = pipe(image=canvas, num_inference_steps=50, octree_resolution=380,
            generator=torch.manual_seed(1234))[0]
# colour: orthographic projection of the input onto the mesh along the view axis (-Z in Hunyuan's frame)
v = np.asarray(mesh.vertices)
a = np.asarray(canvas).astype(np.float32)
lo, hi = v.min(0), v.max(0)
c = (lo + hi) / 2
span = (hi - lo)[:2].max() / 0.85
u = ((v[:, 0] - c[0]) / span + 0.5) * 511
w = (0.5 - (v[:, 1] - c[1]) / span) * 511
px = a[np.clip(w.round().astype(int), 0, 511), np.clip(u.round().astype(int), 0, 511)]
fill = a[a[..., 3] > 128][:, :3].mean(0)
rgb = np.where(px[:, 3:] > 128, px[:, :3], fill)
mesh.visual = trimesh.visual.ColorVisuals(mesh, vertex_colors=np.c_[rgb, np.full(len(v), 255)].astype(np.uint8))
mesh.export(out)
print(f'HY_DONE seconds={time.time() - t0:.1f} peak_gpu_mb={torch.cuda.max_memory_allocated() / 2**20:.0f} '
      f'verts={len(v)}')
