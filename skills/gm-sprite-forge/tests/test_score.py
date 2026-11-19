import importlib.util
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np
from PIL import Image

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
spec = importlib.util.spec_from_file_location('score', SCRIPTS / 'score.py')
score = importlib.util.module_from_spec(spec)
spec.loader.exec_module(score)


class ScoreTests(unittest.TestCase):
    def sprite(self):
        image = np.zeros((24, 24, 4), dtype=np.uint8)
        image[8:14, 8:13] = [80, 100, 120, 255]
        return image

    def test_identical_shift_and_recolour(self):
        original = self.sprite()
        result = score.compare(original, original)
        self.assertEqual((result['silhouette_iou'], result['pixel_similarity'], result['palette_distance']), (1, 1, 0))
        result = score.compare(original, score.shifted(original, -3, 0))
        self.assertEqual((result['silhouette_iou_best'], result['shift_px']), (1, [3, 0]))
        recolour = original.copy()
        recolour[8:14, 8:13, 0] += 30
        result = score.compare(original, recolour)
        self.assertEqual(result['silhouette_iou'], 1)
        self.assertGreater(result['palette_distance'], 0)

    def test_sheet_missing_frame_and_size_mismatch(self):
        image = self.sprite()
        sheet = np.concatenate([image, image, image], axis=1)
        missing = sheet.copy()
        missing[:, 24:48] = 0
        with TemporaryDirectory() as tmp:
            a, b = Path(tmp) / 'a.png', Path(tmp) / 'b.png'
            Image.fromarray(sheet).save(a)
            Image.fromarray(missing).save(b)
            result = score.score(a, b, 24)
            self.assertFalse(result['frames_match'])
            self.assertEqual([frame['column'] for frame in result['rows'][0]['frames']], [0, 1, 2])
            sheet[:, 24:48] = 0
            Image.fromarray(sheet).save(a)
            Image.fromarray(sheet).save(b)
            self.assertEqual([frame['column'] for frame in score.score(a, b, 24)['rows'][0]['frames']], [0, 2])
            Image.fromarray(image).save(b)
            with self.assertRaisesRegex(SystemExit, 'size mismatch'):
                score.score(a, b)

    def test_palette_distance_matches_reference(self):
        original = self.sprite()
        recolour = original.copy()
        recolour[8:11, 8:13, :3] = [180, 25, 45]
        self.assertAlmostEqual(score.palette_distance(original, recolour), score.sm.palette_distance(original, recolour))

    def test_inclusive_gate_boundaries_and_missing_values(self):
        gates = {'a': {'min': 0.9}, 'b': {'max': 4}, 'c': {'equals': True}}
        self.assertTrue(all(x['pass'] for x in score.gate_results({'a': .9, 'b': 4, 'c': True}, gates).values()))
        self.assertFalse(any(x['pass'] for x in score.gate_results({'a': .899, 'b': 4.001, 'c': None}, gates).values()))

    def test_shadow_only_frames_and_constant_motion(self):
        shadow = np.zeros((24, 24, 4), dtype=np.uint8)
        shadow[10:13, 9:15] = [0, 0, 0, 100]
        sheet = np.concatenate([shadow] * 4, axis=1)
        with TemporaryDirectory() as tmp:
            a, b = Path(tmp) / 'a.png', Path(tmp) / 'b.png'
            Image.fromarray(sheet).save(a)
            Image.fromarray(sheet).save(b)
            result = score.score(a, b, 24)
            self.assertEqual(result['shadow_iou'], 1)
            self.assertEqual(result['motion_corr'], 1)
            moving = sheet.copy()
            moving[:, 24:48] = score.shifted(shadow, 4, 0)
            Image.fromarray(moving).save(b)
            self.assertIsNone(score.score(a, b, 24)['motion_corr'])
            sheet[:, 24:48] = 0
            Image.fromarray(sheet).save(b)
            self.assertFalse(score.score(a, b, 24)['frames_match'])
        self.assertIsNone(score.motion_correlation([1, 1, 1], [0, 0, 0]))

    def test_shift_does_not_wrap(self):
        image = self.sprite()
        image[:, 0] = [255, 255, 255, 255]
        self.assertFalse(score.shifted(image, -1, 0)[:, -1].any())


if __name__ == '__main__':
    unittest.main()
