"""Tests for sprite-frame sequence grouping."""
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import ansimuz_effects
from test_smallscaleint import png


class Cards(unittest.TestCase):
    def test_frame_sequence_uses_natural_order_and_sheet_when_geometry_matches(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sprites = root / 'blast' / 'Sprites'
            sprites.mkdir(parents=True)
            for n in (1, 2, 10):
                (sprites / f'frame-{n}.png').write_bytes(png(8, 8))
            (sprites.parent / 'spritesheet.png').write_bytes(png(24, 8))
            cards = ansimuz_effects.build_cards(root, {'id': 't1:ansimuz-test@1', 'schema': 'ogm.asset-card/1.0', 'vocab': '2026-10-27'})
            self.assertEqual(len(cards), 1)
            self.assertEqual(cards[0]['sprite']['drawn_view'], 'none')
            animation = cards[0]['sprite']['animations'][0]
            self.assertEqual(animation['frames'], [0, 1, 2])
            self.assertEqual(animation['sheets'][0]['cols'], 3)
            files = [x['path'] for x in cards[0]['source']['files']]
            self.assertEqual(files[1:], ['blast/Sprites/frame-1.png', 'blast/Sprites/frame-2.png', 'blast/Sprites/frame-10.png'])


if __name__ == '__main__':
    unittest.main()
