"""Export synthetic renders without touching inputs or relaxing source rights."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from vegetation_export import export


class VegetationExportTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.render = self.root / 'renders'
        self.render.mkdir()
        for i, view in enumerate('NESW'):
            Image.new('RGBA', (256, 256), (30 + i, 80, 20, 255)).save(self.render / f'{view}.png')
        self.collection = json.loads((REPO / 'packages/contracts/fixtures/cards/collection-kenney-mini-dungeon.json').read_text())
        self.source = {'id': 't1:kenney-mini-dungeon/tiles/tree@1.0', 'card_type': 'asset',
                       'collection': self.collection['id']}
        self.output = self.root / 'sets' / 'smallscaleint-vegetation'

    def test_export_preserves_provenance_rights_and_sources(self):
        before = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in self.render.iterdir()}
        target = export(self.render, self.output, 'tree-v1', self.source, self.collection,
                        {'seed': 12, 'ai_generated': False, 'derived_from': 'wrong'})
        card = json.loads((target / 'tree-v1.card.json').read_text())
        recipe = json.loads((target / 'recipe.json').read_text())
        collection = json.loads((self.output / 'collection.card.json').read_text())
        self.assertEqual(card['related'][0]['id'], self.source['id'])
        self.assertEqual(card['rights'], self.collection['rights'])
        self.assertEqual(collection['rights'], self.collection['rights'])
        self.assertEqual(card['generation']['method'], 'ai')
        self.assertEqual(recipe['derived_from'], self.source['id'])
        self.assertTrue(recipe['ai_generated'])
        self.assertEqual(recipe['seed'], 12)
        for item in card['source']['files']:
            data = (self.output / item['path']).read_bytes()
            self.assertEqual(item['sha256'], 'sha256:' + hashlib.sha256(data).hexdigest())
        self.assertEqual(before, {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in self.render.iterdir()})
        with self.assertRaises(FileExistsError):
            export(self.render, self.output, 'tree-v1', self.source, self.collection, {'seed': 12})

    def test_refuses_pack_paths_bad_inputs_and_partial_output(self):
        with self.assertRaises(ValueError):
            export(self.render, self.root / 'packs' / 'source', 'tree-v1', self.source, self.collection, {'seed': 1})
        with self.assertRaises(ValueError):
            export(self.render, self.output, '../bad', self.source, self.collection, {'seed': 1})
        with self.assertRaises(ValueError):
            export(self.render, self.output, 'tree-v1', {**self.source, 'collection': 'wrong'}, self.collection, {'seed': 1})
        (self.render / 'W.png').unlink()
        with self.assertRaises(FileNotFoundError):
            export(self.render, self.output, 'tree-v1', self.source, self.collection, {'seed': 1})
        self.assertFalse((self.output / 'tree-v1').exists())
        self.assertFalse((self.output / 'collection.card.json').exists())


if __name__ == '__main__':
    unittest.main()
