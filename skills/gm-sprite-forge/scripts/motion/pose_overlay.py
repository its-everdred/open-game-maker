"""Frame-by-frame pose check against the pack clip (#1282 bake-off): for each sheet frame, the pack's silhouette and the
cell's laid over each other (pack red, ours cyan, both white) with that frame's silhouette IoU, so a reviewer sees which
beats (wind-up, strike, recovery) land and which do not.

Usage: pose_overlay.py <out.png> <pack_sheet.png> <cell_dir> ... [--rows 1,2] [--zoom 3]
Each cell row is labelled with its name and mean IoU; a loop's frames start at its scored phase (scores.json).
Writes <out.png> and <out>.json (per-frame IoU per cell path and row).
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import spritemetrics as sm  # noqa: E402
from matrix_media import font, frames  # noqa: E402

PACK, OURS, BOTH, BG = (230, 70, 70), (70, 210, 230), (245, 245, 245), (40, 40, 48)
CROP = (16, 16, 112, 112)  # the figure's area in a 128 px cell (origin row 88)


def overlay(pack_frames, our_frames):
    """Composite frames and per-frame IoU."""
    out, ious = [], []
    for p, o in zip(pack_frames, our_frames):
        mp, mo = sm.mask(np.asarray(p)), sm.mask(np.asarray(o))
        img = np.zeros(mp.shape + (3,), np.uint8) + np.array(BG, np.uint8)
        img[mp & ~mo], img[mo & ~mp], img[mp & mo] = PACK, OURS, BOTH
        out.append(Image.fromarray(img))
        ious.append(round(float(sm.iou(mp, mo)), 3))
    return out, ious


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('out', type=Path)
    ap.add_argument('pack')
    ap.add_argument('cells', nargs='+', type=Path)
    ap.add_argument('--rows', default='1,2')
    ap.add_argument('--zoom', type=int, default=3)
    a = ap.parse_args()
    rows = [int(r) for r in a.rows.split(',')]
    z, cell, label_w = a.zoom, CROP[2] - CROP[0], 260
    f = font(13)
    lines, report = [], {}
    if len({str(c) for c in a.cells}) != len(a.cells):
        ap.error('a cell is listed twice')
    for c in a.cells:
        shift = json.loads((c / 'scores.json').read_text()).get('phase_shift', 0)
        report[str(c)] = {}
        for r in rows:
            ims, ious = overlay([im.crop(CROP) for im in frames(a.pack, r)],
                                [im.crop(CROP) for im in frames(c / 'out/sheet.png', r, shift)])
            report[str(c)][str(r)] = ious
            lines.append((f'{c.name} row {r}', f'mean IoU {np.mean(ious):.2f}', ims, ious))
    W, H = label_w + 15 * cell * z, len(lines) * (cell * z + 18)
    sheet = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(sheet)
    for i, (name, mean, ims, ious) in enumerate(lines):
        y = i * (cell * z + 18)
        d.text((8, y + 8), name, font=f, fill=(235, 235, 240))
        d.text((8, y + 26), mean, font=f, fill=(170, 170, 185))
        for k, (im, v) in enumerate(zip(ims, ious)):
            x = label_w + k * cell * z
            sheet.paste(im.resize((cell * z, cell * z), Image.NEAREST), (x, y + 18))
            d.text((x + 4, y + 2), f'{k}: {v:.2f}', font=f, fill=(235, 235, 240))
    sheet.save(a.out)
    a.out.with_suffix('.json').write_text(json.dumps(report, indent=1))
    print(a.out)


if __name__ == '__main__':
    main()
