"""Seven-column review media is complete, traceable and non-destructive."""
import json
from pathlib import Path
import sys
import tempfile
import unittest

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from vegetation_matrix_media import assemble


class VegetationMatrixMediaTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.paths = []
        for i in range(7):
            path = self.root / f'{i}.png'
            Image.new('RGBA', (256 if i != 6 else 512,) * 2, (10 + 20*i, 50, 20, 255)).save(path)
            self.paths.append(str(path))
        self.rows = [{'id': f'row-{i}', 'name': f'Row {i}', 'original': self.paths[0],
                      'variants': self.paths[1:6], 'mock': self.paths[6]} for i in range(10)]
        self.output = self.root / 'review'

    def test_seven_cells_per_row_with_individual_media_and_recipe(self):
        options = assemble({'rows': self.rows}, self.output, {'round': 1})
        self.assertEqual(len(options), 70)
        self.assertEqual([o['label'] for o in options[:7]],
                         ['Row 0 / Original', 'Row 0 / V1', 'Row 0 / V2', 'Row 0 / V3',
                          'Row 0 / V4', 'Row 0 / V5', 'Row 0 / Mock'])
        self.assertEqual(json.loads((self.output / 'options.json').read_text()), options)
        self.assertEqual(json.loads((self.output / 'recipe.json').read_text()), {'round': 1})
        for option in options:
            self.assertEqual(len(option['media']), 1)
            with Image.open(option['media'][0]['locator']) as cell:
                self.assertEqual(cell.size, (512, 512))
        self.assertEqual(Image.open(self.paths[0]).getpixel((0, 0)), (10, 50, 20, 255))
        with self.assertRaises(FileExistsError):
            assemble({'rows': self.rows}, self.output, {'round': 1})

    def test_rejects_bad_rows_duplicates_and_pack_output(self):
        with self.assertRaises(ValueError):
            assemble({'rows': self.rows[:9]}, self.output, {'round': 1})
        duplicate_rows = list(self.rows)
        duplicate_rows[-1] = {**duplicate_rows[-1], 'variants': [self.paths[1]] * 5}
        with self.assertRaisesRegex(ValueError, 'duplicate render'):
            assemble({'rows': duplicate_rows}, self.output, {'round': 1})
        self.assertFalse(self.output.exists())
        with self.assertRaises(ValueError):
            assemble({'rows': self.rows}, self.root / 'packs' / 'review', {'round': 1})
        self.assertFalse((self.root / 'packs').exists())


if __name__ == '__main__':
    unittest.main()
