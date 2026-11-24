#!/usr/bin/env python3
"""Hourly retro check: agents expecting something and finding nothing.

Scans the worker transcripts of the OGM daemon's tickets (Claude: ~/.claude/projects/*aiur-w-*; Codex:
~/.aiur/accounts/codex/gamebuilder/sessions, workers only, by session cwd under ~/.aiur/w) for gm/pnpm/aiur-main
commands whose output signals an empty or missing result ("0 of 0", "no matches", "no map index yet", "not found",
"No such file or directory", "unknown command", empty JSON from a search, a non-zero exit, `rows: 0`), groups identical
misses and prints one line each, most frequent first.  Kevin 2026-11-24: "hourly improve should involve reviewing logs
for things like agents expecting to find maps and finding none"; every `gm maps search --maps` said "0 of 0" for weeks
(core #1352).  `gm` activity events ($GM_EVENTS_FILE) have no fixed location, so their rows:0 shows up only where the
command printed it.  Never touches Kevin's daemon.  Usage: silent-misses.py [--since MINUTES=60]  Exit 0 always.
"""
import glob, json, os, re, sys, time

HOME = os.path.expanduser('~')
CMD = re.compile(r'(?:^|[\s;&|(])((?:gm|pnpm|aiur-main)\s+[^\n;&|<>]*?)(?=\s*(?:\d?>|<|\||;|&|\n|$))')
SECRET = re.compile(r'(sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{8,}|eyJ[A-Za-z0-9_-]{10,}|(?:token|key|secret|password)=\S+)', re.I)
PATTERNS = [
    ('0 of 0', re.compile(r'\b0 of 0\b')),
    ('no matches', re.compile(r'\bno (?:matches|results)\b', re.I)),
    ('no map index yet', re.compile(r'no map index yet', re.I)),
    ('no such file', re.compile(r'No such file or directory')),
    ('not found', re.compile(r'\bnot found\b', re.I)),
    ('returned nothing', re.compile(r'returned nothing', re.I)),
    ('unknown command', re.compile(r'unknown command', re.I)),
    ('rows: 0', re.compile(r'"?\brows"?\s*[:=]\s*0\b')),
    ('empty result', re.compile(r'^\s*(?:\[\s*\]|\{\s*"(?:results|rows|items|matches|maps|assets)"\s*:\s*\[\s*\]\s*\})\s*$', re.M)),
]


# cheap raw-line prefilter: transcripts are GBs, so only parse lines that can matter
CALLS = ('gm ', 'pnpm ', 'aiur-main ')
KEYS = ('0 of 0', 'no matches', 'no results', 'No matches', 'No results', 'no map index', 'No such file', 'not found', 'Not found',
        'returned nothing', 'nknown command', 'rows', 'Exit code', 'exit_code', 'exited with code', '[]')


def callish(line):
    return any(k in line for k in CALLS)


def resultish(line):
    return any(k in line for k in KEYS)


def norm_cmd(c):
    toks = [t for t in c.split() if not t.startswith('--json')][:4]
    out = []
    for t in toks:
        t = SECRET.sub('<redacted>', t.strip('"\''))
        out.append('<arg>' if re.search(r'[/=.]|\d{3,}', t) and out else t)
    return ' '.join(out)[:60]


def classify(cmd, text, code):
    m = CMD.search(cmd or '')
    if not m:
        return None
    pat = norm_cmd(m.group(1))
    if pat.startswith('pnpm') and not re.search(r'\b(test|typecheck|build|install|gm)\b', pat):
        return None
    head = (text or '')[:3000]
    for name, rx in PATTERNS:
        if rx.search(head):
            return pat, name
    if code not in (None, 0):
        return pat, f'exit {code}'
    return None


def flat(o):
    if isinstance(o, str):
        return o
    if isinstance(o, list):
        return '\n'.join(flat(x) for x in o)
    if isinstance(o, dict):
        return flat(o.get('text') or o.get('content') or '')
    return ''


def record(hits, key, ticket):
    h = hits.setdefault(key, [0, set()])
    h[0] += 1
    h[1].add(ticket)


