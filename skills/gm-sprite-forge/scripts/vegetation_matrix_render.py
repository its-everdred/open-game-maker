"""Render draft vegetation matrix candidates in one Blender process.

Run with Blender: --python vegetation_matrix_render.py -- JOBS.json OUTPUT_DIR
Jobs contain row, scene, seed, and numeric rig options. Outputs are raw diagnostic
renders; finish and inspect them before any review. Never point at a pack directory.
"""
import json
from pathlib import Path
import re
import sys

args = sys.argv[sys.argv.index('--') + 1:]
jobs_file, output = Path(args[0]), Path(args[1]).resolve()
if 'packs' in output.parts:
    raise ValueError('refusing to render inside a pack directory')
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.argv = [sys.argv[0], '--', 'tree', str(output), 'samples=1', 'views=N']
import blender_iso_rig as rig
from vegetation_destination import variant_destination
from vegetation_matrix_parameters import matrix_parameters

jobs = json.loads(jobs_file.read_text())
defaults = rig.P.copy()
for job in jobs:
    row = job['row']
    variant = job['variant']
    scene = job['scene']
    if not re.fullmatch(r'[a-z0-9-]+', row) or variant not in range(1, 6):
        raise ValueError('invalid matrix row or variant')
    if scene not in {'tree', 'bare', 'conifer', 'bush', 'plant'}:
        raise ValueError('unknown vegetation scene')
    rig.SCENE = scene
    rig.OUT = str(variant_destination(output, row, variant))
    rig.P.clear()
    rig.P.update(defaults)
    rig.P.update(matrix_parameters(job))
    rig.main()
    print(f'MATRIX_DONE {row} V{variant}', flush=True)
