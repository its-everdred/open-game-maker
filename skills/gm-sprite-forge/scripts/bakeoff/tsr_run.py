"""TripoSR on the GPU: RGBA sprite -> <out>.glb (vertex colours). Usage: tsr_run.py in.png out.glb [mc_res]"""
import os
import sys
import time

sys.path.insert(0, os.path.expanduser(os.environ.get('OGM_I23D', '~/opt/ogm-i23d')) + '/TripoSR')
import numpy as np
import torch
from PIL import Image
from tsr.system import TSR
from tsr.utils import resize_foreground

src, out = sys.argv[1], sys.argv[2]
res = int(sys.argv[3]) if len(sys.argv) > 3 else 256
t0 = time.time()
torch.cuda.reset_peak_memory_stats()
model = TSR.from_pretrained('stabilityai/TripoSR', config_name='config.yaml', weight_name='model.ckpt')
model.renderer.set_chunk_size(8192)
model.to('cuda')
im = Image.open(src).convert('RGBA')
im = im.resize((im.width * 4, im.height * 4), Image.LANCZOS)
im = resize_foreground(im, 0.85)
a = np.asarray(im).astype(np.float32) / 255
rgb = a[..., :3] * a[..., 3:] + 0.5 * (1 - a[..., 3:])
image = Image.fromarray((rgb * 255).astype(np.uint8)).resize((512, 512))
with torch.no_grad():
    codes = model([image], device='cuda')
    mesh = model.extract_mesh(codes, True, resolution=res)[0]
mesh.export(out)
print(f'TSR_DONE seconds={time.time() - t0:.1f} peak_gpu_mb={torch.cuda.max_memory_allocated() / 2**20:.0f} '
      f'verts={len(mesh.vertices)}')
