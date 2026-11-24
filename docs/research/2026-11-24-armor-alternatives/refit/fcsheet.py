"""Idle stills sheet: SSI original | finish B | finish C1 | finish C3 (official #1338 preset), S SE SW, 4x."""
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
FC = Path('/home/orangekid/games/open-game-maker-2000/assets-local/review/pixel-finish-c/code')
sys.path.append(str(FC / 'scripts')); sys.path.append(str(Path.home() / '.cache/ogm-armor-test/ppiso'))
from pixel_finish_c import finish_c, load_preset  # noqa: E402
import spritemetrics as sm  # noqa: E402
W = Path.home() / '.cache/ogm-armor-test/work'
R = Path('/home/orangekid/games/open-game-maker-2000/assets-local/review/armor/quaternius-refit')
HB = Path('/home/orangekid/games/open-game-maker-2000/assets-local/experiments/sprite-pipeline/hero-base')
PK = '/home/orangekid/games/open-game-maker-2000/assets-local/packs/'
SSI = [PK + 'smallscaleint-2d-hd-barbarian-pack-1/2026-11-01/extracted/6Barbarian/Idle/S/Idle_270_001.png',
       PK + 'smallscaleint-2d-hd-character-pack-1/2026-11-01/extracted/4Paladin/Idle/S/Idle_270_001.png']
STEMS = {'peasant-warrior-m': 'warrior-m', 'ranger-m': 'ranger-m', 'ranger-f': 'ranger-f'}
V = ['C1', 'C3']
(W / 'stillsFC/out').mkdir(exist_ok=True)
def crop(im):
    b = im.getbbox(); return im.crop(b) if b else im
rows = []
for s, body in STEMS.items():
    row = []
    for d in ('S', 'SE', 'SW'):
        cells = [Image.open(HB / body / 'orig' / f'{d}.png').convert('RGBA'), Image.open(W / f'stillsB/pixel/{s}_{d}.png').convert('RGBA')]
        for v in V:
            out, info = finish_c(sm.load(str(W / f'stillsFC/raw_{s}_{d}.png')),
                                 np.asarray(Image.open(W / f'stillsFC/alb_{s}_{d}.png').convert('RGB')),
                                 np.asarray(Image.open(W / f'stillsFC/depth_{s}_{d}.png')), load_preset(FC / 'presets/finish-c.json', v), SSI, 4)
            im = Image.fromarray(out); im.save(W / f'stillsFC/out/{s}_{d}_{v}.png'); cells.append(im)
        row.append([crop(c) for c in cells])
    rows.append(row)
Z, PAD, N = 4, 8, 2 + len(V)
cw = max(t.width for r in rows for g in r for t in g) * Z + PAD
ch = max(t.height for r in rows for g in r for t in g) * Z + PAD
sh = Image.new('RGBA', (cw * 3 * N, ch * len(rows) + 22), (58, 58, 70, 255))
dr = ImageDraw.Draw(sh)
labs = ['SSI original', 'finish B'] + [f'finish {v}' for v in V]
for j in range(3 * N):
    dr.text((j * cw + 4, 4), f"{labs[j % N]} {['S', 'SE', 'SW'][j // N]}", fill=(230, 230, 230, 255))
for i, r in enumerate(rows):
    for k, g in enumerate(r):
        for t, im in enumerate(g):
            big = im.resize((im.width * Z, im.height * Z), Image.NEAREST)
            sh.alpha_composite(big, ((k * N + t) * cw + (cw - big.width) // 2, 22 + i * ch + (ch - big.height)))
sh.save(R / 'idle-original-B-C-4x.png'); print('ok', sh.size)
