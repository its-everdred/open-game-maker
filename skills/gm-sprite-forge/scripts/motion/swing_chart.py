"""Swing chart from swing_curves.py JSONs (plain Python + Pillow): one line per cell, the hand's swing about the
shoulder per sheet frame, with each cell's reversals and largest one-frame turn in the legend.

Usage: swing_chart.py out.png a.json b.json ...
"""
import json
import sys

from PIL import Image, ImageDraw

W, H, L, T, B = 900, 420, 60, 30, 50
COL = [(230, 90, 80), (240, 180, 60), (90, 160, 240), (120, 220, 120), (220, 120, 230)]


def unwrapped(frames):
    """Each frame's swing on the side of the one before, so a line jumps only when the arm does."""
    sw = [frames[0]['swing']]
    for f in frames[1:]:
        sw.append(sw[-1] + (f['swing'] - sw[-1] + 180) % 360 - 180)
    return sw


def main():
    runs = [json.load(open(p)) for p in sys.argv[2:]]
    lines = [unwrapped(r['frames']) for r in runs]
    lo = min(min(s) for s in lines) // 45 * 45 - 45
    hi = max(max(s) for s in lines) // 45 * 45 + 45
    im = Image.new('RGB', (W, H + 26 * len(runs)), (28, 30, 36))
    d = ImageDraw.Draw(im)

    def x(i):
        return L + i * (W - L - 20) / 14

    def y(a):
        return T + (hi - a) / (hi - lo) * (H - T - B)
    for a in range(int(lo), int(hi) + 1, 45):
        d.line([(L, y(a)), (W - 20, y(a))], fill=(60, 62, 70))
        d.text((8, y(a) - 6), f'{a}', fill=(170, 170, 170))
    for i in range(15):
        d.text((x(i) - 4, H - B + 8), str(i), fill=(170, 170, 170))
    d.text((L, 6), 'hand swing about the shoulder per sheet frame (0 forward, 90 up, 180 back, 270 down)',
           fill=(220, 220, 220))
    for k, (r, sw) in enumerate(zip(runs, lines)):
        c = COL[k % len(COL)]
        d.line([(x(i), y(s)) for i, s in enumerate(sw)], fill=c, width=3)
        for i, s in enumerate(sw):
            d.ellipse([x(i) - 3, y(s) - 3, x(i) + 3, y(s) + 3], fill=c)
        d.text((L, H + 6 + 26 * k), f"{r['cell']}: {r['reversals']} reversals, largest one-frame turn "
               f"{r['max_step']:.0f} deg, source keys on flipped hemispheres: {sum(r['flips'].values())}", fill=c)
    im.save(sys.argv[1])


if __name__ == '__main__':
    main()
