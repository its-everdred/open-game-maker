import json
from pathlib import Path
import tempfile
import threading
import unittest

import collector


def record(out, value):
    out.write(json.dumps(value) + '\n')


class CollectorTest(unittest.TestCase):
    def test_incremental_turns_and_restart(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / 'rollout.jsonl'
            with path.open('w') as f:
                record(f, {'type': 'session_meta', 'payload': {'cwd': '/x/.aiur/w/example/open-games/286'}})
                record(f, {'type': 'turn_context', 'timestamp': '2026-11-10', 'payload': {'turn_id': 'a', 'model': 'test', 'effort': 'high'}})
                record(f, {'type': 'event_msg', 'payload': {'type': 'item_completed', 'turn_id': 'a', 'item': {'type': 'CommandExecution', 'command': 'cat .claude/skills/gm-verify/SKILL.md'}}})
                record(f, {'type': 'event_msg', 'payload': {'type': 'item_completed', 'turn_id': 'a', 'item': {'type': 'CommandExecution'}, 'started_at_ms': 100, 'completed_at_ms': 250}})
                record(f, {'type': 'token_usage_record', 'payload': {'turn_id': 'a', 'usage': {'total_tokens': 10}}})
                f.write('{"type":')
            db = collector.open_db(root / 'state.db')
            self.addCleanup(db.close)
            collector.ingest(db, path)
            collector.ingest(db, path)
            row = json.loads(db.execute('SELECT row FROM turns').fetchone()[0])
            self.assertEqual((row['repo'], row['ticket'], row['read'], row['tokens']), ('open-games', 286, ['gm-verify'], 10))
            self.assertEqual(row['tool_time_ms'], {'CommandExecution': 150})
            with path.open('a') as f:
                f.write('"event_msg","payload":{"type":"turn_aborted","turn_id":"a"}}\n')
            collector.ingest(db, path)
            row = json.loads(db.execute('SELECT row FROM turns').fetchone()[0])
            self.assertEqual((row['tokens'], row['kills_aborts']), (10, 1))
            collector.export(db, root / 'ledger.jsonl')
            self.assertEqual(json.loads((root / 'ledger.jsonl').read_text())['turn_id'], 'a')

    def test_bad_json_is_durably_reported(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / 'rollout.jsonl'
            path.write_text('broken\n')
            db = collector.open_db(root / 'state.db')
            self.addCleanup(db.close)
            collector.ingest(db, path)
            collector.ingest(db, path)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM errors').fetchone()[0], 1)
            self.assertEqual(db.execute('SELECT offset FROM sources').fetchone()[0], len('broken\n'))

    def test_concurrent_sources_merge_without_losing_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dbpath = root / 'state.db'
            collector.open_db(dbpath).close()
            paths = []
            for skill in ('first', 'second'):
                path = root / f'{skill}.jsonl'
                with path.open('w') as f:
                    record(f, {'type': 'session_meta', 'payload': {'cwd': '/x/.aiur/w/example/open-games/286'}})
                    record(f, {'type': 'turn_context', 'payload': {'turn_id': 'same'}})
                    record(f, {'role': 'command', 'body': f'cat skills/{skill}/SKILL.md'})
                paths.append(path)
            barrier = threading.Barrier(2)
            errors = []
            def run(path):
                db = collector.open_db(dbpath)
                try:
                    barrier.wait()
                    collector.ingest(db, path)
                except Exception as error:
                    errors.append(error)
                finally:
                    db.close()
            threads = [threading.Thread(target=run, args=(path,)) for path in paths]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()
            self.assertEqual(errors, [])
            db = collector.open_db(dbpath)
            self.addCleanup(db.close)
            row = json.loads(db.execute('SELECT row FROM turns').fetchone()[0])
            self.assertEqual(row['read'], ['first', 'second'])
            self.assertEqual(db.execute('SELECT count(*) FROM sources').fetchone()[0], 2)

    def test_commands_require_execution_evidence(self):
        row = collector.empty_row('open-games', 1, 't', None)
        collector.update(row, {'role': 'command', 'body': 'cat skills/gm-verify/SKILL.md'}, {})
        collector.update(row, {'role': 'command', 'body': 'python3 skills/gm-asset-variants/scripts/style-check.py'}, {})
        collector.update(row, {'role': 'command', 'body': "cat > notes <<'EOF'\npython3 skills/fake/scripts/run.py\nEOF"}, {})
        collector.update(row, {'role': 'command', 'body': "printf '%s' 'notes; python3 skills/fake/scripts/run.py'"}, {})
        collector.update(row, {'role': 'command', 'body': 'false && python3 skills/fake/scripts/run.py'}, {})
        collector.update(row, {'role': 'command', 'body': 'true || python3 skills/fake/scripts/run.py'}, {})
        collector.update(row, {'role': 'command', 'body': 'if false; then :; python3 skills/fake/scripts/run.py; fi'}, {})
        collector.update(row, {'role': 'command', 'body': 'gm look score a b'}, {})
        self.assertEqual(row['read'], ['gm-verify'])
        self.assertEqual(row['acting'], ['gm-asset-variants'])
        self.assertEqual(row['actions'], ['gm look score/judge'])

    def test_mapped_skills_exclude_inlined_skill_prose(self):
        row = collector.empty_row('open-games', 1, 't', None)
        text = '### Mapped skills (load first)\n#### `gm-verify` — mapped by label:game\nUse `--frames` inside skill text.\n### Other installed skills\n- `fake`\nUse `--frames`.'
        collector.update(row, {'type': 'response_item', 'payload': {'type': 'message', 'role': 'user', 'content': [{'type': 'input_text', 'text': text}]}}, {})
        self.assertEqual(row['mapped'], ['gm-verify'])

    def test_counts_look_calls_in_one_command(self):
        row = collector.empty_row('open-games', 1, 't', None)
        collector.observe_command(row, 'gm look score a b; gm look judge c')
        self.assertEqual(row['look_score_calls'], 2)

    def test_mirrored_sources_do_not_double_count(self):
        row = collector.empty_row('open-games', 1, 't', None)
        collector.observe_command(row, 'gm look score a b', 'rollout')
        collector.observe_command(row, 'gm look score a b', 'events')
        self.assertEqual(row['look_score_calls'], 1)
        self.assertFalse(row['look_score_complete'])
        collector.observe_command(row, 'gm look judge c', 'rollout')
        self.assertEqual(row['look_score_calls'], 2)

    def test_repeated_claude_tool_snapshot_counts_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / 'rollout.jsonl'
            call = {'type': 'assistant', 'message': {'id': 'message', 'content': [{'type': 'tool_use', 'id': 'call', 'name': 'Bash', 'input': {'command': 'gm look score a b'}}]}}
            with path.open('w') as f:
                record(f, {'type': 'user', 'promptId': 'turn', 'cwd': '/x/.aiur/w/example/open-games/285'})
                record(f, call)
                record(f, call)
            db = collector.open_db(root / 'state.db')
            self.addCleanup(db.close)
            collector.ingest(db, path)
            row = json.loads(db.execute('SELECT row FROM turns').fetchone()[0])
            self.assertEqual(row['look_score_calls'], 1)
            self.assertFalse(row['look_score_complete'])

    def test_claude_partial_snapshots_keep_later_skill_and_command(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / 'rollout.jsonl'
            def call(call_id, name, input_data):
                return {'type': 'assistant', 'message': {'content': [{'type': 'tool_use', 'id': call_id, 'name': name, 'input': input_data}]}}
            with path.open('w') as f:
                record(f, {'type': 'user', 'promptId': 'turn', 'cwd': '/x/.aiur/w/example/open-games/285'})
                record(f, call('skill', 'Skill', {}))
                record(f, call('skill', 'Skill', {'skill': 'gm-verify'}))
                record(f, call('bash', 'Bash', {}))
                record(f, call('bash', 'Bash', {'command': 'gm look judge image'}))
            db = collector.open_db(root / 'state.db')
            self.addCleanup(db.close)
            collector.ingest(db, path)
            row = json.loads(db.execute('SELECT row FROM turns').fetchone()[0])
            self.assertEqual(row['read'], ['gm-verify'])
            self.assertEqual(row['look_score_calls'], 1)

    def test_claude_skill_call_and_replaced_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / 'rollout.jsonl'
            with path.open('w') as f:
                record(f, {'type': 'user', 'promptId': 'turn', 'cwd': '/x/.aiur/w/example/open-games/285'})
                record(f, {'type': 'assistant', 'message': {'id': 'message', 'model': 'model', 'usage': {'input_tokens': 12, 'output_tokens': 2}, 'content': [{'type': 'tool_use', 'name': 'Skill', 'input': {'skill': 'gm-verify'}}]}})
            db = collector.open_db(root / 'state.db')
            self.addCleanup(db.close)
            collector.ingest(db, path)
            row = json.loads(db.execute('SELECT row FROM turns').fetchone()[0])
            self.assertEqual((row['backend'], row['read'], row['tokens']), ('claude', ['gm-verify'], 14))
            replacement = root / 'replacement'
            replacement.write_text('\n')
            replacement.replace(path)
            with self.assertRaisesRegex(ValueError, 'replaced or truncated'):
                collector.ingest(db, path)


if __name__ == '__main__':
    unittest.main()
