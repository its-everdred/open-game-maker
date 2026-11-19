"""Score a rebuilt sprite (or sheet) against the pack original.

Usage: score.py <original.png> <rebuild.png> [--cell N] [--json out.json]
Single sprites (props, tiles) compare as one image; --cell compares a sheet cell by cell
(rows = directions, cols = frames) and adds frame-count and motion checks.

Metrics (all from spritemetrics):
  silhouette_iou     object masks (alpha >= 128) at the pack's anchor; 1 = identical footprint
  silhouette_iou_best  same after the best shift within +-6 px (separates placement from shape)
  shift_px           the shift that gave the best IoU
  pixel_similarity   1 - mean |RGB delta|/255 over the union of both masks, both on the same mid-grey,
                     at the best shift; 1 = identical pixels
  palette_distance   symmetric weighted nearest-colour RGB distance (0 = same colours; ~10 = hard to tell)
  edge_f1            F1 of silhouette rims with 1 px tolerance (outline/contour match)
  lum_hist_l1        L1 distance of the 16-bin luminance histograms (0 = same shading distribution, max 2)
  bands_delta        difference in luminance band count
  shadow_iou         IoU of the cast-shadow masks (partial alpha, near-black)
  shadow_alpha_delta rebuild minus original mean shadow alpha (0-255)
For sheets: frames_match (per row), motion_corr (correlation of consecutive-frame IoU curves).
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).resolve().parent))
import spritemetrics as sm  # noqa: E402

SHIFT = 6
GREY = np.array([128, 128, 128], float)


def shifted(a, dx, dy):
    return np.roll(np.roll(a, dy, 0), dx, 1)


def on_grey(a):
    al = a[..., 3:4].astype(float) / 255
    return a[..., :3].astype(float) * al + GREY * (1 - al)


def lum_hist(a):
    m = sm.mask(a)
    if not m.any():
        return np.zeros(16)
    h, _ = np.histogram(sm.lum(a)[m], bins=16, range=(0, 256))
    return h / h.sum()


def edge_f1(m1, m2):
    e1, e2 = sm.edge(m1), sm.edge(m2)
    if not e1.any() or not e2.any():
        return 0.0
    d1, d2 = ndimage.binary_dilation(e1), ndimage.binary_dilation(e2)
    p = (e2 & d1).sum() / e2.sum()
    r = (e1 & d2).sum() / e1.sum()
    return float(2 * p * r / (p + r)) if p + r else 0.0


def compare(o, r):
    mo, mr = sm.mask(o), sm.mask(r)
    best = (sm.iou(mo, mr), 0, 0)
    for dy in range(-SHIFT, SHIFT + 1):
        for dx in range(-SHIFT, SHIFT + 1):
            v = sm.iou(mo, shifted(mr, dx, dy))
            if v > best[0]:
                best = (v, dx, dy)
    rs = shifted(r, best[1], best[2])
    mrs = sm.mask(rs)
    union = mo | mrs
    sim = 1 - np.abs(on_grey(o) - on_grey(rs))[union].mean() / 255 if union.any() else 1.0
    return {
        'silhouette_iou': round(sm.iou(mo, mr), 3),
        'silhouette_iou_best': round(best[0], 3),
        'shift_px': [best[1], best[2]],
        'pixel_similarity': round(float(sim), 3),
        'palette_distance': round(sm.palette_distance(o, r) or 999, 1),
        'edge_f1': round(edge_f1(mo, mrs), 3),
        'lum_hist_l1': round(float(np.abs(lum_hist(o) - lum_hist(r)).sum()), 3),
        'bands_delta': sm.luminance_bands(r) - sm.luminance_bands(o),
        'shadow_iou': round(sm.iou(sm.shadow_mask(o), sm.shadow_mask(shifted(r, best[1], best[2]))), 3),
        'shadow_alpha_delta': round(float(shadow_alpha(r) - shadow_alpha(o)), 1),
    }


def shadow_alpha(a):
    s = sm.shadow_mask(a)
    return a[..., 3][s].mean() if s.any() else 0.0


def mean_metrics(rows):
    keys = [k for k in rows[0] if isinstance(rows[0][k], (int, float))]
    return {k: round(float(np.mean([x[k] for x in rows])), 3) for k in keys}


def score(orig, rebuild, cell=None):
    o, r = sm.load(orig), sm.load(rebuild)
    if o.shape != r.shape:
        raise SystemExit(f'size mismatch {o.shape} vs {r.shape}')
    if not cell:
        return compare(o, r)
    go, gr = sm.cells(o, cell), sm.cells(r, cell)
    per, rows = [], []
    for ro, rr in zip(go, gr):
        fo = [c for c in ro if sm.mask(c).any()]
        fr = [c for c in rr if sm.mask(c).any()]
        cmp = [compare(a, b) for a, b in zip(fo, fr)]
        per.extend(cmp)
        mo = [sm.iou(sm.mask(fo[i]), sm.mask(fo[i + 1])) for i in range(len(fo) - 1)]
        mr = [sm.iou(sm.mask(fr[i]), sm.mask(fr[i + 1])) for i in range(len(fr) - 1)]
        n = min(len(mo), len(mr))
        corr = float(np.corrcoef(mo[:n], mr[:n])[0, 1]) if n > 2 and np.std(mo[:n]) and np.std(mr[:n]) else None
        rows.append({'frames_orig': len(fo), 'frames_rebuild': len(fr), 'motion_corr': corr and round(corr, 3)})
    out = mean_metrics(per) if per else {}
    out['frames_match'] = all(x['frames_orig'] == x['frames_rebuild'] for x in rows)
    out['rows'] = rows
    return out


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('original')
    ap.add_argument('rebuild')
    ap.add_argument('--cell', type=int)
    ap.add_argument('--json')
    a = ap.parse_args()
    res = score(a.original, a.rebuild, a.cell)
    txt = json.dumps(res, indent=1)
    if a.json:
        Path(a.json).write_text(txt)
    print(txt)
