"""Finish C (#1338). Kevin on finish B: "fuzzy ... the original sprites have sharper edges and sharper shade/color
transitions. clear lines separating clothing from skin". The pack's differing neighbours are 13-52% hard steps
(dE >= 20), finish B's 1%; its rim is a darkened local colour, never black."""
from pathlib import Path
import sys
import subprocess
import unittest

import numpy as np
from PIL import Image
from skimage.color import rgb2lab

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import spritemetrics as sm  # noqa: E402
from pixel_finish import pixel_finish  # noqa: E402
from pixel_finish_c import PRESET, finish_c, fold_orphans, load_preset, pick_resize  # noqa: E402

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
    return load_preset(PRESET, 'C1') | {'palette': 'own'} | kw


class FinishC(unittest.TestCase):
    def test_pack_palette_cli_requires_references_before_reading_inputs(self):
        command = [sys.executable, '-I', str(ROOT / 'scripts/pixel_finish_c.py'),
                   'raw.png', 'alb.png', 'depth.png', 'out.png', '--variant', 'C1']
        result = subprocess.run(command, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('add --ssi', result.stderr)

    def test_default_uses_own_colours_without_internal_lines(self):
        default = load_preset(PRESET, None)
        self.assertEqual(default, load_preset(PRESET, 'C4'))
        self.assertEqual(default['palette'], 'own')
        self.assertEqual(default['line_dark'], 0)

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


    def test_pack_tone_palette_takes_the_reference_colours(self):
        # C1/C2 (ssi_tone) re-colour each material in the hue of the nearest pack colour group: a warm skin render
        # next to a cooler, ruddier pack skin must come out in the pack's hue, not its own
        import tempfile
        raw, alb, dep, _ = body()
        ref = np.zeros((32, 32, 4), np.uint8)
        ref[4:28, 8:24] = [200, 140, 125, 255]
        ref[4:16, 8:24] = [170, 110, 100, 255]
        with tempfile.TemporaryDirectory() as d:
            path = str(Path(d) / 'ref.png')
            Image.fromarray(ref).save(path)
            P = load_preset(PRESET, 'C1') | {'line_dark': 0, 'outline_dark': 0, 'ssi_max_de': 40}
            own, _ = finish_c(raw, alb, dep, P)  # no reference: the render's own hue
            tone, _ = finish_c(raw, alb, dep, P, [path])
        on = tone[..., 3] > 0
        hue = lambda o: np.degrees(np.arctan2(*rgb2lab(o[..., :3] / 255)[on][:, [2, 1]].T)).mean()  # noqa: E731
        pack = np.degrees(np.arctan2(*rgb2lab(ref[4:28, 8:24, :3] / 255).reshape(-1, 3)[:, [2, 1]].T)).mean()
        self.assertLess(abs(hue(tone) - pack), abs(hue(own) - pack) - 5)

    def test_orphan_pixels_fold_into_their_neighbours(self):
        # the Hammer slam speckle (#1282): a lone band pixel inside another band is noise, not shading
        mid = np.zeros((5, 5), int)
        band = np.zeros((5, 5), int)
        band[2, 2] = 2
        _, out = fold_orphans(mid, band, 1)
        self.assertEqual(out[2, 2], 0)
        band[2, 3] = 2  # two together are a shape, and stay
        _, out = fold_orphans(mid, band, 1)
        self.assertEqual(out[2, 2], 2)

    def test_an_empty_render_gives_an_empty_sprite(self):
        # one model with a transparent material must not abort a whole pack preview
        out, info = finish_c(np.zeros((64, 64, 4), np.uint8), None, None, preset(cloth_split=False))
        self.assertEqual(out.shape, (16, 16, 4))
        self.assertFalse(out[..., 3].any())

    def test_albedo_chroma_preserves_a_shadowed_face(self):
        # A neutral shadow in the lit pass must not turn a warm painted face grey.
        raw = np.full((32, 32, 4), [100, 100, 100, 255], np.uint8)
        alb = np.full((32, 32, 3), [210, 140, 110], np.uint8)
        P = load_preset(PRESET, 'C4')
        out, info = finish_c(raw, alb, None, P)
        lab = rgb2lab(out[..., :3] / 255)
        self.assertGreater(lab[..., 1].mean(), 8)
        self.assertGreater(lab[..., 2].mean(), 8)
        self.assertEqual(info['line_px'], 0)

    def test_body_mask_keeps_distinct_painted_details(self):
        raw = np.full((32, 32, 4), [100, 100, 100, 255], np.uint8)
        alb = np.full((32, 32, 3), [210, 140, 110], np.uint8)
        alb[:, 16:] = [100, 140, 210]
        ids = np.zeros((32, 32), int)  # both regions are part of the body mask
        out, _ = finish_c(raw, alb, None, load_preset(PRESET, 'C4'), ids=ids)
        lab = rgb2lab(out[..., :3] / 255)
        self.assertGreater(lab[:, :4, 2].mean() - lab[:, -4:, 2].mean(), 20)

    def test_small_warm_face_survives_many_grey_materials(self):
        raw = np.full((128, 128, 4), [128, 128, 128, 255], np.uint8)
        alb = np.empty((128, 128, 3), np.uint8)
        for i in range(32):
            alb[:, i * 4:(i + 1) * 4] = 30 + i * 6
        alb[60:64, 60:64] = [168, 135, 125]
        out, _ = finish_c(raw, alb, None, load_preset(PRESET, 'C4'), ss=1)
        face = rgb2lab(out[60:64, 60:64, :3] / 255)
        self.assertGreater(face[..., 1].mean(), 5)
        self.assertGreater(face[..., 2].mean(), 5)

    def test_unlit_material_uses_visible_colour_when_diffuse_pass_is_black(self):
        raw = np.full((32, 32, 4), [180, 80, 40, 255], np.uint8)
        alb = np.ones((32, 32, 3), np.uint8)  # Blender can dither an all-black pass to 1.
        raw[:, 16:, :3] = [100, 100, 100]
        alb[:, 16:] = [210, 140, 110]  # a neighbouring diffuse material still uses its albedo
        out, _ = finish_c(raw, alb, None, load_preset(PRESET, 'C4'))
        lab = rgb2lab(out[..., :3] / 255)
        self.assertGreater(lab[:, :4, 1].mean(), 15)
        self.assertGreater(lab[:, :4, 2].mean(), 15)
        self.assertGreater(lab[:, -4:, 1].mean(), 8)
        self.assertGreater(lab[:, -4:, 2].mean(), 8)


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
