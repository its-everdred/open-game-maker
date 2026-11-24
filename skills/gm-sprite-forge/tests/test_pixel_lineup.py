"""Kevin judges items in engine: at true size, standing on the game's ground next to the hero. A lineup that rescales a
sprite or floats it off the ground line misleads that judgement."""
from pathlib import Path
import sys
import tempfile
import unittest

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from pixel_lineup import strip  # noqa: E402


def solid(w, h, rgb):
    return Image.new('RGBA', (w, h), rgb + (255,))


class Lineup(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        tile = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
        tile.paste((0, 0, 200, 255), (64, 176, 192, 240))  # stands in for a 128 x 64 ground tile
        self.tile = str(Path(self.tmp.name, 'tile.png'))
        tile.save(self.tile)

    def tearDown(self):
        self.tmp.cleanup()

    def columns(self, img, rgb):
        a = np.asarray(img)[..., :3].astype(int)
        return np.argwhere((np.abs(a - rgb).sum(-1) < 60))

    def test_items_keep_their_size_and_stand_on_the_hero_ground_line(self):
        hero, item = solid(10, 40, (250, 0, 0)), solid(8, 20, (0, 250, 0))
        img, names = strip([('crate', item)], [hero], hero, False, [self.tile], '#ffffff:1.0,1.0')
        h, i = self.columns(img, (250, 0, 0)), self.columns(img, (0, 250, 0))
        self.assertEqual(h[:, 0].max(), i[:, 0].max())  # same feet row
        self.assertEqual((np.ptp(i[:, 0]) + 1, np.ptp(i[:, 1]) + 1), (20, 8))
        self.assertEqual([n[0] for n in names], ['crate'])

    def test_weapons_are_held_at_hand_height_not_on_the_ground(self):
        hero, sword = solid(10, 40, (250, 0, 0)), solid(4, 10, (0, 250, 0))
        img, _ = strip([('sword', sword)], [], hero, True, [self.tile], '#ffffff:1.0,1.0')
        feet, s = self.columns(img, (250, 0, 0))[:, 0].max(), self.columns(img, (0, 250, 0))
        self.assertGreater(feet - s[:, 0].max(), 8)


if __name__ == '__main__':
    unittest.main()
