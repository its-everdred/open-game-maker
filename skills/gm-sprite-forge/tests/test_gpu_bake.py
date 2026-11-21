"""Checks for the GPU bake-off rig and its shared finish pass."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / 'scripts'
sys.path.insert(0, str(SCRIPTS))
from gpu_bake_finish import downsample  # noqa: E402


def run_finish(*args):
    subprocess.run([sys.executable, str(SCRIPTS / 'gpu_bake_finish.py'), *map(str, args)], check=True)


class FinishTest(unittest.TestCase):
    def test_downsample_is_premultiplied(self):
        # one 4x4 block: half opaque red, half transparent black -> red at half alpha, not darkened red
        a = np.zeros((4, 4, 4), np.uint8)
        a[:2, :, :] = (200, 0, 0, 255)
        with tempfile.TemporaryDirectory() as t:
            Image.fromarray(a).save(f'{t}/raw_N.png')
            px = downsample(f'{t}/raw_N.png', 1)[0, 0]
        self.assertEqual(tuple(px), (200, 0, 0, 128))

    def test_sheet_assembly_and_hue_kept(self):
        with tempfile.TemporaryDirectory() as t:
            raw, out = Path(t, 'raw'), Path(t, 'out')
            raw.mkdir()
            cell = np.zeros((8, 8, 4), np.uint8)
            cell[2:6, 2:6] = (120, 120, 120, 255)  # grey object
            for r in range(8):
                for c in range(15):
                    marked = cell.copy()
                    marked[0, 0] = (r * 20 + 10, c * 10 + 10, 50, 255)  # position marker
                    Image.fromarray(np.kron(marked, np.ones((2, 2, 1), np.uint8))).save(raw / f'raw_{r}_{c}.png')
            ref = np.zeros((8, 8, 4), np.uint8)
            ref[2:6, 2:6] = (200, 30, 30, 255)  # a bright red reference: lightness may move, hue must not
            Image.fromarray(ref).save(Path(t, 'ref.png'))
            run_finish(raw, out, '--cell', 8, '--colour-ref', Path(t, 'ref.png'))
            sheet = np.asarray(Image.open(out / 'sheet.png'))
            run_finish(raw, Path(t, 'plain'), '--cell', 8)
            plain = np.asarray(Image.open(Path(t, 'plain', 'sheet.png')))
        self.assertEqual(sheet.shape, (64, 120, 4))
        self.assertEqual(tuple(plain[3 * 8, 7 * 8][:3]), (70, 80, 50))  # row 3, column 7 landed in its own cell
        body = sheet[8 * 3 + 3, 8 * 7 + 3]
        self.assertEqual(body[3], 255)
        self.assertLessEqual(int(body[:3].max()) - int(body[:3].min()), 3)  # still grey
        self.assertNotEqual(int(body[0]), 120)  # lightness was matched

    def test_props_views_and_mixed_directory(self):
        with tempfile.TemporaryDirectory() as t:
            raw = Path(t, 'raw')
            raw.mkdir()
            view = np.zeros((8, 8, 4), np.uint8)
            view[2:6, 2:6] = (90, 60, 30, 255)
            for d in 'NESW':
                Image.fromarray(view).save(raw / f'raw_{d}.png')
            run_finish(raw, Path(t, 'out'), '--cell', 4)
            self.assertEqual(sorted(p.name for p in Path(t, 'out').iterdir()), ['E.png', 'N.png', 'S.png', 'W.png'])
            Image.fromarray(view).save(raw / 'raw_0_0.png')  # a stale sheet frame in a props directory
            bad = subprocess.run([sys.executable, str(SCRIPTS / 'gpu_bake_finish.py'), str(raw), str(Path(t, 'x'))],
                                 capture_output=True)
            self.assertNotEqual(bad.returncode, 0)
            self.assertFalse(Path(t, 'x').exists())


@unittest.skipUnless(shutil.which('nvidia-smi') and shutil.which('blender'), 'needs an NVIDIA GPU and Blender')
class GpuRigTest(unittest.TestCase):
    def test_props_render_on_gpu(self):
        with tempfile.TemporaryDirectory() as t:
            builder = Path(t, 'cube.py')
            builder.write_text('import bpy\n\ndef build(P):\n'
                               '    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.5))\n'
                               '    return [bpy.context.object]\n')
            subprocess.run(['blender', '-b', '--factory-startup', '--python-exit-code', '1', '--python',
                            str(SCRIPTS / 'gpu_bake_rig.py'), '--', t, str(builder), 'samples=1', 'supersample=1',
                            'height_px=100'], check=True, stdout=subprocess.DEVNULL)
            meta = json.loads(Path(t, 'render.json').read_text())
            south = np.asarray(Image.open(Path(t, 'raw_S.png')))
        self.assertIn(meta['backend'], ('OPTIX', 'CUDA'))
        ys = np.flatnonzero((south[..., 3] > 128).any(1))
        self.assertAlmostEqual(ys[-1] - ys[0] + 1, 100, delta=3)  # fitted to height_px


if __name__ == '__main__':
    unittest.main()
