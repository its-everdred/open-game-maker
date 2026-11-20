import json
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import review_checkpoints


class ReviewCheckpointTests(unittest.TestCase):
    def fixture_rounds(self):
        data = json.loads((Path(__file__).parent / 'fixtures/review-30-rounds.json').read_text())
        start = datetime(2026, 1, 1, tzinfo=timezone.utc)
        rounds = [review_checkpoints.Round(
            row['number'], start + timedelta(minutes=row['minute']), row['score'])
            for row in data['rounds']]
        return rounds, data['score_margin']

    def test_scripted_30_round_run_is_batched_and_commands_age_ten_minutes(self):
        rounds, margin = self.fixture_rounds()
        checkpoints = review_checkpoints.review_checkpoints(rounds, score_margin=margin)
        self.assertLessEqual(len(checkpoints), 4)
        self.assertTrue(all(right.round_number - left.round_number >= 5
                            for left, right in zip(checkpoints, checkpoints[1:])))
        self.assertTrue(all(rounds[right.round_number - 1].at - rounds[left.round_number - 1].at >= timedelta(minutes=10)
                            for left, right in zip(checkpoints, checkpoints[1:])))

    def test_never_replaces_command_younger_than_ten_minutes(self):
        start = datetime(2026, 1, 1, tzinfo=timezone.utc)
        rounds = [review_checkpoints.Round(i, start + timedelta(minutes=i), .5 + i * .1,
                                            newly_passed_gates=('prop',) if i > 1 else ())
                  for i in range(1, 8)]
        checkpoints = review_checkpoints.review_checkpoints(rounds, score_margin=.05)
        self.assertEqual(checkpoints[0].round_number, 1)
        self.assertTrue(all(rounds[b.round_number - 1].at - rounds[a.round_number - 1].at >= timedelta(minutes=10)
                            for a, b in zip(checkpoints, checkpoints[1:])))

    def test_verdict_followup_waits_for_named_change_and_compares_judged_round(self):
        start = datetime(2026, 1, 1, tzinfo=timezone.utc)
        rounds = [
            review_checkpoints.Round(1, start, .5),
            review_checkpoints.Round(2, start + timedelta(minutes=20), .5),
            review_checkpoints.Round(3, start + timedelta(minutes=32), .51,
                                     changed_note_parts=('lighting',)),
            review_checkpoints.Round(4, start + timedelta(minutes=34), .52,
                                     changed_note_parts=('small rocks',), candidates=('A', 'B', 'C', 'D')),
        ]
        rounds = review_checkpoints.apply_verdict(
            rounds, verdict_round=2, matches=False,
            note='Add color to the small rocks', changed_note_parts=('small rocks',))
        checkpoints = review_checkpoints.review_checkpoints(rounds, score_margin=1)
        self.assertEqual(len(checkpoints), 2)
        self.assertEqual(checkpoints[1].round_number, 4)
        self.assertEqual(checkpoints[1].addresses_note, 'Add color to the small rocks')
        self.assertEqual(checkpoints[1].comparison_round, 2)
        self.assertEqual(checkpoints[1].candidates, ('A', 'B', 'C'))

    def test_non_positive_score_margin_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'score_margin must be positive'):
            review_checkpoints.review_checkpoints([], score_margin=0)

    def test_matches_verdict_stops_future_commands(self):
        start = datetime(2026, 1, 1, tzinfo=timezone.utc)
        rounds = [review_checkpoints.Round(i, start + timedelta(minutes=20 * i), .5)
                  for i in range(1, 6)]
        rounds = review_checkpoints.apply_verdict(rounds, verdict_round=2, matches=True)
        checkpoints = review_checkpoints.review_checkpoints(rounds, score_margin=1)
        self.assertEqual([item.round_number for item in checkpoints], [1])


if __name__ == '__main__':
    unittest.main()
