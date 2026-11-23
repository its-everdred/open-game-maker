"""Render and score a list of rig/motion cells one Blender at a time (#1202 rig spike).

Usage: run_cells.py <cells.json> <out_root> [--engine workbench|cycles] [--only name,...] [--rescore]
cells.json: {"mesh": glb, "rotz": deg, "pack": {"walk": sheet.png, "attack": sheet.png, "idle": sheet.png}, "blender": wrapper,
             "finish": "base" (a base body: skin-only colour pass against pack.idle; default: pack colour match),
             "pixel": {"colours": 8, "cloth": 6, "smooth": true} (pack-style pixel finish after the colour pass;
                       "cloth" renders a cloth mask and gives the undergarments their own colours; "weapon": N
                       gives the weapon N colours of its own from the same mask),
             "render": {key: value, ...}, "cells": [{"name", "clip": "walk"|"attack", "motion": {...}, "weapon": {...}}]}
A cell with "rigged" (rigged.py: a body that arrives rigged) skips the fit and faces itself from its feet (its own
"rotz", default 0, turns it further); its "model", "cost_usd" and "licence" override the top level's for its recipe.
The top-level "mesh" is still required.
Each cell gets <out_root>/<name>/ with raw frames, out/sheet.png and scores.json; a summary table is printed.
--rescore keeps each cell's render and runs only the finish and scoring again (a new colour or pixel finish).
"""
import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


LICENCE = (('kaykit', 'CC0 (KayKit Character Animations, owned)'), ('/cmu/', 'CMU mocap (free for any use)'),
           ('/bandai/', 'CC BY-NC 4.0 (Bandai Namco Research Motion)'),
           ('/lafan1/', 'CC BY-NC-ND 4.0 (Ubisoft LaFAN1): private use, adapted output not shared'),
           ('handkey', 'own work (hand-keyed script)'), ('quaternius', 'CC0 (Quaternius Universal Animation Library)'))


def fmt(x):
    """Two decimals, or n/a for a metric score.py could not define (no motion, no contact frames)."""
    return 'n/a' if x is None else f'{x:.2f}'


def write_recipe(d, spec, c, scores):
    """recipe.json beside the cell: what the review page prints under it (kind, model, cost, skill, arm, motion)."""
    mo = c['motion']
    key = mo.get('path', (c.get('rigged') or {}).get('path', '')) if mo['kind'] != 'handkey' else 'handkey'
    lic = c.get('licence') or next((v for k, v in LICENCE if k in key or k == mo['kind']), 'unknown')
    fit = json.loads((d / 'fit.json').read_text())
    render = json.loads((d / 'render.json').read_text())
    rec = {'name': c['name'], 'kind': '3D model -> 2D render (rigged, animated)', 'ai_generated': True,
           'model': c.get('model', spec.get('model', 'TRELLIS multi-view mesh')),
           'cost_usd': c.get('cost_usd', spec.get('cost_usd', 0.0)),
           'skill': 'gm-sprite-forge (motion/)', 'arm': c.get('arm', 'A: Rigify metarig fit + bone heat'),
           'motion': {k: v for k, v in mo.items() if k != 'path'} | ({'source': Path(mo['path']).name} if 'path' in mo else {}),
           'motion_licence': lic, 'mesh': Path((c.get('rigged') or {}).get('path') or spec['mesh']).name, 'skin': fit['skin'], 'retarget': fit['motion'],
           'finish': spec.get('finish', 'pack'), 'pixel': spec.get('pixel'), 'blender': render['blender'], 'engine': render['engine'], 'render_minutes': render['render_minutes'],
           'scores': {k: v for k, v in scores.items() if k != 'foot_slide'} | {'foot_slide_px': scores['foot_slide']['mean_px']}}
    (d / 'recipe.json').write_text(json.dumps(rec, indent=1, default=str))


def blender(spec, d, keys, log):
    """One render_motion.py run for cell directory d; True when it succeeded."""
    with open(d / log, 'w') as out:
        return subprocess.run([spec['blender'], '--python', str(HERE / 'render_motion.py'), '--', str(d),
                               str(d / 'spec.json'), *keys], stdout=out, stderr=subprocess.STDOUT).returncode == 0


