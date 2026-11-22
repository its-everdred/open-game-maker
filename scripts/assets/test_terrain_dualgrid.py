"""Terrain transition sheets: layout, provenance and the seam/hole checks, on synthetic pack tiles.

Needs numpy and Pillow: ~/.local/share/ogm/image-python-v1/bin/python -I scripts/assets/test_terrain_dualgrid.py
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import numpy as np
from PIL import Image

import terrain_dualgrid as t


def fake_pack(root):
    """A 256x256 block per source tile, its top face a flat colour, so pieces are traceable to their terrain."""
    for i, (_, overlay, _, _) in enumerate(t.TERRAINS):
        name = overlay or 'Ground A1'
        im = np.zeros((256, 256, 4), np.uint8)
        im[176:240, 64:192] = (40 * i + 20, 200 - 30 * i, 90, 255)
        Image.fromarray(im).save(root / f'{name}_N.png')


class Sheets(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        env, cls.out = Path(cls.tmp.name) / 'env', Path(cls.tmp.name) / 'out'
        env.mkdir()
        fake_pack(env)
        cls.status = t.main(env, cls.out)
        cls.sheets = [np.array(Image.open(cls.out / f'terrain-{name}.png')) for name, *_ in t.TERRAINS]

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_writes_one_sheet_per_terrain_in_the_adapter_layout(self):
        self.assertEqual(self.status, 0)
        for sheet in self.sheets:
            # 16 cases across, (3 variants x 4 quarters) down, 64x32 frames: @gm/pack-smallscaleint terrainSheet.
            self.assertEqual(sheet.shape, (12 * 32, 16 * 64, 4))
            self.assertFalse(sheet[:, :64].any(), 'case 0 (terrain absent) must stay empty')

    def test_full_case_quarters_tile_the_whole_diamond(self):
        whole = np.zeros((t.TH, t.TW), bool)
        for quarter in t.QUARTERS:
            x, y = t.QUARTER_BOX[quarter]
            whole[y:y + t.QH, x:x + t.QW] |= t.frame(self.sheets[2], 15, 0, quarter)[..., 3] == 255
        self.assertTrue((whole == t.INSIDE).all())

    def test_records_provenance_and_passing_checks(self):
        meta = json.loads((self.out / 'terrain-grass.json').read_text())
        self.assertEqual(meta['provenance']['source_tiles'], ['Ground A1_N', 'Ground A2_N'])
        self.assertIs(meta['provenance']['ai_generated'], False)
        self.assertIs(meta['provenance']['experiment'], False)
        manifest = json.loads((self.out / 'manifest.json').read_text())
        self.assertEqual(manifest['checks'], {'status': 'pass', 'problems': []})

    def test_hole_check_catches_a_missing_case(self):
        broken = [s.copy() for s in self.sheets]
        broken[0][:, 15 * t.QW:16 * t.QW] = 0  # drop the base terrain's full piece
        self.assertTrue(t.check_holes(broken, seeds=(1,)))

    def test_frame_check_catches_a_blank_overlay_the_hole_check_cannot_see(self):
        # Dirt under the grass is opaque, so blank grass transitions leave no hole; they would show dirt instead.
        blank = [s.copy() for s in self.sheets]
        blank[2][:, t.QW:15 * t.QW] = 0
        self.assertEqual(t.check_holes(blank, seeds=(1,)), [])
        self.assertTrue(t.check_frames(blank))

    def test_frame_check_catches_swapped_quarters(self):
        swapped = [s.copy() for s in self.sheets]
        top, bottom = swapped[3][0:t.QH].copy(), swapped[3][3 * t.QH:4 * t.QH].copy()
        swapped[3][0:t.QH], swapped[3][3 * t.QH:4 * t.QH] = bottom, top
        self.assertTrue(t.check_frames(swapped))
        self.assertEqual(t.check_frames(self.sheets), [])

    def test_edge_check_catches_noise_on_the_border(self):
        original = t.TAPER.copy()
        try:
            t.TAPER[:] = 1  # untapered noise: corner tiles no longer meet on shared corners
            self.assertTrue(t.check_edges())
        finally:
            t.TAPER[:] = original


if __name__ == '__main__':
    unittest.main()
