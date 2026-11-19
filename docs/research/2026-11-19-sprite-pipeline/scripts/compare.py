"""Side-by-side review media: original vs rebuild, with the scorer's numbers. For the review lane.

Single sprites (props/tiles, one PNG per view):
  compare.py still --pairs <orig1.png>:<rebuild1.png> [...] --labels N,E,S,W --out sheet.png [--zoom 4]
  One row per view: original | rebuild | difference heat; metrics printed under each row.
Sheets (characters: rows = 8 directions, cols = frames):
  compare.py sheet <orig_sheet.png> <rebuild_sheet.png> --cell 64 --out <dir> [--zoom 4] [--fps 12]
  Writes <dir>/still-8dir.png (frame 0 of every direction, original over rebuild),
  <dir>/dir<r>.gif (original | rebuild animated, per direction) and <dir>/scores.json.
  An MP4 for the phone: ffmpeg -i dir<r>.gif -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" -pix_fmt yuv420p -profile:v main dir<r>.mp4
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
import score  # noqa: E402
import spritemetrics as sm  # noqa: E402

BG = (92, 120, 92, 255)
KEYS = ['silhouette_iou', 'silhouette_iou_best', 'pixel_similarity', 'palette_distance', 'edge_f1', 'lum_hist_l1', 'shadow_iou']


def on_bg(a, zoom):
    t = Image.new('RGBA', (a.shape[1], a.shape[0]), BG)
    t.alpha_composite(Image.fromarray(a))
    return t.resize((a.shape[1] * zoom, a.shape[0] * zoom), Image.NEAREST)


def diff_img(o, r, zoom):
    d = np.abs(score.on_grey(o) - score.on_grey(r)).mean(-1)
    heat = np.zeros(o.shape, np.uint8)
    heat[..., 0] = np.clip(d * 3, 0, 255)
    heat[..., 1] = np.clip(255 - d * 3, 0, 255) * (sm.mask(o) | sm.mask(r))
    heat[..., 3] = 255
    return Image.fromarray(heat).resize((o.shape[1] * zoom, o.shape[0] * zoom), Image.NEAREST)


def crop_box(arrs, pad=6):
    m = np.zeros(arrs[0].shape[:2], bool)
    for a in arrs:
        m |= a[..., 3] > 0
    bb = sm.bbox(m) or (0, 0, m.shape[1], m.shape[0])
    return max(bb[0] - pad, 0), max(bb[1] - pad, 0), min(bb[2] + pad, m.shape[1]), min(bb[3] + pad, m.shape[0])


def still(pairs, labels, out, zoom):
    rows = []
    for (op, rp), lab in zip(pairs, labels):
        o, r = sm.load(op), sm.load(rp)
        x0, y0, x1, y1 = crop_box([o, r])
        oc, rc = o[y0:y1, x0:x1], r[y0:y1, x0:x1]
        s = score.compare(o, r)
        rows.append((lab, on_bg(oc, zoom), on_bg(rc, zoom), diff_img(oc, rc, zoom), s))
    w = max(a.width for _, a, _, _, _ in rows) * 3 + 40
    h = sum(a.height + 44 for _, a, _, _, _ in rows)
    sheet = Image.new('RGBA', (w, h), (24, 24, 24, 255))
    d = ImageDraw.Draw(sheet)
    y = 0
    for lab, a, b, c, s in rows:
        x = 10
        for im in (a, b, c):
            sheet.paste(im, (x, y))
            x += im.width + 10
        d.text((10, y + a.height + 4), f'{lab}  original | rebuild | diff', fill='white')
        d.text((10, y + a.height + 20), '  '.join(f'{k}={s[k]}' for k in KEYS), fill=(200, 220, 255))
        y += a.height + 44
    sheet.save(out)
    return {lab: s for lab, _, _, _, s in rows}


def sheet_media(orig, rebuild, cell, outdir, zoom, fps):
    outdir = Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    go, gr = sm.cells(sm.load(orig), cell), sm.cells(sm.load(rebuild), cell)
    tiles = Image.new('RGBA', (len(go) * cell * zoom, 2 * cell * zoom), BG)
    for r, (ro, rr) in enumerate(zip(go, gr)):
        tiles.paste(on_bg(ro[0], zoom), (r * cell * zoom, 0))
        tiles.paste(on_bg(rr[0], zoom), (r * cell * zoom, cell * zoom))
        frames = []
        for co, cr in zip(ro, rr):
            f = Image.new('RGBA', (2 * cell * zoom + 8, cell * zoom), (24, 24, 24, 255))
            f.paste(on_bg(co, zoom), (0, 0))
            f.paste(on_bg(cr, zoom), (cell * zoom + 8, 0))
            frames.append(f.convert('RGB'))
        frames[0].save(outdir / f'dir{r}.gif', save_all=True, append_images=frames[1:], duration=int(1000 / fps), loop=0)
    tiles.save(outdir / 'still-8dir.png')
    res = score.score(orig, rebuild, cell)
    (outdir / 'scores.json').write_text(json.dumps(res, indent=1))
    return res


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='mode', required=True)
    a1 = sub.add_parser('still')
    a1.add_argument('--pairs', nargs='+', required=True)
    a1.add_argument('--labels')
    a1.add_argument('--out', required=True)
    a1.add_argument('--zoom', type=int, default=4)
    a2 = sub.add_parser('sheet')
    a2.add_argument('orig')
    a2.add_argument('rebuild')
    a2.add_argument('--cell', type=int, required=True)
    a2.add_argument('--out', required=True)
    a2.add_argument('--zoom', type=int, default=4)
    a2.add_argument('--fps', type=int, default=12)
    x = ap.parse_args()
    if x.mode == 'still':
        pairs = [p.split(':') for p in x.pairs]
        labels = x.labels.split(',') if x.labels else [str(i) for i in range(len(pairs))]
        print(json.dumps(still(pairs, labels, x.out, x.zoom), indent=1))
    else:
        print(json.dumps(sheet_media(x.orig, x.rebuild, x.cell, x.out, x.zoom, x.fps), indent=1))
