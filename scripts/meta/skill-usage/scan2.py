#!/usr/bin/env python3
"""Collect local Aiur event logs into the same incremental turn ledger."""
import argparse
import json
import sys
import base64
from pathlib import Path
import re
import collector


def source_context(path):
    match = re.fullmatch(r'github-([A-Za-z0-9_=-]+)\.(\d+)\.agent_events\.jsonl', path.name)
    if not match:
        return None
    try:
        repo = base64.urlsafe_b64decode(match.group(1) + '===').decode().split('/')[-1].lower()
    except (ValueError, UnicodeError):
        return None
    if repo not in ('open-game-maker', 'open-game-maker-2000', 'open-games'):
        return None
    return {'repo': 'open-games' if repo == 'open-games' else 'open-game-maker', 'ticket': int(match.group(2))}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--state-dir', type=Path, default=Path('assets-local/experiments/skills'))
    parser.add_argument('--root', type=Path, default=Path.home() / '.aiur/logs')
    args = parser.parse_args()
    args.state_dir.mkdir(parents=True, exist_ok=True)
    db = collector.open_db(args.state_dir / 'state.sqlite3')
    failures = []
    for path in sorted(args.root.glob('**/*.agent_events.jsonl')):
        context = source_context(path)
        if context:
            try:
                collector.ingest(db, path, context)
            except (OSError, ValueError) as error:
                failures.append(f'{path}: {error}')
    collector.export(db, args.state_dir / 'ledger.jsonl')
    failures.extend(f'{path} at byte {offset}: {message}' for path, offset, message in db.execute('SELECT path,offset,message FROM errors ORDER BY path,offset'))
    db.close()
    if failures:
        print('\n'.join(failures), file=sys.stderr)
        raise SystemExit(1)


if __name__ == '__main__':
    main()
