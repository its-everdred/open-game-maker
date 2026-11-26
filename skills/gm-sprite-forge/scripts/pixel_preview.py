"""Preview 3D models through the pack camera and a pixel finish (B, or C): raw | pixel, side by side.

Usage: pixel_preview.py <model|dir> [...] --out <dir> [--dirs S,SE] [--colours 14] [--anim rig.glb] [--ref-height H]
                        [--group category|none] [--title "Pack"] [--finish B|C [--variant C1|C2|C3|C4] [--ssi ref.png ...]
                        [--cloth-split]]
Renders every .glb/.gltf/.fbx/.obj (directories recursively; one file per model name, glb > gltf > fbx > obj) with
pixel_preview_rig.py in one Blender run at pack scale (a character stands 43 px, as the hero bodies; props, weapons
and tiles at the same world scale). Finish B uses hard alpha (finish.py) and pixel_finish.py with
14 colours, smoothed, one palette across its directions (B is 8 + 6 cloth colours; with no cloth mask the 14 share one
palette). Writes raw/ and pixel/ PNGs at 1x, one contact sheet per group (<out>/<group>.png, zoomed, nearest
neighbour), sheets.json and recipe.json. Never writes into the inputs.
Finish C (the default, #1338) renders at 4x with no anti-aliasing plus albedo and depth passes (raw/, alb/ and depth/ keep them at
4x) and gives each model pixel_finish_c.py with presets/finish-c.json (--variant; --ssi pack sprites of the same kind
for the ssi_tone palette; --cloth-split keeps white undergarments off the skin): majority-vote downsample, hard bands per
material and a darkened-colour outline. Default C4 keeps albedo hue and has no internal separation lines.
"""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import sysconfig
import tempfile
import time

import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
from finish import finish  # noqa: E402
from pixel_finish import pixel_finish  # noqa: E402
from pixel_finish_c import PRESET, finish_c, load_preset, needs_ssi  # noqa: E402

RIG = Path(__file__).with_name('pixel_preview_rig.py')
EXT = {'.glb': 0, '.gltf': 1, '.fbx': 2, '.obj': 3}
BG = (54, 58, 62)
# first match wins; weapons split into kinds when a pack has more than WEAPON_SPLIT of them
RULES = [
    ('armor', r'helm|armou?r|cape|cloak|boot|glove|gauntlet|pauldron|bracer|hood|hat\b|_hat|mask|belt|chestplate'),
    ('weapons-shields', r'shield'),
    ('weapons-bows', r'crossbow|bow|arrow|quiver'),
    ('weapons-axes', r'axe(?!l)|halberd'),
    ('weapons-hammers', r'hammer|mace|club|maul|flail|fistweapon'),
    ('weapons-swords', r'sword|blade|dagger|knife|sabre|saber|katana|cutlass'),
    ('weapons-staffs', r'staff|wand|scythe|spear|lance|trident|scepter|sceptre|rod_magic'),
    ('environment', r'wall|floor|tile|stair|step|column|pillar|door|gate|arch|bridge|fence|roof|battlement|dock|ground|'
                    r'rock|stone|cliff|tree|bush|grass|plant|tower|corner|ladder|window|path|road|water|hill|'
                    r'mountain|building|house|overhang|support|structure|scaffold|platform|block'),
]
WEAPON_SPLIT = 12


def collect(inputs):
    found = {}
    for inp in inputs:
        files = [inp] if inp.is_file() else sorted(p for p in inp.rglob('*') if p.suffix.lower() in EXT)
        for f in files:
            key = re.sub(r'[-_ ]', '', f.stem.lower())
            if key not in found or EXT[f.suffix.lower()] < EXT[found[key].suffix.lower()]:
                found[key] = f
    names, models = set(), []
    for f in sorted(found.values(), key=lambda p: p.stem.lower()):
        name = re.sub(r'[^A-Za-z0-9_-]', '_', f.stem)
        while name in names:
            name += '_'
        names.add(name)
        models.append({'name': name, 'path': str(f.resolve())})
    return models


def category(rec, n_weapons):
    if rec.get('character'):
        return 'characters'
    name = rec['name'].lower()
    for cat, rx in RULES:
        if re.search(rx, name):
            if cat.startswith('weapons-') and n_weapons <= WEAPON_SPLIT:
                return 'weapons'
            return cat
    return 'props'


def pixelate(frames, colours):
    """finish B over one model: the directions side by side, so they share one palette."""
    h = max(f.shape[0] for f in frames)
    strip = np.concatenate([np.pad(f, ((0, h - f.shape[0]), (0, 0), (0, 0))) for f in frames], 1)
    out = pixel_finish(finish(strip), colours, smooth=True)
    parts, x = [], 0
    for f in frames:
        parts.append(out[:f.shape[0], x:x + f.shape[1]])
        x += f.shape[1]
    return parts


