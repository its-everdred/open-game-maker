import unittest
import tempfile
import json
from pathlib import Path
import collector
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch
import metadata


class MetadataTest(unittest.TestCase):
    def test_reconstructs_labels_as_of_turn_not_as_of_now(self):
        snapshot = {'labels': ['role:3d'], 'observed_at': '2026-11-10T12:00:00Z', 'events': [
            {'event': 'unlabeled', 'label': 'role:visual', 'time': '2026-11-10T10:00:00Z'},
            {'event': 'labeled', 'label': 'role:3d', 'time': '2026-11-10T11:00:00Z'},
        ]}
        self.assertEqual(metadata.labels_at(snapshot, '2026-11-10T09:00:00Z'), ['role:visual'])
        self.assertEqual(metadata.labels_at(snapshot, '2026-11-10T11:30:00+00:00'), ['role:3d'])
        self.assertIsNone(metadata.labels_at(snapshot, '2026-11-10T13:00:00Z'))
        snapshot['events'].append({'event': 'unlabeled', 'label': None, 'time': '2026-11-10T11:45:00Z'})
        self.assertIsNone(metadata.labels_at(snapshot, '2026-11-10T11:30:00Z'))

    def test_fetch_returns_start_boundary_not_consumer_time(self):
        pages = SimpleNamespace(returncode=0, stdout='[[]]', stderr='')
        issue = SimpleNamespace(returncode=0, stdout=json.dumps({'updated_at': '2026-01-01T00:00:00Z', 'labels': []}), stderr='')
        before = datetime.now(timezone.utc)
        with patch.object(metadata.subprocess, 'run', side_effect=[pages, issue]):
            labels, events, boundary = metadata.github('owner', 'open-games', 1)
        after = datetime.now(timezone.utc)
        self.assertEqual((labels, events), ([], []))
        self.assertLessEqual(before, datetime.fromisoformat(boundary.replace('Z', '+00:00')))
        self.assertLessEqual(datetime.fromisoformat(boundary.replace('Z', '+00:00')), after)

    def test_export_attaches_historical_labels_with_provenance(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            db = collector.open_db(root / 'state.sqlite3')
            self.addCleanup(db.close)
            row = collector.empty_row('open-games', 285, 'turn', '2026-11-10T09:00:00Z')
            db.execute('INSERT INTO turns VALUES (?,?,?,?)', ('open-games', 285, 'turn', json.dumps(row)))
            db.commit()
            metadata.save_snapshot(db, 'open-games', 285, ['role:3d'], [
                {'event': 'labeled', 'label': 'role:3d', 'time': '2026-11-10T10:00:00Z'},
                {'event': 'unlabeled', 'label': 'role:visual', 'time': '2026-11-10T09:30:00Z'},
            ], '2026-11-10T12:00:00Z')
            collector.export(db, root / 'ledger.jsonl')
            result = json.loads((root / 'ledger.jsonl').read_text())
            self.assertEqual(result['labels'], ['role:visual'])
            self.assertEqual(result['labels_source'], 'github-label-events')


if __name__ == '__main__':
    unittest.main()
