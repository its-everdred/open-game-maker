"""Measure one SmallScaleInt sheet or single sprite and print a JSON style summary.

Usage: measure_sheet.py <png> [--cell N]
  --cell N  split into N x N cells (rows = 8 directions, cols = frames); omit for a single sprite (prop/tile).
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import spritemetrics as sm  # noqa: E402


def summarise(vals):
    vals = [v for v in vals if v is not None]
    if not vals:
        return None
    return {'mean': round(float(np.mean(vals)), 3), 'min': round(float(np.min(vals)), 3), 'max': round(float(np.max(vals)), 3)}


def sprite_stats(a):
    m = sm.mask(a)
    al = a[..., 3]
    o = sm.outline_stats(a)
    ld = sm.light_direction(a)
    bb = sm.bbox(m)
    return {
        'opaque_px': int(m.sum()),
        'colours': int(len(sm.palette(a)[0])),
        'colours_90pct': sm.colours_for_coverage(a),
        'lum_bands': sm.luminance_bands(a),
        'partial_alpha_share': float(((al > 0) & (al < 255)).sum() / max((al > 0).sum(), 1)),
        'rim_to_interior_lum': o and o['rim_to_interior_lum'],
        'rim_dark_share': o and o['rim_dark_share'],
        'light_angle_deg': ld and ld['angle_deg'],
        'bbox_w': bb and bb[2] - bb[0],
        'bbox_h': bb and bb[3] - bb[1],
        'foot_y': bb and bb[3],
    }


def measure(path, cell=None):
    sheet = sm.load(path)
    out = {'file': str(path), 'size': list(sheet.shape[1::-1])}
    if not cell:
        out['sprite'] = sprite_stats(sheet)
        return out
    if cell <= 0 or sheet.shape[0] % cell or sheet.shape[1] % cell:
        raise ValueError('cell must be positive and divide both sheet dimensions')
    grid = sm.cells(sheet, cell)
    rows = []
    for r, row in enumerate(grid):
        frames = [c for c in row if (c[..., 3] > 0).any()]
        # object mask, or the alpha mask for shadow-only sheets (no object pixels)
        masks = [sm.mask(c) if sm.mask(c).any() else c[..., 3] > 0 for c in frames]
        stats = [sprite_stats(c) for c in frames]
        consecutive = [sm.iou(masks[i], masks[i + 1]) for i in range(len(masks) - 1)]
        rows.append({
            'row': r,
            'frames': len(frames),
            'consecutive_iou': summarise(consecutive),
            'loop_iou': sm.iou(masks[-1], masks[0]) if len(masks) > 1 else None,
            'opaque_px': summarise([float(m.sum()) for m in masks]),
            'light_angle_deg': summarise([s['light_angle_deg'] for s in stats]),
        })
        out.setdefault('_stats', []).extend(x for x in stats if x['opaque_px'])
    stats = out.pop('_stats', [])
    out['grid'] = {'cell': cell, 'cols': len(grid[0]), 'rows': len(grid)}
    out['sheet_colours'] = int(len(sm.palette(sheet)[0]))
    out['per_frame'] = {k: summarise([s[k] for s in stats]) for k in stats[0]} if stats else None
    out['rows'] = rows
    areas = [r['opaque_px']['mean'] for r in rows if r['opaque_px']]
    out['direction_area_cv'] = round(float(np.std(areas) / np.mean(areas)), 3) if areas else None
    return out


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('png')
    ap.add_argument('--cell', type=int)
    a = ap.parse_args()
    print(json.dumps(measure(a.png, a.cell), indent=1))
