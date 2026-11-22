"""Dual-grid 16 terrain transition sheets for the SmallScaleInt isometric ground (#1204, layout A from #1200).

Cuts each terrain's 128x64 top face from cloned pack tiles, masks it with the 16 corner cases (3 edge variants each),
and writes one quarter sheet per terrain in the layout `@gm/pack-smallscaleint` reads (`terrainSheet`):
64x32 frames, 16 columns (the case), rows = variant * 4 + quarter (top, right, left, bottom of the cell).
Pack files are only read. Output stays in assets-local (the pack's licence is local-only processing). Then it checks
the sheets: every edge pixel follows only the two corners it shares with its neighbour (no seam), and seeded maps
composed from the sheets have no hole (no missing case).

    ~/.local/share/ogm/image-python-v1/bin/python -I scripts/assets/terrain_dualgrid.py \\
        assets-local/packs/smallscaleint-fantasy-tileset-2d-isometric/2026-11-01/extracted/Environment \\
        assets-local/sets/terrain-dualgrid16/<date>
"""
import json
import subprocess
import sys
from datetime import date
from pathlib import Path

import numpy as np
from PIL import Image

TW, TH = 128, 64
QW, QH = TW // 2, TH // 2
CASES, VARIANTS = 16, 3
QUARTERS = ('top', 'right', 'left', 'bottom')
TOP, RIGHT, LEFT, BOTTOM = 1, 2, 4, 8
PACK = 'smallscaleint-fantasy-tileset-2d-isometric@2026-11-01'

# Lowest priority first, the order the adapter layers them. (id, pack overlay over Ground A1, edge noise, shadow px)
TERRAINS = [
    ('dirt', None, 0.0, 0),
    ('dry-grass', 'Ground J1', 0.32, 1),
    ('grass', 'Ground A2', 0.32, 1),
    ('dark-grass', 'Ground A18', 0.32, 1),
    ('cobble', 'Ground E1', 0.18, 1),
    ('paving', 'Ground H1', 0.06, 2),
]

# Tile-local diamond coordinates: top vertex (0,0), right (1,0), left (0,1), bottom (1,1).
_py, _px = np.mgrid[0:TH, 0:TW] + 0.5
U = (_px - TW / 2) / TW + _py / TH
V = -(_px - TW / 2) / TW + _py / TH
INSIDE = (U >= 0) & (U < 1) & (V >= 0) & (V < 1)
TAPER = np.clip(np.minimum.reduce([U, 1 - U, V, 1 - V]) * 6, 0, 1)
# Each cell quarter's 64x32 box in a 128x64 tile, and which pixels belong to it.
QUARTER_BOX = {'top': (32, 0), 'right': (64, 16), 'left': (0, 16), 'bottom': (32, 32)}
QUARTER_OF = {'top': (U < 0.5) & (V < 0.5), 'right': (U >= 0.5) & (V < 0.5),
              'left': (U < 0.5) & (V >= 0.5), 'bottom': (U >= 0.5) & (V >= 0.5)}
# A cell's quarter is cut from the corner tile centred on the vertex it touches, from that tile's opposite quadrant.
OPPOSITE = {'top': 'bottom', 'right': 'left', 'left': 'right', 'bottom': 'top'}


def noise(seed, cells=6):
    """Value noise in [-1, 1] over the tile, tapered to 0 on its borders so neighbouring tiles always meet."""
    g = np.random.default_rng(seed).uniform(-1, 1, (cells + 1, cells + 1))
    x, y = np.clip(U, 0, 1) * cells, np.clip(V, 0, 1) * cells
    x0, y0 = np.minimum(x.astype(int), cells - 1), np.minimum(y.astype(int), cells - 1)
    fx, fy = x - x0, y - y0
    v = (g[y0, x0] * (1 - fx) * (1 - fy) + g[y0, x0 + 1] * fx * (1 - fy)
         + g[y0 + 1, x0] * (1 - fx) * fy + g[y0 + 1, x0 + 1] * fx * fy)
    jitter = np.random.default_rng(seed + 7).uniform(-0.35, 0.35, U.shape)
    return (v + jitter) * TAPER


def corner_field(case):
    t, r, l, b = (bool(case & bit) for bit in (TOP, RIGHT, LEFT, BOTTOM))
    return t * (1 - U) * (1 - V) + r * U * (1 - V) + l * (1 - U) * V + b * U * V


def corner_mask(case, amp, seed):
    """Which pixels of the corner tile show the terrain: the corner weights plus border-tapered noise, cut at 1/2."""
    if case == 0:
        return np.zeros_like(INSIDE)
    if case == 15:
        return INSIDE.copy()
    return INSIDE & (corner_field(case) + noise(seed) * amp > 0.5)


def mask_seed(layer, case, variant):
    return 100_000 * layer + 1000 * case + 17 * variant


