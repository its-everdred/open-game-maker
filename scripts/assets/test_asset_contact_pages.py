"""Test the generic local contact page generator."""
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import asset_contact_pages
from test_smallscaleint import png


class Pages(unittest.TestCase):
    def test_page_links_each_card_and_lists_animation_frame_counts(self):
        with tempfile.TemporaryDirectory() as tmp:
            pack = Path(tmp)
            ext = pack / '1' / 'extracted'
            source = ext / 'sprite.png'
            source.parent.mkdir(parents=True)
            source.write_bytes(png(32, 32))
            card = {'kind': 'sprite', 'title': 'Spark', 'source': {'files': [{'path': 'sprite.png'}]},
                    'sprite': {'animations': [{'name': 'idle', 'frames': [0, 1, 2]}]}}
            target = asset_contact_pages.write_page(pack, ext, [card], 'Effects')
            text = target.read_text()
            self.assertIn('Spark', text)
            self.assertIn('idle: 3 frames', text)
            self.assertIn('width="96"', text)

    def test_separate_animation_frames_are_all_visible(self):
        with tempfile.TemporaryDirectory() as tmp:
            pack = Path(tmp)
            ext = pack / '1' / 'extracted'
            ext.mkdir(parents=True)
            for name in ('one.png', 'two.png'):
                (ext / name).write_bytes(png(8, 8))
            card = {'kind': 'sprite', 'title': 'Blast', 'source': {'files': [{'path': 'one.png'}]},
                    'sprite': {'animations': [{'name': 'blast', 'frames': [0, 1], 'files': ['one.png', 'two.png']}]}}
            text = asset_contact_pages.write_page(pack, ext, [card], 'Effects').read_text()
            self.assertIn('one.png', text)
            self.assertIn('two.png', text)


if __name__ == '__main__':
    unittest.main()
