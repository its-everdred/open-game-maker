"""Zoomed contact strip of rendered cells for looking: strip.py <raw_dir> <out.png> [rows=1,2] [zoom=3] [ref=sheet.png]
Crops every frame to the union box of the row, so small sprites are readable; ref adds the pack's rows above."""
import sys
from pathlib import Path

from PIL import Image

raw, out = Path(sys.argv[1]), sys.argv[2]
opt = dict(a.split('=', 1) for a in sys.argv[3:])
rows = [int(r) for r in opt.get('rows', '1,2').split(',')]
zoom = int(opt.get('zoom', 3))
lines = []
if 'ref' in opt:
    sh = Image.open(opt['ref']).convert('RGBA')
    c = sh.height // 8
    lines += [[sh.crop((i * c, r * c, i * c + c, r * c + c)) for i in range(sh.width // c)] for r in rows]
for r in rows:
    fr = sorted(raw.glob(f'raw_{r}_*.png'), key=lambda p: int(p.stem.split('_')[2]))
    lines.append([Image.open(p).convert('RGBA') for p in fr])
cell = lines[-1][0].width
lines = [[im.resize((cell, cell), Image.NEAREST) if im.width != cell else im for im in ln] for ln in lines]
box = None
for ln in lines:
    for im in ln:
        b = im.getbbox()
        if b:
            box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
w, h = box[2] - box[0] + 4, box[3] - box[1] + 4
W = Image.new('RGBA', (w * max(map(len, lines)), h * len(lines)), (58, 58, 68, 255))
for y, ln in enumerate(lines):
    for x, im in enumerate(ln):
        W.alpha_composite(im.crop((box[0] - 2, box[1] - 2, box[2] + 2, box[3] + 2)), (x * w, y * h))
s = zoom * 128 / cell if cell > 128 else zoom
W.resize((int(W.width * s), int(W.height * s)), Image.NEAREST).save(out)
