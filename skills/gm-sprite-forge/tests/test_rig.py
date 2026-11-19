"""Synthetic checks for the calibrated renderer and sheet finishing."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from finish import finish
from render_sheet import assemble


class RigTest(unittest.TestCase):
    def test_tile_projection(self):
        with tempfile.TemporaryDirectory() as temp:
            subprocess.run(['blender', '-b', '--factory-startup', '--threads', '2', '--python',
                            str(ROOT / 'scripts/blender_iso_rig.py'), '--', 'tile', temp,
                            'samples=1', 'views=N'], check=True, stdout=subprocess.DEVNULL)
            pixels = np.asarray(Image.open(Path(temp) / 'tile_N.png').convert('RGBA'))
            fixture = json.loads((ROOT / 'tests/fixtures/diamond.json').read_text())
            for row, (left, right) in fixture.items():
                # The green top face, excluding its dark side and shadow.
                line = pixels[int(row)]
                xs = np.flatnonzero((line[:, 1] > line[:, 0]) & (line[:, 3] == 255))
                self.assertGreater(len(xs), 0)
                self.assertLessEqual(abs(int(xs[0]) - left), 1)
                self.assertLessEqual(abs(int(xs[-1]) - right), 1)

    def test_four_views_turn_the_cube(self):
        with tempfile.TemporaryDirectory() as temp:
            subprocess.run(['blender', '-b', '--factory-startup', '--threads', '2',
                            '--python-exit-code', '1', '--python',
                            str(ROOT / 'scripts/blender_iso_rig.py'), '--', 'cube', temp,
                            'samples=1'], check=True, stdout=subprocess.DEVNULL)
            turned = Path(temp) / 'turned'
            subprocess.run(['blender', '-b', '--factory-startup', '--threads', '2',
                            '--python-exit-code', '1', '--python',
                            str(ROOT / 'scripts/blender_iso_rig.py'), '--', 'cube', str(turned),
                            'samples=1', 'views=N', 'yaw0=90'], check=True, stdout=subprocess.DEVNULL)
            images = [np.asarray(Image.open(Path(temp) / f'cube_{view}.png')) for view in 'NWSE']
            self.assertTrue(np.array_equal(images[1], np.asarray(Image.open(turned / 'cube_N.png'))))
            for index in range(4):
                self.assertFalse(np.array_equal(images[index], images[(index + 1) % 4]))

    def test_rendered_sheet_yaws(self):
        with tempfile.TemporaryDirectory() as temp:
            for yaw in (0, 45):
                out = Path(temp) / str(yaw)
                subprocess.run(['blender', '-b', '--factory-startup', '--threads', '2',
                                '--python-exit-code', '1', '--python',
                                str(ROOT / 'scripts/blender_iso_rig.py'), '--', 'cube', str(out),
                                'samples=1', 'sheet=1', 'cell=64', f'yaw0={yaw}'],
                               check=True, stdout=subprocess.DEVNULL)
            row7 = np.asarray(Image.open(Path(temp) / '0/frame_7_0.png'))
            row0 = np.asarray(Image.open(Path(temp) / '45/frame_0_0.png'))
            self.assertTrue(np.array_equal(row7, row0))
            self.assertFalse(np.array_equal(row0, np.asarray(Image.open(Path(temp) / '0/frame_0_0.png'))))

    def test_finish_and_sheet_order(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            for row in range(8):
                for col in range(15):
                    pixels = np.zeros((64, 64, 4), np.uint8)
                    pixels[0, 0] = [20 + row, col, 50, 255]
                    pixels[0, 1] = [90, 40, 10, 40]
                    pixels[0, 2] = [3, 2, 1, 40]
                    Image.fromarray(pixels).save(directory / f'frame_{row}_{col}.png')
            sheet, shadow = assemble(directory, 64, True)
            self.assertEqual(tuple(sheet[0, 0]), (20, 0, 50, 255))
            self.assertEqual(tuple(sheet[7 * 64, 0]), (27, 0, 50, 255))
            self.assertEqual(tuple(sheet[0, 1]), (0, 0, 0, 0))
            self.assertEqual(tuple(shadow[0, 2]), (0, 0, 0, 40))
            self.assertFalse(np.any((sheet[..., 3] > 0) & (sheet[..., 3] < 255)))

    def test_finish_blackens_shadow(self):
        pixels = np.array([[[2, 3, 4, 50], [100, 30, 20, 50], [50, 60, 70, 200]]], dtype=np.uint8)
        result = finish(pixels)
        self.assertEqual(result.tolist(), [[[0, 0, 0, 50], [0, 0, 0, 0], [50, 60, 70, 255]]])


if __name__ == '__main__':
    unittest.main()
