"""Pack-style pixel finish (#1202): pixel_finish.py <sheet.png> <out.png> --colours N [--smooth] [--clean]

Run after the colour pass. The SmallScaleInt originals are flat: ~110-125 colours per frame, skin in ~4 tone bands,
~20% of neighbouring pixels identical, 1 px pixels, no outline, hard alpha. Our renders are smooth (~450 colours,
~1% identical neighbours). So: optional 3x3 median in Lab inside the silhouette (drops sub-pixel micro-shading), then one
k-means palette over the whole sheet (the same colours in every direction and frame; lightness weighted x2 so clusters
become tone bands, not hue noise), then optional cleanup that gives isolated pixels their neighbours' colour. No dithering
or outline; alpha is untouched. With a cloth mask, cloth gets its own palette: on one palette few colours merge the white
undergarments into pale skin (the underwear vanished). Kevin picked "B" (hero-finish1-warrior, 2026-11-22): 14 colours,
8 skin and 6 cloth, smoothed, no cleanup.
"""
import argparse

import numpy as np
from PIL import Image
from scipy.cluster.vq import kmeans2
from scipy.ndimage import median_filter
from skimage.color import lab2rgb, rgb2lab

W = np.array([2.0, 1.0, 1.0])  # L, a*, b* weights for the clustering


def pixel_finish(rgba, colours, smooth=False, clean=False, seed=7, cloth=None, cloth_colours=6):
    """rgba: uint8 (H, W, 4); cloth: optional bool (H, W) mask. Returns a copy with at most `colours` RGB colours
    inside the silhouette, plus at most `cloth_colours` on the cloth."""
    a = rgba.copy()
    m = a[..., 3] > 0
    cloth = np.zeros(m.shape, bool) if cloth is None else cloth & m
    lab = rgb2lab(a[..., :3] / 255)
    if smooth:  # per channel, inside the silhouette only: the background never bleeds in
        for k in range(3):
            ch = lab[..., k]
            lab[..., k] = np.where(m, median_filter(np.where(m, ch, np.median(ch[m])), size=3), ch)
    rng = np.random.default_rng(seed)
    idx, cents = np.full(m.shape, -1), []
    for sel, n in ((m & ~cloth, colours), (cloth, cloth_colours)):
        if sel.sum() < n:  # too few pixels to cluster: keep them as they are
            continue
        cent, li = kmeans2(lab[sel] * W, n, minit='++', iter=30, seed=rng)
        idx[sel] = li + sum(len(c) for c in cents)
        cents.append(cent)
    if not cents:
        return a
    cent = np.concatenate(cents)
    done = idx >= 0
    if clean:  # a pixel no 4-neighbour shares takes the most common other colour among its 8 neighbours
        for _ in range(2):
            new = idx.copy()
            for y, x in zip(*np.nonzero(m[1:-1, 1:-1])):
                y, x = y + 1, x + 1
                v = idx[y, x]
                if v < 0 or v in (idx[y - 1, x], idx[y + 1, x], idx[y, x - 1], idx[y, x + 1]):
                    continue
                n8 = [n for n in idx[y - 1:y + 2, x - 1:x + 2].ravel() if n >= 0 and n != v]
                if n8:
                    new[y, x] = max(set(n8), key=n8.count)
            idx = new
    pal = (np.clip(lab2rgb((cent / W)[None])[0], 0, 1) * 255).round().astype(np.uint8)
    a[done, :3] = pal[idx[done]]
    return a


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('out')
    ap.add_argument('--colours', type=int, required=True)
    ap.add_argument('--smooth', action='store_true')
    ap.add_argument('--clean', action='store_true')
    ap.add_argument('--cloth-mask', help='a sheet-sized mask image: white is cloth')
    ap.add_argument('--cloth', type=int, default=6, help='colours for the cloth')
    a = ap.parse_args()
    cloth = np.asarray(Image.open(a.cloth_mask).convert('L')) > 127 if a.cloth_mask else None
    out = pixel_finish(np.asarray(Image.open(a.src).convert('RGBA')), a.colours, a.smooth, a.clean, cloth=cloth,
                       cloth_colours=a.cloth)
    Image.fromarray(out).save(a.out)


if __name__ == '__main__':
    main()
