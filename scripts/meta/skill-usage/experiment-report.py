#!/usr/bin/env python3
"""Render local skill evidence as a standalone HTML report."""
import argparse
import base64
from datetime import datetime
from collections import defaultdict
from html import escape
import json
import mimetypes
import os
import tempfile
from pathlib import Path


def load(path):
    if not path.exists():
        return []
    with path.open() as source:
        return [json.loads(line) for line in source if line.strip()]


def media(path):
    if not path:
        return '<span>Unavailable</span>'
    file = Path(path)
    mime = mimetypes.guess_type(file.name)[0] or ''
    if not file.is_file() or not (mime.startswith('image/') or mime.startswith('video/')):
        return '<span>Unavailable</span>'
    data = base64.b64encode(file.read_bytes()).decode('ascii')
    url = f'data:{mime};base64,{data}'
    return f'<video controls preload="none" src="{url}"></video>' if mime.startswith('video/') else f'<img src="{url}" alt="Iteration image">'


def numeric_scores(row):
    data = row.get('score')
    if not isinstance(data, dict):
        return {}
    values = {}
    overall = data.get('score')
    if isinstance(overall, (int, float)) and not isinstance(overall, bool):
        values['overall'] = overall
    tiers = data.get('tiers') or data.get('tier_scores') or {}
    if isinstance(tiers, dict):
        for tier, value in tiers.items():
            if isinstance(value, dict):
                value = value.get('score')
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                values[str(tier)] = value
    return values


