"""Score one rendered rig/motion cell against the pack sheet: score.py metrics on the rendered rows, the loop phase that
best matches the pack, and foot slide (#1202 rig spike).

Usage: score_cell.py <cell_dir> <pack_sheet.png> [--rows 1,2] [--loop] [--finish]
--finish runs gpu_bake_finish.py on <cell_dir>/raw_*.png first (colour pass against the pack sheet) -> <cell_dir>/out.
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('cell_dir', type=Path)
    ap.add_argument('pack_sheet')
    ap.add_argument('--rows', default='1,2')
    ap.add_argument('--loop', action='store_true')
    ap.add_argument('--finish', action='store_true')
    a = ap.parse_args()
    rows = [int(r) for r in a.rows.split(',')]
    out = a.cell_dir / 'out'
    if a.finish:
        subprocess.run([sys.executable, str(HERE.parent / 'gpu_bake_finish.py'), str(a.cell_dir), str(out),
                        '--cell', '128', '--colour-ref', a.pack_sheet], check=True, stdout=subprocess.DEVNULL)
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
