import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import artifacts

spec = importlib.util.spec_from_file_location('scan_posts', Path(__file__).with_name('scan-posts.py'))
scan = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scan)


class ScanPostsTest(unittest.TestCase):
    def test_paginated_arrays_are_combined_without_slurp(self):
        db = sqlite3.connect(':memory:')
        self.addCleanup(db.close)
        artifacts.ensure_schema(db)
        reply = SimpleNamespace(returncode=0, stdout='[{"id":1}][{"id":2}]', stderr='')
        with patch.object(scan.subprocess, 'run', return_value=reply) as run, patch.object(scan.backfill, 'collect', return_value=[]) as collect:
            scan.scan_ticket(db, 'owner', 'open-games', 1, Path('.'))
        self.assertNotIn('--slurp', run.call_args.args[0])
        self.assertEqual([c['id'] for c in collect.call_args.args[1]], [1, 2])

    def test_missing_file_does_not_advance_comment_cursor(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'review').mkdir()
            db = sqlite3.connect(root / 'state.sqlite3')
            self.addCleanup(db.close)
            artifacts.ensure_schema(db)
            comment = {'id': 1, 'body': 'Ready\nassets-local/review/missing.png',
                       'created_at': '2026-11-10T00:00:00Z', 'updated_at': '2026-11-10T00:00:00Z'}
            reply = SimpleNamespace(returncode=0, stdout=json.dumps([comment]), stderr='')
            with patch.object(scan.subprocess, 'run', return_value=reply):
                errors = scan.scan_ticket(db, 'owner', 'open-games', 285, root)
            self.assertTrue(errors)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM comment_cursors').fetchone()[0], 0)
            comment['body'] = 'Ready'
            reply.stdout = json.dumps([comment])
            with patch.object(scan.subprocess, 'run', return_value=reply):
                self.assertEqual(scan.scan_ticket(db, 'owner', 'open-games', 285, root), [])
            since, version = db.execute('SELECT since,version FROM comment_cursors').fetchone()
            self.assertGreater(since, comment['updated_at'])
            self.assertEqual(version, 3)


if __name__ == '__main__':
    unittest.main()
