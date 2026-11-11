import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('report', Path(__file__).with_name('experiment-report.py'))
report = importlib.util.module_from_spec(spec)
spec.loader.exec_module(report)


class ReportTest(unittest.TestCase):
    def test_report_escapes_data_and_embeds_images(self):
        with tempfile.TemporaryDirectory() as tmp:
            image = Path(tmp) / 'image.png'
            image.write_bytes(b'abc')
            turns = [{'repo': 'game<script>', 'ticket': 1, 'mapped': [], 'read': ['skill'], 'acting': [], 'tokens': 4}]
            artifacts = [{'repo': 'game<script>', 'ticket': 1, 'iteration': 1, 'snapshot': str(image), 'skills': ['skill'], 'score': {'x': 8}}]
            html = report.render(turns, artifacts)
            self.assertIn('data:image/png;base64,YWJj', html)
            self.assertIn('game&lt;script&gt;', html)
            self.assertNotIn('game<script>', html)
            self.assertIn('Iteration 1', html)

    def test_look_calls_show_partial_as_lower_bound(self):
        turns = [{'repo': 'game', 'ticket': 1, 'turn_id': 't', 'look_score_calls': 2, 'turn_fields_complete': False}]
        self.assertIn('<td>≥2</td>', report.render(turns, []))
        turns[0]['mapped'] = ['skill']
        self.assertIn('<th>skill</th><td>0</td><td>≥1</td>', report.render(turns, []))

    def test_mapped_only_turns_do_not_count_as_used_tokens(self):
        turns = [{'repo': 'game', 'ticket': 1, 'mapped': ['skill'], 'read': [], 'acting': [], 'tokens': 100}]
        html = report.render(turns, [])
        self.assertIn('<th>skill</th><td>0</td><td>1</td><td>0</td><td>Unknown</td>', html)

    def test_tier_deltas_only_compare_same_snapshot(self):
        turns = [{'repo': 'game', 'ticket': 1, 'mapped': [], 'read': ['skill'], 'acting': [], 'tokens': 4}]
        frames = [
            {'repo': 'game', 'ticket': 1, 'iteration': 1, 'target_snapshot': 'same', 'skills': [], 'score': {'tiers': {'shape': 3}}},
            {'repo': 'game', 'ticket': 1, 'iteration': 2, 'target_snapshot': 'same', 'skills': ['skill'], 'score': {'tiers': {'shape': {'score': 5}}}},
        ]
        self.assertIn('shape: +2', report.render(turns, frames))
        frames[1]['target_snapshot'] = 'different'
        self.assertNotIn('shape: +2', report.render(turns, frames))

    def test_comparison_requires_role_and_known_introduction(self):
        turns = [
            {'repo': 'game', 'ticket': 1, 'time': '2026-11-08', 'labels': ['role:visual'], 'mapped': [], 'read': ['old'], 'acting': [], 'tokens': 10},
            {'repo': 'game', 'ticket': 2, 'time': '2026-11-10', 'labels': ['role:visual'], 'mapped': [], 'read': ['new'], 'acting': [], 'tokens': 8},
        ]
        html = report.render(turns, [], [{'name': 'new', 'date_added': '2026-11-09'}])
        self.assertIn('<td>new</td><td>old</td><td>role:visual</td>', html)
        self.assertIn('No comparable observations', report.render(turns, [], [{'name': 'new', 'date_added': None}]))
        turns[1]['mapped'], turns[1]['read'] = ['new'], []
        self.assertIn('No comparable observations', report.render(turns, [], [{'name': 'new', 'date_added': '2026-11-09'}]))


if __name__ == '__main__':
    unittest.main()
