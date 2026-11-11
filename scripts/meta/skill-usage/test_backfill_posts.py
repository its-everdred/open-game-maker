import importlib.util
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('backfill', Path(__file__).with_name('backfill-posts.py'))
backfill = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backfill)


class BackfillTest(unittest.TestCase):
    def test_recognizes_explicit_checkpoint_but_not_negation(self):
        sha = 'a' * 40
        self.assertIsNotNone(backfill.ready_line(f'Executor: goo sheet ready {sha}. Sheet: assets-local/review/x.png'))
        self.assertIsNone(backfill.ready_line(f'Executor: sheet not ready {sha}.'))
        self.assertIsNone(backfill.ready_line('- work is not yet ready'))

    def test_edited_post_uses_revision_time(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            image = root / 'review' / 'still.png'
            image.parent.mkdir()
            image.write_bytes(b'image')
            os.utime(image, (1794268800, 1794268800))
            db = sqlite3.connect(root / 'state.db')
            self.addCleanup(db.close)
            comment = {'id': 3, 'created_at': '2026-11-08T00:00:00Z', 'updated_at': '2026-11-10T00:00:00Z', 'body': 'Ready\nassets-local/review/still.png'}
            self.assertEqual(backfill.collect(db, [comment], 'open-games', 285, root), [])
            row = __import__('json').loads(db.execute('SELECT row FROM artifacts').fetchone()[0])
            self.assertEqual(row['time'], comment['updated_at'])

    def test_imports_only_unchanged_local_review_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            image = root / 'review' / 'still.png'
            image.parent.mkdir()
            image.write_bytes(b'image')
            os.utime(image, (1000000000, 1000000000))
            db = sqlite3.connect(root / 'state.db')
            self.addCleanup(db.close)
            comments = [{'id': 1, 'created_at': '2026-11-10T00:00:00Z', 'body': 'Ready\nSkills: gm-verify\nassets-local/review/still.png'}]
            negated = [{'id': 2, 'created_at': '2026-11-10T00:00:00Z', 'body': 'Not ready yet: assets-local/review/still.png'}]
            self.assertEqual(backfill.collect(db, negated, 'open-games', 285, root), [])
            row = __import__('json').loads(db.execute('select row from artifacts').fetchone()[0])
            self.assertIsNone(row['iteration'])
            self.assertFalse(row['is_iteration'])
            self.assertEqual(backfill.collect(db, comments, 'open-games', 285, root), [])
            self.assertEqual(backfill.collect(db, comments, 'open-games', 285, root), [])
            self.assertEqual(db.execute('select count(*) from artifacts').fetchone()[0], 2)
            os.utime(image, (2000000000, 2000000000))
            self.assertIn('changed since post', backfill.collect(db, comments, 'open-games', 285, root)[0])


if __name__ == '__main__':
    unittest.main()
