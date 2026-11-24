"""Finish C sample (Kevin 2026-11-24: sharper edges, hard shade bands, clear lines between clothing and skin).

finishc.py <colour.png> <id.png> <out.png> --size H [--bands 3] [--ids '#ff0000,#00ff00,...'] [--skin '#ff0000']
colour.png: the raw render (any supersample); id.png: the same frame rendered with flat ID colours per material.
1. Down to the 1x cell by block: alpha = coverage >= 0.5, the ID = the block's majority ID, the colour = the mean of
   that ID's pixels only (no blending across materials, no anti-aliasing).
2. Each material is posterised to --bands hard shade bands (k-means on lightness inside the material, each band the
   median colour of its pixels).
3. A 1 px dark line where two materials meet, drawn on the clothing side (never on skin), in the darkened local colour.
4. A dark outline: every opaque pixel touching transparency takes its own colour darkened.
"""
import argparse
import numpy as np
from PIL import Image


def hexc(s):
    s = s.lstrip('#'); return np.array([int(s[i:i + 2], 16) for i in (0, 2, 4)], float)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('colour'); ap.add_argument('ids'); ap.add_argument('out')
    ap.add_argument('--factor', type=int, default=1, help='supersample factor of the raw renders')
    ap.add_argument('--bands', type=int, default=3)
    ap.add_argument('--ids-pal', default='#ff0000,#00ff00,#0000ff,#ffff00,#ff00ff,#00ffff,#ff8000,#8000ff')
    ap.add_argument('--skin', default='#ff0000', help='ID colour of the body (skin) material: lines never go on it')
    ap.add_argument('--line', type=float, default=0.55); ap.add_argument('--outline', type=float, default=0.45)
    a = ap.parse_args()
    C = np.asarray(Image.open(a.colour).convert('RGBA'), float)
    I = np.asarray(Image.open(a.ids).convert('RGBA'), float)
    pal = np.array([hexc(x) for x in a.ids_pal.split(',')])
    # ID per raw pixel: nearest palette colour by hue (the renders shade the flat colours a little)
    rgb = I[..., :3]
    nrm = rgb / np.maximum(rgb.max(-1, keepdims=True), 1)
    pn = pal / 255.0
    d = ((nrm[..., None, :] - pn[None, None]) ** 2).sum(-1)
    ID = d.argmin(-1)
    ID[I[..., 3] < 128] = len(pal)  # drawn in colour but not in the ID pass (the weapon): its own material
    ID[C[..., 3] < 128] = -1
    f = a.factor
    h, w = ID.shape[0] // f, ID.shape[1] // f
    out = np.zeros((h, w, 4)); oid = np.full((h, w), -1)
    for y in range(h):
        for x in range(w):
            bi = ID[y * f:(y + 1) * f, x * f:(x + 1) * f].ravel()
            bc = C[y * f:(y + 1) * f, x * f:(x + 1) * f].reshape(-1, 4)
            if (bi >= 0).mean() < 0.5:
                continue
            v, n = np.unique(bi[bi >= 0], return_counts=True)
            k = v[n.argmax()]
            out[y, x, :3] = bc[bi == k, :3].mean(0); out[y, x, 3] = 255; oid[y, x] = k
    # posterise per material: band by a 3x3 median of lightness inside the material, so texture speckle does not
    # break a band into noise
    from scipy.ndimage import median_filter
    Lall = out[..., :3] @ [0.299, 0.587, 0.114]
    for k in np.unique(oid[oid >= 0]):
        m = oid == k
        px = out[m, :3]
        Lk = np.where(m, Lall, np.nan)
        Lm = median_filter(np.nan_to_num(Lk, nan=-1), size=3)
        L = np.where(Lm[m] < 0, Lall[m], Lm[m])
        nb = min(a.bands, max(1, len(np.unique(L.round()))))
        cent = np.quantile(L, (np.arange(nb) + 0.5) / nb)
        for _ in range(12):
            lab = np.abs(L[:, None] - cent[None]).argmin(1)
            cent = np.array([L[lab == j].mean() if (lab == j).any() else cent[j] for j in range(nb)])
        cols = np.array([np.median(px[lab == j], 0) if (lab == j).any() else px.mean(0) for j in range(nb)])
        out[m, :3] = cols[lab]
    skin = int(((pal - hexc(a.skin)) ** 2).sum(1).argmin())
    res = out.copy()
    op = oid >= 0
    # material lines: on the non-skin side; between two clothing materials, on the darker one
    lum = out[..., :3] @ [0.299, 0.587, 0.114]
    for dy, dx in ((0, 1), (1, 0), (0, -1), (-1, 0)):
        nid = np.full_like(oid, -1); nl = np.zeros_like(lum)
        ys, xs = slice(max(dy, 0), h + min(dy, 0)), slice(max(dx, 0), w + min(dx, 0))
        yd, xd = slice(max(-dy, 0), h + min(-dy, 0)), slice(max(-dx, 0), w + min(-dx, 0))
        nid[yd, xd] = oid[ys, xs]; nl[yd, xd] = lum[ys, xs]
        edge = op & (nid >= 0) & (nid != oid) & (oid != skin) & ((nid == skin) | (lum < nl) | ((lum == nl) & (dy + dx > 0)))
        res[edge, :3] = out[edge, :3] * a.line
    # outline
    pad = np.pad(op, 1)
    border = op & ~(pad[:-2, 1:-1] & pad[2:, 1:-1] & pad[1:-1, :-2] & pad[1:-1, 2:])
    res[border, :3] = out[border, :3] * a.outline
    Image.fromarray(res.clip(0, 255).astype(np.uint8), 'RGBA').save(a.out)


if __name__ == '__main__':
    main()
