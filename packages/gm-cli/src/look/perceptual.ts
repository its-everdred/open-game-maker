import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import type { Image } from './score.js';

const exec = promisify(execFile);
// Refuse all model downloads: LPIPS can only use a locally installed package and cached weights.
const script = `
import sys
import torch
import torch.hub
import lpips
import numpy as np
from PIL import Image
def offline(*args, **kwargs): raise RuntimeError('model weights are not cached')
torch.hub.download_url_to_file = offline
model = lpips.LPIPS(net='alex', verbose=False).eval()
def tensor(path):
    arr = np.asarray(Image.open(path).convert('RGB'), dtype=np.float32) / 127.5 - 1
    return torch.from_numpy(arr).permute(2,0,1).unsqueeze(0)
with torch.no_grad(): print(float(model(tensor(sys.argv[1]), tensor(sys.argv[2])).item()))
`;

export async function perceptual(a: Image, b: Image): Promise<{ score: number | null; note: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'gm-look-'));
  try {
    const paths = [join(dir, 'target.png'), join(dir, 'candidate.png')];
    await Promise.all(
      [a, b].map((im, i) =>
        sharp(im.pixels, { raw: { width: im.width, height: im.height, channels: 3 } })
          .png()
          .toFile(paths[i]!),
      ),
    );
    const result = await exec('python3', ['-c', script, ...paths], { timeout: 60_000 });
    const value = Number(result.stdout.trim().split('\n').at(-1));
    if (!Number.isFinite(value)) throw new Error('invalid LPIPS result');
    return { score: value, note: 'LPIPS AlexNet distance; lower is closer' };
  } catch {
    return { score: null, note: 'LPIPS or cached local model unavailable; perceptual score skipped' };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
