"""The base-body colour pass must give bare skin the pack's skin tones and keep white undergarments white: the pack's
full-palette match turned bare legs into the pack character's dark trousers, and a per-pixel skin/cloth split turned
pale skin grey and some underwear into skin (#1202)."""
from pathlib import Path
import sys
import unittest

import numpy as np
from skimage.color import rgb2lab

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from finish_base import base_pass  # noqa: E402

SKIN = (205, 150, 120)       # rendered skin: light and warm
GARMENT = (238, 236, 232)    # rendered undergarment: near white
PACK_SKIN = (176, 112, 84)   # the pack's skin, darker and redder
TROUSERS = (58, 40, 30)      # the pack's dark leather trousers


def blob(colours, shade=0):
    """One 128 cell: a vertical stripe per colour, each with a small lightness ramp so histograms have spread."""
    a = np.zeros((128, 128, 4), np.uint8)
    for i, c in enumerate(colours):
        for y in range(20, 108):
            k = 1 - shade * (y - 20) / 88
            a[y, 30 + 20 * i:48 + 20 * i, :3] = np.clip(np.array(c) * k, 0, 255)
            a[y, 30 + 20 * i:48 + 20 * i, 3] = 255
    return a


def lab_of(a, x):
    return rgb2lab(a[20:108, x, :3][None].astype(float) / 255)[0]


class BasePassTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        ours = blob([SKIN, GARMENT, SKIN], shade=0.25)
        ref = blob([PACK_SKIN, TROUSERS, TROUSERS, PACK_SKIN], shade=0.2)
        cls.ours, cls.ref = ours, ref
        cls.out, cls.counts = base_pass(ours, ref)

    def test_undergarments_stay_light_and_neutral(self):
        # the pack is mostly dark trousers; the undergarment must not take them
        lab = lab_of(self.out, 58)
        self.assertGreater(np.median(lab[:, 0]), 50)  # trousers are L 18
        self.assertLess(np.median(np.hypot(lab[:, 1], lab[:, 2])), 8)

    def test_skin_takes_the_pack_skin_tone(self):
        got = np.median(lab_of(self.out, 38), 0)
        want = np.median(lab_of(self.ref, 38), 0)
        before = np.median(lab_of(self.ours, 38), 0)
        self.assertLess(np.linalg.norm(got - want), np.linalg.norm(before - want) / 2)
        self.assertGreater(got[0], 45)  # not the trousers' darkness

    def test_mostly_skin_body_keeps_every_skin_pixel_warm(self):
        # a base body is mostly skin: no share of it may be treated as cloth and greyed out
        ours = blob([SKIN, (226, 196, 178), SKIN, GARMENT], shade=0.25)  # incl. pale, low-chroma skin
        out, _ = base_pass(ours, self.ref)
        for x in (38, 58, 78):
            chroma = np.hypot(*lab_of(out, x)[:, 1:].T)
            self.assertGreater(chroma.min(), 8, x)
        self.assertLess(np.median(np.hypot(*lab_of(out, 98)[:, 1:].T)), 8)

    def test_transparent_pixels_are_untouched(self):
        np.testing.assert_array_equal(self.out[self.ours[..., 3] == 0], self.ours[self.ours[..., 3] == 0])


if __name__ == '__main__':
    unittest.main()
