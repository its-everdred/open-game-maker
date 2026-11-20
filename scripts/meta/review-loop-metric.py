#!/usr/bin/env python3
"""Report the time from a review round being published to its first feed refresh."""

from __future__ import annotations

import argparse
import json
import statistics
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
    args = parser.parse_args()
    if args.hours <= 0:
        parser.error("--hours must be greater than zero")
    rows = read_observations(args.log, datetime.now(timezone.utc) - timedelta(hours=args.hours))
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
