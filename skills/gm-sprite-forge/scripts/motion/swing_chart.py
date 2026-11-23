"""Swing-angle chart from swing_curves.py JSONs (plain Python + Pillow): one line per cell (hand about the shoulder, degrees per sheet frame) and the
reversal count in the legend. Usage: chart.py out.png a.json b.json ..."""
import json
import sys

from PIL import Image, ImageDraw
W, H, L, T, B = 900, 420, 60, 30, 50
COL = [(230, 90, 80), (240, 180, 60), (90, 160, 240), (120, 220, 120), (220, 120, 230)]
im = Image.new('RGB', (W, H + 26 * (len(sys.argv) - 2)), (28, 30, 36))
d = ImageDraw.Draw(im)
x = lambda i: L + i * (W - L - 20) / 14
y = lambda a: T + (270 - a) / 360 * (H - T - B)  # -90 (down, in front) to 270 (down, behind)
for a in range(-90, 271, 45):
    d.line([(L, y(a)), (W - 20, y(a))], fill=(60, 62, 70))
    d.text((8, y(a) - 6), f'{a}', fill=(170, 170, 170))
for i in range(15):
    d.text((x(i) - 4, H - B + 8), str(i), fill=(170, 170, 170))
d.text((L, 6), 'hand swing about the shoulder (0 forward, 90 up, 180 back, 270 or -90 down) per sheet frame',
       fill=(220, 220, 220))
for k, p in enumerate(sys.argv[2:]):
    r = json.load(open(p))
    sw = [f['swing'] for f in r['frames']]
    sw = [s - 360 if s > 270 else s for s in sw]  # one side of straight down stays continuous
    c = COL[k % len(COL)]
    d.line([(x(i), y(s)) for i, s in enumerate(sw)], fill=c, width=3)
    for i, s in enumerate(sw):
        d.ellipse([x(i) - 3, y(s) - 3, x(i) + 3, y(s) + 3], fill=c)
    d.text((L, H + 6 + 26 * k), f"{r['cell']}: {r['reversals']} reversals, largest one-frame turn {r['max_step']:.0f} deg,"
           f" source keys on flipped hemispheres: {sum(r['flips'].values())}", fill=c)
im.save(sys.argv[1])
