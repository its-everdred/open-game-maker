"""Cards preserve provenance and reject incomplete or malformed sprite sets."""
import hashlib
from pathlib import Path
from io import BytesIO

from PIL import Image
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from vegetation_card import make_card


def header(width=256):
    buffer = BytesIO()
    Image.new('RGBA', (width, 256)).save(buffer, format='PNG')
    return buffer.getvalue()


class VegetationCardTest(unittest.TestCase):
    def test_card_links_all_views_and_source(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for view in 'NESW':
                (root / f'tree-v1_{view}.png').write_bytes(header())
            card = make_card(root, 'tree-v1', 't1:source/trees/a1@1')
            self.assertEqual(card['related'], [{'rel': 'derived-from', 'id': 't1:source/trees/a1@1'}])
            self.assertEqual(card['generation']['method'], 'ai')
            self.assertEqual(set(card['sprite']['facings']), set('NESW'))
            self.assertEqual(card['source']['content_hash'], 'sha256:' + hashlib.sha256(header()).hexdigest())
            with self.assertRaises(ValueError):
                make_card(root, '../tree', 't1:source/trees/a1@1')
            (root / 'tree-v1_W.png').write_bytes(header(64))
            with self.assertRaises(ValueError):
                make_card(root, 'tree-v1', 't1:source/trees/a1@1')


if __name__ == '__main__':
    unittest.main()
