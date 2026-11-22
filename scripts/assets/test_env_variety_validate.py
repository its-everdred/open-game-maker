"""Synthetic coverage for the pilot validator's gates and the pilot's stake cut.

Each gate exists because a variant that fails it would look wrong in a scene: off its tile, rescaled, recoloured
off-palette or cut off. A gate that passes a broken variant would let it into a creator review.

Run: gm py -- -I scripts/assets/test_env_variety_validate.py -v
"""

import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

try:
    import numpy as np
    import scipy  # noqa: F401  (the pilot's cut() needs it)
    from PIL import Image  # noqa: F401

    import env_variety_pilot as pilot  # noqa: E402
    import env_variety_validate as validate  # noqa: E402
except ImportError:  # pragma: no cover - the forge Python has all three
    np = None


def sprite(box=(100, 150, 150, 208), colour=(120, 90, 60)):
    rgba = np.zeros((256, 256, 4), dtype=np.uint8)
    x0, y0, x1, y1 = box
    rgba[y0:y1, x0:x1, :3] = colour
    rgba[y0:y1, x0:x1, 3] = 255
    return rgba


@unittest.skipIf(np is None, "needs NumPy, SciPy and Pillow (run with the forge Python)")
class CheckTest(unittest.TestCase):
    def setUp(self):
        self.source = sprite()

    def check(self, variant, op="recolour", sources=None):
        return validate.check(variant, self.source, sources or [self.source], op)

    def test_identical_copy_passes_every_gate(self):
        result = self.check(self.source.copy())
        self.assertTrue(result["pass"], result)

    def test_colour_from_no_source_fails_density(self):
        result = self.check(sprite(colour=(200, 10, 10)))
        self.assertFalse(result["density"])
        self.assertFalse(result["pass"])

    def test_sideways_shift_fails_anchor(self):
        # Same size, palette, contact row and no clipping: only the anchor gate can see a 20 px shift.
        result = self.check(sprite(box=(120, 150, 170, 208)))
        self.assertTrue(result["contact"] and result["scale"] and result["density"] and result["clip"])
        self.assertFalse(result["anchor"])

    def test_composition_may_shift_within_its_cell(self):
        self.assertTrue(self.check(sprite(box=(120, 150, 170, 208)), op="compose")["anchor"])

    def test_floating_variant_fails_contact(self):
        self.assertFalse(self.check(sprite(box=(100, 140, 150, 198)))["contact"])

    def test_decal_stays_inside_its_cell(self):
        # A decal or cluster covers part of a cell: up to 24 px either way, never past the 32 px half-height.
        self.assertTrue(self.check(sprite(box=(100, 140, 150, 188)), op="decal")["contact"])
        self.assertTrue(self.check(sprite(box=(100, 160, 150, 228)), op="compose")["contact"])
        self.assertFalse(self.check(sprite(box=(100, 170, 150, 238)), op="decal")["contact"])

    def test_rescaled_variant_fails_scale(self):
        self.assertFalse(self.check(sprite(box=(110, 170, 130, 208)))["scale"])

    def test_variant_touching_the_canvas_edge_fails_clip(self):
        self.assertFalse(self.check(sprite(box=(0, 150, 50, 208)))["clip"])


@unittest.skipIf(np is None, "needs NumPy, SciPy and Pillow (run with the forge Python)")
class CutTest(unittest.TestCase):
    def palisade(self):
        """Three 6 px stakes with pointed tops on a shared 4 px mound."""
        rgba = np.zeros((256, 256, 4), dtype=np.uint8)
        for left in (100, 106, 112):
            for x in range(left, left + 6):
                top = 120 + abs(x - (left + 2)) * 3  # tip at left + 2
                rgba[top:200, x] = (110, 80, 40, 255)
        rgba[200:204, 98:120] = (90, 70, 40, 255)
        return rgba

    def test_stakes_are_split_between_tips(self):
        self.assertEqual(len(pilot.stakes(self.palisade())), 3)

    def test_removed_stake_leaves_a_stump_and_the_mound(self):
        rgba = self.palisade()
        x0, x1 = pilot.stakes(rgba)[1]
        out = pilot.cut(rgba, [1], stump=10)
        column = out[:, (x0 + x1) // 2, 3]
        self.assertEqual(column[:190].max(), 0)  # the stake above the stump is gone
        self.assertTrue((column[194:204] == 255).all())  # stump and mound stay
        self.assertTrue((out[120:200, 101, 3] == rgba[120:200, 101, 3]).all())  # neighbours untouched

    def test_compose_copies_pixels_without_blending_shadows(self):
        # A blended shadow over another part makes a colour no pack sprite has, which fails the density gate.
        back = sprite(box=(100, 150, 150, 208), colour=(200, 200, 200))
        front = np.zeros_like(back)
        front[180:200, 60:140] = (0, 0, 0, 120)  # shadow overlapping the back part
        front[160:200, 140:160] = (90, 60, 30, 255)
        out = pilot.compose([(back, (0.0, 0.0)), (front, (0.1, 0.1))])
        allowed = validate.palette(back) | validate.palette(front)
        self.assertEqual(validate.palette(out) - allowed, set())

    def test_missing_stake_index_is_an_error(self):
        with self.assertRaises(ValueError):
            pilot.cut(self.palisade(), [7])


if __name__ == "__main__":
    unittest.main()
