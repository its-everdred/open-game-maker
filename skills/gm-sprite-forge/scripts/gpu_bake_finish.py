"""Finish gpu_bake_rig.py renders into pack-size sprites: one pass shared by every bake-off arm.

Usage: gpu_bake_finish.py <raw_dir> <out_dir> --cell 256 [--colour-ref orig.png ...]
- premultiplied box downsample of each raw_*.png to the cell size (supersampled render -> soft pack highlights)
- finish.py contract: hard object alpha, black partial-alpha shadow
- with --colour-ref: lightness (CIELAB L) histogram match of object pixels to the original's object pixels;
  hue and chroma come from the materials
  (the pack has no fixed palette, so this matches its tonal range, not a palette index)
props -> <out>/<N|E|S|W>.png; sheets -> <out>/sheet.png (8 rows x 15 columns).
"""
import argparse
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from skimage.color import lab2rgb, rgb2lab
from skimage.exposure import match_histograms

sys.path.insert(0, str(Path(__file__).resolve().parent))
import spritemetrics as sm  # noqa: E402
from finish import finish  # noqa: E402


def downsample(path, cell):
    a = np.asarray(Image.open(path).convert('RGBA'), dtype=np.float64) / 255
    f = a.shape[0] // cell
    a[..., :3] *= a[..., 3:]
    a = a.reshape(cell, f, cell, f, 4).mean((1, 3))
    rgb = np.where(a[..., 3:] > 0, a[..., :3] / np.maximum(a[..., 3:], 1e-6), 0)
    return (np.concatenate([rgb, a[..., 3:]], -1) * 255).round().astype(np.uint8)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('raw', type=Path)
    ap.add_argument('out', type=Path)
    ap.add_argument('--cell', type=int, default=256)
    ap.add_argument('--colour-ref', nargs='*', default=[])
    x = ap.parse_args()
    ref = None
    if x.colour_ref:
        refs = [sm.load(p) for p in x.colour_ref]
        ref = np.concatenate([r[sm.mask(r)][:, :3] for r in refs])[None]
        ref_l = rgb2lab(ref / 255)[..., 0]
    frames = {}
    for p in sorted(x.raw.glob('raw_*.png')):
        a = finish(downsample(p, x.cell))
        obj = sm.mask(a)
        if ref is not None and obj.any():  # match lightness only; per-channel RGB matching shifts greys' hue
            lab = rgb2lab(a[..., :3][obj][None] / 255)
            lab[..., 0] = match_histograms(lab[..., 0], ref_l)
            a[..., :3][obj] = (lab2rgb(lab)[0] * 255).round().clip(0, 255)
        frames[p.stem[4:]] = a
    x.out.mkdir(parents=True, exist_ok=True)
    if all(re.fullmatch(r'\d+_\d+', k) for k in frames):
        sheet = np.zeros((8 * x.cell, 15 * x.cell, 4), np.uint8)
        for k, a in frames.items():
            r, c = map(int, k.split('_'))
            sheet[r * x.cell:(r + 1) * x.cell, c * x.cell:(c + 1) * x.cell] = a
        Image.fromarray(sheet).save(x.out / 'sheet.png')
    else:
        for k, a in frames.items():
            Image.fromarray(a).save(x.out / f'{k}.png')


if __name__ == '__main__':
    main()
