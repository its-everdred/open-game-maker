"""Kevin asked "what is shader blend?" (#1200): one picture of option C, step by step, on the spike's test map.

TEMPORARY EXPERIMENT, reuses render.py's masks over cloned pack pixels. Output goes to assets-local, never committed.

    python -I explain_shader.py <pack Environment dir> <out dir>
"""
import numpy as np
from PIL import Image

import render as r


def fields(k):
    """Per-pixel weight of terrain k (bilinear between cell centres) and the same plus noise, as in scene_splat."""
    yy, xx = np.mgrid[0:r.CH, 0:r.CW] + 0.5
    ox, oy = r.cell_xy(0, 0)
    sx, sy = (xx - ox - r.TW / 2) / (r.TW / 2), (yy - oy) / (r.TH / 2)
    gu, gv = (sx + sy) / 2 - 0.5, (sy - sx) / 2 - 0.5
    rng = np.random.default_rng(3)
    big = Image.fromarray(rng.uniform(0, 255, (r.CH // 20 + 2, r.CW // 20 + 2)).astype(np.uint8))
    smooth = np.array(big.resize(((r.CW // 20 + 2) * 20, (r.CH // 20 + 2) * 20), Image.BICUBIC))[:r.CH, :r.CW] / 127.5 - 1
    nz = smooth + rng.uniform(-0.35, 0.35, (r.CH, r.CW))
    u0, v0 = np.floor(gu).astype(int), np.floor(gv).astype(int)
    fu, fv = gu - u0, gv - v0
    G = np.pad(r.GRID, 1, mode='edge')

    def g(du, dv):
        return G[np.clip(v0 + dv + 1, 0, r.H + 1), np.clip(u0 + du + 1, 0, r.W + 1)]
    f = ((g(0, 0) >= k) * (1 - fu) * (1 - fv) + (g(1, 0) >= k) * fu * (1 - fv)
         + (g(0, 1) >= k) * (1 - fu) * fv + (g(1, 1) >= k) * fu * fv)
    return f, f + nz * r.TERRAINS[k][2]


def gray(field):
    v = (np.clip(field, 0, 1) * 255).astype(np.uint8)
    im = np.dstack([v, v, v, np.full_like(v, 255)])
    im[~r.AREA] = (24, 24, 28, 255)
    return Image.fromarray(im)


if __name__ == '__main__':
    k = 5  # stone paving
    f, fn = fields(k)
    blocky = r.scene_blocky()
    shader = r.scene_splat()
    dual, _ = r.scene_dualgrid()
    # Crop around the stone, cobble and dirt pocket left of centre (cells around x=3, y=6).
    x, y = r.cell_xy(3, 6)
    box = (x + r.TW // 2 - 192, y + r.TH // 2 - 130, x + r.TW // 2 + 192, y + r.TH // 2 + 130)
    panels = [blocky, gray(f), gray((fn > 0.5).astype(float)), shader, dual]
    titles = ['1 map cells', '2 stone weight', '3 cut at half, plus noise', '4 C: shader', 'A: dual-grid 16']
    sheet = Image.new('RGBA', (768, 3 * 284), (16, 16, 20, 255))
    for i, (im, t) in enumerate(zip(panels, titles)):
        px, py = (i % 2) * 384, (i // 2) * 284
        sheet.alpha_composite(im.crop(box), (px, py + 24))
        r.label(sheet, (px + 8, py + 6), t)
    sheet.save(r.OUT / 'c-shader-explained.png')
    print(r.OUT / 'c-shader-explained.png')
