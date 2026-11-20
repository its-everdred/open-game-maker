"""Exercise render orchestration with synthetic Blender output."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from render_vegetation import render_variant


class RenderVegetationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.collection = json.loads((REPO / 'packages/contracts/fixtures/cards/collection-kenney-mini-dungeon.json').read_text())
        self.source = {'id': 't1:kenney-mini-dungeon/tiles/tree@2.0', 'card_type': 'asset',
                       'collection': self.collection['id']}
        self.palette = {'foliage': {'hi': [97, 136, 51], 'mid': [58, 90, 27], 'lo': [29, 53, 10]},
                        'bark': {'hi': [117, 87, 56], 'mid': [92, 65, 42], 'lo': [52, 37, 25]}}
        self.metadata = {'agent': {'backend': 'test', 'model': 'synthetic'},
                         'skills': ['gm-sprite-forge'], 'tool_versions': {'blender': 'test'}}

    def test_render_packages_four_views_and_records_parameters(self):
        commands = []
        def fake_blender(cmd, check):
            self.assertTrue(check)
            commands.append(cmd)
            raw = Path(cmd[cmd.index('--') + 2])
            for i, view in enumerate('NESW'):
                Image.new('RGBA', (256, 256), (30 + i, 80, 20, 255)).save(raw / f'tree_{view}.png')
        with patch('render_vegetation.subprocess.run', side_effect=fake_blender):
            result = render_variant('tree', self.root / 'set', 'tree-v1', self.source, self.collection,
                                    seed=42, dense=True, shadows=False, metadata=self.metadata, fanout=3,
                                    spread_min=0.3, crown_width=1.4, leaf_count=64, palette=self.palette,
                                    batch_size=3, batch_radius=0.04, yaw=45)
        self.assertEqual(len(commands), 1)
        self.assertIn('seed=42', commands[0])
        self.assertIn('yaw0=45', commands[0])
        self.assertIn('shadows=0', commands[0])
        self.assertIn('fanout=3', commands[0])
        self.assertIn('crown_width=1.4', commands[0])
        self.assertIn('leaf_count=64', commands[0])
        self.assertIn('foliage_hi_r=97', commands[0])
        self.assertIn('bark_lo_b=25', commands[0])
        self.assertIn('batch_size=3', commands[0])
        self.assertIn('batch_radius=0.04', commands[0])
        card = json.loads((result / 'tree-v1.card.json').read_text())
        recipe = json.loads((result / 'recipe.json').read_text())
        self.assertEqual(set(card['sprite']['facings']), set('NESW'))
        self.assertEqual(recipe['parameters']['seed'], 42)
        self.assertEqual(recipe['parameters']['yaw0'], 45)
        self.assertEqual(recipe['parameters']['crown_width'], 1.4)
        self.assertEqual(recipe['materials']['palette'], self.palette)
        self.assertEqual(recipe['parameters']['batch_size'], 3)
        self.assertEqual(recipe['derived_from'], self.source['id'])
        self.assertTrue(recipe['ai_generated'])
        self.assertEqual(recipe['agent'], self.metadata['agent'])
        self.assertEqual(len(recipe['rig_sha256']), 64)
        self.assertIn('vegetation_mesh.py', recipe['generator_sha256'])
        self.assertIn('finish.py', recipe['generator_sha256'])
        self.assertTrue(all(len(value) == 64 for value in recipe['generator_sha256'].values()))

    def test_plant_leaf_width_is_forwarded_and_recorded(self):
        commands = []
        def fake_blender(cmd, check):
            commands.append(cmd)
            raw = Path(cmd[cmd.index('--') + 2])
            for view in 'NESW':
                Image.new('RGBA', (256, 256), (20, 70, 10, 255)).save(raw / f'plant_{view}.png')
        with patch('render_vegetation.subprocess.run', side_effect=fake_blender):
            result = render_variant('plant', self.root / 'set', 'plant-v1', self.source, self.collection,
                                    seed=7, leafy=True, leaf_width=0.25, metadata=self.metadata)
        self.assertIn('leaf_width=0.25', commands[0])
        recipe = json.loads((result / 'recipe.json').read_text())
        self.assertEqual(recipe['parameters']['leaf_width'], 0.25)

    def test_bare_branch_width_is_forwarded_and_recorded(self):
        commands = []
        def fake_blender(cmd, check):
            commands.append(cmd)
            raw = Path(cmd[cmd.index('--') + 2])
            for view in 'NESW':
                Image.new('RGBA', (256, 256), (20, 70, 10, 255)).save(raw / f'bare_{view}.png')
        with patch('render_vegetation.subprocess.run', side_effect=fake_blender):
            result = render_variant('bare', self.root / 'set', 'bare-v1', self.source, self.collection,
                                    seed=7, branch_width=1.4, branch_radius=0.05, metadata=self.metadata)
        self.assertIn('branch_width=1.4', commands[0])
        self.assertIn('branch_radius=0.05', commands[0])
        recipe = json.loads((result / 'recipe.json').read_text())
        self.assertEqual(recipe['parameters']['branch_width'], 1.4)
        self.assertEqual(recipe['parameters']['branch_radius'], 0.05)

    def test_branched_conifer_controls_are_forwarded_and_recorded(self):
        commands = []
        def fake_blender(cmd, check):
            commands.append(cmd)
            raw = Path(cmd[cmd.index('--') + 2])
            for view in 'NESW':
                Image.new('RGBA', (256, 256), (20, 70, 10, 255)).save(raw / f'conifer_{view}.png')
        with patch('render_vegetation.subprocess.run', side_effect=fake_blender):
            result = render_variant('conifer', self.root / 'set', 'fir-v1', self.source, self.collection,
                                    seed=7, branched=True, tiers=10, spokes=6, metadata=self.metadata)
        self.assertIn('branched=1', commands[0])
        self.assertIn('tiers=10', commands[0])
        self.assertIn('spokes=6', commands[0])
        recipe = json.loads((result / 'recipe.json').read_text())
        self.assertEqual(recipe['parameters']['tiers'], 10)
        self.assertEqual(recipe['parameters']['spokes'], 6)

    def test_invalid_inputs_do_not_invoke_blender(self):
        with patch('render_vegetation.subprocess.run') as run:
            for kwargs in ({'seed': 1, 'height': 0}, {'seed': 1, 'metadata': {}},
                           {'seed': 1, 'samples': 0, 'metadata': self.metadata},
                           {'seed': 1, 'fanout': 0, 'metadata': self.metadata},
                           {'seed': 1, 'spread_max': 1, 'metadata': self.metadata},
                           {'seed': 1, 'crown_width': 0, 'metadata': self.metadata},
                           {'seed': 1, 'plant_height': 0, 'metadata': self.metadata},
                           {'seed': 1, 'leaf_width': 0, 'metadata': self.metadata},
                           {'seed': 1, 'leaf_width': 0.25, 'metadata': self.metadata},
                           {'seed': 1, 'branch_width': 1.4, 'metadata': self.metadata},
                           {'seed': 1, 'batch_size': 0, 'metadata': self.metadata},
                           {'seed': 1, 'branched': True, 'metadata': self.metadata},
                           {'seed': 1, 'tiers': 1, 'metadata': self.metadata},
                           {'seed': 1, 'spokes': 2, 'metadata': self.metadata},
                           {'seed': 1, 'batch_radius': -0.1, 'metadata': self.metadata},
                           {'seed': 1, 'leaf_shading': True, 'metadata': self.metadata},
                           {'seed': 1, 'leaves_per_cluster': 65, 'metadata': self.metadata},
                           {'seed': 1, 'palette': {'foliage': {}}, 'metadata': self.metadata},
                           {'seed': 1, 'palette': {**self.palette, 'bark': {'hi': [0, 0, 300], 'mid': [0, 0, 0], 'lo': [0, 0, 0]}}, 'metadata': self.metadata}):
                with self.assertRaises(ValueError):
                    render_variant('tree', self.root / 'set', 'tree-v1', self.source, self.collection, **kwargs)
            with self.assertRaises(ValueError):
                render_variant('tree', self.root / 'packs' / 'source', 'tree-v1', self.source,
                               self.collection, seed=1, metadata=self.metadata)
            for scene, options in [('tree', {'leafy': True}), ('plant', {'dense': True})]:
                with self.subTest(scene=scene), self.assertRaises(ValueError):
                    render_variant(scene, self.root / 'set', 'test-v1', self.source,
                                   self.collection, seed=1, metadata=self.metadata, **options)
            run.assert_not_called()


if __name__ == '__main__':
    unittest.main()
