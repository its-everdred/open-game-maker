import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import measure_sheet as sheet
import spritemetrics as metrics


class SpriteMetricsTests(unittest.TestCase):
    def measure(self, pixels, cell):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'sheet.png'
            Image.fromarray(pixels).save(path)
            return sheet.measure(path, cell)

    def test_counts_nonempty_frames_and_measures_sprite(self):
        pixels = np.zeros ( (8, 24, 4), dtype=np.uint8)
        pixels[1:4, 2:4] = [100, 50, 20, 255]
        pixels[2:5, 18:20] = [200, 50, 20, 255]
        result = self.measure(pixels, 8)
        self.assertEqual(result['grid'], {'cell': 8, 'cols': 3, 'rows': 1})
        self.assertEqual(result['rows'][0]['frames'], 2)
        self.assertEqual(result['sheet_colours'], 2)
        self.assertEqual(result['per_frame']['bbox_w']['mean'], 2)
        self.assertEqual(result['per_frame']['bbox_h']['mean'], 3)

    def test_shadow_excluded_from_object(self):
        pixels = np.array([[[0, 0, 0, 165], [0, 0, 0, 255], [20, 30, 40, 200]]], dtype=np.uint8)
        self.assertEqual(metrics.mask(pixels).tolist(), [[False, True, True]])
        self.assertEqual(metrics.shadow_mask(pixels).tolist(), [[True, False, False]])

    def test_transparent_sheet_has_no_frame_metrics(self):
        result = self.measure(np.zeros((8, 16, 4), dtype=np.uint8), 8)
        self.assertEqual(result['rows'][0]['frames'], 0)
        self.assertIsNone(result['per_frame'])
        self.assertIsNone(result['direction_area_cv'])
        self.assertIsNone(metrics.bbox(metrics.mask(np.zeros((8, 8, 4), dtype=np.uint8))))

    def test_invalid_cell_is_clear(self):
        with self.assertRaisesRegex(ValueError, 'cell must be positive'):
            self.measure(np.zeros((8, 8, 4), dtype=np.uint8), 9)


if __name__ == '__main__':
    unittest.main()
