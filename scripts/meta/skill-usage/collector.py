"""Transactional incremental turn aggregation for local rollout evidence."""
import json
import hashlib
import fcntl
import os
from pathlib import Path
import re
import sqlite3
import shlex
import tempfile
from datetime import datetime

WORKSPACE = re.compile(r'[/\\]\.aiur[/\\]w[/\\][^/\\]+[/\\]([^/\\]+)[/\\](\d+)', re.I)
SKILL_SCRIPT = re.compile(r'(?:^|[\s/\\])skills[/\\]([\w:.-]+)[/\\]scripts[/\\]', re.I)
SKILL_PATH = re.compile(r'(?:^|[\s/\\])skills[/\\]([\w:.-]+)[/\\]SKILL\.md', re.I)
def observe_command(row, command):
    # Nested commands and heredocs require a shell parser that can prove which
    # branch executed. Keep them unattributed rather than counting examples.
    if any(marker in command for marker in ('<<', '$(', '`', '\n', '&&', '||')):
        return
    try:
        lexer = shlex.shlex(command, posix=True, punctuation_chars=';&|')
        lexer.whitespace_split = True
        lexer.commenters = ''
        tokens = list(lexer)
    except ValueError:
        return
    if any(token in {'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'until', 'do', 'done', 'case', 'esac', 'select', 'function', '(', ')', '{', '}'} for token in tokens):
        return
    segments, segment = [], []
    for token in tokens + [';']:
        if token and all(char in ';&|' for char in token):
            if segment:
                segments.append(segment)
                segment = []
        else:
            segment.append(token)
    for words in segments:
        executable = Path(words[0]).name
        if executable in ('cat', 'sed', 'head', 'tail'):
            for word in words[1:]:
                add_unique(row, 'read', SKILL_PATH.findall(word))
        if executable in ('python', 'python3', 'node', 'bash', 'sh') and len(words) > 1:
            script = words[1]
            add_unique(row, 'acting', SKILL_SCRIPT.findall(script))
            if script.endswith('/style-check.py'):
                add_unique(row, 'acting', ['gm-asset-variants'])
        if words[:2] == ['gm', 'look'] and len(words) > 2 and words[2] in ('score', 'judge'):
            add_unique(row, 'actions', ['gm look score/judge'])



def workspace(value):
    match = WORKSPACE.search(value or '')
    if not match:
        return None
    name = match.group(1).lower()
    if name not in ('open-game-maker', 'open-game-maker-2000', 'open-games'):
        return None
    return ('open-games' if name == 'open-games' else 'open-game-maker', int(match.group(2)))


def empty_row(repo, ticket, turn, timestamp):
    return {'repo': repo, 'ticket': ticket, 'turn_id': turn, 'time': timestamp,
            'labels': None, 'backend': None, 'model': None, 'effort': None,
            'mapped': [], 'read': [], 'acting': [], 'actions': [], 'tool_time_ms': {},
            'tokens': None, 'images_viewed': None, 'kills_aborts': None}


def add_unique(row, key, values):
    row[key] = sorted(set(row.get(key, [])).union(values))


def update(row, record, context):
    """Extract only observations present in the record, never its prose as commands."""
    kind = record.get('type')
    if kind == 'assistant' and isinstance(record.get('message'), dict):
        message = record['message']
        row['backend'] = 'claude'
        row['model'] = message.get('model') or row['model']
        row['effort'] = record.get('effort') or row['effort']
        for item in message.get('content', []):
            if isinstance(item, dict) and item.get('type') == 'tool_use':
                update(row, {'type': 'response_item', 'payload': {'type': 'function_call', 'name': item.get('name', ''), 'arguments': json.dumps(item.get('input', {}))}}, context)
                if item.get('name') == 'Skill':
                    name = item.get('input', {}).get('skill')
                    if name:
                        add_unique(row, 'read', [name])
    if record.get('role') == 'command':
        observe_command(row, str(record.get('body') or ''))
    payload = record.get('payload') or {}
    if not isinstance(payload, dict):
        return
    typ = payload.get('type')
    labels = payload.get('labels', record.get('labels'))
    if isinstance(labels, list) and all(isinstance(label, str) for label in labels):
        row['labels'] = sorted(set(labels))
    if kind == 'turn_context':
        row['model'] = payload.get('model') or row['model']
        row['effort'] = payload.get('effort') or row['effort']
        row['backend'] = 'codex'
    if kind == 'token_usage_record':
        usage = payload.get('usage') or {}
        if isinstance(usage.get('total_tokens'), int):
            row['tokens'] = (row['tokens'] or 0) + usage['total_tokens']
    if kind == 'event_msg' and typ == 'turn_aborted':
        row['kills_aborts'] = (row['kills_aborts'] or 0) + 1
    if kind == 'event_msg' and typ == 'item_completed':
        item = payload.get('item') or {}
        start, end = payload.get('started_at_ms'), payload.get('completed_at_ms')
        category = item.get('type', 'unknown') if isinstance(item, dict) else 'unknown'
        if category == 'CommandExecution' and isinstance(item.get('command'), str):
            observe_command(row, item['command'])
        if isinstance(start, (int, float)) and isinstance(end, (int, float)) and end >= start and ('tool' in category.lower() or category == 'CommandExecution'):
            row['tool_time_ms'][category] = row['tool_time_ms'].get(category, 0) + end - start
    if kind == 'response_item' and typ in ('function_call', 'custom_tool_call', 'local_shell_call'):
        name = payload.get('name', '')
        content = str(payload.get('input') or payload.get('arguments') or '')
        if name in ('Bash', 'bash', 'local_shell_call'):
            try:
                args = json.loads(content)
            except (ValueError, TypeError):
                args = {}
            command = args.get('command') if isinstance(args, dict) else None
            if isinstance(command, str):
                observe_command(row, command)
        if 'read' in name.lower():
            add_unique(row, 'read', SKILL_PATH.findall(content))
        if name in ('view_image', 'image') or 'view_image' in content:
            row['images_viewed'] = (row['images_viewed'] or 0) + 1
    if (kind == 'response_item' and typ == 'message' and payload.get('role') == 'user') or kind == 'user':
        message_content = payload.get('content', []) if kind == 'response_item' else (record.get('message') or {}).get('content', [])
        content = json.dumps(message_content, ensure_ascii=False)
        match = re.search(r'Mapped skills \(load first\)(.*?)(?:Other installed skills|Authoritative integration branch)', content, re.I | re.S)
        if match:
            add_unique(row, 'mapped', re.findall(r'`([\w:.-]+)`', match.group(1)))


def open_db(path):
    db = sqlite3.connect(path, timeout=300)
    db.executescript('''CREATE TABLE IF NOT EXISTS sources
      (path TEXT PRIMARY KEY, device INTEGER, inode INTEGER, offset INTEGER, context TEXT);
      CREATE TABLE IF NOT EXISTS message_usage
      (path TEXT, message_id TEXT, tokens INTEGER, PRIMARY KEY(path,message_id));
      CREATE TABLE IF NOT EXISTS errors
      (path TEXT, offset INTEGER, message TEXT, PRIMARY KEY(path,offset));
      CREATE TABLE IF NOT EXISTS ticket_labels
      (repo TEXT, ticket INTEGER, snapshot TEXT, PRIMARY KEY(repo,ticket));
      CREATE TABLE IF NOT EXISTS turns
      (repo TEXT, ticket INTEGER, turn_id TEXT, row TEXT, PRIMARY KEY(repo,ticket,turn_id));''')
    columns = {column[1] for column in db.execute('PRAGMA table_info(sources)')}
    if 'anchor' not in columns:
        db.execute('ALTER TABLE sources ADD COLUMN anchor TEXT')
    return db


def fingerprint(source, offset):
    source.seek(max(0, offset - 256))
    return hashlib.sha256(source.read(min(offset, 256))).hexdigest()


def ingest(db, path, initial_context=None):
    path = str(Path(path).resolve())
    with open(path, 'rb') as source, db:
        db.execute('BEGIN IMMEDIATE')
        stat = os.fstat(source.fileno())
        saved = db.execute('SELECT device,inode,offset,context,anchor FROM sources WHERE path=?', (path,)).fetchone()
        if saved and (saved[0], saved[1]) == (stat.st_dev, stat.st_ino) and saved[2] <= stat.st_size:
            offset, context = saved[2], json.loads(saved[3])
            if saved[4] and fingerprint(source, offset) != saved[4]:
                raise ValueError(f'{path}: source changed before checkpoint; rebuild the ledger before continuing')
        elif saved:
            raise ValueError(f'{path}: source replaced or truncated; rebuild the ledger before continuing')
        else:
            offset, context = 0, dict(initial_context or {})
        source.seek(offset)
        rows = {}
        while True:
            line = source.readline()
            if not line or not line.endswith(b'\n'):
                break
            try:
                record = json.loads(line)
            except (json.JSONDecodeError, UnicodeDecodeError) as error:
                db.execute('INSERT OR REPLACE INTO errors VALUES (?,?,?)', (path, offset, str(error)))
                offset = source.tell()
                continue
            if not isinstance(record, dict):
                db.execute('INSERT OR REPLACE INTO errors VALUES (?,?,?)', (path, offset, 'JSON record is not an object'))
                offset = source.tell()
                continue
            payload = record.get('payload') or {}
            if not isinstance(payload, dict):
                payload = {}
            if record.get('cwd'):
                location = workspace(record['cwd'])
                if location:
                    context['repo'], context['ticket'] = location
            if record.get('type') == 'session_meta':
                location = workspace(payload.get('cwd', ''))
                if location:
                    context['repo'], context['ticket'] = location
            turn = payload.get('turn_id') if record.get('type') in ('turn_context', 'token_usage_record') or payload.get('type') in ('task_started', 'task_complete', 'turn_aborted', 'item_completed') else None
            if record.get('type') == 'user' and record.get('promptId'):
                turn = record['promptId']
            turn = turn or record.get('turn_id') or context.get('turn')
            if turn:
                context['turn'] = turn
            if context.get('repo') and turn:
                key = (context['repo'], context['ticket'], turn)
                if key not in rows:
                    existing = db.execute('SELECT row FROM turns WHERE repo=? AND ticket=? AND turn_id=?', key).fetchone()
                    rows[key] = json.loads(existing[0]) if existing else empty_row(*key, record.get('timestamp'))
                update(rows[key], record, context)
                if record.get('type') == 'assistant' and isinstance(record.get('message'), dict):
                    message = record['message']
                    usage = message.get('usage') or {}
                    message_id = message.get('id')
                    components = [usage.get(field, 0) for field in ('input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens')]
                    if message_id and usage and all(isinstance(value, int) and value >= 0 for value in components):
                        tokens = sum(components)
                        prior = db.execute('SELECT tokens FROM message_usage WHERE path=? AND message_id=?', (path, message_id)).fetchone()
                        old_tokens = prior[0] if prior else 0
                        tokens = max(tokens, old_tokens)
                        rows[key]['tokens'] = (rows[key]['tokens'] or 0) + tokens - old_tokens
                        db.execute('INSERT OR REPLACE INTO message_usage VALUES (?,?,?)', (path, message_id, tokens))
            offset = source.tell()
        for key, row in rows.items():
            db.execute('INSERT OR REPLACE INTO turns VALUES (?,?,?,?)', (*key, json.dumps(row, sort_keys=True)))
        anchor = fingerprint(source, offset)
        db.execute('INSERT OR REPLACE INTO sources (path,device,inode,offset,context,anchor) VALUES (?,?,?,?,?,?)', (path, stat.st_dev, stat.st_ino, offset, json.dumps(context), anchor))


def export(db, destination):
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.with_name(destination.name + '.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        with tempfile.NamedTemporaryFile(mode='w', dir=destination.parent, prefix=destination.name + '.', delete=False) as out:
            temporary = Path(out.name)
            snapshots = {(repo, ticket): json.loads(snapshot) for repo, ticket, snapshot in db.execute('SELECT repo,ticket,snapshot FROM ticket_labels')}
            from metadata import labels_at
            for repo, ticket, raw in db.execute('SELECT repo,ticket,row FROM turns ORDER BY repo,ticket,turn_id'):
                row = json.loads(raw)
                snapshot = snapshots.get((repo, ticket))
                if snapshot and snapshot.get('schema_version', 0) >= 3 and row.get('labels') is None:
                    row['labels'] = labels_at(snapshot, row.get('time'))
                    if row['labels'] is not None:
                        row['labels_source'] = 'github-label-events'
                        row['labels_observed_at'] = snapshot['observed_at']
                out.write(json.dumps(row, sort_keys=True) + '\n')
        os.replace(temporary, destination)
