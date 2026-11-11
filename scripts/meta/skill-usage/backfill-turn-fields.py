#!/usr/bin/env python3
"""Replay recorded sources to repair mapped skills and look-score counts."""
import argparse
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
import tempfile
import collector


def parser_fingerprint():
    return hashlib.sha256(Path(collector.__file__).read_bytes() + Path(__file__).read_bytes()).hexdigest()


def has_relevant_records(source, limit):
    source.seek(0)
    overlap = b''
    remaining = limit
    while remaining:
        chunk = source.read(min(1024 * 1024, remaining))
        if not chunk:
            break
        data = overlap + chunk
        if b'Mapped skills (load first)' in data or b'look' in data:
            return True
        overlap = data[-32:]
        remaining -= len(chunk)
    return False


def backfill(db, allow_missing=False, replay_path=None):
    temporary = tempfile.TemporaryDirectory() if replay_path is None else None
    replay_path = Path(temporary.name) / 'replay.sqlite3' if temporary else Path(replay_path)
    replay = collector.open_db(replay_path)
    try:
        fingerprint = parser_fingerprint()
        replay.execute('CREATE TABLE IF NOT EXISTS replay_metadata (fingerprint TEXT NOT NULL)')
        saved = replay.execute('SELECT fingerprint FROM replay_metadata').fetchone()
        if saved and saved[0] != fingerprint:
            raise ValueError('replay parser changed; remove backfill-replay.sqlite3 and restart')
        if not saved:
            if replay.execute('SELECT 1 FROM sources LIMIT 1').fetchone():
                raise ValueError('unversioned replay; remove backfill-replay.sqlite3 and restart')
            replay.execute('INSERT INTO replay_metadata VALUES (?)', (fingerprint,))
            replay.commit()
        sources = db.execute('SELECT path,context,offset,device,inode,anchor FROM sources ORDER BY path').fetchall()
        current = {path: (offset, device, inode) for path, _, offset, device, inode, _ in sources}
        for path, offset, device, inode in replay.execute('SELECT path,offset,device,inode FROM sources'):
            live = current.get(path)
            if live is None or offset > live[0] or (device, inode) != live[1:]:
                raise ValueError('live checkpoints changed; remove backfill-replay.sqlite3 and restart')
        missing = []
        for path, raw_context, offset, device, inode, anchor in sources:
            if not Path(path).is_file() and allow_missing:
                missing.append(path)
                continue
            with open(path, 'rb') as source:
                stat = os.fstat(source.fileno())
                if (stat.st_dev, stat.st_ino) != (device, inode) or stat.st_size < offset or (anchor and collector.fingerprint(source, offset) != anchor):
                    raise ValueError(f'{path}: source changed before checkpoint; original ledger unchanged')
                if not has_relevant_records(source, offset):
                    continue
            context = json.loads(raw_context)
            initial = {key: context[key] for key in ('repo', 'ticket') if key in context} if path.endswith('.agent_events.jsonl') else None
            # Isolate large rollout JSON records so their memory is released per source.
            command = ('import json,sys,collector; db=collector.open_db(sys.argv[1]); '
                       'collector.ingest(db,sys.argv[2],json.loads(sys.argv[3]),end_offset=int(sys.argv[4])); db.close()')
            subprocess.run([sys.executable, '-c', command, str(replay_path), path, json.dumps(initial), str(offset)],
                           check=True, env={**os.environ, 'PYTHONPATH': str(Path(__file__).parent)})
        errors = replay.execute('SELECT path,offset,message FROM errors').fetchall()
        if errors and not allow_missing:
            raise ValueError(f'replay has {len(errors)} malformed records; original ledger unchanged')
        incomplete = bool(missing or errors)
        repaired = {(repo, ticket, turn): json.loads(row) for repo, ticket, turn, row in replay.execute('SELECT repo,ticket,turn_id,row FROM turns')}
        with db:
            db.executemany('INSERT OR IGNORE INTO observed_tool_calls VALUES (?,?)', replay.execute('SELECT path,call_id FROM observed_tool_calls'))
            for repo, ticket, turn, raw in db.execute('SELECT repo,ticket,turn_id,row FROM turns').fetchall():
                row = json.loads(raw)
                observed = repaired.get((repo, ticket, turn))
                row['mapped'] = observed['mapped'] if observed else []
                row['look_score_calls'] = observed['look_score_calls'] if observed else 0
                row['look_score_sources'] = observed.get('look_score_sources', {}) if observed else {}
                row['look_score_complete'] = not incomplete and (observed is None or observed.get('look_score_complete', False))
                row['turn_fields_complete'] = not incomplete
                db.execute('UPDATE turns SET row=? WHERE repo=? AND ticket=? AND turn_id=?', (json.dumps(row, sort_keys=True), repo, ticket, turn))
        return missing + [f'{path}:{offset}: {message}' for path, offset, message in errors]
    finally:
        replay.close()
        if temporary:
            temporary.cleanup()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state-dir', type=Path, default=Path('assets-local/experiments/skills'))
    parser.add_argument('--allow-missing', action='store_true', help='Export lower bounds when checkpointed sources are absent or malformed')
    args = parser.parse_args()
    db = collector.open_db(args.state_dir / 'state.sqlite3')
    try:
        replay_path = args.state_dir / 'backfill-replay.sqlite3'
        missing = backfill(db, args.allow_missing, replay_path)
        replay_path.unlink(missing_ok=True)
        if missing:
            print(f'Partial backfill: {len(missing)} source files or malformed records; fields are lower bounds.')
        collector.export(db, args.state_dir / 'ledger.jsonl')
    finally:
        db.close()


if __name__ == '__main__':
    main()
