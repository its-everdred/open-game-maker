"""Finish C frames + comparison media for the Quaternius refit test. Run with the forge venv python from work/."""
import json, shutil, subprocess, sys
sys.path.append(str(__import__('pathlib').Path.home() / '.cache/ogm-armor-test/ppiso'))
from pathlib import Path
from PIL import Image, ImageDraw

W = Path.home() / '.cache/ogm-armor-test/work'
R = Path('/home/orangekid/games/open-game-maker-2000/assets-local/review/armor/quaternius-refit')
HB = Path('/home/orangekid/games/open-game-maker-2000/assets-local/experiments/sprite-pipeline/hero-base')
PY = str(Path.home() / '.local/share/ogm/forge-venv/bin/python')
M = Path.home() / 'ogm-stack/skills/gm-sprite-forge/scripts/motion'
STEMS = {'peasant-warrior-m': 'warrior-m', 'ranger-m': 'ranger-m', 'ranger-f': 'ranger-f'}
R.mkdir(parents=True, exist_ok=True)


def fc(colour, ids, out, factor):
    subprocess.run([PY, str(W / 'finishc.py'), str(colour), str(ids), str(out), '--factor', str(factor)], check=True)


def stills():
    # ---- stills: SSI original | finish B | finish C, S SE SW, 4x
    (W / 'stillsC').mkdir(exist_ok=True)
    rows = []
    for s, body in STEMS.items():
        row = []
        for d in ('S', 'SE', 'SW'):
            c = W / f'stillsC/{s}_{d}.png'
            fc(W / f'stills4x-colour/raw_{s}_{d}.png', W / f'stills4x-id/raw_{s}_{d}.png', c, 4)
            row.append((HB / body / 'orig' / f'{d}.png', W / f'stillsB/pixel/{s}_{d}.png', c))
        rows.append((s, row))
    Z, PAD = 4, 8
    def crop(p):
        im = Image.open(p).convert('RGBA'); b = im.getbbox(); return im.crop(b) if b else im
    tiles = [[[crop(p) for p in trio] for trio in row] for _, row in rows]
    cw = max(t.width for r in tiles for trio in r for t in trio) * Z + PAD
    ch = max(t.height for r in tiles for trio in r for t in trio) * Z + PAD
    sheet = Image.new('RGBA', (cw * 9, ch * len(rows) + 20), (58, 58, 70, 255))
    dr = ImageDraw.Draw(sheet)
    for j, lab in enumerate(['SSI original', 'finish B', 'finish C'] * 3):
        dr.text((j * cw + 4, 4), f"{lab} {['S', 'SE', 'SW'][j // 3]}", fill=(230, 230, 230, 255))
    for i, r in enumerate(tiles):
        for k, trio in enumerate(r):
            for t, im in enumerate(trio):
                big = im.resize((im.width * Z, im.height * Z), Image.NEAREST)
                x = (k * 3 + t) * cw + (cw - big.width) // 2; y = 20 + i * ch + (ch - big.height)
                sheet.alpha_composite(big, (x, y))
    sheet.save(R / 'idle-original-B-C-4x.png')
    print('stills sheet', R / 'idle-original-B-C-4x.png')

    # ---- finish C lineup: a copy of the finish B preview dir with pixel/ swapped for finish C
    cdir = W / 'stillsC-preview'
    if cdir.exists():
        shutil.rmtree(cdir)
    shutil.copytree(W / 'stillsB', cdir, ignore=shutil.ignore_patterns('lineup*'))
    for p in (W / 'stillsC').glob('*.png'):
        shutil.copy(p, cdir / 'pixel' / p.name)
    sj = json.loads((cdir / 'sheets.json').read_text())
    for g in sj.values():
        for k in [k for k in g if k.startswith('lineup')]:
            g.pop(k)
    (cdir / 'sheets.json').write_text(json.dumps(sj, indent=1))



if (W / 'stills4x-id/models.jsonl').exists():
    stills()

