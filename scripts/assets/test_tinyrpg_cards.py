"""Synthetic Tiny RPG character sheet grouping tests."""
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import tinyrpg_cards
from test_smallscaleint import png


class Cards(unittest.TestCase):
    def test_groups_actions_and_shadow_variants_per_character(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for directory in ('Knight', 'Knight with shadows'):
                for action, frames in (('Idle', 4), ('Walk', 6)):
                    path = root / 'Characters(100x100 split)' / 'Knight' / directory / f'Knight_{action}.png'
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(png(100 * frames, 100))
            cards = tinyrpg_cards.build_cards(root, {'id': 't1:tiny-test@1', 'schema': 'ogm.asset-card/1.0', 'vocab': '2026-10-27'})
            self.assertEqual(len(cards), 1)
            animations = cards[0]['sprite']['animations']
            self.assertEqual([len(a['frames']) for a in animations], [4, 6])
            self.assertEqual([s['variant'] for s in animations[0]['sheets']], ['shadowless', 'shadow'])

    def test_projectile_duplicates_are_one_card_with_alternate_size(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for directory in ('Arrow(Projectile)', 'Characters(100x100 split)/Knight/Arrow(projectile)'):
                for size in (32, 100):
                    path = root / directory / f'Arrow01({size}x{size}).png'
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(png(size, size))
            cards = tinyrpg_cards.build_cards(root, {'id': 't1:tiny-test@1', 'schema': 'ogm.asset-card/1.0', 'vocab': '2026-10-27'})
            self.assertEqual(len(cards), 1)
            self.assertEqual(cards[0]['image']['width_px'], 32)
            self.assertEqual(len(cards[0]['source']['files']), 2)


if __name__ == '__main__':
    unittest.main()
