import importlib.util
import json
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("review-loop-metric.py")
SPEC = importlib.util.spec_from_file_location("review_loop_metric", MODULE_PATH)
assert SPEC and SPEC.loader
METRIC = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(METRIC)


class ReviewLoopMetricTest(unittest.TestCase):
    def test_uses_first_feed_refresh_after_publish_even_if_log_writes_arrive_out_of_order(self):
        published = datetime.now(timezone.utc) - timedelta(seconds=60)
        refresh = published + timedelta(seconds=20)
        item = {"ticket": "42", "id": "round-1", "postedAt": published.isoformat()}
        rows = [
            {"timestamp": refresh.isoformat(), "event": "feed_refresh", "source": "rounds", "gameId": "g1", "items": [item]},
            {"timestamp": published.isoformat(), "event": "publish", "source": "rounds", "gameId": "g1", "items": [item]},
        ]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "review-publishes.log"
            path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
            observations = METRIC.read_observations(path, datetime.now(timezone.utc) - timedelta(hours=1))
        self.assertEqual(observations, [("42", 20.0)])

    def test_observes_command_feed_without_a_separate_publish_record(self):
        posted = datetime(2026, 11, 26, tzinfo=timezone.utc)
        refresh = posted + timedelta(seconds=20)
        item = {"ticket": "42", "id": "decision-1", "postedAt": posted.isoformat()}
        rows = [
            {"timestamp": refresh.isoformat(), "event": "feed_refresh", "source": "game_commands", "gameId": "g1", "items": [item, {"ticket": "qa-review", "id": "qa-1", "postedAt": posted.isoformat()}, {"ticket": "43", "id": "malformed", "postedAt": None}]},
        ]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "review-publishes.log"
            path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
            observations = METRIC.read_observations(path, posted - timedelta(seconds=1))
        self.assertEqual(observations, [("42", 20.0)])

    def test_counts_answered_review_cards_from_the_round_store(self):
        cutoff = datetime(2026, 11, 26, tzinfo=timezone.utc)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "ogm.sqlite3"
            with closing(sqlite3.connect(path)) as db:
                db.execute("CREATE TABLE review_rounds (id TEXT, verdict TEXT, verdict_at TEXT, ticket TEXT)")
                db.execute("CREATE TABLE command_reviews (game_id TEXT, decision_id TEXT, at TEXT, ticket TEXT)")
                db.executemany("INSERT INTO review_rounds VALUES (?, ?, ?, ?)", [
                    ("answer", "approved", "2026-11-26T01:00:00Z", "42"),
                    ("old", "needs_work", "2026-11-25T23:59:59Z", "42"),
                    ("open", None, None, "42"),
                    ("qa", "approved", "2026-11-26T01:00:00Z", "qa-review"),
                ])
                db.executemany("INSERT INTO command_reviews VALUES (?, ?, ?, ?)", [
                    ("g", "d", "2026-11-26T01:00:00Z", "42"),
                    ("g", "d", "2026-11-26T01:01:00Z", "42"),
                    ("g", "old", "2026-11-25T23:59:59Z", None),
                    ("qa", "qa-decision", "2026-11-26T01:00:00Z", "qa-review"),
                ])
                db.commit()
            self.assertEqual(METRIC.count_answered_rounds(path, cutoff), 1)
            self.assertEqual(METRIC.count_answered_commands(path, cutoff), 1)
            result = subprocess.run(
                [sys.executable, str(MODULE_PATH), "--db", str(path), "--log", str(path.parent / "empty"), "--hours", "100000"],
                capture_output=True, text=True, check=True,
            )
            self.assertIn("Creator review rounds answered: 2; recorded Command reviews: 2", result.stdout)

    def test_database_path_uses_api_configuration_and_explicit_override(self):
        with tempfile.TemporaryDirectory() as directory:
            env_dir = Path(directory)
            (env_dir / "api.env").write_text('OTHER=ignored\nOGM_DATA_DIR="/configured/data"\n', encoding="utf-8")
            self.assertEqual(METRIC.default_database(env_dir, None), Path("/configured/data/ogm.sqlite3"))
            self.assertEqual(METRIC.default_database(env_dir, "/override"), Path("/override/ogm.sqlite3"))

    def test_reports_feed_latency_even_if_answer_database_is_unavailable(self):
        now = datetime.now(timezone.utc)
        posted = now - timedelta(seconds=30)
        refreshed = now - timedelta(seconds=10)
        item = {"ticket": "42", "id": "r", "postedAt": posted.isoformat()}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            log = root / "feed.log"
            rows = [
                {"timestamp": posted.isoformat(), "event": "publish", "source": "rounds", "gameId": "g", "items": [item]},
                {"timestamp": refreshed.isoformat(), "event": "feed_refresh", "source": "rounds", "gameId": "g", "items": [item]},
            ]
            log.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
            result = subprocess.run(
                [sys.executable, str(MODULE_PATH), "--db", str(root / "missing"), "--log", str(log)],
                capture_output=True, text=True,
            )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Review answers unavailable", result.stderr)
        self.assertIn("S6 first feed refresh: 1 feed observations", result.stdout)

    def test_missing_database_is_not_reported_as_zero_answers(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(FileNotFoundError):
                METRIC.count_answered_rounds(Path(directory) / "missing.sqlite3", datetime.now(timezone.utc))


if __name__ == "__main__":
    unittest.main()
