"""Check the review footprint gate with deliberately different silhouettes."""
from pathlib import Path
import sys
import tempfile
import unittest
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from vegetation_footprint import compare


class FootprintTest(unittest.TestCase):
    def test_checks_bbox_and_coverage(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            def sprite(name, boxes):
                image = Image.new('RGBA', (128, 128))
                draw = ImageDraw.Draw(image)
                for box in boxes:
                    draw.rectangle(box, fill=(30, 100, 20, 255))
                path = root / name
                image.save(path)
                return path
            reference = sprite('ref.png', [(10, 10, 109, 109)])
            close = sprite('close.png', [(10, 10, 104, 104)])
            thin = sprite('thin.png', [(10, 10, 109, 19), (10, 10, 19, 109)])
            shifted = sprite('shifted.png', [(28, 10, 127, 109)])
            self.assertTrue(compare(reference, close)['pass'])
            self.assertFalse(compare(reference, thin)['pass'])
            self.assertFalse(compare(reference, shifted)['pass'])
            image = Image.open(close).convert('RGBA')
            ImageDraw.Draw(image).rectangle((20, 20, 39, 39), fill=(0, 0, 0, 100))
            image.save(close)
            self.assertFalse(compare(reference, close)['pass'])

    def test_nearly_invisible_and_dark_green_specks_are_not_ground_shadow(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            image = Image.new('RGBA', (32, 32))
            ImageDraw.Draw(image).rectangle((4, 4, 27, 27), fill=(30, 100, 20, 255))
            reference = root / 'ref.png'
            candidate = root / 'candidate.png'
            image.save(reference)
            image.putpixel((8, 8), (0, 0, 0, 1))
            image.putpixel((9, 9), (0, 8, 0, 173))
            image.save(candidate)
            result = compare(reference, candidate)
            self.assertEqual(result['candidate']['shadow'], 0)
            self.assertTrue(result['pass'])
