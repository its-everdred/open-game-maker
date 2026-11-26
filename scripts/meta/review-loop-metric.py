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
                        if isinstance(item, dict):
                            key = (source, game, str(item["id"]))
                            published[key] = (str(item["ticket"]), timestamp)
                    continue
                if row.get("event") != "feed_refresh":
                    continue
                for item in items:
                    if not isinstance(item, dict):
                        continue
                    key = (source, game, str(item["id"]))
                    refreshes.setdefault(key, []).append(timestamp)
            except (KeyError, TypeError, ValueError, json.JSONDecodeError):
                continue
    observations = []
    for key, (ticket, posted) in published.items():
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
            "SELECT count(*) FROM review_rounds WHERE verdict IS NOT NULL AND julianday(verdict_at) >= julianday(?)",
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
            "WHERE julianday(at) >= julianday(?) GROUP BY game_id, decision_id)",
            (cutoff.isoformat(),),
        ).fetchone()
    return int(row[0])


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
        default=Path(os.environ.get("OGM_DATA_DIR", Path.home() / ".local/share/ogm/data")) / "ogm.sqlite3",
        help="API SQLite database (defaults to $OGM_DATA_DIR/ogm.sqlite3)",
    )
    args = parser.parse_args()
    if args.hours <= 0:
        parser.error("--hours must be greater than zero")
    cutoff = datetime.now(timezone.utc) - timedelta(hours=args.hours)
    try:
        answered = count_answered_rounds(args.db, cutoff)
        commands = count_answered_commands(args.db, cutoff)
    except (OSError, sqlite3.Error) as error:
        print(f"Review answers unavailable: {error}", file=sys.stderr)
        return 1
    print(f"Creator review rounds answered: {answered}; recorded Command reviews: {commands}")
    rows = read_observations(args.log, cutoff)
    if not rows:
        print("No review feed observations in the selected window.")
        return 0
    seconds = [elapsed for _, elapsed in rows]
    print(f"S6 first feed refresh: {len(rows)} rounds; median {statistics.median(seconds):.1f}s; worst {max(seconds):.1f}s")
    if args.rows:
        for ticket, elapsed in rows:
            print(f"ticket {ticket}: {elapsed:.1f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
