"""Checks for pose_overlay.py (#1282 bake-off): the frame-by-frame silhouette check against the pack clip.

The creator judges each beat (wind-up, strike, recovery) from this sheet, so a frame must be coloured by who covers it
(pack red, ours cyan, both white), its IoU must be the real overlap, and a cell with fewer frames than the pack must
fail rather than silently leave the pack's last beats unchecked.
"""
import sys
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/motion'))
from pose_overlay import BOTH, OURS, PACK, overlay  # noqa: E402


def square(x0, x1):
    a = np.zeros((8, 8, 4), np.uint8)
    a[2:6, x0:x1] = (200, 150, 120, 255)
    return Image.fromarray(a)


class Overlay(unittest.TestCase):
    def test_colours_and_iou_follow_the_overlap(self):
        ims, ious = overlay([square(0, 4), square(0, 4)], [square(0, 4), square(2, 6)])
        self.assertEqual(ious, [1.0, round(8 / 24, 3)])  # 2x4 shared of a 4x6 union
        px = np.asarray(ims[1])
        self.assertEqual(tuple(px[3, 0]), PACK)
        self.assertEqual(tuple(px[3, 3]), BOTH)
        self.assertEqual(tuple(px[3, 5]), OURS)

    def test_a_short_cell_fails_instead_of_dropping_pack_beats(self):
        with self.assertRaises(SystemExit):
            overlay([square(0, 4)] * 15, [square(0, 4)] * 14)


if __name__ == '__main__':
    unittest.main()
