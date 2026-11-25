import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('search_clip', Path(__file__).with_name('search_clip.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SearchClipTest(unittest.TestCase):
    def test_cosine_uses_both_views_and_rejects_invalid_vectors(self):
        self.assertAlmostEqual(module.score([1, 0], [[1, 0], [0, 1]]), 0.5)
        self.assertIsNone(module.score([1, 0], [[1]]))
        self.assertIsNone(module.score([1, 0], [[float('nan'), 1]]))

    def test_reads_only_matching_hash_and_confined_analysis(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            analysis = root / 'inspiration' / 'sample' / 'analysis' / 'Caves'
            analysis.mkdir(parents=True)
            data = {'map': 'Caves/one.png', 'sha256': 'abc', 'clip': {
                'model': module.MODEL, 'embeddings': [[1, 0], [0, 1]],
            }}
            (analysis / 'one.analysis.json').write_text(json.dumps(data))
            row = {'id': 'one', 'source_folder': 'inspiration/sample', 'source_file': 'maps/Caves/one.png',
                   'content_hash': 'sha256:abc'}
            self.assertEqual(module.scores(root, [row], [1, 0]), {'one': 0.5})
            self.assertEqual(module.scores(root, [{**row, 'content_hash': 'sha256:other'}], [1, 0]), {})
            self.assertEqual(module.scores(root, [{**row, 'source_file': 'maps/../Caves/one.png'}], [1, 0]), {})
            self.assertEqual(module.scores(root, [{**row, 'source_folder': 'inspiration/../sample'}], [1, 0]), {})
            (root / 'inspiration' / 'alias').symlink_to(root / 'inspiration' / 'sample', target_is_directory=True)
            self.assertEqual(module.scores(root, [{**row, 'source_folder': 'inspiration/alias'}], [1, 0]), {})


if __name__ == '__main__':
    unittest.main()
