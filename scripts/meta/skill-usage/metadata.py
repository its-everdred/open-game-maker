#!/usr/bin/env python3
"""Capture GitHub issue label history for turns, without storing issue text."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import re
import sqlite3
import subprocess
import sys

import collector


def labels_at(snapshot, timestamp):
    try:
        at = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
        observed = datetime.fromisoformat(snapshot['observed_at'].replace('Z', '+00:00'))
    except (TypeError, AttributeError, KeyError, ValueError):
        return None
    if at.tzinfo is None or observed.tzinfo is None:
        return None
    if at > observed:
        return None
    labels = set(snapshot['labels'])
    for event in sorted(snapshot['events'], key=lambda event: event['time'], reverse=True):
        try:
            event_time = datetime.fromisoformat(event['time'].replace('Z', '+00:00'))
        except ValueError:
            return None
        if event_time.tzinfo is None:
            return None
        if event_time <= at:
            break
        if not event.get('label'):
            return None
        if event['event'] == 'labeled':
            labels.discard(event['label'])
        elif event['event'] == 'unlabeled':
            labels.add(event['label'])
    return sorted(labels)


def save_snapshot(db, repo, ticket, labels, events, observed_at):
    db.execute('''CREATE TABLE IF NOT EXISTS ticket_labels
                  (repo TEXT, ticket INTEGER, snapshot TEXT, PRIMARY KEY(repo,ticket))''')
    snapshot = {'schema_version': 3, 'labels': sorted(set(labels)), 'events': events, 'observed_at': observed_at}
    with db:
        db.execute('INSERT OR REPLACE INTO ticket_labels VALUES (?,?,?)', (repo, ticket, json.dumps(snapshot)))


def github(owner, repo, ticket):
    def get(endpoint, paginate=False):
        cmd = ['gh', 'api', endpoint]
        if paginate:
            cmd += ['--paginate', '--slurp']
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if result.returncode:
            raise RuntimeError(result.stderr.strip() or f'gh exited {result.returncode}')
        return json.loads(result.stdout)
    started = datetime.now(timezone.utc)
    pages = get(f'repos/{owner}/{repo}/issues/{ticket}/events?per_page=100', True)
    events = [{'event': item['event'], 'time': item['created_at'], 'label': (item.get('label') or {}).get('name')}
              for page in pages for item in page
              if item.get('event') in ('labeled', 'unlabeled') and item.get('created_at')]
    latest = get(f'repos/{owner}/{repo}/issues/{ticket}')
    updated = datetime.fromisoformat(latest['updated_at'].replace('Z', '+00:00'))
    if updated >= started - timedelta(seconds=2):
        raise RuntimeError('issue changed while label history was read; retry')
    return [label['name'] for label in latest['labels']], events, started.isoformat().replace('+00:00', 'Z')


def owner_from_remote():
    url = subprocess.run(['git', 'remote', 'get-url', 'origin'], capture_output=True, text=True, check=True).stdout.strip()
    match = re.search(r'github\.com[:/]([^/]+)/[^/]+?(?:\.git)?$', url)
    if not match:
        raise ValueError('origin must identify a GitHub repository')
    return match.group(1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--state-dir', type=Path, default=Path('assets-local/experiments/skills'))
    parser.add_argument('--limit', type=int, help='Maximum tickets to refresh in this invocation')
    parser.add_argument('--refresh', action='store_true', help='Refresh every ticket history')
    parser.add_argument('--repo', choices=['open-game-maker', 'open-games'])
    parser.add_argument('--ticket', type=int)
    args = parser.parse_args()
    if bool(args.repo) != bool(args.ticket):
        parser.error('--repo and --ticket must be supplied together')
    args.state_dir.mkdir(parents=True, exist_ok=True)
    db = collector.open_db(args.state_dir / 'state.sqlite3')
    db.execute('CREATE TABLE IF NOT EXISTS ticket_labels (repo TEXT, ticket INTEGER, snapshot TEXT, PRIMARY KEY(repo,ticket))')
    if args.ticket:
        tickets = [(args.repo, args.ticket)]
    else:
        tickets = []
        for repo, ticket, last in db.execute("SELECT repo,ticket,MAX(json_extract(row, '$.time')) FROM turns GROUP BY repo,ticket ORDER BY repo,ticket"):
            existing = db.execute('SELECT snapshot FROM ticket_labels WHERE repo=? AND ticket=?', (repo, ticket)).fetchone()
            if args.refresh or not existing or json.loads(existing[0]).get('schema_version', 0) < 3 or (last and last > json.loads(existing[0])['observed_at']):
                tickets.append((repo, ticket))
    if args.limit is not None:
        if args.limit < 1:
            parser.error('--limit must be positive')
        tickets = tickets[:args.limit]
    owner = owner_from_remote()
    errors = []
    held = False
    # Keep the number of in-flight read-only requests bounded. Each ticket is
    # committed independently so an interrupted backfill can resume.
    with ThreadPoolExecutor(max_workers=3) as pool:
        for start in range(0, len(tickets), 3):
            batch = tickets[start:start + 3]
            futures = [pool.submit(github, owner, repo, ticket) for repo, ticket in batch]
            for (repo, ticket), future in zip(batch, futures):
                try:
                    labels, events, observed_at = future.result()
                    save_snapshot(db, repo, ticket, labels, events, observed_at)
                except (OSError, ValueError, KeyError, RuntimeError, subprocess.TimeoutExpired) as error:
                    errors.append(f'{repo}#{ticket}: {error}')
                    held = held or 'aiur: github budget hold resource=' in str(error)
            if held:
                break
    collector.export(db, args.state_dir / 'ledger.jsonl')
    db.close()
    if errors:
        print('\n'.join(errors), file=sys.stderr)
        sys.exit(75 if held else 1)


if __name__ == '__main__':
    main()
