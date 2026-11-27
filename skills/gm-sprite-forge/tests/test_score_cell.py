"""Checks for score_cell.empty_render (#1282 round 3): a cell whose body never entered the camera must say so.

100STYLE walk windows start metres from the origin; rendered without in_place they came out as empty frames, and the
scorer blamed the weapon mask ("rendered before the weapon was red?"), sending the next run after the wrong fix.
Needs numpy and Pillow (`gm py --`).
"""
import sys
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/motion'))
from score_cell import albedo_sheet, empty_render  # noqa: E402
from run_cells import uses_finish_c, uses_own_finish, write_recipe  # noqa: E402


def cell(frames):
    d = Path(tempfile.mkdtemp())
    for i, alpha in enumerate(frames):
        a = np.zeros((8, 8, 4), np.uint8)
        a[2:4, 2:4, 3] = alpha
        Image.fromarray(a).save(d / f'raw_1_{i}.png')
    return d


class EmptyRenderTest(unittest.TestCase):
    def test_unspecified_pixel_finish_uses_own_colour_finish(self):
        self.assertTrue(uses_finish_c({}))
        self.assertTrue(uses_own_finish({}))
        self.assertFalse(uses_finish_c({'pixel': {'colours': 14}}))
        self.assertFalse(uses_own_finish({'pixel': {'finish': 'C', 'variant': 'C1'}}))

    def test_recipe_records_the_actual_default_finish(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            (d / 'fit.json').write_text(json.dumps({'skin': {}, 'motion': {}}))
            (d / 'render.json').write_text(json.dumps({'blender': '4', 'engine': 'workbench', 'render_minutes': 1}))
            spec = {'mesh': 'body.glb', 'finish': 'base'}
            cell_spec = {'name': 'idle', 'motion': {'kind': 'pose'}}
            write_recipe(d, spec, cell_spec, {'foot_slide': {'mean_px': 0}})
            recipe = json.loads((d / 'recipe.json').read_text())
            self.assertEqual(recipe['finish'], 'own')
            self.assertEqual(recipe['pixel'], {'finish': 'C', 'variant': 'C4'})

    def test_all_frames_empty_is_reported(self):
        self.assertTrue(empty_render(cell([0, 0, 0])))

    def test_one_visible_frame_is_a_render(self):
        self.assertFalse(empty_render(cell([0, 255, 0])))

    def test_no_frames_is_not_this_error(self):
        self.assertFalse(empty_render(cell([])))

    def test_albedo_frames_follow_their_raw_sheet_cells(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            for row, col, colour in ((1, 0, (180, 90, 60)), (2, 1, (60, 90, 180))):
                Image.new('RGBA', (4, 4), (*colour, 255)).save(d / f'raw_{row}_{col}.png')
                Image.new('RGB', (4, 4), colour).save(d / f'alb_{row}_{col}.png')
            out = albedo_sheet(d, (12, 8), cell=4)
            self.assertEqual(tuple(out[4, 0]), (180, 90, 60))
            self.assertEqual(tuple(out[8, 4]), (60, 90, 180))
            (d / 'alb_2_1.png').unlink()
            with self.assertRaises(SystemExit):
                albedo_sheet(d, (12, 8), cell=4)


if __name__ == '__main__':
    unittest.main()
