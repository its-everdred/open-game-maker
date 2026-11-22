"""Terrain-transition spike (#1200): renders the approval sheet for the SmallScaleInt isometric ground.

TEMPORARY EXPERIMENT: every mask and transition tile this writes is a procedural experiment (numpy masks over cloned
pack pixels), not a production sprite. Pack originals are only read. Output goes to assets-local, never committed.

    python -I render.py <pack Environment dir> <out dir>
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ENV, OUT = Path(sys.argv[1]), Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)
TW, TH = 128, 64  # floor diamond (#1021)

# Terrains, lowest priority first: a higher terrain overlays every lower one. (name, pack overlay over Ground A1,
# edge noise amplitude, edge shadow px)
TERRAINS = [
    ('dirt', None, 0.0, 0),
    ('dry grass', 'Ground J1', 0.32, 1),
    ('grass', 'Ground A2', 0.32, 1),
    ('dark grass', 'Ground A18', 0.32, 1),
    ('cobble path', 'Ground E1', 0.18, 1),
    ('stone paving', 'Ground H1', 0.06, 2),
]
KEY = {'d': 0, 'y': 1, 'g': 2, 'k': 3, 'c': 4, 's': 5}
SCENE = [
    'kkkggggyyy',
    'kkgggggyyy',
    'kggggcgggy',
    'gggggcggdd',
    'ggssscccdd',
    'ggssscggdd',
    'gddsscgggg',
    'gddgccgkkg',
    'ggggcggkkk',
    'ggggcggggk',
]
GRID = np.array([[KEY[ch] for ch in row] for row in SCENE])
H, W = GRID.shape


def load(name):
    return Image.open(ENV / f'{name}.png').convert('RGBA')


# Tile-local diamond coordinates: top vertex (0,0), right (1,0), left (0,1), bottom (1,1).
_py, _px = np.mgrid[0:TH, 0:TW] + 0.5
U = (_px - TW / 2) / TW + _py / TH
V = -(_px - TW / 2) / TW + _py / TH
INSIDE = (U >= 0) & (U < 1) & (V >= 0) & (V < 1)
TAPER = np.clip(np.minimum.reduce([U, 1 - U, V, 1 - V]) * 6, 0, 1)


def noise(seed, cells=6):
    """Value noise in [-1, 1] over the tile's uv square, tapered to 0 on its borders so neighbours always meet."""
    g = np.random.default_rng(seed).uniform(-1, 1, (cells + 1, cells + 1))
    x, y = np.clip(U, 0, 1) * cells, np.clip(V, 0, 1) * cells
    x0, y0 = np.minimum(x.astype(int), cells - 1), np.minimum(y.astype(int), cells - 1)
    fx, fy = x - x0, y - y0
    v = (g[y0, x0] * (1 - fx) * (1 - fy) + g[y0, x0 + 1] * fx * (1 - fy)
         + g[y0 + 1, x0] * (1 - fx) * fy + g[y0 + 1, x0 + 1] * fx * fy)
    jitter = np.random.default_rng(seed + 7).uniform(-0.35, 0.35, U.shape)
    return (v + jitter) * TAPER


def top_texture(overlay):
    """The terrain's top face as a 128x64 diamond, sampled from the pack's block plus overlay."""
    im = load('Ground A1_N')
    if overlay:
        im.alpha_composite(load(f'{overlay}_N'))
    tex = np.array(im.crop((64, 176, 192, 240)))
    tex[~INSIDE] = 0
    return tex


TEX = [top_texture(t[1]) for t in TERRAINS]

# ---- masks -------------------------------------------------------------------------------------------------
VARIANTS = 3


def corner_mask(bits, amp, seed):
    """Dual-grid / marching-squares piece: bits = (top, right, left, bottom) corner terrain flags."""
    t, r, l, b = bits
    f = t * (1 - U) * (1 - V) + r * U * (1 - V) + l * (1 - U) * V + b * U * V
    return INSIDE & (f + noise(seed) * amp > 0.5)


def blob_index(occ):
    """occ is 3x3 (rows v-1..v+1, cols u-1..u+1). The 47-blob 8-bit mask, corners dropped unless both sides set."""
    n, e, s, w = occ[0][1], occ[1][2], occ[2][1], occ[1][0]
    ne, se, sw, nw = occ[0][2] and n and e, occ[2][2] and s and e, occ[2][0] and s and w, occ[0][0] and n and w
    return sum(int(bool(x)) << i for i, x in enumerate([n, ne, e, se, s, sw, w, nw]))


