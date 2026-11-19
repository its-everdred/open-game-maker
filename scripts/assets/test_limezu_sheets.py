"""Coverage and escaping for local pixel-art contact pages."""
import sys
import hashlib
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import limezu_sheets
from test_smallscaleint import png


class Sheets(unittest.TestCase):
    def test_groups_single_files_and_builds_lineup_at_three_times_scale(self):
        with tempfile.TemporaryDirectory() as tmp:
            pack = Path(tmp) / 'pack'
            ext = pack / '1.3' / 'extracted'
            paths = ['32x32/Characters_32x32/Farmer_1_32x32.png', '32x32/Animals_32x32/Cows/Cow.png',
                     '32x32/Animals_32x32/Cats/Portraits_Cat.png',
                     '32x32/Single_Files_32x32/Crops_32x32/Tomato.png', 'Icons/Icons_32x32/Icon.png']
            for rel in paths:
                path = ext / rel
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(png(32, 32))
            outputs = limezu_sheets.write_pages(pack, ext)
            self.assertIn('lineup.html', [p.name for p in outputs])
            lineup = (pack / 'sheets' / 'lineup.html').read_text()
            self.assertIn('Farmer', lineup)
            self.assertIn('Cow', lineup)
            self.assertNotIn('Portraits Cat', lineup)
            self.assertIn('width="96" height="96"', lineup)
            self.assertIn('image-rendering:pixelated', lineup)
            self.assertTrue(any('crops' in p.name for p in outputs))
            self.assertTrue(any('icons' in p.name for p in outputs))

    def test_lineup_uses_measured_animal_frame_when_present(self):
        with tempfile.TemporaryDirectory() as tmp:
            pack = Path(tmp) / 'pack'
            ext = pack / '1.3' / 'extracted'
            rel = '32x32/Animals_32x32/Cows_32x32/Cow_32x32.png'
            path = ext / rel
            path.parent.mkdir(parents=True)
            path.write_bytes(png(768, 32))
            thumb = pack / 'sheets' / 'lineup-thumbs' / (hashlib.sha256(rel.encode()).hexdigest() + '.png')
            thumb.parent.mkdir(parents=True)
            thumb.write_bytes(png(32, 32))
            limezu_sheets.write_pages(pack, ext)
            text = (pack / 'sheets' / 'lineup.html').read_text()
            self.assertIn('lineup-thumbs/', text)
            self.assertIn('width="96" height="96"', text)


if __name__ == '__main__':
    unittest.main()
