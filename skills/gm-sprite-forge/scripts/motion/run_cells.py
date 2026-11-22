"""Render and score a list of rig/motion cells one Blender at a time (#1202 rig spike).

Usage: run_cells.py <cells.json> <out_root> [--engine workbench|cycles] [--only name,...]
cells.json: {"mesh": glb, "rotz": deg, "pack": {"walk": sheet.png, "attack": sheet.png}, "blender": wrapper,
             "render": {key: value, ...}, "cells": [{"name", "clip": "walk"|"attack", "motion": {...}, "weapon": {...}}]}
Each cell gets <out_root>/<name>/ with raw frames, out/sheet.png and scores.json; a summary table is printed.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('cells', type=Path)
    ap.add_argument('out', type=Path)
    ap.add_argument('--engine', default='workbench')
    ap.add_argument('--only')
    a = ap.parse_args()
    spec = json.loads(a.cells.read_text())
    only = set(a.only.split(',')) if a.only else None
    rows = []
    for c in spec['cells']:
        if only and c['name'] not in only:
            continue
        d = a.out / c['name']
        d.mkdir(parents=True, exist_ok=True)
        cell = {'mesh': spec['mesh'], 'rotz': spec.get('rotz', 0), 'motion': c['motion'] | {'clip': c['clip']},
                'weapon': c.get('weapon', spec.get('weapon')), 'rig_cache': str(a.out / 'rig_cache.blend')}
        (d / 'spec.json').write_text(json.dumps(cell, indent=1))
        keys = [f'{k}={v}' for k, v in (spec.get('render', {}) | {'engine': a.engine}).items()]
        if a.engine == 'workbench':
            keys.append('supersample=2')
        log = open(d / 'render.log', 'w')
        r = subprocess.run([spec['blender'], '--python', str(HERE / 'render_motion.py'), '--', str(d), str(d / 'spec.json'),
                            *keys], stdout=log, stderr=subprocess.STDOUT)
        if r.returncode:
            rows.append((c['name'], 'render failed: see render.log'))
            print(c['name'], 'render failed', flush=True)
            continue
        loop = ['--loop'] if c['clip'] == 'walk' and c['motion'].get('loop', True) else []
        s = subprocess.run([sys.executable, '-I', str(HERE / 'score_cell.py'), str(d), spec['pack'][c['clip']], '--finish', *loop],
                           capture_output=True, text=True)
        if s.returncode:
            rows.append((c['name'], 'score failed: ' + s.stderr.strip().splitlines()[-1]))
            print(c['name'], 'score failed', s.stderr[-300:], flush=True)
            continue
        sj = json.loads((d / 'scores.json').read_text())
        line = (f"{c['name']:28} corr {sj['motion_corr']:.2f} (rows {', '.join(f'{x:.2f}' for x in sj['motion_corr_rows'])};"
                f" shift {sj['phase_shift']}) iou {sj['silhouette_iou']:.2f} slide {sj['foot_slide']['mean_px']} px"
                f" render {sj['render_minutes']} min")
        rows.append((c['name'], line))
        print(line, flush=True)
    (a.out / 'summary.txt').write_text('\n'.join(r[1] for r in rows) + '\n')


main()