# ---- motion: finish C sheets from the raw colour + ID frames, as fake cells for matrix_media
for s in STEMS:
    for clip in ('walk', 'bigchop'):
        r0 = W / f'cells/{s}-{clip}'; i = W / f'cells/{s}-{clip}-id'; c = W / f'cells/{s}-{clip}-C'
        b = W / f'cells/{s}-{clip}-B'
        if not (r0 / 'out/sheet.png').exists() or not i.exists():
            print('missing', r0, i); continue
        (c / 'out').mkdir(parents=True, exist_ok=True); (b / 'out').mkdir(parents=True, exist_ok=True)
        base = Image.open(r0 / 'out/sheet.png')
        out = Image.new('RGBA', base.size, (0, 0, 0, 0))
        # finish B as the gear lineups use it (pixel_preview.pixelate: hard alpha + 14 colours, one palette per row);
        # the motion cells' own finish is the base-body skin pass and paints clothing as skin
        import numpy as np
        from pixel_preview import pixelate
        outb = Image.new('RGBA', base.size, (0, 0, 0, 0))
        byrow = {}
        for raw in sorted(r0.glob('raw_*_*.png')):
            _, row, col = raw.stem.split('_'); byrow.setdefault(int(row), []).append((int(col), raw))
        for row, lst in byrow.items():
            fr = [np.asarray(Image.open(p).convert('RGBA').resize((128, 128), Image.BOX)) for _, p in lst]
            for (col, _), px in zip(lst, pixelate(fr, 14)):
                outb.alpha_composite(Image.fromarray(px.astype(np.uint8), 'RGBA'), (col * 128, row * 128))
        outb.save(b / 'out/sheet.png')
        rb = json.loads((r0 / 'recipe.json').read_text()); rb['name'] += ' finish B'
        (b / 'recipe.json').write_text(json.dumps(rb)); shutil.copy(r0 / 'scores.json', b / 'scores.json')
        for raw in sorted(r0.glob('raw_*_*.png')):
            _, row, col = raw.stem.split('_')
            f = Image.open(raw).width // 128
            tmp = c / f'c_{row}_{col}.png'
            fc(raw, i / raw.name, tmp, f)
            out.alpha_composite(Image.open(tmp).convert('RGBA'), (int(col) * 128, int(row) * 128))
        out.save(c / 'out/sheet.png')
        rec = json.loads((r0 / 'recipe.json').read_text()); rec['name'] += ' finish C'
        (c / 'recipe.json').write_text(json.dumps(rec)); shutil.copy(r0 / 'scores.json', c / 'scores.json')
        pack = json.loads((W / f'cells-{s}.json').read_text())['pack']['attack' if clip == 'bigchop' else 'walk']
        md = W / f'media/{s}-{clip}'
        subprocess.run([PY, str(M / 'matrix_media.py'), str(md), pack, f'{s} {clip}', str(b), str(c)], check=True,
                       stdout=subprocess.DEVNULL)
        for z in (4, 1):
            for d in ('S', 'SE'):
                shutil.copy(md / f'matrix_{d}_{z}x.mp4', R / f'{s}-{clip}_{d}_{z}x.mp4')
        print('media', s, clip)

# ---- deformation close-ups: the raw (2x supersampled) S frames of each clip, every other frame, 2x nearest
for s in STEMS:
    for clip in ('walk', 'bigchop'):
        r0 = W / f'cells/{s}-{clip}'
        fr = sorted(r0.glob('raw_2_*.png'), key=lambda p: int(p.stem.split('_')[2]))[::2]
        if not fr:
            continue
        ims = [Image.open(p).convert('RGBA') for p in fr]
        box = None
        for im in ims:
            b = im.getbbox()
            box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
        ims = [im.crop(box) for im in ims]
        w, h = ims[0].size
        sh = Image.new('RGBA', (w * 2 * len(ims), h * 2), (58, 58, 70, 255))
        for k, im in enumerate(ims):
            sh.alpha_composite(im.resize((w * 2, h * 2), Image.NEAREST), (k * w * 2, 0))
        sh.save(R / f'{s}-{clip}-deform-closeup.png')
        print('closeup', s, clip)
