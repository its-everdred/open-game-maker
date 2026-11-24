"""Checks for run_cells.write_recipe (#1282 round 2): the review page prints each cell's motion licence from recipe.json.

A hand-keyed `kind: pose` cell has no motion file; its motion is our own work. Its rig, though, comes from a pack, and
reading the licence off the rig path would credit the pack (or print `unknown`) for motion it never made.
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/motion'))
from run_cells import write_recipe  # noqa: E402

SCORES = {'motion_corr': 0.5, 'motion_corr_rows': [0.5, 0.5], 'phase_shift': 0, 'silhouette_iou': 0.3,
          'foot_slide': {'mean_px': 0.2}, 'render_minutes': 1.0}


def recipe(cell):
    with tempfile.TemporaryDirectory() as t:
        d = Path(t)
        (d / 'fit.json').write_text(json.dumps({'skin': {}, 'motion': {}}))
        (d / 'render.json').write_text(json.dumps({'blender': '4.3', 'engine': 'cycles', 'render_minutes': 1.0}))
        write_recipe(d, {'mesh': 'body.glb'}, cell, SCORES)
        return json.loads((d / 'recipe.json').read_text())


class RecipeTest(unittest.TestCase):
    def test_hand_keyed_pose_is_own_work_on_a_pack_rig(self):
        cell = {'name': 'P', 'motion': {'kind': 'pose', 'keys': []},
                'rigged': {'path': '/packs/quaternius-ual/rig.glb'}}
        self.assertEqual(recipe(cell)['motion_licence'], 'own work (hand-keyed script)')

    def test_a_copied_clip_takes_its_source_licence(self):
        cell = {'name': 'Q', 'motion': {'kind': 'copy', 'path': '/mocap/quaternius/walk.glb'},
                'rigged': {'path': '/gen/rig.glb'}}
        self.assertEqual(recipe(cell)['motion_licence'], 'CC0 (Quaternius Universal Animation Library)')


if __name__ == '__main__':
    unittest.main()
