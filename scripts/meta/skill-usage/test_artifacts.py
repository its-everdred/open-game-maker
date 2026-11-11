import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

import artifacts


class ArtifactTest(unittest.TestCase):
    def test_deduplicates_and_numbers_iterations(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            image = root / 'still.png'
            image.write_bytes(b'first')
            score = root / 'score.json'
            score.write_text('{"score": 8}')
            db = sqlite3.connect(root / 'state.db')
            self.addCleanup(db.close)
            kwargs = dict(repo='open-games', ticket=285, path=image, commit='abc', skills=['gm-verify'], score=score)
            first = artifacts.record(db, **kwargs)
            self.assertEqual(artifacts.record(db, **kwargs), first)
            image.write_bytes(b'second')
            second = artifacts.record(db, **kwargs)
            self.assertEqual((first['iteration'], second['iteration']), (1, 2))
            self.assertNotEqual(first['hash'], second['hash'])
            artifacts.export(db, root / 'artifacts.jsonl')
            self.assertEqual(len((root / 'artifacts.jsonl').read_text().splitlines()), 2)
            self.assertEqual(second['score'], {'score': 8})

    def test_explicit_attribution_enriches_prior_inference(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            image = root / 'still.png'
            image.write_bytes(b'image')
            score = root / 'score.json'
            score.write_text('{"score": 8}')
            db = sqlite3.connect(root / 'state.db')
            self.addCleanup(db.close)
            base = dict(repo='game', ticket=1, path=image, post_id='post')
            prior = artifacts.record(db, **base, commit=None, skills=[], provenance='historical-inference')
            enriched = artifacts.record(db, **base, commit='abc', skills=['gm-verify'], score=score)
            self.assertEqual(enriched['iteration'], prior['iteration'])
            self.assertEqual((enriched['commit'], enriched['skills'], enriched['score']), ('abc', ['gm-verify'], {'score': 8}))
            self.assertEqual(enriched['provenance'], 'explicit')
            self.assertEqual(db.execute('SELECT count(*) FROM artifacts').fetchone()[0], 1)

    def test_edited_reference_can_become_a_ready_iteration(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            image = root / 'still.png'
            image.write_bytes(b'image')
            db = sqlite3.connect(root / 'state.db')
            self.addCleanup(db.close)
            base = dict(repo='game', ticket=1, path=image, post_id='post', skills=[], provenance='historical-inference')
            first = artifacts.record(db, **base, commit=None, is_iteration=False)
            self.assertIsNone(first['iteration'])
            base['skills'] = ['gm-verify']
            ready = artifacts.record(db, **base, commit='abc', is_iteration=True)
            self.assertEqual((ready['iteration'], ready['commit'], ready['skills']), (1, 'abc', ['gm-verify']))
            base['skills'] = ['gm-assets']
            edited = artifacts.record(db, **base, commit='abc', is_iteration=True)
            self.assertEqual(edited['skills'], ['gm-assets', 'gm-verify'])
            self.assertEqual(db.execute('SELECT count(*) FROM artifacts').fetchone()[0], 1)

    def test_migrates_original_schema_without_losing_rows(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = sqlite3.connect(Path(tmp) / 'state.db')
            self.addCleanup(db.close)
            db.execute('CREATE TABLE artifacts (repo TEXT,ticket INTEGER,iteration INTEGER,hash TEXT,path TEXT,post_id TEXT,row TEXT,PRIMARY KEY(repo,ticket,iteration))')
            db.execute('INSERT INTO artifacts VALUES (?,?,?,?,?,?,?)', ('game', 1, 1, 'hash', '/one', 'post', '{"iteration": 1}'))
            db.commit()
            artifacts.ensure_schema(db)
            db.execute('INSERT INTO artifacts VALUES (?,?,?,?,?,?,?)', ('game', 1, 1, 'hash2', '/two', 'post', '{"iteration": 1}'))
            self.assertEqual(db.execute('SELECT COUNT(*) FROM artifacts').fetchone()[0], 2)

    def test_one_post_groups_files_and_older_posts_are_ordered(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            one, two, older = root / 'one.png', root / 'two.mp4', root / 'older.png'
            for path in (one, two, older):
                path.write_bytes(path.name.encode())
            db = sqlite3.connect(root / 'state.db')
            self.addCleanup(db.close)
            common = dict(repo='open-games', ticket=285, commit='abc', skills=[])
            artifacts.record(db, **common, path=one, post_id='new', created_at='2026-11-10T10:00:00Z')
            artifacts.record(db, **common, path=two, post_id='new', created_at='2026-11-10T10:00:00Z')
            artifacts.record(db, **common, path=older, post_id='old', created_at='2026-11-09T10:00:00Z')
            rows = db.execute('SELECT post_id,iteration FROM artifacts ORDER BY post_id').fetchall()
            self.assertEqual(rows, [('new', 2), ('new', 2), ('old', 1)])


if __name__ == '__main__':
    unittest.main()
