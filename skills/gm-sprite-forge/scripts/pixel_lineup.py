"""In-engine lineups for a pixel_preview.py run: every pixel sprite at 1x on a real ground patch beside reference sprites.

Usage: pixel_lineup.py <preview_out> --ground base.png[,overlay.png] --refs a.png b.png ... [--holder b.png] [--dir S]
For each group in <preview_out>/sheets.json, writes lineup-<group>.png (1x, what the game shows) and
lineup-<group>@3x.png (nearest neighbour, item names underneath) and adds both paths to sheets.json.
Ground: the pack's 256 px iso tiles (a 128 x 64 diamond), laid as a field; `overlay` (e.g. grass) is drawn on each base
tile. Every strip starts with the refs (pack originals, approved base bodies) standing on the ground; characters, armor
and props stand on it too; each weapon is shown beside a copy of --holder (default: the second ref) at hand height.
Sprites are placed by their alpha box: its bottom on the ground line, its centre on the slot. Never resizes a sprite.
Weapons are not shown at the pack's own scale (a chibi pack normalised to a 43 px hero inflates them): each is
re-sized from its raw render so its longest side is a real-world fraction of the holder's height (REAL_SIZE; the pack
6Barbarian's long axe measures ~36 px against a ~43 px body, 0.84, which anchors the two-handed axe), then given finish B
again. The fractions and factors go to <preview_out>/lineup.json. Everything else keeps its render's size.
A sprite without its own shadow pixels gets a soft contact shadow, and the strip is lit with --light (default: Dusk
Helm's breezy daylight, field.hd2d.json: ambient #e8f0ff x 0.85 plus the #ffe2a8 x 0.12 sun fill, contrast 1.1).
"""
import argparse
import json
from pathlib import Path

import re
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pixel_preview import pixelate  # noqa: E402

PER_STRIP = 12
GAP = 6
HAND = 0.45  # hand height as a fraction of the holder's height
# longest side of a weapon as a fraction of the holder's height; first match wins
REAL_SIZE = [
    (r'fist', 0.2), (r'dagger|knife', 0.25), (r'wand', 0.28), (r'quiver', 0.35), (r'arrow', 0.45),
    (r'shield.*(large|tower)', 0.45), (r'shield', 0.38), (r'crossbow', 0.5),
    (r'halberd|spear|lance|scythe|trident', 1.1), (r'staff', 1.05), (r'bow', 0.8),
    (r'axe.*(1h|1handed)', 0.6), (r'(sword|blade).*(1h|1handed)', 0.55), (r'(hammer|mace|club).*(1h|1handed)', 0.55),
    (r'axe.*(2h|2handed|two|large|great)|(2h|great).*axe', 0.84), (r'axe', 0.6),
    (r'(sword|blade).*(2h|2handed|two|large|great)|greatsword|claymore', 0.8), (r'sword|blade|sabre|katana', 0.55),
    (r'(hammer|mace|club|maul).*(2h|2handed|two|large|great)|maul', 0.85), (r'hammer|mace|club|flail', 0.55),
]
DEFAULT_SIZE = 0.55


def real_size(name):
    n = name.lower()
    return next((f for rx, f in REAL_SIZE if re.search(rx, n)), DEFAULT_SIZE)


def resize_weapon(raw_path, target, colours):
    """The raw render scaled so its longest side is `target` px, then finish B: pixel art made at the new size."""
    raw = crop(raw_path)
    k = target / max(raw.size)
    im = raw.resize((max(1, round(raw.width * k)), max(1, round(raw.height * k))), Image.LANCZOS)
    return Image.fromarray(pixelate([np.asarray(im)], colours)[0]), k


DAYLIGHT = '#e8f0ff:0.85,#ffe2a8:0.12,1.1'


def crop(path):
    im = Image.open(path).convert('RGBA')
    box = im.getbbox()
    return im.crop(box) if box else im


