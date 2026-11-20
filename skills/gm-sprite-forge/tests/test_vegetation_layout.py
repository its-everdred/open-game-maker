"""Behavioral tests for the seeded vegetation layout primitives."""
import math
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from vegetation_layout import branches, clustered_placements, placements


class VegetationLayoutTest(unittest.TestCase):
    def test_attachment_min_moves_seeded_branches_down_the_trunk(self):
        baseline = branches(17, levels=1, lean=0)
        lower = branches(17, levels=1, lean=0, attachment_min=0.30)
        self.assertEqual(lower, branches(17, levels=1, lean=0, attachment_min=0.30))
        self.assertEqual(baseline[0], lower[0])
        self.assertTrue(all(a.start[2] > b.start[2] for a, b in zip(baseline[1:], lower[1:])))
        with self.assertRaises(ValueError):
            branches(17, attachment_min=0.96)

    def test_branch_tree_is_seeded_and_connected(self):
        tree = branches(17, height=2, levels=3)
        self.assertEqual(tree, branches(17, height=2, levels=3))
        self.assertNotEqual(tree, branches(18, height=2, levels=3))
        self.assertEqual(len(tree), 15)
        self.assertEqual(len(branches(17, levels=2, fanout=3)), 13)
        narrow = branches(17, levels=1, spread=(0, 0))
        self.assertTrue(all(b.start[:2] == b.end[:2] for b in narrow[1:]))
        self.assertEqual(tree[0].start, (0, 0, 0))
        for child in tree[1:]:
            parents = [p for p in tree if p.depth == child.depth - 1]
            self.assertTrue(any(abs(math.dist(p.start, child.start) + math.dist(child.start, p.end)
                                    - math.dist(p.start, p.end)) < 1e-9 for p in parents))
            self.assertGreater(child.end[2], child.start[2])

    def test_placements_are_seeded_and_bounded(self):
        cluster = placements(5, 20, extent=0.3, min_scale=0.7, max_scale=0.9)
        self.assertEqual(cluster, placements(5, 20, extent=0.3, min_scale=0.7, max_scale=0.9))
        self.assertNotEqual(cluster, placements(6, 20, extent=0.3, min_scale=0.7, max_scale=0.9))
        for p in cluster:
            self.assertLessEqual(max(abs(p.x), abs(p.y)), 0.3)
            self.assertTrue(0 <= p.rotation < math.tau)
            self.assertTrue(0.7 <= p.scale <= 0.9)
        self.assertEqual(placements(1, 0), [])

    def test_grouped_scatter_is_seeded_bounded_and_keeps_batches_together(self):
        grouped = clustered_placements(9, 11, extent=0.4, batch_size=3, batch_radius=0.06)
        self.assertEqual(grouped, clustered_placements(9, 11, extent=0.4, batch_size=3, batch_radius=0.06))
        self.assertNotEqual(grouped, clustered_placements(10, 11, extent=0.4, batch_size=3, batch_radius=0.06))
        self.assertEqual(clustered_placements(9, 11, extent=0.4), placements(9, 11, extent=0.4))
        self.assertEqual(len(grouped), 11)
        for p in grouped:
            self.assertLessEqual(max(abs(p.x), abs(p.y)), 0.4)
        for start in range(0, len(grouped), 3):
            batch = grouped[start:start+3]
            for a in batch:
                for b in batch:
                    self.assertLessEqual(math.hypot(a.x-b.x, a.y-b.y), 0.120000001)
        self.assertEqual(clustered_placements(9, 0, batch_size=3), [])
        for kwargs in ({'batch_size': 0}, {'batch_radius': -1}, {'batch_radius': float('nan')}):
            with self.assertRaises(ValueError):
                clustered_placements(9, 3, **kwargs)

    def test_rejects_invalid_ranges(self):
        for kwargs in ({'height': 0}, {'lean': -1}, {'levels': 6}, {'fanout': 0},
                       {'spread': (0, 1)}, {'height': float('nan')}):
            with self.assertRaises(ValueError):
                branches(0, **kwargs)
        for kwargs in ({'count': -1}, {'count': 1, 'extent': -1},
                       {'count': 1, 'min_scale': 2, 'max_scale': 1}):
            with self.assertRaises(ValueError):
                placements(0, **kwargs)

class VegetationBlenderTest(unittest.TestCase):
    def test_shadowless_render_has_no_shadow_pixels(self):
        import subprocess
        import tempfile
        from PIL import Image
        import numpy as np
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as temp:
            for enabled in (0, 1):
                out = Path(temp) / str(enabled)
                subprocess.run(['blender', '-b', '--factory-startup', '--threads', '2',
                                '--python-exit-code', '1', '--python',
                                str(root / 'scripts/blender_iso_rig.py'), '--', 'cube', str(out),
                                'samples=1', 'views=N', f'shadows={enabled}'],
                               check=True, stdout=subprocess.DEVNULL)
                with Image.open(out / 'cube_N.png') as image:
                    pixels = np.asarray(image.convert('RGBA'))
                    alpha = pixels[..., 3]
                    shadow_pixels = int(((alpha > 0) & (alpha < 255) & (pixels[..., :3].max(axis=2) <= 8)).sum())
                if enabled:
                    self.assertGreater(shadow_pixels, 0)
                else:
                    self.assertEqual(shadow_pixels, 0)

    def test_custom_palette_changes_rendered_foliage(self):
        import subprocess
        import tempfile
        import numpy as np
        from PIL import Image
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as temp:
            dominant = []
            for name, rgb in (('red', (220, 20, 20)), ('blue', (20, 20, 220))):
                out = Path(temp) / name
                options = [f'foliage_{band}_{channel}={value}'
                           for band in ('hi', 'mid', 'lo') for channel, value in zip('rgb', rgb)]
                subprocess.run(['blender', '-b', '--factory-startup', '--threads', '2',
                                '--python-exit-code', '1', '--python',
                                str(root / 'scripts/blender_iso_rig.py'), '--', 'plant', str(out),
                                'samples=1', 'views=N', 'shadows=0', *options],
                               check=True, stdout=subprocess.DEVNULL)
                with Image.open(out / 'plant_N.png') as image:
                    pixels = np.asarray(image.convert('RGBA'))
                    dominant.append(pixels[..., :3][pixels[..., 3] == 255].mean(axis=0))
            self.assertGreater(dominant[0][0], dominant[0][2] * 2)
            self.assertGreater(dominant[1][2], dominant[1][0] * 2)

    def test_geometry_builds_in_blender(self):
        import subprocess
        root = Path(__file__).resolve().parents[1]
        subprocess.run(['blender', '-b', '--factory-startup', '--threads', '2',
                        '--python-exit-code', '1', '--python',
                        str(root / 'tests/vegetation_blender_check.py')],
                       check=True, stdout=subprocess.DEVNULL)


if __name__ == '__main__':
    unittest.main()
