#!/usr/bin/env python3
"""Import visual paths from a JSON export of issue comments.

Comment text is data. Only existing files under the review directory that have
not changed since the post are candidates; commands in comments are never run.
"""
import argparse
from datetime import datetime
import json
from pathlib import Path
import re
import sqlite3
import sys

import artifacts

PATH = re.compile(r'assets-local/review/[A-Za-z0-9_./-]+\.(?:png|jpe?g|webp|gif|mp4|webm)', re.I)
SHA = re.compile(r'\b[0-9a-f]{40}\b', re.I)
SKILLS = re.compile(r'^\s*skills(?: used)?\s*:\s*(.+)$', re.I | re.M)


def ready_line(body):
    for line in body.splitlines():
        text = line.strip().strip('*').strip()
        if re.search(r'\bnot(?:\s+yet)?\s+ready\b', text, re.I):
            continue
        if re.fullmatch(r'(?:#{1,6}\s*)?ready(?:\s*[:—–-]\s*.*)?', text, re.I):
            return text
        if re.match(r'executor:\s*', text, re.I) and re.search(r'\bready\b', text, re.I) and SHA.search(text):
            return text
    return None


def collect(db, comments, repo, ticket, asset_root):
    review = (asset_root / 'review').resolve()
    errors = []
    artifacts.ensure_schema(db)
    for comment in comments:
        body = comment.get('body') or ''
        # The current comment body can have been edited after creation.
        stamp = comment.get('updated_at') or comment.get('created_at')
        ready = ready_line(body)
        if not stamp or stamp < '2026-11-08':
            continue
        try:
            posted = datetime.fromisoformat(stamp.replace('Z', '+00:00')).timestamp()
        except ValueError:
            errors.append(f"comment {comment.get('id')}: invalid timestamp")
            continue
        match = SKILLS.search(body)
        skills = re.findall(r'[\w:-]+', match.group(1)) if match else []
        sha = SHA.search(ready) if ready else None
        for rel in sorted(set(PATH.findall(body))):
            path = (asset_root / rel.removeprefix('assets-local/')).resolve()
            if not path.is_relative_to(review) or not path.is_file():
                errors.append(f"comment {comment.get('id')}: missing {rel}")
                continue
            if path.stat().st_mtime > posted:
                errors.append(f"comment {comment.get('id')}: changed since post: {rel}")
                continue
            artifacts.record(db, repo=repo, ticket=ticket, path=path, commit=sha.group() if sha else None,
                             skills=skills, post_id=comment['id'], provenance='historical-inference', created_at=stamp, is_iteration=ready is not None)
    return errors


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--state-dir', type=Path, default=Path('assets-local/experiments/skills'))
    parser.add_argument('--asset-root', type=Path, default=Path('assets-local'))
    parser.add_argument('--repo', required=True)
    parser.add_argument('--ticket', type=int, required=True)
    parser.add_argument('comments', type=Path, help='JSON array exported from the issue comment API')
    args = parser.parse_args()
    args.state_dir.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(args.state_dir / 'state.sqlite3', timeout=300)
    errors = collect(db, json.loads(args.comments.read_text()), args.repo, args.ticket, args.asset_root)
    artifacts.export(db, args.state_dir / 'artifacts.jsonl')
    db.close()
    if errors:
        print('\n'.join(errors), file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