def top_face(env, overlay):
    """The terrain's 128x64 top face: the pack's dirt block with the terrain overlay on it, outside the diamond clear."""
    im = Image.open(env / 'Ground A1_N.png').convert('RGBA')
    if overlay:
        im.alpha_composite(Image.open(env / f'{overlay}_N.png').convert('RGBA'))
    face = np.array(im.crop((64, 176, 192, 240)))
    face[~INSIDE] = 0
    return face


def corner_tile(face, mask, shadow_px):
    """RGBA corner tile: the face where the mask is set, a soft drop shadow just below its edge, clear elsewhere."""
    tile = np.zeros((TH, TW, 4), np.uint8)
    tile[mask] = face[mask]
    if shadow_px:
        below = np.zeros_like(mask)
        below[shadow_px:] = mask[:-shadow_px]
        shade = below & ~mask & INSIDE
        tile[shade] = (0, 0, 0, 72)
    return tile


def sheet(face, layer, amp, shadow_px):
    out = np.zeros((VARIANTS * len(QUARTERS) * QH, CASES * QW, 4), np.uint8)
    for variant in range(VARIANTS):
        for case in range(1, CASES):
            tile = corner_tile(face, corner_mask(case, amp, mask_seed(layer, case, variant)), shadow_px)
            for qi, quarter in enumerate(QUARTERS):
                # The cell's quarter shows this tile's opposite quadrant; both sit in the same 64x32 box offset.
                sx, sy = QUARTER_BOX[OPPOSITE[quarter]]
                piece = tile[sy:sy + QH, sx:sx + QW].copy()
                keep = QUARTER_OF[OPPOSITE[quarter]][sy:sy + QH, sx:sx + QW]
                piece[~keep] = 0
                row = variant * len(QUARTERS) + qi
                out[row * QH:(row + 1) * QH, case * QW:(case + 1) * QW] = piece
    return out


def frame(sheet_px, case, variant, quarter):
    row = variant * len(QUARTERS) + QUARTERS.index(quarter)
    return sheet_px[row * QH:(row + 1) * QH, case * QW:(case + 1) * QW]


# ---- checks -------------------------------------------------------------------------------------------------
def check_edges():
    """Pixels on a corner tile's border follow the two corners that border shares, never the tile's noise.

    Neighbouring corner tiles share those two corners, so the terrain edge crosses between them without a step.
    """
    ring = 1 / 64
    border = INSIDE & (np.minimum.reduce([U, 1 - U, V, 1 - V]) < ring)  # the outermost pixel ring
    problems = []
    for layer, (_, _, amp, _) in enumerate(TERRAINS):
        if not amp:
            continue
        for case in range(1, 15):
            field = corner_field(case)
            clean = INSIDE & (field > 0.5)
            # Where the corners alone put a pixel clearly in or out (beyond the noise a ring pixel may carry), the
            # tile must agree with the corners.
            decided = border & (np.abs(field - 0.5) > amp * 1.35 * 6 * ring)
            for variant in range(VARIANTS):
                mask = corner_mask(case, amp, mask_seed(layer, case, variant))
                bad = int((mask[decided] != clean[decided]).sum())
                if bad:
                    problems.append(f'layer {layer} case {case} variant {variant}: {bad} border pixels off the corners')
    return problems


