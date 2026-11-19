"""Render a calibrated 8-direction sheet using Blender and finish its pixels."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile

import numpy as np
from PIL import Image

from finish import finish

SCRIPT = Path(__file__).with_name('blender_iso_rig.py')


def assemble(directory, cell, shadow_sheet=False):
    sheet = np.zeros((8 * cell, 15 * cell, 4), dtype=np.uint8)
    shadow = np.zeros_like(sheet) if shadow_sheet else None
    for row in range(8):
        for col in range(15):
            pixels = finish(np.asarray(Image.open(directory / f'frame_{row}_{col}.png').convert('RGBA')))
            if pixels.shape != (cell, cell, 4):
                raise ValueError(f'wrong frame size at row {row}, column {col}')
            if shadow is not None:
                is_shadow = (pixels[..., 3] > 0) & (pixels[..., 3] < 255)
                shadow[row * cell:(row + 1) * cell, col * cell:(col + 1) * cell][is_shadow] = pixels[is_shadow]
                pixels[is_shadow] = 0
            sheet[row * cell:(row + 1) * cell, col * cell:(col + 1) * cell] = pixels
    return sheet, shadow


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('scene', choices=['cube', 'rock', 'hull', 'blend'])
    parser.add_argument('output', type=Path)
    parser.add_argument('--cell', type=int, choices=[64, 128], default=64)
    parser.add_argument('--start', type=int, default=1)
    parser.add_argument('--end', type=int, default=15)
    parser.add_argument('--samples', type=int, default=1)
    parser.add_argument('--mesh', type=Path, help='OBJ for hull or blend file for blend scene')
    parser.add_argument('--shadow-sheet', type=Path)
    parser.add_argument('--derived-from', required=True)
    parser.add_argument('--ai-generated', action='store_true')
    args = parser.parse_args()
    if args.end < args.start or args.samples < 1:
        parser.error('end must be >= start and samples must be positive')
    if args.scene in ('hull', 'blend') and not args.mesh:
        parser.error('--mesh is required for hull and blend scenes')
    env = os.environ.copy()
    if args.mesh:
        env['SPRITE_OBJ' if args.scene == 'hull' else 'SPRITE_BLEND'] = str(args.mesh.resolve())
    with tempfile.TemporaryDirectory(prefix='sprite-forge-') as temp:
        frames = Path(temp)
        subprocess.run(['nice', '-n', '10', 'blender', '-b', '--factory-startup', '--threads', '2',
                        '--python-exit-code', '1', '--python', str(SCRIPT), '--', args.scene, str(frames), 'sheet=1',
                        f'cell={args.cell}', f'frame_start={args.start}', f'frame_end={args.end}',
                        f'samples={args.samples}'], check=True, env=env)
        sheet, shadow = assemble(frames, args.cell, bool(args.shadow_sheet))
        args.output.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(sheet).save(args.output)
        if shadow is not None:
            args.shadow_sheet.parent.mkdir(parents=True, exist_ok=True)
            Image.fromarray(shadow).save(args.shadow_sheet)
    args.output.with_suffix('.json').write_text(json.dumps({
        'derived_from': args.derived_from, 'ai_generated': args.ai_generated,
        'cell': args.cell, 'frames': 15, 'directions': 8,
        'frame_start': args.start, 'frame_end': args.end,
    }, indent=2) + '\n')


if __name__ == '__main__':
    main()
