"""The pixel finish must make our smooth renders as flat as the pack: Kevin asked for fewer shades and less detail
(hero-finish1-warrior "B": 14 colours, smoothed), the pack has ~20% identical neighbouring pixels and ours ~1% (#1202)."""
from pathlib import Path
import sys
import unittest

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from pixel_finish import pixel_finish  # noqa: E402


def render_like(seed=0):
    """A 2 x 3 sheet of 64 px cells: a shaded body (smooth light gradient plus noise) on a transparent background."""
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:128, 0:192]
    cx, cy = x % 64 - 32, y % 64 - 32
    body = cx ** 2 / 14 ** 2 + cy ** 2 / 26 ** 2 < 1
    shade = 0.55 + 0.35 * (-cx - cy) / 60 + rng.normal(0, 0.03, body.shape)
    a = np.zeros((128, 192, 4), np.uint8)
    a[..., 0] = np.clip(shade * 230, 0, 255)
    a[..., 1] = np.clip(shade * 160, 0, 255)
    a[..., 2] = np.clip(shade * 130, 0, 255)
    a[..., 3] = np.where(body, 255, 0)
    return a


def same_neighbours(a):
    m = a[..., 3] > 0
    both = m[:, 1:] & m[:, :-1]
    return ((a[:, 1:, :3] == a[:, :-1, :3]).all(-1) & both).sum() / both.sum()


class PixelFinishTest(unittest.TestCase):
    def test_flattens_a_smooth_render_to_the_picked_palette(self):
        src = render_like()
        out = pixel_finish(src, 14, smooth=True)
        m = out[..., 3] > 0
        self.assertGreater(len(np.unique(src[m][:, :3], axis=0)), 150)  # the input is a smooth render
        self.assertLessEqual(len(np.unique(out[m][:, :3], axis=0)), 14)
        self.assertGreater(same_neighbours(out), 0.4)  # flat bands, flatter than the pack's ~0.2
        # the smoothing is what B adds: noise-level micro-shading must not survive as speckle between the bands
        self.assertGreater(same_neighbours(out), same_neighbours(pixel_finish(src, 14)) + 0.2)
        np.testing.assert_array_equal(out[..., 3], src[..., 3])  # the silhouette and hard alpha are untouched

    def test_one_palette_across_the_sheet(self):
        # every direction and frame shares the same colours, so a walk does not flicker between palettes
        out = pixel_finish(render_like(), 14, smooth=True)
        cells = [out[r * 64:(r + 1) * 64, c * 64:(c + 1) * 64] for r in range(2) for c in range(3)]
        pals = [set(map(tuple, cell[cell[..., 3] > 0][:, :3])) for cell in cells]
        for p in pals[1:]:
            self.assertGreater(len(p & pals[0]) / len(p | pals[0]), 0.7)

    def test_undergarments_keep_their_own_colours(self):
        # On one palette, pale skin and the white undergarments share colours, so the underwear merges into the skin:
        # it vanished on Kevin's first finish (#1202). The cloth mask gives the cloth a ramp no skin pixel uses.
        a = render_like()
        y = np.mgrid[0:128, 0:192][0]
        body = a[..., 3] > 0
        cloth = (np.abs(y % 64 - 40) < 5) & body  # a band of briefs across each body
        a[..., :3] = np.where(body[..., None], np.clip(a[..., :3] * 1.35, 0, 255), 0)  # pale skin, highlights near white
        a[cloth, :3] = np.clip(a[cloth, :3].mean(-1, keepdims=True) + 20, 0, 255)  # shaded white cloth

        def shared(out):
            return set(map(tuple, out[cloth][:, :3])) & set(map(tuple, out[body & ~cloth][:, :3]))

        self.assertTrue(shared(pixel_finish(a, 14, smooth=True)))
        self.assertFalse(shared(pixel_finish(a, 8, smooth=True, cloth=cloth, cloth_colours=6)))

    def test_weapon_keeps_its_own_colours(self):
        # A lit steel blade is pale and nearly neutral: on the body's palette it took the pale skin colour and the axe
        # read as a flesh stick (#1282 round 2). With a weapon mask it is clustered on its own.
        a = render_like()
        body = a[..., 3] > 0
        y, x = np.mgrid[0:128, 0:192]
        cx, cy = x % 64 - 32, y % 64 - 32
        blade = (np.abs(cx + 4) < 2) & (cy < 0) & body  # a thin blade over the body: few pixels, like the axe
        a[body & ~blade, :3] = np.clip(a[body & ~blade, :3] * 1.35, 0, 255)  # pale skin
        a[blade, :3] = np.clip(np.array([205, 210, 220]) * (0.8 + 0.4 * (cy[blade] + 26) / 26)[:, None], 0, 255)  # steel

        def shared(out):
            return set(map(tuple, out[blade][:, :3])) & set(map(tuple, out[body & ~blade][:, :3]))
        self.assertTrue(shared(pixel_finish(a, 8, smooth=True)))  # the bug: blade and skin share colours
        self.assertFalse(shared(pixel_finish(a, 8, smooth=True, weapon=blade, weapon_colours=4)))


if __name__ == '__main__':
    unittest.main()