def compose(grid, sheets):
    """Draws a terrain grid from the quarter sheets exactly as the adapter places pieces; returns RGBA pixels."""
    h, w = grid.shape
    at = lambda x, y: grid[min(max(y, 0), h - 1), min(max(x, 0), w - 1)]
    canvas = np.zeros(((w + h) * TH // 2 + TH, (w + h) * TW // 2 + TW, 4), np.uint8)
    vertex = {'top': (0, 0), 'right': (1, 0), 'left': (0, 1), 'bottom': (1, 1)}
    for y in range(h):
        for x in range(w):
            ox, oy = (x - y) * TW // 2 + h * TW // 2 - TW // 2, (x + y) * TH // 2
            for quarter in QUARTERS:
                vx, vy = x + vertex[quarter][0], y + vertex[quarter][1]
                bx, by = QUARTER_BOX[quarter]
                corners = (at(vx - 1, vy - 1), at(vx, vy - 1), at(vx - 1, vy), at(vx, vy))
                for layer in sorted(set(corners)):  # only terrains present at the corner, as the adapter draws
                    case = sum(bit for bit, cell in zip((TOP, RIGHT, LEFT, BOTTOM), corners) if cell >= layer)
                    piece = frame(sheets[layer], case, (vx + 2 * vy) % VARIANTS, quarter).astype(np.float32)
                    dst = canvas[oy + by:oy + by + QH, ox + bx:ox + bx + QW].astype(np.float32)
                    a = piece[..., 3:4] / 255
                    dst[..., :3] = piece[..., :3] * a + dst[..., :3] * (1 - a)
                    dst[..., 3:4] = 255 * (a + dst[..., 3:4] / 255 * (1 - a))
                    canvas[oy + by:oy + by + QH, ox + bx:ox + bx + QW] = dst.round().astype(np.uint8)
    return canvas


def map_area(h, w, shape):
    area = np.zeros(shape, bool)
    for y in range(h):
        for x in range(w):
            ox, oy = (x - y) * TW // 2 + h * TW // 2 - TW // 2, (x + y) * TH // 2
            area[oy:oy + TH, ox:ox + TW] |= INSIDE
    return area


def seeded_grid(seed, size=14):
    rng = np.random.default_rng(seed)
    grid = np.zeros((size, size), int)
    for _ in range(12):
        k, cx, cy, r = rng.integers(1, len(TERRAINS)), rng.integers(size), rng.integers(size), 1 + rng.random() * 4
        yy, xx = np.mgrid[0:size, 0:size]
        grid[np.hypot(xx - cx, yy - cy) + rng.random((size, size)) * 1.2 <= r] = k
    return grid


# A pixel 3 px in from each corner tile vertex: the corner weights alone decide it (the noise is tapered to ~0 there).
TIP = {'top': (64, 2), 'right': (125, 32), 'left': (2, 32), 'bottom': (64, 61)}
TIP_BIT = {'top': TOP, 'right': RIGHT, 'left': LEFT, 'bottom': BOTTOM}


def check_frames(sheets):
    """Every frame shows its terrain at a corner tip exactly when the case sets that corner.

    Catches a blank, missing, swapped or mirrored transition frame, which the hole check cannot see wherever a lower
    terrain is opaque underneath.
    """
    problems = []
    for layer, px in enumerate(sheets):
        for variant in range(VARIANTS):
            for case in range(1, CASES):
                for quarter in QUARTERS:
                    corner = OPPOSITE[quarter]
                    bx, by = QUARTER_BOX[corner]
                    tx, ty = TIP[corner]
                    opaque = frame(px, case, variant, quarter)[ty - by, tx - bx, 3] == 255
                    if opaque != bool(case & TIP_BIT[corner]):
                        problems.append(f'layer {layer} case {case} variant {variant} {quarter}: {corner} tip wrong')
    return problems


def check_holes(sheets, seeds=(1, 7, 42, 1204, 90001)):
    problems = []
    for seed in seeds:
        grid = seeded_grid(seed)
        canvas = compose(grid, sheets)
        area = map_area(*grid.shape, canvas.shape[:2])
        holes = int((canvas[..., 3][area] < 255).sum())
        if holes:
            problems.append(f'seed {seed}: {holes} map pixels not fully covered')
    return problems


def git_head():
    try:
        return subprocess.run(['git', 'rev-parse', 'HEAD'], capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def main(env, out):
    out.mkdir(parents=True, exist_ok=True)
    sheets, entries = [], []
    for layer, (terrain, overlay, amp, shadow_px) in enumerate(TERRAINS):
        face = top_face(env, overlay)
        px = sheet(face, layer, amp, shadow_px)
        sheets.append(px)
        name = f'terrain-{terrain}.png'
        Image.fromarray(px).save(out / name)
        sources = ['Ground A1_N'] + ([f'{overlay}_N'] if overlay else [])
        meta = {
            'file': name,
            'terrain': terrain,
            'priority': layer,
            'layout': {'scheme': 'dual-grid-16', 'frame': [QW, QH], 'columns': CASES,
                       'rows': VARIANTS * len(QUARTERS), 'row': 'variant * 4 + quarter',
                       'quarters': list(QUARTERS), 'case_bits': {'top': TOP, 'right': RIGHT, 'left': LEFT,
                                                                  'bottom': BOTTOM}},
            'provenance': {
                'source_pack': PACK,
                'source_tiles': sources,
                'method': 'top face cut from cloned pack tiles; corner-case masks from bilinear corner weights plus '
                          f'border-tapered value noise (amplitude {amp}); {shadow_px} px drop shadow; '
                          'cut into cell quarters',
                'generator': 'scripts/assets/terrain_dualgrid.py',
                'generator_commit': git_head(),
                'ai_generated': False,
                'experiment': False,
                'derived_from_paid_pack': True,
            },
            'usage': 'inherits the source pack rights; local processing only, never redistributed standalone',
        }
        (out / f'terrain-{terrain}.json').write_text(json.dumps(meta, indent=2) + '\n')
        entries.append(meta)
    problems = check_edges() + check_frames(sheets) + check_holes(sheets)
    (out / 'manifest.json').write_text(json.dumps({
        'set': 'terrain-dualgrid16', 'made': date.today().isoformat(), 'sheets': [e['file'] for e in entries],
        'checks': {'status': 'pass' if not problems else 'fail', 'problems': problems},
    }, indent=2) + '\n')
    for problem in problems:
        print(problem, file=sys.stderr)
    print(json.dumps({'sheets': len(entries), 'problems': len(problems)}))
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main(Path(sys.argv[1]), Path(sys.argv[2])))