def render(turns, artifacts, inventory=None):
    tickets = sorted({(r['repo'], r['ticket']) for r in turns + artifacts})
    skills = sorted({s for r in turns for s in r.get('acting', []) + r.get('read', []) + r.get('mapped', [])} | {s for r in artifacts for s in r.get('skills', [])} | {r['name'] for r in inventory or [] if r.get('name')})
    by_ticket = defaultdict(list)
    turn_index = defaultdict(list)
    skill_index = defaultdict(list)
    for row in turns:
        turn_index[(row['repo'], row['ticket'])].append(row)
        for skill in set(row.get('acting', []) + row.get('read', []) + row.get('mapped', [])):
            skill_index[skill].append(row)
    for row in artifacts:
        by_ticket[(row['repo'], row['ticket'])].append(row)
    out = ['<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Skill experiment</title>',
           '<style>body{font:15px system-ui;margin:2rem;color:#18212c}table{border-collapse:collapse}td,th{border:1px solid #ccd4dd;padding:.35rem;text-align:left}figure{display:inline-block;vertical-align:top;margin:.5rem;max-width:260px}img,video{max-width:250px;max-height:200px}pre{white-space:pre-wrap;overflow-wrap:anywhere}section{margin:2rem 0}.matrix{overflow:auto;max-width:100%}</style></head><body>',
           '<h1>Skill experiment</h1><p>Observed evidence only. Missing values do not mean zero; attribution does not establish causation.</p>',
           '<details><summary>Skill × ticket</summary><div class="matrix"><table><tr><th>Skill</th>']
    out.extend(f'<th>{escape(repo)} #{ticket}</th>' for repo, ticket in tickets)
    out.append('</tr>')
    for skill in skills:
        out.append(f'<tr><th>{escape(skill)}</th>')
        for key in tickets:
            matches = turn_index[key]
            tags = [label for label in ('mapped', 'read', 'acting') if any(skill in r.get(label, []) for r in matches)]
            if any(skill in r.get('skills', []) for r in by_ticket[key]) and 'acting' not in tags:
                tags.append('artifact')
            out.append('<td>' + escape(', '.join(tags) or '—') + '</td>')
        out.append('</tr>')
    deltas = defaultdict(list)
    for frames in by_ticket.values():
        groups = defaultdict(list)
        for frame in frames:
            if frame.get('iteration') is not None:
                groups[frame['iteration']].append(frame)
        iterations = [groups[key] for key in sorted(groups)]
        for previous, current in zip(iterations, iterations[1:]):
            first = next((frame for frame in previous if numeric_scores(frame)), None)
            second = next((frame for frame in current if numeric_scores(frame)), None)
            if not first or not second:
                continue
            before, after = numeric_scores(first), numeric_scores(second)
            if first.get('target_snapshot') and first.get('target_snapshot') == second.get('target_snapshot'):
                for skill in {skill for frame in current for skill in frame.get('skills', [])}:
                    deltas[skill].extend(f'{tier}: {after[tier] - before[tier]:+g}' for tier in sorted(before.keys() & after.keys()))
    out.append('</table></div></details><h2>Per skill</h2><table><tr><th>Skill</th><th>Tickets</th><th>Mapped turns</th><th>Read or acting turns</th><th>Known tokens in read or acting turns</th><th>Observed score deltas</th></tr>')
    for skill in skills:
        matches = skill_index[skill]
        used = [row for row in matches if skill in row.get('read', []) or skill in row.get('acting', [])]
        mapped = sum(skill in row.get('mapped', []) for row in matches)
        if any(row.get('turn_fields_complete') is False for row in turns):
            mapped = f'≥{mapped}'
        count = len({(row['repo'], row['ticket']) for row in used})
        tokens = [row['tokens'] for row in used if row.get('tokens') is not None]
        out.append(f'<tr><th>{escape(skill)}</th><td>{count}</td><td>{mapped}</td><td>{len(used)}</td><td>{sum(tokens) if tokens else "Unknown"}</td><td>{escape(', '.join(deltas[skill]) or 'Unknown')}</td></tr>')
    out.append('</table><h2>Look-score calls per turn</h2><table><tr><th>Ticket</th><th>Turn</th><th>Calls</th></tr>')
    for row in turns:
        count = row.get('look_score_calls')
        out.append(f'<tr><td>{escape(row["repo"])} #{row["ticket"]}</td><td>{escape(str(row.get("turn_id", "Unknown")))}</td><td>{(f"≥{count}" if (row.get("turn_fields_complete") is False or row.get("look_score_complete") is False) else count) if count is not None else "Unknown"}</td></tr>')
    out.append('</table><h2>Visual iterations</h2>')
    for key in tickets:
        frames = sorted((row for row in by_ticket[key] if row.get('iteration') is not None), key=lambda row: row['iteration'])
        references = [row for row in by_ticket[key] if row.get('iteration') is None]
        if not frames and not references:
            continue
        out.append(f'<section><h3>{escape(key[0])} #{key[1]}</h3>')
        if frames and frames[0].get('target'):
            out.append('<figure><figcaption>Target</figcaption>' + media(frames[0].get('target_snapshot') or frames[0]['target']) + '</figure>')
        for frame in frames:
            tags = escape(', '.join(frame.get('skills', [])) or 'Unknown')
            score = escape(json.dumps(frame.get('score'), ensure_ascii=False))
            turn = next((row for row in turn_index[key] if row.get('turn_id') == frame.get('turn_id') and frame.get('turn_id')), None)
            tokens = turn.get('tokens') if turn else None
            out.append(f'<figure><figcaption>Iteration {frame["iteration"]} · {tags} · tokens: {tokens if tokens is not None else "Unknown"}</figcaption>{media(frame.get("snapshot") or frame.get("path"))}<pre>{score}</pre></figure>')
        for reference in references:
            out.append('<figure><figcaption>Unclassified posted reference</figcaption>' + media(reference.get('snapshot') or reference.get('path')) + '</figure>')
        passing = next((f for f in frames if isinstance(f.get('score'), dict) and (f['score'].get('pass') is True or f['score'].get('result') == 'pass')), None)
        if passing:
            try:
                start = datetime.fromisoformat(frames[0]['time'].replace('Z', '+00:00'))
                end = datetime.fromisoformat(passing['time'].replace('Z', '+00:00'))
                elapsed = f'{(end - start).total_seconds():g} seconds between posts' if end >= start else 'Unknown'
            except (KeyError, TypeError, ValueError):
                elapsed = 'Unknown'
            out.append(f'<p>First observed judge pass: iteration {passing["iteration"]}; elapsed: {elapsed}.</p>')
        else:
            out.append('<p>No judge pass recorded; iterations to pass are unknown.</p>')
        out.append('</section>')
    out.append('<h2>Try a new skill</h2>')
    comparisons = []
    introductions = {}
    for item in inventory or []:
        name, added = item.get('name'), item.get('date_added')
        if name and added:
            introductions[name] = min(introductions.get(name, added), added)
    for new, added in introductions.items():
        new_roles = defaultdict(list)
        for current in skill_index.get(new, []):
            if new not in current.get('read', []) and new not in current.get('acting', []):
                continue
            if current.get('time') and current['time'][:10] >= added:
                for role in current.get('labels') or []:
                    if role.startswith('role:'):
                        new_roles[role].append(current)
        if not new_roles:
            continue
        old_roles = defaultdict(list)
        for old in turns:
            if not old.get('time') or old['time'][:10] >= added:
                continue
            for role in set(old.get('labels') or []) & new_roles.keys():
                for incumbent in set(old.get('acting', []) + old.get('read', [])) - {new}:
                    old_roles[(role, incumbent)].append(old)
        for (role, incumbent), old in sorted(old_roles.items()):
            current = new_roles[role]
            new_tokens = [row['tokens'] for row in current if row.get('tokens') is not None]
            old_tokens = [row['tokens'] for row in old if row.get('tokens') is not None]
            comparisons.append((new, incumbent, role, len(current), len(old),
                                sum(new_tokens) if new_tokens else 'Unknown',
                                sum(old_tokens) if old_tokens else 'Unknown'))
    if comparisons:
        out.append('<p>Observed turns with the same role. Dates inferred from first detection may be later than installation; these are not controlled comparisons.</p><table><tr><th>New skill</th><th>Incumbent</th><th>Shared role</th><th>New turns</th><th>Earlier turns</th><th>Known new tokens</th><th>Known earlier tokens</th></tr>')
        for new, incumbent, role, new_count, old_count, new_tokens, old_tokens in comparisons:
            out.append(f'<tr><td>{escape(new)}</td><td>{escape(incumbent)}</td><td>{escape(role)}</td><td>{new_count}</td><td>{old_count}</td><td>{new_tokens}</td><td>{old_tokens}</td></tr>')
        out.append('</table>')
    else:
        out.append('<p>No comparable observations with known introduction dates and matching ticket roles are available.</p>')
    out.append('</body></html>')
    return ''.join(out)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--state-dir', type=Path, default=Path('assets-local/experiments/skills'))
    parser.add_argument('--output', type=Path)
    parser.add_argument('--inventory', type=Path, default=Path('docs/meta/skills/inventory.json'))
    args = parser.parse_args()
    output = args.output or args.state_dir / 'report.html'
    output.parent.mkdir(parents=True, exist_ok=True)
    report = render(load(args.state_dir / 'ledger.jsonl'), load(args.state_dir / 'artifacts.jsonl'), json.loads(args.inventory.read_text()) if args.inventory.exists() else [])
    with tempfile.NamedTemporaryFile(mode='w', dir=output.parent, prefix=output.name + '.', delete=False) as tmp:
        tmp.write(report)
        temporary = tmp.name
    os.replace(temporary, output)


if __name__ == '__main__':
    main()
