import importlib.util
import json
import tempfile
import unittest
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


if __name__ == "__main__":
    unittest.main()
