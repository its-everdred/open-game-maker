#!/usr/bin/env python3
"""Record explicitly attributed local visual artifacts, without uploading them."""
import argparse
from datetime import datetime, timezone
import hashlib
import fcntl
import json
import os
from pathlib import Path
import sqlite3
import tempfile


def ensure_schema(db):
    columns = db.execute('PRAGMA table_info(artifacts)').fetchall()
    if columns and any(col[1] == 'iteration' and col[5] for col in columns):
        # Preserve existing local ledgers while allowing multiple files per post.
        with db:
            db.execute('ALTER TABLE artifacts RENAME TO artifacts_old')
            _create_schema(db)
            db.execute('INSERT INTO artifacts SELECT * FROM artifacts_old')
            db.execute('DROP TABLE artifacts_old')
    else:
        _create_schema(db)


def _create_schema(db):
    db.execute("""CREATE TABLE IF NOT EXISTS artifacts
       (repo TEXT, ticket INTEGER, iteration INTEGER, hash TEXT, path TEXT, post_id TEXT, row TEXT,
        PRIMARY KEY(repo,ticket,path,hash,post_id))""")


def renumber(db, repo, ticket):
    entries = db.execute('SELECT path,hash,post_id,row FROM artifacts WHERE repo=? AND ticket=?', (repo, ticket)).fetchall()
    groups = {}
    for _, _, post_id, raw in entries:
        item = json.loads(raw)
        if not item.get('is_iteration', True):
            continue
        try:
            timestamp = datetime.fromisoformat(item['time'].replace('Z', '+00:00')).timestamp()
        except (KeyError, TypeError, ValueError):
            timestamp = float('inf')
        groups[post_id] = min(groups.get(post_id, float('inf')), timestamp)
    order = {post_id: i for i, post_id in enumerate(sorted(groups, key=lambda value: (groups[value], value)), 1)}
    for path, digest, post_id, raw in entries:
        item = json.loads(raw)
        item['iteration'] = order.get(post_id) if item.get('is_iteration', True) else None
        db.execute('UPDATE artifacts SET iteration=?, row=? WHERE repo=? AND ticket=? AND path=? AND hash=? AND post_id=?',
                   (item['iteration'], json.dumps(item), repo, ticket, path, digest, post_id))


def snapshot_file(path, snapshot_dir):
    path = Path(path).resolve(strict=True)
    if not path.is_file():
        raise ValueError('artifact must be a file')
    snapshot_dir.mkdir(parents=True, exist_ok=True)
    hasher = hashlib.sha256()
    before = path.stat()
    with tempfile.NamedTemporaryFile(dir=snapshot_dir, delete=False) as temp:
        temporary = Path(temp.name)
        try:
            with path.open('rb') as source:
                for chunk in iter(lambda: source.read(1024 * 1024), b''):
                    hasher.update(chunk)
                    temp.write(chunk)
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise
    after = path.stat()
    if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns):
        temporary.unlink(missing_ok=True)
        raise ValueError('artifact changed while being recorded')
    digest = hasher.hexdigest()
    snapshot = snapshot_dir / (digest + path.suffix.lower())
    os.replace(temporary, snapshot)
    return path, snapshot, digest


