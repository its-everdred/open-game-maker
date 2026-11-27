"""Kevin reviews packs through the pixel mask one asset group at a time (armor, each weapon kind, props, tiles), so a
model in the wrong group, or the same model twice from a pack's parallel format folders, wastes his review."""
from pathlib import Path
import sys
import tempfile
import unittest

import numpy as np
from scipy.ndimage import binary_erosion

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from pixel_preview import category, collect, pixelate, pixelate_c  # noqa: E402
from pixel_finish_c import PRESET, load_preset  # noqa: E402


class Grouping(unittest.TestCase):
    def test_rigged_models_are_characters_whatever_their_name(self):
        self.assertEqual(category({'name': 'Skeleton_Warrior', 'character': True}, 0), 'characters')

    def test_weapon_kinds_split_only_in_big_weapon_packs(self):
        sword = {'name': 'sword_A', 'character': False}
        self.assertEqual(category(sword, 5), 'weapons')
        self.assertEqual(category(sword, 40), 'weapons-swords')
        self.assertEqual(category({'name': 'Skeleton_Shield_Large_A'}, 40), 'weapons-shields')
        self.assertEqual(category({'name': 'crossbow_2handed'}, 40), 'weapons-bows')

        self.assertEqual(category({'name': 'arrow_bow_bundle'}, 40), 'weapons-bows')
        self.assertEqual(category({'name': 'Skeleton_Arrow_Broken'}, 40), 'weapons-bows')

    def test_narrow_stairs_are_not_bows(self):  # KayKit Dungeon's only "bow" was stairs_narrow (Kevin: "no bows")
        self.assertEqual(category({'name': 'stairs_narrow'}, 40), 'environment')
        self.assertEqual(category({'name': 'wall-narrow'}, 40), 'environment')

    def test_armor_tiles_and_props(self):
        self.assertEqual(category({'name': 'helmet_knight'}, 0), 'armor')
        self.assertEqual(category({'name': 'wall_doorway'}, 0), 'environment')
        self.assertEqual(category({'name': 'potion_small_red'}, 0), 'props')


class Collect(unittest.TestCase):
    def test_one_file_per_model_preferring_glb(self):
        with tempfile.TemporaryDirectory() as d:
            for rel in ('fbx/wall_corner.fbx', 'gltf/wall-corner.gltf', 'glb/wallCorner.glb', 'obj/barrel.obj'):
                p = Path(d, rel)
                p.parent.mkdir(exist_ok=True)
                p.write_text('')
            got = {m['name']: Path(m['path']).suffix for m in collect([Path(d)])}
        self.assertEqual(got, {'barrel': '.obj', 'wallCorner': '.glb'})


class Pixelate(unittest.TestCase):
    def test_directions_share_one_palette_and_keep_their_sizes(self):
        rng = np.random.default_rng(1)
        frames = []
        for w in (20, 28):
            f = np.zeros((32, w, 4), np.uint8)
            f[4:30, 3:w - 3, :3] = rng.integers(0, 255, (26, w - 6, 3))
            f[4:30, 3:w - 3, 3] = 255
            frames.append(f)
        out = pixelate(frames, 6)
        self.assertEqual([o.shape for o in out], [f.shape for f in frames])
        colours = {tuple(c) for o in out for c in o[o[..., 3] > 0][:, :3]}
        self.assertLessEqual(len(colours), 6)


class PixelateC(unittest.TestCase):
    def test_directions_share_one_palette_and_return_at_1x(self):
        # a walk must not flicker between palettes from one direction to the next
        rng = np.random.default_rng(2)
        raws, albs, deps = [], [], []
        for w in (80, 112):  # 4x renders of two directions, different widths
            f = np.zeros((128, w, 4), np.uint8)
            f[16:120, 12:w - 12, :3] = (rng.random((104, w - 24, 1)) * 60 + 150).astype(np.uint8) * [1, 0.8, 0.7]
            f[16:120, 12:w - 12, 3] = 255
            a = np.zeros((128, w, 3), np.uint8)
            a[16:120, 12:w - 12] = [220, 180, 160]
            raws.append(f)
            albs.append(a)
            deps.append(np.full((128, w), 30000, np.uint16))
        out = pixelate_c(raws, albs, deps, load_preset(PRESET, 'C3'))
        self.assertEqual([o.shape for o in out], [(32, 20, 4), (32, 28, 4)])
        inner = [binary_erosion(o[..., 3] > 0) for o in out]  # inside the outline
        pals = [{tuple(c) for c in o[i][:, :3]} for o, i in zip(out, inner)]
        self.assertLessEqual(len(pals[0] | pals[1]), 4)  # one material, C3's 4 bands, in both directions together


if __name__ == '__main__':
    unittest.main()