def blob_mask(idx, amp, seed, margin=0.3):
    bits = [(idx >> i) & 1 for i in range(8)]
    n, ne, e, se, s, sw, w, nw = bits
    occ = [[nw, n, ne], [w, 1, e], [sw, s, se]]
    d = np.full(U.shape, 9.0)
    for dv in range(3):
        for du in range(3):
            if occ[dv][du]:
                continue
            u0, v0 = du - 1, dv - 1  # out square [u0,u0+1]x[v0,v0+1]
            dx = np.maximum.reduce([u0 - U, np.zeros_like(U), U - (u0 + 1)])
            dy = np.maximum.reduce([v0 - V, np.zeros_like(V), V - (v0 + 1)])
            d = np.minimum(d, np.hypot(dx, dy))
    return INSIDE & (d + noise(seed) * amp * margin > margin)


BLOB_SET = sorted({blob_index([[(c >> (3 * r + k)) & 1 for k in range(3)] for r in range(3)]) for c in range(512)
                   if (c >> 4) & 1})
assert len(BLOB_SET) == 47, len(BLOB_SET)

# ---- world compositing -------------------------------------------------------------------------------------
PAD_TOP, PAD = 200, 96
CW, CH = (W + H) * TW // 2 + 2 * PAD, (W + H) * TH // 2 + PAD_TOP + 64


def cell_xy(cx, cy):
    """Top-left of the 128x64 box around cell (cx, cy)'s diamond (cx runs along u, cy along v)."""
    return int(round((cx - cy) * TW / 2 + H * TW / 2 - TW / 2 + PAD)), int(round((cx + cy) * TH / 2 + PAD_TOP))


def stamp(canvas, tile, cx, cy):
    x, y = cell_xy(cx, cy)
    canvas[y:y + TH, x:x + TW] |= tile