def side_by_side(frames, fill):
    h = max(f.shape[0] for f in frames)
    return np.concatenate([np.pad(f, ((0, h - f.shape[0]), (0, 0)) + ((0, 0),) * (f.ndim - 2), constant_values=fill)
                           for f in frames], 1)


def pixelate_c(raws, albs, depths, P, ssi=(), ss=4):
    """finish C over one model: the directions side by side at ss x, so one material has one palette in all of them."""
    out, _ = finish_c(side_by_side(raws, 0), side_by_side(albs, 0), side_by_side(depths, 65535), P, ssi, ss)
    parts, x = [], 0
    for f in raws:
        w, h = f.shape[1] // ss, f.shape[0] // ss
        parts.append(out[:h, x:x + w])
        x += w
    return parts


def font(size):
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def sheet(entries, dirs, zoom, title, cols):
    """One tile per model: raw directions | pixel directions, its name underneath."""
    cell = max(e['cell'] for e in entries)
    gap, pad, label = 4 * zoom, 8, 18
    tile_w = 2 * len(dirs) * cell * zoom + gap * 3
    tile_h = cell * zoom + label
    cols = max(1, min(cols, len(entries)))
    rows = -(-len(entries) // cols)
    head = 30
    W, H = cols * (tile_w + pad) + pad, head + rows * (tile_h + pad) + pad
    img = Image.new('RGBA', (W, H), BG + (255,))
    d = ImageDraw.Draw(img)
    d.text((pad, 6), title, fill=(235, 235, 235), font=font(18))
    for i, e in enumerate(entries):
        x0 = pad + (i % cols) * (tile_w + pad)
        y0 = head + (i // cols) * (tile_h + pad)
        x = x0
        for kind in ('raw', 'pixel'):
            for f in e[kind]:
                big = Image.fromarray(f).resize((f.shape[1] * zoom, f.shape[0] * zoom), Image.NEAREST)
                ox = x + (cell - f.shape[1]) * zoom // 2
                oy = y0 + (cell - f.shape[0]) * zoom  # feet on a common line
                img.alpha_composite(big, (ox, oy))
                x += cell * zoom
            x += gap * 2
        d.line([(x0 + len(dirs) * cell * zoom + gap, y0), (x0 + len(dirs) * cell * zoom + gap, y0 + cell * zoom)],
               fill=(90, 95, 100), width=1)
        d.text((x0, y0 + cell * zoom + 2), e['name'], fill=(220, 220, 220), font=font(13))
    return img.convert('RGB')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('inputs', nargs='+', type=Path)
    ap.add_argument('--out', type=Path, required=True)
    ap.add_argument('--dirs', default='S,SE')
    ap.add_argument('--colours', type=int, default=14, help='finish B: 14 (8 + 6 cloth, one palette without a mask)')
    ap.add_argument('--anim', type=Path, help='glb whose idle action poses rigged characters that have none')
    ap.add_argument('--ref-height', type=float, default=0,
                    help="a character's height in the pack's world units (default: median of the run's characters)")
    ap.add_argument('--group', choices=['category', 'none'], default='category')
    ap.add_argument('--title', help='sheet title prefix (default: the first input folder name)')
    ap.add_argument('--zoom', type=int, default=3)
    ap.add_argument('--cols', type=int, default=4)
    ap.add_argument('--samples', type=int, default=32)
    ap.add_argument('--threads', type=int, default=2)
    ap.add_argument('--blender', default='blender')
    ap.add_argument('--finish', choices=['B', 'C'], default='C')
    ap.add_argument('--preset', type=Path, default=PRESET, help='finish C parameters')
    ap.add_argument('--variant', help='finish C preset variant (C1, C2, C3, C4; default: C4)')
    ap.add_argument('--ssi', nargs='*', type=Path, default=[], help='finish C: pack sprites of the same kind (ssi_tone)')
    ap.add_argument('--cloth-split', action='store_true', help='finish C: white undergarments are their own material')
    a = ap.parse_args()
    crisp = a.finish == 'C'
    SS = 4
    P = load_preset(a.preset, a.variant) | ({'cloth_split': True} if a.cloth_split else {}) if crisp else None
    if crisp and needs_ssi(P) and not a.ssi:
        ap.error(f"finish C {a.variant or 'defaults'} uses the {P['palette']} palette: add --ssi <pack sprites of the "
                 'same kind> (or --variant C3, the model\'s own colours)')
    a.ssi = [p.resolve() for p in a.ssi]  # the recipe is replayed by pixel_lineup from any directory
    models = collect(a.inputs)
    if not models:
        ap.error('no .glb/.gltf/.fbx/.obj models found')
    title = a.title or a.inputs[0].resolve().name
    t0 = time.time()
    with tempfile.TemporaryDirectory(prefix='pixel-preview-') as tmp:
        jobs = Path(tmp) / 'jobs.json'
        jobs.write_text(json.dumps({'models': models, 'anim': str(a.anim.resolve()) if a.anim else None}))
        renders = Path(tmp) / 'r'
        a.out.mkdir(parents=True, exist_ok=True)
        env = os.environ | {'PYTHONPATH': sysconfig.get_paths()['purelib']}  # the glTF importer needs numpy
        with open(a.out / 'blender.log', 'w') as log:
            res = subprocess.run(['nice', '-n', '10', a.blender, '-b', '--factory-startup', '--python-use-system-env', '--threads', str(a.threads),
                                  '--python-exit-code', '1', '--python', str(RIG), '--', str(renders), str(jobs),
                                  f'dirs={a.dirs}', f'ref_height={a.ref_height}', f'samples={a.samples}',
                                  f'threads={a.threads}'] + ([f'ss={SS}', 'passes=1'] if crisp else []), stdout=log, stderr=subprocess.STDOUT, env=env)
        if res.returncode:
            sys.exit(f"blender failed (exit {res.returncode}); see {a.out / 'blender.log'}")
        recs = [json.loads(line) for line in (renders / 'models.jsonl').read_text().splitlines()]
        render = json.loads((renders / 'render.json').read_text())
        dirs = a.dirs.split(',')
        for k in ('raw', 'pixel') + (('alb', 'depth') if crisp else ()):
            (a.out / k).mkdir(parents=True, exist_ok=True)
        done = []
        for r in recs:
            if 'error' in r:
                print(f"skip {r['name']}: {r['error']}", file=sys.stderr)
                continue
            raw = [np.asarray(Image.open(renders / f"raw_{r['name']}_{d}.png").convert('RGBA')) for d in dirs]
            for d, f in zip(dirs, raw):
                Image.fromarray(f).save(a.out / 'raw' / f"{r['name']}_{d}.png")
            if crisp:
                albs, deps = [], []
                for d in dirs:
                    for k, store in (('alb', albs), ('depth', deps)):
                        src = renders / f"{k}_{r['name']}_{d}.png"
                        (a.out / k / src.name[len(k) + 1:]).write_bytes(src.read_bytes())
                        im = Image.open(src)
                        store.append(np.asarray(im.convert('RGB') if k == 'alb' else im))
                pix = pixelate_c(raw, albs, deps, P, [str(p) for p in a.ssi], SS)
                raw = [np.asarray(Image.fromarray(f).resize((f.shape[1] // SS, f.shape[0] // SS), Image.LANCZOS))
                       for f in raw]  # the contact sheet shows the raw render at 1x
            else:
                pix = pixelate(raw, a.colours)
            for d, p in zip(dirs, pix):
                Image.fromarray(p).save(a.out / 'pixel' / f"{r['name']}_{d}.png")
            done.append(r | {'raw': raw, 'pixel': pix})
    n_weapons = sum(category(r, 0) in ('weapons',) for r in done)
    groups = {}
    for r in done:
        groups.setdefault(category(r, n_weapons) if a.group == 'category' else 'all', []).append(r)
    sheets = {}
    for g, entries in sorted(groups.items()):
        path = a.out / f'{g}.png'
        label = f"{title} · {g.replace('-', ' ')}" if a.group == 'category' else title
        sheet(entries, dirs, a.zoom, f'{label}   raw | pixel ({",".join(dirs)})', a.cols).save(path)
        sheets[g] = {'sheet': str(path.resolve()), 'models': [e['name'] for e in entries]}
        print(path)
    (a.out / 'sheets.json').write_text(json.dumps(sheets, indent=1) + '\n')
    (a.out / 'recipe.json').write_text(json.dumps({
        'kind': '3D model render -> 2D pixel', 'skill': 'gm-sprite-forge', 'tool': 'scripts/pixel_preview.py',
        'model': None, 'cost_usd': 0, 'ai_generated': False,
        'finish': {'name': 'C', 'ss': SS, 'preset': str(a.preset.resolve()), 'variant': a.variant, 'params': P,
                   'ssi': [str(p) for p in a.ssi]} if crisp else
                  {'name': 'B', 'colours': a.colours, 'smooth': True, 'hard_alpha': True},
        'camera': 'pack iso (60 deg from vertical, yaw 45), 45.25 px per world unit before scale',
        'height_px': 43, 'ref_height': render['ref_height'], 'scale': render['scale'], 'dirs': dirs,
        'blender': render['blender'], 'minutes': round((time.time() - t0) / 60, 2),
        'inputs': [str(p.resolve()) for p in a.inputs],
        'skipped': {r['name']: r['error'] for r in recs if 'error' in r},
        'idle': {r['name']: r.get('idle') for r in done if r.get('character')},
    }, indent=1) + '\n')


if __name__ == '__main__':
    main()
