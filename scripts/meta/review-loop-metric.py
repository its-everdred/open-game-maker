#!/usr/bin/env python3
"""Report recorded creator answers and review feed refresh latency."""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import statistics
import sys
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path


def read_observations(path: Path, cutoff: datetime) -> list[tuple[str, float]]:
    published: dict[tuple[str, str, str], tuple[str, datetime]] = {}
    refreshes: dict[tuple[str, str, str], list[datetime]] = {}
    feed_posts: dict[tuple[str, str, str], tuple[str, datetime]] = {}
    if not path.exists():
        return []
    with path.open(encoding="utf-8") as stream:
        for line in stream:
            try:
                row = json.loads(line)
                timestamp = datetime.fromisoformat(row["timestamp"].replace("Z", "+00:00"))
                if timestamp < cutoff:
                    continue
                source = str(row["source"])
                game = str(row["gameId"])
                items = row.get("items", [])
                if not isinstance(items, list):
                    continue
                if row.get("event") == "publish":
                    for item in items:
                        if isinstance(item, dict) and item.get("ticket") != "qa-review":
                            key = (source, game, str(item["id"]))
                            published[key] = (str(item["ticket"]), timestamp)
                    continue
                if row.get("event") != "feed_refresh":
                    continue
                for item in items:
                    if not isinstance(item, dict) or item.get("ticket") == "qa-review":
                        continue
                    key = (source, game, str(item["id"]))
                    refreshes.setdefault(key, []).append(timestamp)
                    try:
                        posted = datetime.fromisoformat(item["postedAt"].replace("Z", "+00:00"))
                        if posted.tzinfo is not None and cutoff <= posted <= timestamp:
                            feed_posts.setdefault(key, (str(item["ticket"]), posted))
                    except (KeyError, TypeError, ValueError):
                        pass
            except (KeyError, TypeError, ValueError, json.JSONDecodeError):
                continue
    observations = []
    # Round publish events remain authoritative where available. Command feeds
    # have no publish event, so use the original timestamp in the visible card.
    for key, (ticket, posted) in (feed_posts | published).items():
        first_refresh = min((timestamp for timestamp in refreshes.get(key, []) if timestamp >= posted), default=None)
        if first_refresh is not None:
            observations.append((ticket, (first_refresh - posted).total_seconds()))
    return observations


def count_answered_rounds(path: Path, cutoff: datetime) -> int:
    """Read the same durable rounds that back the creator review feed."""
    if not path.is_file():
        raise FileNotFoundError(path)
    with closing(sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)) as db:
        row = db.execute(
            "SELECT count(*) FROM review_rounds WHERE verdict IS NOT NULL AND ticket <> 'qa-review' "
            "AND julianday(verdict_at) >= julianday(?)",
            (cutoff.isoformat(),),
        ).fetchone()
    return int(row[0])


def count_answered_commands(path: Path, cutoff: datetime) -> int:
    """Count distinct recorded Command reviews, keeping them separate from rounds."""
    if not path.is_file():
        raise FileNotFoundError(path)
    with closing(sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)) as db:
        row = db.execute(
            "SELECT count(*) FROM (SELECT game_id, decision_id FROM command_reviews "
            "WHERE coalesce(ticket, '') <> 'qa-review' AND julianday(at) >= julianday(?) "
            "GROUP BY game_id, decision_id)",
            (cutoff.isoformat(),),
        ).fetchone()
    return int(row[0])


def default_database(env_dir: Path, data_dir: str | None) -> Path:
    if not data_dir:
        try:
            for line in (env_dir / "api.env").read_text(encoding="utf-8").splitlines():
                key, separator, value = line.partition("=")
                if separator and key.strip() == "OGM_DATA_DIR":
                    data_dir = value.strip().strip('"').strip("'")
        except FileNotFoundError:
            pass
    return Path(data_dir or "~/.local/share/ogm/data").expanduser() / "ogm.sqlite3"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hours", type=float, default=24)
    parser.add_argument("--rows", action="store_true", help="print individual round observations")
    parser.add_argument(
        "--log",
        type=Path,
        default=Path.home() / ".local/state/ogm/review-publishes.log",
        help="feed log path (defaults to ~/.local/state/ogm/review-publishes.log)",
    )
    parser.add_argument(
        "--db",
        type=Path,
        help="API SQLite database (defaults to OGM_DATA_DIR from the environment or API env file)",
    )
    args = parser.parse_args()
    if args.hours <= 0:
        parser.error("--hours must be greater than zero")
    cutoff = datetime.now(timezone.utc) - timedelta(hours=args.hours)
    answer_status = 0
    try:
        database = args.db or default_database(
            Path(os.environ.get("OGM_ENV_DIR", "~/.config/ogm/env")).expanduser(), os.environ.get("OGM_DATA_DIR")
        )
        answered = count_answered_rounds(database, cutoff)
        commands = count_answered_commands(database, cutoff)
    except (OSError, sqlite3.Error) as error:
        print(f"Review answers unavailable: {error}", file=sys.stderr)
        answer_status = 1
    else:
        print(f"Creator review rounds answered: {answered}; recorded Command reviews: {commands}")
    rows = read_observations(args.log, cutoff)
    if not rows:
        print("No review feed observations in the selected window.")
        return answer_status
    seconds = [elapsed for _, elapsed in rows]
    print(f"S6 first feed refresh: {len(rows)} feed observations; median {statistics.median(seconds):.1f}s; worst {max(seconds):.1f}s")
    if args.rows:
        for ticket, elapsed in rows:
            print(f"ticket {ticket}: {elapsed:.1f}s")
    return answer_status


if __name__ == "__main__":
    raise SystemExit(main())
