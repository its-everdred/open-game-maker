import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import collector

spec = importlib.util.spec_from_file_location('backfill_turn_fields', Path(__file__).with_name('backfill-turn-fields.py'))
backfill = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backfill)


class BackfillTest(unittest.TestCase):
    def test_repairs_fields_without_losing_other_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / 'rollout.jsonl'
            records = [
                {'type': 'session_meta', 'payload': {'cwd': '/x/.aiur/w/a/open-games/1'}},
                {'type': 'turn_context', 'payload': {'turn_id': 't'}},
                {'type': 'response_item', 'payload': {'type': 'message', 'role': 'user', 'content': [{'text': '### Mapped skills (load first)\n#### `gm-verify` — mapped by label:game\n### Other installed skills\n- `bad`'}]}},
                {'role': 'command', 'body': 'gm look judge image.png'},
            ]
            source.write_text(''.join(json.dumps(record) + '\n' for record in records))
            db = collector.open_db(root / 'state.db')
            self.addCleanup(db.close)
            collector.ingest(db, source)
            row = json.loads(db.execute('SELECT row FROM turns').fetchone()[0])
            row.update(mapped=['--frames'], look_score_calls=0, tokens=99)
            db.execute('UPDATE turns SET row=?', (json.dumps(row),))
            db.commit()
            backfill.backfill(db)
            row = json.loads(db.execute('SELECT row FROM turns').fetchone()[0])
            self.assertEqual((row['mapped'], row['look_score_calls'], row['tokens']), (['gm-verify'], 1, 99))

    def test_missing_source_requires_opt_in_and_marks_lower_bound(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / 'rollout.jsonl'
            source.write_text(json.dumps({'type': 'session_meta', 'payload': {'cwd': '/x/.aiur/w/a/open-games/1'}}) + '\n' + json.dumps({'type': 'turn_context', 'payload': {'turn_id': 't'}}) + '\n')
            db = collector.open_db(root / 'state.db')
            self.addCleanup(db.close)
            collector.ingest(db, source)
            source.unlink()
            with self.assertRaises(FileNotFoundError):
                backfill.backfill(db)
            self.assertEqual(len(backfill.backfill(db, allow_missing=True)), 1)
            row = json.loads(db.execute('SELECT row FROM turns').fetchone()[0])
            self.assertFalse(row['turn_fields_complete'])

    def test_replay_preserves_call_ids_for_future_incremental_reads(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / 'rollout.jsonl'
            call = {'type': 'assistant', 'message': {'id': 'message', 'content': [{'type': 'tool_use', 'id': 'call', 'name': 'Bash', 'input': {'command': 'gm look judge image'}}]}}
            records = [{'type': 'user', 'promptId': 'turn', 'cwd': '/x/.aiur/w/a/open-games/1'}, call]
            source.write_text(''.join(json.dumps(record) + '\n' for record in records))
            db = collector.open_db(root / 'state.db')
            self.addCleanup(db.close)
            collector.ingest(db, source)
            db.execute('DELETE FROM observed_tool_calls')
            db.commit()
            replay_path = root / 'replay.db'
            backfill.backfill(db, replay_path=replay_path)
            backfill.backfill(db, replay_path=replay_path)
            with source.open('a') as f:
                f.write(json.dumps(call) + '\n')
            collector.ingest(db, source)
            row = json.loads(db.execute('SELECT row FROM turns').fetchone()[0])
            self.assertEqual(row['look_score_calls'], 1)

    def test_resume_rejects_changed_parser(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            db = collector.open_db(root / 'state.db')
            self.addCleanup(db.close)
            replay_path = root / 'replay.db'
            backfill.backfill(db, replay_path=replay_path)
            with patch.object(backfill, 'parser_fingerprint', return_value='different'):
                with self.assertRaisesRegex(ValueError, 'parser changed'):
                    backfill.backfill(db, replay_path=replay_path)

    def test_resume_rejects_rewound_live_checkpoint(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / 'rollout.jsonl'
            source.write_text(json.dumps({'type': 'session_meta', 'payload': {'cwd': '/x/.aiur/w/a/open-games/1', 'note': 'gm look'}}) + '\n')
            db = collector.open_db(root / 'state.db')
            self.addCleanup(db.close)
            collector.ingest(db, source)
            replay_path = root / 'replay.db'
            backfill.backfill(db, replay_path=replay_path)
            db.execute('UPDATE sources SET offset=0')
            db.commit()
            with self.assertRaisesRegex(ValueError, 'live checkpoints changed'):
                backfill.backfill(db, replay_path=replay_path)

    def test_malformed_records_require_opt_in_and_mark_lower_bounds(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / 'rollout.jsonl'
            source.write_text(json.dumps({'type': 'user', 'promptId': 't', 'cwd': '/x/.aiur/w/a/open-games/1', 'message': {'content': 'gm look'}}) + '\n' + '{bad}\n')
            db = collector.open_db(root / 'state.db')
            self.addCleanup(db.close)
            collector.ingest(db, source)
            with self.assertRaisesRegex(ValueError, 'malformed'):
                backfill.backfill(db)
            gaps = backfill.backfill(db, allow_missing=True)
            self.assertEqual(len(gaps), 1)
            self.assertFalse(json.loads(db.execute('SELECT row FROM turns').fetchone()[0])['turn_fields_complete'])

    def test_skipped_source_errors_still_mark_incomplete(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / 'rollout.jsonl'
            source.write_text(json.dumps({'type': 'user', 'promptId': 't', 'cwd': '/x/.aiur/w/a/open-games/1'}) + '\n{bad}\n')
            db = collector.open_db(root / 'state.db')
            self.addCleanup(db.close)
            collector.ingest(db, source)
            with self.assertRaisesRegex(ValueError, 'malformed'):
                backfill.backfill(db)
            self.assertEqual(len(backfill.backfill(db, allow_missing=True)), 1)
            self.assertFalse(json.loads(db.execute('SELECT row FROM turns').fetchone()[0])['turn_fields_complete'])

    def test_prefilter_accepts_case_insensitive_headings(self):
        from io import BytesIO
        content = b'### MAPPED SKILLS (LOAD FIRST)\n'
        self.assertTrue(backfill.has_relevant_records(BytesIO(content), len(content)))