def claude(path, cutoff, hits):
    tk = re.search(r'open-(game-maker|games)-(\d+)', os.path.dirname(path))
    ticket = ('og#' if tk and tk.group(1) == 'games' else '#') + tk.group(2) if tk else 'other'
    calls = {}
    for line in open(path, errors='ignore'):
        if len(line) > 4000000 or not (('"tool_use"' in line and callish(line)) or ('"tool_result"' in line and resultish(line))):
            continue
        try:
            d = json.loads(line)
        except ValueError:
            continue
        ts = d.get('timestamp') or ''
        c = (d.get('message') or {}).get('content')
        if not isinstance(c, list):
            continue
        for b in c:
            if b.get('type') == 'tool_use' and b.get('name') == 'Bash':
                calls[b['id']] = (b.get('input') or {}).get('command', '')
            elif b.get('type') == 'tool_result' and b.get('tool_use_id') in calls:
                if ts and ts < cutoff:
                    continue
                txt = flat(b.get('content'))
                m = re.search(r'Exit code (\d+)', txt) if b.get('is_error') else None
                r = classify(calls[b['tool_use_id']], txt, int(m.group(1)) if m else None)
                if r:
                    record(hits, r, ticket)


def codex(path, cutoff, hits):
    calls = {}
    ticket = None
    for line in open(path, errors='ignore'):
        if len(line) > 4000000:
            continue
        if not ('"session_meta"' in line or ('call' in line and (callish(line) or resultish(line)))):
            continue
        try:
            d = json.loads(line)
        except ValueError:
            continue
        p = d.get('payload') or {}
        if d.get('type') == 'session_meta':
            m = re.search(r'/\.aiur/w/[^/]+/[^/]+/(\d+)', p.get('cwd', ''))
            if not m:
                return
            ticket = ('og#' if '/open-games/' in p.get('cwd', '') else '#') + m.group(1)
        elif p.get('type') in ('custom_tool_call', 'function_call'):
            calls[p.get('call_id')] = str(p.get('input') or p.get('arguments') or '')
        elif p.get('type') in ('custom_tool_call_output', 'function_call_output') and ticket:
            if (d.get('timestamp') or '') < cutoff:
                continue
            txt = flat(p.get('output'))
            m = re.search(r'"exit_code":\s*(\d+)|exited with code (\d+)', txt)
            code = int(m.group(1) or m.group(2)) if m else None
            # decode the command from the JS exec script: cmd:"..." (escaped quotes kept as is)
            cmd = ' ; '.join(re.findall(r'cmd:\s*"((?:[^"\\]|\\.)*)"', calls.get(p.get('call_id'), ''))) or calls.get(p.get('call_id'), '')
            r = classify(cmd.replace('\\"', '"'), txt, code)
            if r:
                record(hits, r, ticket)


def main():
    a = sys.argv[1:]
    since = int(a[a.index('--since') + 1]) if '--since' in a else 60
    t0 = time.time() - since * 60
    cutoff = time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime(t0))
    hits = {}
    cl = glob.glob(HOME + '/.claude/projects/*aiur-w-*/*.jsonl')
    cx = glob.glob(HOME + '/.aiur/accounts/codex/gamebuilder/sessions/*/*/*/*.jsonl')
    for fn, files in ((claude, cl), (codex, cx)):
        for f in files:
            if os.path.getmtime(f) < t0:
                continue
            try:
                fn(f, cutoff, hits)
            except OSError:
                pass
    rows = sorted(hits.items(), key=lambda kv: (-kv[1][0], kv[0]))
    for (pat, msg), (n, tix) in rows:
        t = sorted(tix, key=lambda x: (len(x), x))
        ts = ','.join(t[:5]) + (f'+{len(t) - 5}' if len(t) > 5 else '')
        print(f'MISS {n} {ts} {pat} -> {msg}')
    print(f'silent-misses: {len(rows)} groups, {sum(v[0] for v in hits.values())} hits')


if __name__ == '__main__':
    main()
