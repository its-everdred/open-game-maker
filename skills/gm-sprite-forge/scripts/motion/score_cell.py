"""Score one rendered rig/motion cell against the pack sheet: score.py metrics on the rendered rows, the loop phase that
best matches the pack, and foot slide (#1202 rig spike).

Usage: score_cell.py <cell_dir> <pack_sheet.png> [--rows 1,2] [--loop] [--finish] [--skin-ref <pack Idle sheet>]
                     [--pixel N [--smooth]]
--finish runs gpu_bake_finish.py on <cell_dir>/raw_*.png first (colour pass against the pack sheet) -> <cell_dir>/out.
With --skin-ref (a base body) the pack colour match is skipped and finish_base.py matches only the skin to that sheet;
the sheet before that pass is kept as out/sheet_finish.png. --pixel N then runs pixel_finish.py (N colours over the
whole sheet, --smooth for the 3x3 median first); the sheet before it is kept as out/sheet_colour.png. With --cloth N
the cell's mask_<row>_<col>.png frames (render_motion.py mask=1) give the cloth its own N colours.
A walk is a loop with an arbitrary first frame, so with --loop every cyclic shift of the frames is scored and the best
motion correlation is kept (its shift is reported); an attack is scored as rendered.
Foot slide: a foot is in contact on frames where its sole is within 1 px of its lowest height; each contact step
follows the point that touches the ground (heel or ball, whichever is lower), so a heel-to-toe roll is not slide. For an in-place walk
the ground moves under the body at one speed along the facing direction, so slide is how far a contact foot strays from
that (the median contact speed along the facing; any sideways movement counts); for an attack the ground does not move, so slide is the contact foot's own movement. Both are
screen px per contact frame at the pack's cell size, averaged over contact frames and rows.
Writes <cell_dir>/scores.json.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import score as sc  # noqa: E402



def rows_sheet(path, rows, cell=128, shift=0):
    a = np.asarray(Image.open(path).convert('RGBA'))
    out = []
    for r in rows:
        line = a[r * cell:(r + 1) * cell]
        cols = [line[:, c * cell:(c + 1) * cell] for c in range(line.shape[1] // cell)]
        cols = cols[shift:] + cols[:shift]
        out.append(np.concatenate(cols, 1))
    return np.concatenate(out, 0)


def best_shift(pack, ours, rows, cell=128):
    """Cyclic first frame that maximises score.py's motion correlation (masks only; cheap). Returns (shift, corr@0)."""
    def masks(path, row_index):
        a = np.asarray(Image.open(path).convert('RGBA'))
        line = a[row_index * cell:(row_index + 1) * cell]
        return [sc.frame_mask(line[:, c * cell:(c + 1) * cell]) for c in range(line.shape[1] // cell)]
    def curve(ms):
        return [sc.sm.iou(ms[i], ms[i + 1]) for i in range(len(ms) - 1)]
    pm = [masks(pack, i) for i in range(len(rows))]
    om = [masks(ours, r) for r in rows]
    corr = []
    for k in range(len(om[0])):
        cs = [sc.motion_correlation(curve(p), curve(o[k:] + o[:k])) for p, o in zip(pm, om)]
        corr.append(np.mean(cs) if all(c is not None for c in cs) else -1)
    return int(np.argmax(corr)), corr[0]


def foot_slide(feet, rows, loop):
    unit_px = feet['unit_px']  # world units -> screen px, written by render_motion.py from its camera
    per_row = []
    for r in rows:
        fr = feet['feet'][str(r)]
        steps = []
        for side in 'LR':
            pts = {k: np.array([f[side][k][:2] for f in fr]) for k in ('heel', 'ball')}
            zs = {k: np.array([f[side][k][2] for f in fr]) * unit_px for k in ('heel', 'ball')}
            z = np.minimum(zs['heel'], zs['ball'])
            contact = z - z.min() < 1.0
            n = len(fr)
            for i in range(n if loop else n - 1):
                j = (i + 1) % n
                if contact[i] and contact[j]:
                    k = 'heel' if zs['heel'][i] <= zs['ball'][i] else 'ball'  # the point touching the ground
                    steps.append(pts[k][j] - pts[k][i])
        if not steps:
            per_row.append({'contact_steps': 0, 'mean_px': None, 'max_px': None})
            continue
        steps = np.array(steps)
        if not loop:
            ground = np.zeros(2)
        elif str(r) in feet.get('forward', {}):  # the ground only moves along the facing: sideways drift is slide
            u = np.array(feet['forward'][str(r)], float)
            u /= np.linalg.norm(u)
            ground = u * np.median(steps @ u)
        else:
            ground = np.median(steps, 0)
        err = np.linalg.norm(steps - ground, axis=1)
        per_row.append({'contact_steps': len(steps), 'ground_px_per_frame': np.round(ground, 2).tolist(),
                        'mean_px': round(float(err.mean()), 2), 'max_px': round(float(err.max()), 2)})
    vals = [r['mean_px'] for r in per_row if r['mean_px'] is not None]
    return {'mean_px': round(float(np.mean(vals)), 2) if vals else None, 'rows': per_row}


def mask_sheets(cell_dir, shape, cell=128):
    """The cloth and weapon masks at sheet size: each mask_<row>_<col>.png box-downsampled into its cell, as
    gpu_bake_finish places raw_<row>_<col>.png. A cell is cloth where the mask is mostly white over visible pixels,
    weapon where it is mostly red (render_motion.mask_materials); masks rendered before the weapon was red have none."""
    masks = sorted(cell_dir.glob('mask_*_*.png'))
    if {p.stem[5:] for p in masks} != {p.stem[4:] for p in cell_dir.glob('raw_*_*.png')}:
        raise SystemExit(f'{cell_dir}: --cloth needs one mask_<row>_<col>.png per raw frame (render_motion.py mask=1)')
    cloth, weapon = np.zeros(shape, bool), np.zeros(shape, bool)
    for p in masks:
        r, c = map(int, p.stem.split('_')[1:])
        m = np.asarray(Image.open(p).convert('RGBA'), dtype=float) / 255
        f = m.shape[0] // cell

        def down(x):
            return x.reshape(cell, f, cell, f).mean((1, 3))
        cover = np.maximum(down(m[..., 3]), 1e-6)
        green, red = down(m[..., 1] * m[..., 3]), down((m[..., 0] - m[..., 1]).clip(0) * m[..., 3])
        box = np.s_[r * cell:(r + 1) * cell, c * cell:(c + 1) * cell]
        cloth[box] = green > 0.5 * cover
        weapon[box] = red > 0.5 * cover
    return cloth, weapon


def empty_render(cell_dir):
    """True when no raw frame shows anything: the body stood outside the camera the whole clip (a window cut from deep
    in a mocap take without in_place), which every later pass would misreport (no weapon in the masks, IoU 0)."""
    raws = list(cell_dir.glob('raw_*_*.png'))
    return bool(raws) and not any(np.asarray(Image.open(p).convert('RGBA'))[..., 3].any() for p in raws)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('cell_dir', type=Path)
    ap.add_argument('pack_sheet')
    ap.add_argument('--rows', default='1,2')
    ap.add_argument('--loop', action='store_true')
    ap.add_argument('--finish', action='store_true')
    ap.add_argument('--skin-ref')
    ap.add_argument('--pixel', type=int, help='pack-style pixel finish: colours for everything but the cloth (pick B: 8, with --cloth 6)')
    ap.add_argument('--smooth', action='store_true', help='with --pixel: 3x3 Lab median before the palette')
    ap.add_argument('--cloth', type=int, help='with --pixel: colours for the cloth, from the mask frames')
    ap.add_argument('--weapon', type=int, help='with --cloth: colours for the weapon, from the same mask frames')
    a = ap.parse_args()
    if a.skin_ref and not a.finish:
        ap.error('--skin-ref is part of the finish pass: add --finish')
    if a.weapon and not a.cloth:
        ap.error('--weapon reads the mask frames: add --cloth')
    if (a.pixel or a.smooth or a.cloth) and not (a.finish and a.pixel):
        ap.error('--pixel is part of the finish pass: add --finish (and --pixel N for --smooth or --cloth)')
    if empty_render(a.cell_dir):
        sys.exit(f'{a.cell_dir.name}: every raw frame is empty: the body is outside the camera (in_place on a clip that '
                 'starts away from the origin)')
    rows = [int(r) for r in a.rows.split(',')]
    out = a.cell_dir / 'out'
    if a.finish:
        ref = [] if a.skin_ref else ['--colour-ref', a.pack_sheet]
        subprocess.run([sys.executable, str(HERE.parent / 'gpu_bake_finish.py'), str(a.cell_dir), str(out),
                        '--cell', '128', *ref], check=True, stdout=subprocess.DEVNULL)
        shape = np.asarray(Image.open(out / 'sheet.png')).shape[:2]
        cloth, weapon = mask_sheets(a.cell_dir, shape) if a.cloth else (None, None)
        weapon = weapon if a.weapon else None
        if weapon is not None and not weapon.any():
            sys.exit(f'{a.cell_dir.name}: --weapon but no weapon in the masks (rendered before the weapon was red?): '
                     'render the cell again with run_cells.py (no --rescore)')
        if a.skin_ref:
            import finish_base
            (out / 'sheet.png').replace(out / 'sheet_finish.png')
            sheet, _ = finish_base.base_pass(finish_base.sm.load(out / 'sheet_finish.png'),
                                             finish_base.sm.load(a.skin_ref), keep=weapon)
            Image.fromarray(sheet).save(out / 'sheet.png')
        if a.pixel:
            from pixel_finish import pixel_finish
            (out / 'sheet.png').replace(out / 'sheet_colour.png')
            colour = np.asarray(Image.open(out / 'sheet_colour.png').convert('RGBA'))
            sheet = pixel_finish(colour, a.pixel, a.smooth, cloth=cloth, cloth_colours=a.cloth or 6, weapon=weapon,
                                 weapon_colours=a.weapon or 4)
            Image.fromarray(sheet).save(out / 'sheet.png')
    tmp = a.cell_dir / '_score'
    tmp.mkdir(exist_ok=True)
    Image.fromarray(rows_sheet(a.pack_sheet, rows)).save(tmp / 'pack.png')
    shift, first = best_shift(tmp / 'pack.png', out / 'sheet.png', rows) if a.loop else (0, None)
    Image.fromarray(rows_sheet(out / 'sheet.png', rows, shift=shift)).save(tmp / 'ours.png')
    res = sc.score(str(tmp / 'pack.png'), str(tmp / 'ours.png'), 128)  # full metrics once, at the chosen phase
    first = res['motion_corr'] if first is None else first
    feet = json.loads((a.cell_dir / 'feet.json').read_text())
    render = json.loads((a.cell_dir / 'render.json').read_text())
    summary = {
        'motion_corr': res['motion_corr'], 'motion_corr_rows': [r['motion_corr'] for r in res['rows']],
        'phase_shift': shift, 'motion_corr_unshifted': first,
        'silhouette_iou': res['silhouette_iou'], 'silhouette_iou_best': res['silhouette_iou_best'],
        'pixel_similarity': res['pixel_similarity'], 'palette_distance': res['palette_distance'],
        'foot_slide': foot_slide(feet, rows, a.loop), 'render_minutes': render['render_minutes'],
        'rows': rows, 'pack_sheet': Path(a.pack_sheet).name,
    }
    (a.cell_dir / 'scores.json').write_text(json.dumps(summary, indent=1))
    print(json.dumps({k: v for k, v in summary.items() if k != 'foot_slide'} | {'foot_slide_px': summary['foot_slide']['mean_px']}))


if __name__ == '__main__':
    main()
