"""Checks for score_cell.empty_render (#1282 round 3): a cell whose body never entered the camera must say so.

100STYLE walk windows start metres from the origin; rendered without in_place they came out as empty frames, and the
scorer blamed the weapon mask ("rendered before the weapon was red?"), sending the next run after the wrong fix.
Needs numpy and Pillow (`gm py --`).
"""
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/motion'))
from score_cell import empty_render  # noqa: E402


def cell(frames):
    d = Path(tempfile.mkdtemp())
    for i, alpha in enumerate(frames):
        a = np.zeros((8, 8, 4), np.uint8)
        a[2:4, 2:4, 3] = alpha
        Image.fromarray(a).save(d / f'raw_1_{i}.png')
    return d


class EmptyRenderTest(unittest.TestCase):
    def test_all_frames_empty_is_reported(self):
        self.assertTrue(empty_render(cell([0, 0, 0])))

    def test_one_visible_frame_is_a_render(self):
        self.assertFalse(empty_render(cell([0, 255, 0])))

    def test_no_frames_is_not_this_error(self):
        self.assertFalse(empty_render(cell([])))


if __name__ == '__main__':
    unittest.main()