def ground(tiles, w, h, line):
    """A field of iso tiles covering w x h, a row of tile top-face centres on the ground line."""
    base = [Image.open(t).convert('RGBA') for t in tiles]
    field = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    n = (w // 64 + h // 32) // 2 + 4
    top = min(np.argwhere(np.asarray(base[0])[..., 3] > 0)[:, 0])  # first opaque row of the base tile
    cells = sorted(((i, j) for i in range(-n, n) for j in range(-n, n)), key=lambda c: c[0] + c[1])
    for i, j in cells:
        x = w // 2 + (i - j) * 64 - 128
        y = line + (i + j) * 32 - top - 32
        if -256 < x < w and -256 < y < h:
            for t in base:
                _paste(field, t, x, y)
    return field


def _paste(dst, src, x, y):  # alpha_composite refuses negative offsets
    sx, sy = max(0, -x), max(0, -y)
    part = src.crop((sx, sy, src.width, src.height))
    dst.alpha_composite(part, (max(0, x), max(0, y)))


def has_shadow(im):
    a = np.asarray(im)
    return bool(((a[..., 3] > 0) & (a[..., 3] < 255) & (a[..., :3].max(-1) < 16)).sum() > 20)


def contact_shadow(img, cx, line, width):
    """A soft dark ellipse under a standing sprite, like the pack's own shadow pixels."""
    w, h = max(6, int(width * 0.8)), max(3, int(width * 0.3))
    sh = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse((0, 0, w - 1, h - 1), fill=(0, 0, 0, 90))
    _paste(img, sh, cx - w // 2, line - h // 2 - 1)


def light(img, spec):
    """Multiply by the summed light colours, then contrast about mid grey."""
    *lights, contrast = spec.split(',')
    mul = np.zeros(3)
    for part in lights:
        c, k = part.split(':')
        mul += np.array([int(c[i:i + 2], 16) for i in (1, 3, 5)]) / 255 * float(k)
    a = np.asarray(img).astype(float)
    rgb = a[..., :3] / 255 * mul
    rgb = (rgb - 0.5) * float(contrast) + 0.5
    a[..., :3] = np.clip(rgb, 0, 1) * 255
    return Image.fromarray(a.round().astype(np.uint8))


def strip(items, refs, holder, weapons, tiles, spec=DAYLIGHT):
    """items: [(name, sprite)]. Returns (1x image, [(name, x_centre)])."""
    slots = [(None, r, False) for r in refs] + [(n, s, weapons) for n, s in items]
    widths = [(holder.width + GAP // 2 + s.width) if w else s.width for _, s, w in slots]
    tall = max(max(s.height for _, s, _ in slots), holder.height)
    W = sum(widths) + GAP * (len(slots) + 1)
    H, line = tall + 26, tall + 14
    img = ground(tiles, W, H, line)
    x, names = GAP, []
    for (name, s, w), sw in zip(slots, widths):
        if w:
            if not has_shadow(holder):
                contact_shadow(img, x + holder.width // 2, line, holder.width)
            img.alpha_composite(holder, (x, line - holder.height))
            hand = line - int(holder.height * HAND)
            _paste(img, s, x + holder.width + GAP // 2, hand - s.height // 2)
        else:
            if not has_shadow(s):
                contact_shadow(img, x + s.width // 2, line, s.width)
            _paste(img, s, x, line - s.height)
        if name:
            names.append((name, x + sw // 2, sw + GAP))
        x += sw + GAP
    return light(img, spec), names


def font(size):
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('preview', type=Path)
    ap.add_argument('--ground', required=True, help='base tile png[,overlay png], 256 px iso tiles')
    ap.add_argument('--refs', nargs='+', type=Path, required=True)
    ap.add_argument('--holder', type=Path, help='who stands beside each weapon (default: the second ref)')
    ap.add_argument('--dir', default='S')
    ap.add_argument('--zoom', type=int, default=3)
    ap.add_argument('--colours', type=int, default=14, help='finish B colours for re-sized weapons')
    ap.add_argument('--light', default=DAYLIGHT, help='colour:weight,... ,contrast (default: Dusk Helm daylight)')
    a = ap.parse_args()
    sheets = json.loads((a.preview / 'sheets.json').read_text())
    refs = [crop(p) for p in a.refs]
    holder = crop(a.holder) if a.holder else refs[min(1, len(refs) - 1)]
    tiles = a.ground.split(',')
    sizes = {}
    for g, info in sheets.items():
        if g.startswith('weapons'):
            items = []
            for n in info['models']:
                f = real_size(n)
                im, k = resize_weapon(a.preview / 'raw' / f'{n}_{a.dir}.png', f * holder.height, a.colours)
                items.append((n, im))
                sizes[n] = {'fraction_of_holder': f, 'px': max(im.size), 'raw_scale': round(k, 3)}
        else:
            items = [(n, crop(a.preview / 'pixel' / f'{n}_{a.dir}.png')) for n in info['models']]
        rows = [strip(items[k:k + PER_STRIP], refs, holder, g.startswith('weapons'), tiles, a.light)
                for k in range(0, len(items), PER_STRIP)]
        W, H = max(r[0].width for r in rows), sum(r[0].height for r in rows)
        one = Image.new('RGBA', (W, H), (40, 44, 40, 255))
        y = 0
        for im, _ in rows:
            one.alpha_composite(im, (0, y))
            y += im.height
        one = one.convert('RGB')
        p1 = a.preview / f'lineup-{g}.png'
        one.save(p1)
        z, label = a.zoom, 16
        big = Image.new('RGB', (W * z, (H + label * len(rows) // z + 1) * z), (40, 44, 40))
        d = ImageDraw.Draw(big)
        y = 0
        for im, names in rows:
            big.paste(im.convert('RGB').resize((im.width * z, im.height * z), Image.NEAREST), (0, y))
            y += im.height * z
            for n, cx, room in names:
                fit = max(4, room * z // 8)  # ~8 px per character at size 13
                t = n if len(n) <= fit else n[:fit - 1] + '…'
                d.text((cx * z - d.textlength(t, font=font(13)) / 2, y + 2), t, fill=(225, 225, 225), font=font(13))
            y += label
        big = big.crop((0, 0, W * z, y))
        p3 = a.preview / f'lineup-{g}@{z}x.png'
        big.save(p3)
        info['lineup'], info['lineup_zoom'] = str(p1.resolve()), str(p3.resolve())
        print(p3)
    (a.preview / 'sheets.json').write_text(json.dumps(sheets, indent=1) + '\n')
    (a.preview / 'lineup.json').write_text(json.dumps({
        'holder_px': holder.height, 'refs': [str(p) for p in a.refs], 'holder': str(a.holder or a.refs[min(1, len(a.refs) - 1)]),
        'ground': tiles, 'light': a.light, 'weapon_sizes': sizes,
        'weapon_calibration': 'pack 6Barbarian long axe ~36 px vs ~43 px body = 0.84 (2H axe)'}, indent=1) + '\n')


if __name__ == '__main__':
    main()
