"""Matrix jobs must carry the same style controls used for export."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from vegetation_matrix_parameters import matrix_parameters


class MatrixParametersTest(unittest.TestCase):
    def test_forwards_geometry_palette_and_orientation(self):
        palette = {m: {b: [12, 34, 56] for b in ('hi', 'mid', 'lo')} for m in ('foliage', 'bark')}
        params = matrix_parameters({'seed': 42, 'yaw': 45, 'dense': 1, 'leaf_count': 800,
                                    'branched': 1, 'palette': palette})
        self.assertEqual(params['yaw0'], 45)
        self.assertEqual(params['leaf_count'], 800)
        self.assertEqual(params['dense'], 1)
        self.assertEqual(params['branched'], 1)
        self.assertEqual(params['foliage_hi_g'], 34)
        with self.assertRaises(ValueError):
            matrix_parameters({'seed': 42, 'misspelled_control': 1})
