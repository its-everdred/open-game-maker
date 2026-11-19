"""Measure the reference set and write style-measurements.json next to the report.

Usage: study.py <packs-dir> <out.json>
<packs-dir> is assets-local/packs. Paths below are the four rebuild references plus context sheets.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import measure_sheet as ms  # noqa: E402
import spritemetrics as sm  # noqa: E402

TILESET = 'smallscaleint-fantasy-tileset-2d-isometric/2026-11-01/extracted'
SHEETS = {
    'knight64_walk': ('smallscaleint-2d-character-knight/2026-11-01/extracted/1Knight/Walk_Shadowless.png', 64),
    'knight64_idle': ('smallscaleint-2d-character-knight/2026-11-01/extracted/1Knight/Idle_Shadowless.png', 64),
    'knightHD_walk_shadow': ('smallscaleint-2d-hd-character-knight/2026-11-01/extracted/Spritesheets/With shadows/Walk.png', 128),
    'goblin01_walk': ('smallscaleint-2d-orcs-and-goblins-topdown/2026-11-01/extracted/Seperate shadows and effects/Goblin 01/Walk.png', 128),
    'goblin01_walk_shadow': ('smallscaleint-2d-orcs-and-goblins-topdown/2026-11-01/extracted/Seperate shadows and effects/Goblin 01/Shadows/Walk.png', 128),
    'tileset_player_walk': (f'{TILESET}/Characters/Player/Walk.png', 128),
}
PROPS = ['Stone A3', 'Stone A1', 'Stone A5', 'Ground A1', 'Wall A1', 'Roof A1', 'Misc A1', 'Tree A1', 'Door A1', 'Chest A1']


def main(packs, out):
    packs = Path(packs)
    res = {'sheets': {}, 'props': {}}
    for name, (rel, cell) in SHEETS.items():
        p = packs / rel
        if not p.exists():
            res['sheets'][name] = {'missing': rel}
            continue
        m = ms.measure(p, cell)
        m['file'] = rel
        res['sheets'][name] = m
    for prop in PROPS:
        views = {}
        for d in 'NESW':
            p = packs / TILESET / 'Environment' / f'{prop}_{d}.png'
            if p.exists():
                st = ms.sprite_stats(sm.load(p))
                views[d] = st
        if views:
            areas = [v['opaque_px'] for v in views.values()]
            heights = [v['bbox_h'] for v in views.values()]
            res['props'][prop] = {
                'views': views,
                'area_cv_across_views': round(float((max(areas) - min(areas)) / (sum(areas) / len(areas))), 3),
                'bbox_h_range': [min(heights), max(heights)],
            }
    Path(out).write_text(json.dumps(res, indent=1))
    for n, s in res['sheets'].items():
        if s.get('per_frame'):
            pf = s['per_frame']
            print(f"{n:24s} grid {s['grid']['cols']}x{s['grid']['rows']} frames/row {[r['frames'] for r in s['rows']][0]} "
                  f"sheet colours {s['sheet_colours']} frame colours {pf['colours']['mean']:.0f} (90%: {pf['colours_90pct']['mean']:.0f}) "
                  f"bands {pf['lum_bands']['mean']:.1f} partialA {pf['partial_alpha_share']['mean']:.2f} "
                  f"rim/int {pf['rim_to_interior_lum']['mean']:.2f} light {pf['light_angle_deg']['mean']:.0f} "
                  f"bbox {pf['bbox_w']['mean']:.0f}x{pf['bbox_h']['mean']:.0f} foot_y {pf['foot_y']['mean']:.0f} "
                  f"consecIoU {sum(r['consecutive_iou']['mean'] for r in s['rows'])/len(s['rows']):.2f} dirCV {s['direction_area_cv']}")
    for n, p in res['props'].items():
        v = p['views'].get('S') or next(iter(p['views'].values()))
        print(f"{n:12s} S: colours {v['colours']} (90%: {v['colours_90pct']}) bands {v['lum_bands']} partialA {v['partial_alpha_share']:.2f} "
              f"rim/int {v['rim_to_interior_lum'] and round(v['rim_to_interior_lum'], 2)} light {v['light_angle_deg'] and round(v['light_angle_deg'])} "
              f"bbox {v['bbox_w']}x{v['bbox_h']} | views area spread {p['area_cv_across_views']} h {p['bbox_h_range']}")


if __name__ == '__main__':
    main(*sys.argv[1:3])
