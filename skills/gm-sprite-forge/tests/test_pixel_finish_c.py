"""Finish C (#1338). Kevin on finish B: "fuzzy ... the original sprites have sharper edges and sharper shade/color
transitions. clear lines separating clothing from skin". The pack's differing neighbours are 13-52% hard steps
(dE >= 20), finish B's 1%; its rim is a darkened local colour, never black."""
from pathlib import Path
import sys
import unittest

import numpy as np
from PIL import Image
from skimage.color import rgb2lab

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import spritemetrics as sm  # noqa: E402
from pixel_finish import pixel_finish  # noqa: E402
from pixel_finish_c import PRESET, finish_c, load_preset, pick_resize  # noqa: E402

SS = 4
SKIN, WHITE = np.array([240, 216, 199]), np.array([240, 240, 236])  # pale skin, briefs: dE 13.3 < merge_de 14


def body(seed=0):
    """A 64 px sprite rendered at 4x: smooth-shaded pale skin with white briefs (the albedo says which is which), a soft
    rim, and depth rising toward the edges (the briefs sit in front)."""
    rng = np.random.default_rng(seed)
    n = 64 * SS
    y, x = (np.mgrid[0:n, 0:n] + 0.5) / SS
    cx, cy = x - 32, y - 32
    r = cx ** 2 / 14 ** 2 + cy ** 2 / 26 ** 2
    briefs = np.abs(cy - 8) < 5  # rows 35-44 at 1x, block-aligned
    alb = np.where(briefs[..., None], WHITE, SKIN).astype(np.uint8)
    shade = 0.6 + 0.35 * (-cx - cy) / 60 + rng.normal(0, 0.02, r.shape)
    raw = np.zeros((n, n, 4), np.uint8)
    raw[..., :3] = np.clip(alb * shade[..., None], 0, 255)
    raw[..., 3] = np.clip((1.02 - r) * 30, 0, 1) * 255
    depth = np.clip(30000 + 2000 * r - 3000 * briefs, 0, 65535).astype(np.uint16)
    return raw, alb, depth, briefs[SS // 2::SS, SS // 2::SS]


def preset(**kw):
    return load_preset(PRESET, None) | {'palette': 'own'} | kw


class FinishC(unittest.TestCase):
    def test_hard_steps_like_the_pack_where_b_is_soft(self):
        raw, alb, dep, _ = body()
        one = np.asarray(Image.fromarray(raw).resize((64, 64), Image.LANCZOS))  # what finish B starts from
        b = sm.crispness(pixel_finish(one, 14, smooth=True))
        c = sm.crispness(finish_c(raw, alb, dep, preset())[0])
        self.assertLess(b['hard'], 0.13)  # the fuzz Kevin saw
        self.assertGreater(c['hard'], 0.13)  # inside the pack's 0.13-0.52, or harder
        self.assertGreater(c['same'], 0.46)  # flat bands, at least as flat as the pack

    def test_1x_with_hard_alpha(self):
        raw, alb, dep, _ = body()
        out, _ = finish_c(raw, alb, dep, preset())
        self.assertEqual(out.shape, (64, 64, 4))
        self.assertEqual(set(np.unique(out[..., 3])), {0, 255})

    def test_few_hard_bands_per_material(self):
        raw, alb, dep, briefs = body()
        out, _ = finish_c(raw, alb, dep, preset(bands=3, line_dark=0, outline_dark=0, cloth_split=True))
        on = out[..., 3] > 0
        for part in (briefs, ~briefs):
            self.assertLessEqual(len(np.unique(out[on & part][:, :3], axis=0)), 3)

    def test_cloth_split_keeps_the_undergarments_off_the_skin(self):
        # the prototype's known gap: at merge_de 14 the white briefs and pale skin cluster as one material, so the
        # briefs take skin bands and no line separates them (Kevin: "clear lines separating clothing from skin")
        raw, alb, dep, briefs = body()
        P = preset(line_dark=0, outline_dark=0)
        merged, _ = finish_c(raw, alb, dep, P)
        split, _ = finish_c(raw, alb, dep, P | {'cloth_split': True})
        on = merged[..., 3] > 0

        def shared(o):
            return {tuple(c) for c in o[on & briefs][:, :3]} & {tuple(c) for c in o[on & ~briefs][:, :3]}
        self.assertTrue(shared(merged))
        self.assertFalse(shared(split))

    def test_a_one_pixel_line_where_cloth_meets_skin(self):
        raw, alb, dep, briefs = body()
        P = preset(outline_dark=0, cloth_split=True)
        lined, info = finish_c(raw, alb, dep, P)
        plain, _ = finish_c(raw, alb, dep, P | {'line_dark': 0})
        L, Lp = (rgb2lab(o[..., :3] / 255)[..., 0] for o in (lined, plain))
        darker = (L < Lp - 3) & (lined[..., 3] > 0)
        self.assertGreater(info['line_px'], 0)
        # every column of the seam has a line
        seam_cols = np.unique(np.nonzero(briefs & ~np.roll(briefs, 1, 0))[1])
        cols = [c for c in seam_cols if 22 < c < 42]
        self.assertTrue(all(darker[:, c].any() for c in cols))
        # one pixel thick: the seam runs across the body, so no darkened pixel has another straight above it
        self.assertFalse((darker & np.roll(darker, 1, 0)).any())

    def test_equal_depth_line_stays_one_pixel(self):
        # without a depth pass (hero cells), a seam would be drawn on both sides; it must still be 1 px
        raw, alb, _, briefs = body()
        ids = np.where(np.all(alb == WHITE, -1), 1, 0)
        P = preset(outline_dark=0)
        lined, _ = finish_c(raw, None, None, P, ids=ids)
        plain, _ = finish_c(raw, None, None, P | {'line_dark': 0}, ids=ids)
        L, Lp = (rgb2lab(o[..., :3] / 255)[..., 0] for o in (lined, plain))
        darker = (L < Lp - 3) & (lined[..., 3] > 0)
        self.assertTrue(darker.any())
        self.assertFalse((darker & np.roll(darker, 1, 0)).any())

    def test_outline_is_darkened_local_colour_not_black(self):
        raw, alb, dep, _ = body()
        out, _ = finish_c(raw, alb, dep, preset(line_dark=0))
        plain, _ = finish_c(raw, alb, dep, preset(line_dark=0, outline_dark=0))
        rim = sm.edge(out[..., 3] > 0)
        lab, labp = rgb2lab(out[..., :3] / 255), rgb2lab(plain[..., :3] / 255)
        self.assertTrue((lab[..., 0][rim] < labp[..., 0][rim]).all())
        self.assertGreater(lab[..., 0][rim].min(), 15)  # never black
        self.assertGreater(np.hypot(lab[..., 1], lab[..., 2])[rim].mean(), 3)  # keeps the skin's warmth


class PickResize(unittest.TestCase):
    def test_never_averages(self):
        # an averaging resize makes in-between colours and partial alpha: the fuzz finish C removes
        raw, alb, dep, _ = body()
        raw[..., 3] = np.where(raw[..., 3] >= 128, 255, 0)
        r, a, d = pick_resize(raw, 91, 91, alb, dep)
        self.assertEqual(r.shape, (91, 91, 4))
        src = {tuple(c) for c in raw[raw[..., 3] > 0]}
        self.assertTrue({tuple(c) for c in r[r[..., 3] > 0]} <= src)
        self.assertEqual(set(np.unique(r[..., 3])), {0, 255})
        self.assertTrue({tuple(c) for c in a[r[..., 3] > 0]} <= {tuple(SKIN), tuple(WHITE)})


if __name__ == '__main__':
    unittest.main()
