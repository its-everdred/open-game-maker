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
from scipy.spatial import cKDTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
import spritemetrics as sm  # noqa: E402

SHIFT = 6
GREY = np.array([128, 128, 128], float)


def shifted(a, dx, dy):
    out = np.zeros_like(a)
    h, w = a.shape[:2]
    if abs(dx) >= w or abs(dy) >= h:
        return out
    out[max(0, dy):min(h, h + dy), max(0, dx):min(w, w + dx)] = a[max(0, -dy):min(h, h - dy), max(0, -dx):min(w, w - dx)]
    return out


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


def palette_distance(a, b):
    """Weighted symmetric nearest-colour distance without a quadratic matrix."""
    ca, na = sm.palette(a)
    cb, nb = sm.palette(b)
    if not len(ca) or not len(cb):
        return None
    ab = np.average(cKDTree(cb).query(ca)[0], weights=na)
    ba = np.average(cKDTree(ca).query(cb)[0], weights=nb)
    return float((ab + ba) / 2)


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
        'silhouette_iou': sm.iou(mo, mr),
        'silhouette_iou_best': best[0],
        'shift_px': [best[1], best[2]],
        'pixel_similarity': float(sim),
        'palette_distance': palette_distance(o, r),
        'edge_f1': edge_f1(mo, mrs),
        'lum_hist_l1': float(np.abs(lum_hist(o) - lum_hist(r)).sum()),
        'bands_delta': sm.luminance_bands(r) - sm.luminance_bands(o),
        'shadow_iou': sm.iou(sm.shadow_mask(o), sm.shadow_mask(shifted(r, best[1], best[2]))),
        'shadow_alpha_delta': float(shadow_alpha(r) - shadow_alpha(o)),
    }


def shadow_alpha(a):
    s = sm.shadow_mask(a)
    return a[..., 3][s].mean() if s.any() else 0.0


def mean_metrics(rows):
    keys = [k for k in rows[0] if k != 'shift_px']
    return {k: float(np.mean([x[k] for x in rows])) if all(x[k] is not None for x in rows) else None for k in keys}


def frame_mask(cell):
    return sm.mask(cell) | sm.shadow_mask(cell)


def occupied(cell):
    return bool(frame_mask(cell).any())


def motion_correlation(first, second):
    if len(first) != len(second) or len(first) < 3:
        return None
    if np.std(first) < 1e-12 or np.std(second) < 1e-12:
        return 1.0 if np.allclose(first, second, rtol=0, atol=1e-12) else None
    return float(np.corrcoef(first, second)[0, 1])


def score(orig, rebuild, cell=None):
    o, r = sm.load(orig), sm.load(rebuild)
    if o.shape != r.shape:
        raise SystemExit(f'size mismatch {o.shape} vs {r.shape}')
    if cell is None:
        return compare(o, r)
    if cell <= 0 or o.shape[0] % cell or o.shape[1] % cell:
        raise ValueError('cell must be positive and divide both sheet dimensions')
    go, gr = sm.cells(o, cell), sm.cells(r, cell)
    per, rows = [], []
    for ro, rr in zip(go, gr):
        fo = [c for c in ro if occupied(c)]
        fr = [c for c in rr if occupied(c)]
        cmp = [(column, compare(a, b)) for column, (a, b) in enumerate(zip(ro, rr)) if occupied(a) or occupied(b)]
        per.extend(result for _, result in cmp)
        mo = [sm.iou(frame_mask(fo[i]), frame_mask(fo[i + 1])) for i in range(len(fo) - 1)]
        mr = [sm.iou(frame_mask(fr[i]), frame_mask(fr[i + 1])) for i in range(len(fr) - 1)]
        corr = motion_correlation(mo, mr)
        rows.append({'frames_orig': len(fo), 'frames_rebuild': len(fr), 'motion_corr': corr, 'frames': [{'column': column, **result} for column, result in cmp]})
    out = mean_metrics(per) if per else {}
    out['frames_match'] = all([occupied(a) for a in ro] == [occupied(b) for b in rr] for ro, rr in zip(go, gr))
    correlations = [x['motion_corr'] for x in rows if x['motion_corr'] is not None]
    out['motion_corr'] = float(np.mean(correlations)) if len(correlations) == len(rows) and correlations else None
    out['rows'] = rows
    return out


def gate_results(scores, gates):
    results = {}
    for metric, rule in gates.items():
        value = scores.get(metric)
        passed = value is not None and all(
            value >= threshold if op == 'min' else value <= threshold if op == 'max' else value == threshold
            for op, threshold in rule.items()
        )
        results[metric] = {'value': value, 'rule': rule, 'pass': passed}
    return results


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('original')
    ap.add_argument('rebuild')
    ap.add_argument('--cell', type=int)
    ap.add_argument('--json')
    ap.add_argument('--gates', choices=['prop', 'character-64', 'character-128'])
    a = ap.parse_args()
    res = score(a.original, a.rebuild, a.cell)
    if a.gates:
        gates = json.loads((Path(__file__).resolve().parent.parent / 'gates.json').read_text())
        verdicts = gate_results(res, gates[a.gates])
        res['gates'] = verdicts
        res['pass'] = all(v['pass'] for v in verdicts.values())
    txt = json.dumps(res, indent=1, allow_nan=False)
    if a.json:
        Path(a.json).write_text(txt)
    print(txt)
    if a.gates:
        for metric, verdict in verdicts.items():
            print(f"{metric}: {'PASS' if verdict['pass'] else 'FAIL'}")