def record(db, *, repo, ticket, path, commit, skills, target=None, score=None, post_id=None, provenance='explicit', turn_id=None, created_at=None, is_iteration=True):
    database = Path(db.execute('PRAGMA database_list').fetchone()[2])
    snapshot_dir = database.parent / 'artifact-files'
    path, snapshot, digest = snapshot_file(path, snapshot_dir)
    target_path, target_snapshot = None, None
    if target:
        target_path, target_snapshot, _ = snapshot_file(target, snapshot_dir)
    score_data = json.loads(Path(score).read_text()) if score else None
    post_id = str(post_id or f'{commit or "unknown"}:{digest}')
    ensure_schema(db)
    with db:
        db.execute('BEGIN IMMEDIATE')
        existing = db.execute('SELECT row FROM artifacts WHERE repo=? AND ticket=? AND path=? AND hash=? AND post_id=?',
                              (repo, ticket, str(path), digest, post_id)).fetchone()
        if existing:
            prior = json.loads(existing[0])
            if provenance == 'explicit':
                prior['provenance'] = 'explicit'
                prior['is_iteration'] = True
                prior['skills'] = sorted(set(prior.get('skills', [])) | set(skills))
                for key, value in {'commit': commit, 'turn_id': turn_id,
                                   'target': str(target_path) if target_path else None,
                                   'target_snapshot': str(target_snapshot) if target_snapshot else None,
                                   'score': score_data,
                                   'score_path': str(Path(score).resolve(strict=True)) if score else None}.items():
                    if value is not None:
                        prior[key] = value
                db.execute('UPDATE artifacts SET row=? WHERE repo=? AND ticket=? AND path=? AND hash=? AND post_id=?',
                           (json.dumps(prior), repo, ticket, str(path), digest, post_id))
                renumber(db, repo, ticket)
                prior = json.loads(db.execute('SELECT row FROM artifacts WHERE repo=? AND ticket=? AND path=? AND hash=? AND post_id=?', (repo, ticket, str(path), digest, post_id)).fetchone()[0])
            elif prior.get('provenance') != 'explicit':
                if created_at:
                    prior['time'] = created_at
                prior['is_iteration'] = is_iteration or prior.get('is_iteration', True)
                prior['skills'] = sorted(set(prior.get('skills', [])) | set(skills))
                if commit and not prior.get('commit'):
                    prior['commit'] = commit
                db.execute('UPDATE artifacts SET row=? WHERE repo=? AND ticket=? AND path=? AND hash=? AND post_id=?',
                           (json.dumps(prior), repo, ticket, str(path), digest, post_id))
                renumber(db, repo, ticket)
                prior = json.loads(db.execute('SELECT row FROM artifacts WHERE repo=? AND ticket=? AND path=? AND hash=? AND post_id=?', (repo, ticket, str(path), digest, post_id)).fetchone()[0])
            return prior
        iteration = 0
        row = {'repo': repo, 'ticket': ticket, 'iteration': iteration, 'commit': commit,
               'path': str(path), 'post_id': post_id, 'provenance': provenance, 'is_iteration': is_iteration, 'turn_id': turn_id,
               'time': created_at or datetime.now(timezone.utc).isoformat(), 'snapshot': str(snapshot), 'hash': digest, 'skills': sorted(set(skills)),
               'target': str(target_path) if target_path else None, 'target_snapshot': str(target_snapshot) if target_snapshot else None,
               'score': score_data, 'score_path': str(Path(score).resolve(strict=True)) if score else None}
        db.execute('INSERT INTO artifacts VALUES (?,?,?,?,?,?,?)', (repo, ticket, iteration, digest, str(path), post_id, json.dumps(row)))
        renumber(db, repo, ticket)
        return json.loads(db.execute('SELECT row FROM artifacts WHERE repo=? AND ticket=? AND path=? AND hash=? AND post_id=?', (repo, ticket, str(path), digest, post_id)).fetchone()[0])


def export(db, destination):
    destination = Path(destination)
    with destination.with_name(destination.name + '.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        with tempfile.NamedTemporaryFile(mode='w', dir=destination.parent, prefix=destination.name + '.', delete=False) as output:
            temp = Path(output.name)
            for (row,) in db.execute('SELECT row FROM artifacts ORDER BY repo,ticket,iteration'):
                output.write(row + '\n')
        os.replace(temp, destination)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--state-dir', type=Path, default=Path('assets-local/experiments/skills'))
    parser.add_argument('--repo', required=True)
    parser.add_argument('--ticket', type=int, required=True)
    parser.add_argument('--commit', required=True)
    parser.add_argument('--post-id', required=True, help='Stable ready-post identifier for idempotent collection')
    parser.add_argument('--turn-id', help='Worker turn that produced the artifact, if known')
    parser.add_argument('--skill', action='append', default=[])
    parser.add_argument('--target')
    parser.add_argument('--score')
    parser.add_argument('paths', nargs='+')
    args = parser.parse_args()
    args.state_dir.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(args.state_dir / 'state.sqlite3', timeout=300)
    for path in args.paths:
        record(db, repo=args.repo, ticket=args.ticket, path=path, commit=args.commit,
               skills=args.skill, target=args.target, score=args.score, post_id=args.post_id, turn_id=args.turn_id)
    export(db, args.state_dir / 'artifacts.jsonl')
    db.close()


if __name__ == '__main__':
    main()
