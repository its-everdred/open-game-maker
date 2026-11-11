#!/usr/bin/env python3
"""Collect Codex rollout records into the local transactional ledger."""
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
import collector


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--state-dir', type=Path, default=Path('assets-local/experiments/skills'))
    parser.add_argument('--since', default='2026-11-08', help='Include files modified on or after this UTC date')
    parser.add_argument('--root', action='append', type=Path, help='Session directory; repeatable')
    args = parser.parse_args()
    home = Path.home()
    roots = args.root or [home / '.codex/sessions', home / '.config/ogm/codex-gamebuilder/sessions', home / '.aiur/accounts/codex']
    args.state_dir.mkdir(parents=True, exist_ok=True)
    db = collector.open_db(args.state_dir / 'state.sqlite3')
    cutoff = datetime.fromisoformat(args.since).replace(tzinfo=timezone.utc).timestamp()
    seen = set()
    failures = []
    for root in roots:
        if root.is_dir():
            for path in sorted(root.glob('**/rollout-*.jsonl')):
                resolved = path.resolve()
                if resolved not in seen and path.stat().st_mtime >= cutoff:
                    seen.add(resolved)
                    try:
                        collector.ingest(db, path)
                    except (OSError, ValueError) as error:
                        failures.append(f'{path}: {error}')
    for claude in (() if args.root else (home / '.claude/projects', home / '.claude-2/projects')):
        if claude.is_dir():
            for path in sorted(claude.glob('*aiur-w-*/*/*.jsonl')) + sorted(claude.glob('*aiur-w-*/*.jsonl')):
                if path.stat().st_mtime >= cutoff:
                    try:
                        collector.ingest(db, path)
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
