#!/usr/bin/env python3
"""Incrementally discover issue-comment artifacts; never execute comment text."""
import argparse
from datetime import datetime, timedelta, timezone
import importlib.util
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
from urllib.parse import quote

import artifacts
import collector
import metadata

spec = importlib.util.spec_from_file_location('backfill_posts', Path(__file__).with_name('backfill-posts.py'))
backfill = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backfill)


def scan_ticket(db, owner, repo, ticket, asset_root):
    db.execute('CREATE TABLE IF NOT EXISTS comment_cursors (repo TEXT, ticket INTEGER, since TEXT, version INTEGER, PRIMARY KEY(repo,ticket))')
    if 'version' not in {column[1] for column in db.execute('PRAGMA table_info(comment_cursors)')}:
        db.execute('ALTER TABLE comment_cursors ADD COLUMN version INTEGER')
    db.commit()
    existing = db.execute('SELECT since,version FROM comment_cursors WHERE repo=? AND ticket=?', (repo, ticket)).fetchone()
    since = existing[0] if existing and existing[1] == 3 else '2026-11-08T00:00:00Z'
    endpoint = f'repos/{owner}/{repo}/issues/{ticket}/comments?per_page=100&since={quote(since, safe="")}'
    watermark = (datetime.now(timezone.utc) - timedelta(seconds=2)).isoformat().replace('+00:00', 'Z')
    result = subprocess.run(['gh', 'api', endpoint, '--paginate', '--slurp'], capture_output=True, text=True, timeout=120)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or f'gh exited {result.returncode}')
    comments = [comment for page in json.loads(result.stdout) for comment in page]
    errors = backfill.collect(db, comments, repo, ticket, asset_root)
    # An unresolved file must be retried; do not advance past its post.
    if not errors:
        # Everything updated after request start is replayed on the next run.
        # The overlap covers GitHub's whole-second timestamps.
        cursor = max(since, watermark)
        with db:
            db.execute('INSERT OR REPLACE INTO comment_cursors (repo,ticket,since,version) VALUES (?,?,?,?)', (repo, ticket, cursor, 3))
    return errors


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--state-dir', type=Path, default=Path('assets-local/experiments/skills'))
    parser.add_argument('--asset-root', type=Path, default=Path('assets-local'))
    parser.add_argument('--repo', choices=['open-game-maker', 'open-games'])
    parser.add_argument('--ticket', type=int)
    args = parser.parse_args()
    if bool(args.repo) != bool(args.ticket):
        parser.error('--repo and --ticket must be supplied together')
    args.state_dir.mkdir(parents=True, exist_ok=True)
    db = collector.open_db(args.state_dir / 'state.sqlite3')
    artifacts.ensure_schema(db)
    tickets = [(args.repo, args.ticket)] if args.ticket else db.execute('SELECT DISTINCT repo,ticket FROM turns ORDER BY repo,ticket').fetchall()
    owner = metadata.owner_from_remote()
    errors = []
    held = False
    for repo, ticket in tickets:
        try:
            errors.extend(f'{repo}#{ticket}: {error}' for error in scan_ticket(db, owner, repo, ticket, args.asset_root))
        except (OSError, ValueError, KeyError, RuntimeError, subprocess.TimeoutExpired) as error:
            errors.append(f'{repo}#{ticket}: {error}')
            if 'aiur: github budget hold resource=' in str(error):
                held = True
                break
    artifacts.export(db, args.state_dir / 'artifacts.jsonl')
    db.close()
    if errors:
        print('\n'.join(errors), file=sys.stderr)
        sys.exit(75 if held else 1)


if __name__ == '__main__':
    main()
