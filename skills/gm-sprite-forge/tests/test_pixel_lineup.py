"""Kevin judges items in engine: at true size, standing on the game's ground next to the hero. A lineup that rescales a
sprite or floats it off the ground line misleads that judgement."""
from pathlib import Path
import io
import sys
import tempfile
import unittest

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import json
from unittest import mock

import pixel_lineup  # noqa: E402
from pixel_lineup import closeups, strip  # noqa: E402


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

    def test_closeups_show_each_item_4x_so_small_weapons_read_on_a_phone(self):
        # Kevin, 2026-11-24, of the Cleric mace and shield beside five heroes: "i don't see any weapons"
        mace = solid(3, 6, (0, 250, 0))
        img = closeups([('Cleric_Mace', mace)], '#ffffff:1.0,1.0', 200)
        g = self.columns(img, (0, 250, 0))
        self.assertEqual((np.ptp(g[:, 0]) + 1, np.ptp(g[:, 1]) + 1), (24, 12))
        text = (np.asarray(img)[g[:, 0].max() + 1:, :, :3].min(-1) > 200).sum()
        self.assertGreater(text, 30)  # the name is written under it

    def preview(self, groups, renders):
        d = Path(self.tmp.name, 'pv')
        for k in ('pixel', 'raw'):
            (d / k).mkdir(parents=True, exist_ok=True)
        for name, im in renders.items():
            im.save(d / 'pixel' / name)
        (d / 'sheets.json').write_text(json.dumps({g: {'sheet': '', 'models': m} for g, m in groups.items()}))
        hero = Path(self.tmp.name, 'hero.png')
        solid(10, 40, (250, 0, 0)).save(hero)
        argv = ['pixel_lineup.py', str(d), '--ground', self.tile, '--refs', str(hero), '--light', '#ffffff:1.0,1.0']
        with mock.patch('sys.argv', argv):
            pixel_lineup.main()
        return d

    def test_large_groups_wrap_after_six_items(self):
        names = [f'prop_{i}' for i in range(7)]
        renders = {f'{name}_{direction}.png': solid(8, 8, (0, 250, 0))
                   for name in names for direction in ('S', 'SW')}
        with mock.patch.object(pixel_lineup, 'strip', wraps=strip) as render_strip:
            self.preview({'props': names}, renders)
        self.assertEqual([len(call.args[0]) for call in render_strip.call_args_list], [6, 1])

    def test_props_use_the_iso_direction_not_the_front_view(self):
        # Kevin, 2026-11-24: "isometric would have them angled 45 degrees ish"; S faced walls square to the camera
        d = self.preview({'environment': ['wall']}, {'wall_S.png': solid(8, 8, (0, 250, 0)),
                                                     'wall_SW.png': solid(8, 8, (0, 0, 250))})
        img = Image.open(d / 'lineup-environment.png')
        self.assertEqual(len(self.columns(img, (0, 250, 0))), 0)
        self.assertGreater(len(self.columns(img, (0, 0, 250))), 0)

    def test_a_group_with_nothing_visible_gets_no_lineup(self):
        renders = {f'ghost_{direction}.png': Image.new('RGBA', (8, 8)) for direction in ('S', 'SW')}
        renders.update({f'wall_{direction}.png': solid(8, 8, (0, 0, 250)) for direction in ('S', 'SW')})
        with mock.patch('sys.stderr', new_callable=io.StringIO) as stderr:
            d = self.preview({'props': ['ghost'], 'environment': ['wall']}, renders)
        self.assertIn('skip group props: no visible item', stderr.getvalue())
        sheets = json.loads((d / 'sheets.json').read_text())
        self.assertFalse((d / 'lineup-props@3x.png').exists())
        self.assertNotIn('lineup_zoom', sheets['props'])
        self.assertIn('lineup_zoom', sheets['environment'])


if __name__ == '__main__':
    unittest.main()