def inputs(cell):
    """What a render depends on: everything in a cell spec but where its rig cache lives."""
    return {k: v for k, v in cell.items() if k != 'rig_cache'}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('cells', type=Path)
    ap.add_argument('out', type=Path)
    ap.add_argument('--engine', default='workbench')
    ap.add_argument('--only')
    ap.add_argument('--rescore', action='store_true', help='keep the renders; finish and score again')
    a = ap.parse_args()
    spec = json.loads(a.cells.read_text())
    only = set(a.only.split(',')) if a.only else None
    if spec.get('finish') == 'base' and not Path(spec['pack'].get('idle', '')).is_file():
        ap.error('"finish": "base" needs pack.idle, the class Idle sheet (skin reference)')
    rows = []
    for c in spec['cells']:
        if only and c['name'] not in only:
            continue
        d = a.out / c['name']
        cell = {'mesh': spec['mesh'], 'rotz': c.get('rotz', 0 if c.get('rigged') else spec.get('rotz', 0)),
                'motion': {'stance': spec.get('stance')} | c['motion'] | {'clip': c['clip']},
                'weapon': c.get('weapon', spec.get('weapon')), 'rig_cache': str(a.out / 'rig_cache.blend')}
        if c.get('rigged'):
            cell['rigged'] = c['rigged']
        if a.rescore:  # the recipe and masks must describe the frames on disk, not a since-edited cells.json
            why = 'no render' if not (d / 'render.json').is_file() else \
                'cells.json changed since the render: render it again' if \
                inputs(json.loads((d / 'spec.json').read_text())) != inputs(json.loads(json.dumps(cell))) else None
            if why:
                rows.append((c['name'], f'rescore failed: {why}'))
                print(c['name'], f'rescore failed: {why}', flush=True)
                continue
        d.mkdir(parents=True, exist_ok=True)
        rendered = () if a.rescore else ('feet.json', 'fit.json', 'render.json')
        for stale in ('out', 'scores.json', 'recipe.json') + rendered:
            p = d / stale  # a failed rerun must not leave the previous run's results looking current
            shutil.rmtree(p) if p.is_dir() else p.unlink(missing_ok=True)
        if not a.rescore:
            (d / 'spec.json').write_text(json.dumps(cell, indent=1))
            keys = [f'{k}={v}' for k, v in (spec.get('render', {}) | {'engine': a.engine}).items()]
            if (spec.get('pixel') or {}).get('cloth'):
                keys.append('mask=1')
            if a.engine == 'workbench':
                keys.append('supersample=2')
            if not blender(spec, d, keys, 'render.log'):
                rows.append((c['name'], 'render failed: see render.log'))
                print(c['name'], 'render failed', flush=True)
                continue
        elif (spec.get('pixel') or {}).get('cloth') and \
                len(list(d.glob('mask_*_*.png'))) != len(list(d.glob('raw_*_*.png'))):  # masks only, as rendered
            params = json.loads((d / 'render.json').read_text())['params']
            keys = [f'{k}={v}' for k, v in params.items() if not k.startswith('mask')] + ['mask_only=1']
            if not blender(spec, d, keys, 'mask.log'):
                rows.append((c['name'], 'mask render failed: see mask.log'))
                print(c['name'], 'mask render failed', flush=True)
                continue
        loop = ['--loop'] if c['clip'] == 'walk' and c['motion'].get('loop', True) else []
        loop += ['--rows', str(spec.get('render', {}).get('rows', '1,2'))]  # score the rows that were rendered
        if spec.get('finish') == 'base':  # a base body: match the skin to the pack Idle, keep the undergarments white
            loop += ['--skin-ref', spec['pack']['idle']]
        if spec.get('pixel'):
            px = spec['pixel']
            loop += ['--pixel', str(px['colours'])] + (['--smooth'] if px.get('smooth') else []) + \
                (['--cloth', str(px['cloth'])] if px.get('cloth') else []) + \
                (['--weapon', str(px['weapon'])] if px.get('weapon') else [])
        s = subprocess.run([sys.executable, '-I', str(HERE / 'score_cell.py'), str(d), spec['pack'][c['clip']], '--finish', *loop],
                           capture_output=True, text=True)
        if s.returncode:
            rows.append((c['name'], 'score failed: ' + s.stderr.strip().splitlines()[-1]))
            print(c['name'], 'score failed', s.stderr[-300:], flush=True)
            continue
        sj = json.loads((d / 'scores.json').read_text())
        write_recipe(d, spec, c, sj)
        line = (f"{c['name']:28} corr {fmt(sj['motion_corr'])} (rows {', '.join(fmt(x) for x in sj['motion_corr_rows'])};"
                f" shift {sj['phase_shift']}) iou {fmt(sj['silhouette_iou'])} slide {fmt(sj['foot_slide']['mean_px'])} px"
                f" render {sj['render_minutes']} min")
        rows.append((c['name'], line))
        print(line, flush=True)
    (a.out / 'summary.txt').write_text('\n'.join(r[1] for r in rows) + '\n')
    if any('failed' in r[1] for r in rows):
        sys.exit(1)


main()