def world_texture(k):
    """The terrain painted on every cell of a lattice wider than the map: block plus full overlay (fringe included)."""
    im = Image.new('RGBA', (CW, CH), (0, 0, 0, 255))
    block, over = load('Ground A1_N'), load(f'{TERRAINS[k][1]}_N') if TERRAINS[k][1] else None
    for s in range(-2, W + H + 2):
        for cy in range(-1, H + 1):
            cx = s - cy
            if -1 <= cx <= W:
                x, y = cell_xy(cx, cy)
                for layer in (block, over) if over else (block,):
                    im.paste(layer, (x + TW // 2 - 128, y - 176), layer)
    return np.array(im)


WTEX = [world_texture(k) for k in range(len(TERRAINS))]
AREA = np.zeros((CH, CW), bool)
for cy in range(H):
    for cx in range(W):
        stamp(AREA, INSIDE, cx, cy)


def h(*a):
    return (hash(a) * 2654435761) & 0xFFFF


def base_blocks():
    im = Image.new('RGBA', (CW, CH), (24, 24, 28, 255))
    block = load('Ground A1_N')
    for s in range(W + H):
        for cy in range(H):
            cx = s - cy
            if 0 <= cx < W:
                x, y = cell_xy(cx, cy)
                im.alpha_composite(block, (x + TW // 2 - 128, y - 176))
    return im


def compose(masks):
    """masks[k] = world mask for terrain k (k >= 1); dirt fills underneath."""
    im = base_blocks()
    rgb = np.array(im)
    for k, m in enumerate(masks):
        if k == 0:
            continue
        m = m & AREA
        sh = TERRAINS[k][3]
        if sh:
            shadow = np.zeros_like(m)
            shadow[sh:] = m[:-sh]
            shadow &= ~m & AREA
            rgb[shadow, :3] = (rgb[shadow, :3] * 0.72).astype(np.uint8)
        rgb[m, :3] = WTEX[k][m, :3]
    return Image.fromarray(rgb)


def decorate(im, seed=1):
    """Reuse layers: pack tuft and pebble overlays scattered on cells by a seeded hash, plus three props."""
    tufts = {2: ['Ground A6', 'Ground A7', 'Ground A8', 'Ground A9'], 1: ['Ground J5', 'Ground J6', 'Ground J8'],
             0: ['Ground E2', 'Ground E3', 'Ground E6']}
    for s in range(W + H):
        for cy in range(H):
            cx = s - cy
            if not 0 <= cx < W:
                continue
            k = GRID[cy, cx]
            r = h(seed, cx, cy)
            if k in tufts and r % 3 == 0:
                names = tufts[k]
                im.alpha_composite(load(f'{names[r % len(names)]}_{"NESW"[(r >> 4) % 4]}'),
                                   (cell_xy(cx, cy)[0] + TW // 2 - 128, cell_xy(cx, cy)[1] - 176))
    return props(im)


def props(im):
    for cx, cy, name in sorted([(7, 2, 'Tree A1_N'), (3, 7, 'Tree A2_N')],
                               key=lambda p: p[0] + p[1]):
        x, y = cell_xy(cx, cy)
        im.alpha_composite(load(name), (x + TW // 2 - 128, y - 176))
    return im


def scene_blocky():
    im = base_blocks()
    over = {k: load(f'{t[1]}_N') for k, t in enumerate(TERRAINS) if t[1]}
    block = load('Ground A1_N')
    for s in range(W + H):
        for cy in range(H):
            cx = s - cy
            if 0 <= cx < W:
                x, y = cell_xy(cx, cy)
                im.alpha_composite(block, (x + TW // 2 - 128, y - 176))
                k = GRID[cy, cx]
                if k in over:
                    im.alpha_composite(over[k], (x + TW // 2 - 128, y - 176))
    return props(im)


def at(cx, cy):
    return GRID[min(max(cy, 0), H - 1), min(max(cx, 0), W - 1)]


def scene_dualgrid():
    """Data stays per cell; display tiles sit on cell corners (offset half a tile) and read the 4 cells around."""
    masks = [np.zeros((CH, CW), bool) for _ in TERRAINS]
    used = set()
    for vy in range(H + 1):
        for vx in range(W + 1):
            corners = [at(vx - 1, vy - 1), at(vx, vy - 1), at(vx - 1, vy), at(vx, vy)]  # top, right, left, bottom
            for k in range(1, len(TERRAINS)):
                bits = tuple(int(c >= k) for c in corners)
                if not any(bits):
                    continue
                var = h(vx, vy, k) % VARIANTS
                used.add((k, bits))
                tile = INSIDE if all(bits) else corner_mask(bits, TERRAINS[k][2], 1000 * sum(b << i for i, b in enumerate(bits)) + var)
                x, y = cell_xy(vx - 0.5, vy - 0.5)
                masks[k][y:y + TH, x:x + TW] |= tile
    return compose(masks), used


def scene_blob():
    masks = [np.zeros((CH, CW), bool) for _ in TERRAINS]
    used = set()
    for cy in range(H):
        for cx in range(W):
            for k in range(1, len(TERRAINS)):
                if GRID[cy, cx] < k:
                    continue
                occ = [[at(cx + du, cy + dv) >= k for du in (-1, 0, 1)] for dv in (-1, 0, 1)]
                idx = blob_index(occ)
                used.add((k, idx))
                stamp(masks[k], INSIDE if idx == 255 else blob_mask(idx, TERRAINS[k][2], 5000 + idx * 10 + h(cx, cy, k) % VARIANTS), cx, cy)
    return compose(masks), used


def scene_splat():
    """Shader reference: per-pixel bilinear weights of cell centres plus world-space noise; no transition tiles."""
    yy, xx = np.mgrid[0:CH, 0:CW] + 0.5
    ox, oy = cell_xy(0, 0)
    sx, sy = (xx - ox - TW / 2) / (TW / 2), (yy - oy) / (TH / 2)
    gu, gv = (sx + sy) / 2 - 0.5, (sy - sx) / 2 - 0.5  # cell-centre coordinates
    rng = np.random.default_rng(3)
    big = Image.fromarray(rng.uniform(0, 255, (CH // 20 + 2, CW // 20 + 2)).astype(np.uint8))
    smooth = np.array(big.resize(((CW // 20 + 2) * 20, (CH // 20 + 2) * 20), Image.BICUBIC))[:CH, :CW] / 127.5 - 1
    nz = smooth + rng.uniform(-0.35, 0.35, (CH, CW))
    u0, v0 = np.floor(gu).astype(int), np.floor(gv).astype(int)
    fu, fv = gu - u0, gv - v0
    G = np.pad(GRID, 1, mode='edge')
    def g(du, dv):
        return G[np.clip(v0 + dv + 1, 0, H + 1), np.clip(u0 + du + 1, 0, W + 1)]
    masks = [np.zeros((CH, CW), bool) for _ in TERRAINS]
    for k in range(1, len(TERRAINS)):
        f = ((g(0, 0) >= k) * (1 - fu) * (1 - fv) + (g(1, 0) >= k) * fu * (1 - fv)
             + (g(0, 1) >= k) * (1 - fu) * fv + (g(1, 1) >= k) * fu * fv)
        masks[k] = f + nz * TERRAINS[k][2] > 0.5
    return compose(masks)


# ---- sheets ------------------------------------------------------------------------------------------------
def label(im, xy, text, fill=(235, 235, 235, 255)):
    ImageDraw.Draw(im).text(xy, text, fill=fill)


def tile_image(mask, k, below=0):
    out = TEX[below].copy()
    a = TEX[k][..., 3:4] / 255.0
    out[mask, :3] = (TEX[k][mask, :3] * a[mask] + out[mask, :3] * (1 - a[mask])).astype(np.uint8)
    return Image.fromarray(out)


def layout_dualgrid():
    pairs = [(2, 0), (5, 2)]
    sheet = Image.new('RGBA', (8 * (TW + 6) + 6, 2 * len(pairs) * (TH + 22) + 6), (24, 24, 28, 255))
    for row, (k, below) in enumerate(pairs):
        for i in range(16):
            bits = ((i >> 3) & 1, (i >> 2) & 1, (i >> 1) & 1, i & 1)
            m = INSIDE & False if not any(bits) else (INSIDE if all(bits) else corner_mask(bits, TERRAINS[k][2], 1000 * sum(b << j for j, b in enumerate(bits))))
            x, y = 6 + (i % 8) * (TW + 6), 6 + (2 * row + i // 8) * (TH + 22)
            sheet.alpha_composite(tile_image(m, k, below), (x, y))
            label(sheet, (x + 40, y + TH + 4), ''.join('TRLB'[j] if bits[j] else '.' for j in range(4)))
    return sheet


def layout_blob():
    cols = 12
    sheet = Image.new('RGBA', (cols * (TW + 6) + 6, 4 * (TH + 22) + 6), (24, 24, 28, 255))
    for i, idx in enumerate(BLOB_SET):
        x, y = 6 + (i % cols) * (TW + 6), 6 + (i // cols) * (TH + 22)
        m = INSIDE if idx == 255 else blob_mask(idx, TERRAINS[2][2], 5000 + idx * 10)
        sheet.alpha_composite(tile_image(m, 2, 0), (x, y))
        label(sheet, (x + 52, y + TH + 4), str(idx))
    return sheet


def crop(im):
    cx, cy = CW // 2, PAD_TOP + (W + H) * TH // 4
    return im.crop((cx - 384, cy - 260, cx + 384, cy + 260))


if __name__ == '__main__':
    blocky = scene_blocky()
    dual, dual_used = scene_dualgrid()
    blob, blob_used = scene_blob()
    splat = scene_splat()
    scenes = {
        'now-blocky': blocky,
        'a-dualgrid16': decorate(dual),
        'b-blob47': decorate(blob),
        'c-splat-shader-reference': decorate(splat),
    }
    for name, im in scenes.items():
        im.save(OUT / f'scene-{name}.png')
        crop(im).save(OUT / f'phone-{name}.png')
    layout_dualgrid().save(OUT / 'layout-a-dualgrid16.png')
    layout_blob().save(OUT / 'layout-b-blob47.png')

    # Approval sheet: phone-first, one 768 px column at 1x (real 128x64 tiles).
    titles = {'now-blocky': 'Now', 'a-dualgrid16': 'A  dual-grid 16', 'b-blob47': 'B  blob 47',
              'c-splat-shader-reference': 'C  shader splat'}
    crops = [crop(im) for im in scenes.values()]
    sheet = Image.new('RGBA', (768, sum(c.height + 24 for c in crops)), (16, 16, 20, 255))
    y = 0
    for (name, title), c in zip(titles.items(), crops):
        label(sheet, (8, y + 6), title)
        sheet.alpha_composite(c, (0, y + 24))
        y += c.height + 24
    sheet.save(OUT / 'approval-sheet.png')
    counts = {
        'scene_cells': W * H,
        'a_dualgrid_distinct_pieces_used': len(dual_used),
        'b_blob_distinct_pieces_used': len(blob_used),
        'blob_set_size': len(BLOB_SET),
        'variants_per_piece': VARIANTS,
    }
    (OUT / 'metadata.json').write_text(json.dumps({
        'experiment': True,
        'ai_generated': False,
        'method': 'procedural numpy masks over cloned SmallScaleInt top faces; temporary spike tiles, not production',
        'source_tiles': sorted({t[1] for t in TERRAINS if t[1]} | {'Ground A1', 'Tree A1', 'Tree A2', }),
        'counts': counts,
    }, indent=2))
    print(json.dumps(counts))
