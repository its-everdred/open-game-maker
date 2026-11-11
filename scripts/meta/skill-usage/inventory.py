#!/usr/bin/env python3
"""Discover installed SKILL.md files and preserve inventory history.

Source identifiers are logical names, never absolute host paths. Missing
metadata is null: discovery does not assert a licence or upstream URL.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
from functools import lru_cache
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[3]


@lru_cache(maxsize=None)
def provenance(directory):
    """Use only public GitHub remotes and explicitly present licence files."""
    def git(*args):
        return subprocess.run(['git', '-C', str(directory), *args], capture_output=True, text=True, check=False)
    result = git('rev-parse', '--show-toplevel')
    if result.returncode:
        return None, None
    repo = Path(result.stdout.strip()).resolve()
    remote = git('remote', 'get-url', 'origin')
    url = remote.stdout.strip() if remote.returncode == 0 else ''
    parsed = urlparse(url)
    if parsed.scheme != 'https' or parsed.hostname != 'github.com' or parsed.username or parsed.password:
        url = None
    else:
        url = url.removesuffix('.git')
    license_name = None
    for parent in (Path(directory), *Path(directory).parents):
        if parent != repo and repo not in parent.parents:
            break
        for name in ('LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING'):
            file = parent / name
            if file.is_file():
                first = file.read_text(errors='replace')[:300].lower()
                if 'mit license' in first or 'permission is hereby granted, free of charge' in first:
                    license_name = 'MIT'
                elif 'apache license' in first and 'version 2' in first:
                    license_name = 'Apache-2.0'
                return url, license_name
    return url, license_name


def fail_walk(error):
    raise error


def discover(roots, previous, today, authoritative_prefixes=()):
    old = {(item['source'], item['name']): item for item in previous}
    found = {}
    for source, root in roots:
        if not root.is_dir():
            continue
        paths = []
        for directory, subdirs, files in os.walk(root, followlinks=True, onerror=fail_walk):
            current = Path(directory)
            ancestors = {p.resolve() for p in current.parents if p == root or root in p.parents}
            subdirs[:] = [name for name in subdirs if (current / name).resolve() not in ancestors and (current / name).resolve() != current.resolve()]
            if 'SKILL.md' in files:
                paths.append(current / 'SKILL.md')
        for path in sorted(paths):
            data = path.read_bytes()
            content = data.decode('utf-8')
            front = content.split('---', 2)
            header = front[1] if len(front) > 2 and not front[0].strip() else ''
            name_match = re.search(r'^name:\s*["\']?([^\n"\']+)', header, re.M)
            description_match = re.search(r'^description:\s*["\']?([^\n"\']+)', header, re.M)
            license_match = re.search(r'^licen[cs]e:\s*[\"\']?([^\n\"\']+)', header, re.M | re.I)
            url_match = re.search(r'^(?:homepage|source|url):\s*[\"\']?(https://github\.com/[^\s\"\']+)', header, re.M | re.I)
            name = name_match.group(1).strip() if name_match else path.parent.name
            # A plugin may expose identically named skills in multiple packages.
            rel = path.relative_to(root).parent.as_posix()
            identity = f'{source}/{rel}'
            key = (identity, name)
            prior = old.get(key, {})
            source_url, source_license = provenance(path.parent.resolve())
            found[key] = {
                'name': name, 'source': identity,
                'url': prior.get('url') or (url_match.group(1) if url_match else source_url), 'license': prior.get('license') or (license_match.group(1).strip() if license_match else source_license),
                'version': hashlib.sha256(data).hexdigest(),
                'date_added': prior.get('date_added') if prior else (today if previous else None),
                'date_added_basis': prior.get('date_added_basis') if prior else ('first detected' if previous else None),
                'first_seen': prior.get('first_seen', today),
                'roles': prior.get('roles', []),
                'purpose': description_match.group(1).strip() if description_match else None,
                'status': 'installed', 'removed_date': None, 'removal_reason': None,
            }
    for key, prior in old.items():
        if key not in found:
            # A missing discovery root is not proof that a skill was removed.
            source_root = next((root for source, root in roots if prior['source'].startswith(source + '/')), None)
            entry = dict(prior)
            authoritative = any(prior['source'].startswith(prefix + '/') for prefix in authoritative_prefixes)
            if ((source_root is not None and source_root.is_dir()) or authoritative) and entry.get('status') != 'removed':
                entry.update(status='removed', removed_date=today, removal_reason='Not found during discovery')
            found[key] = entry
    return sorted(found.values(), key=lambda item: (item['name'].lower(), item['source']))


def markdown(rows):
    def cell(value):
        return str(value if value is not None else 'Unknown').replace('|', '\\|').replace('\n', ' ')
    lines = ['# Skill inventory', '', 'Generated by `scripts/meta/skill-usage/inventory.py`. Versions are SHA-256 hashes of the skill instructions; unknown metadata is not inferred.', '', '| Skill | Source | Version (SHA-256) | Added | Roles | Purpose | Licence | URL | Status |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |']
    for item in rows:
        values = [item['name'], item['source'], item['version'], item['date_added'], ', '.join(item['roles']) or 'Unknown', item['purpose'], item['license'], item['url'], item['status']]
        lines.append('| ' + ' | '.join(cell(v) for v in values) + ' |')
    return '\n'.join(lines) + '\n'


def installed_plugin_roots(home):
    roots = []
    dates = {}
    authoritative = []
    for account in ('.claude', '.claude-2'):
        registry = home / account / 'plugins/installed_plugins.json'
        if not registry.is_file():
            continue
        data = json.loads(registry.read_text())
        authoritative.append(f'{account[1:]}-installed')
        for name, installs in data.get('plugins', {}).items():
            for install in installs:
                location = install.get('installPath')
                if not isinstance(location, str) or not location or not Path(location).is_absolute():
                    raise ValueError(f'invalid installed plugin path for {name}')
                path = Path(location)
                if not path.is_dir():
                    raise FileNotFoundError(f'installed plugin directory unavailable: {path}')
                if path.is_dir():
                    source = f"{account[1:]}-installed/{name}/{install.get('version', 'unknown')}"
                    roots.append((source, path))
                    installed = install.get('installedAt')
                    if installed:
                        dates[source] = min(dates.get(source, installed[:10]), installed[:10])
    return list(dict.fromkeys(roots)), dates, authoritative


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT / 'docs/meta/skills')
    args = parser.parse_args()
    home = Path.home()
    roots = [('project-game', ROOT / 'skills'), ('project-claude', ROOT / '.claude/skills'), ('project-codex', ROOT / '.codex/skills'),
             ('project-agents', ROOT / '.agents/skills'), ('user-codex', home / '.codex/skills'),
             ('user-agents', home / '.agents/skills'), ('user-claude', home / '.claude/skills'),
             ('user-skills-repo', home / 'github/skills'),
             ('codex-plugins', home / '.aiur/accounts/codex/gamebuilder/plugins/cache')]
    plugin_roots, plugin_dates, plugin_prefixes = installed_plugin_roots(home)
    roots.extend(plugin_roots)
    args.output.mkdir(parents=True, exist_ok=True)
    inventory = args.output / 'inventory.json'
    previous = json.loads(inventory.read_text()) if inventory.exists() else []
    rows = discover(roots, previous, datetime.date.today().isoformat(), plugin_prefixes)
    for row in rows:
        matching = next((date for source, date in plugin_dates.items() if row['source'].startswith(source + '/')), None)
        if matching:
            row['date_added'] = matching
            row['date_added_basis'] = 'plugin registry'
    roles_file = ROOT / 'skills/gm-core/references/roles.md'
    if roles_file.exists():
        role_map = {}
        for match in re.finditer(r'^\| `(?P<role>role:[^`]+)` \|[^|]+\| (?P<skills>[^|]+)\|', roles_file.read_text(), re.M):
            for skill in match.group('skills').split(','):
                role_map.setdefault(skill.strip().strip('`'), []).append(match.group('role'))
        for row in rows:
            row['roles'] = sorted(set(row.get('roles', [])) | set(role_map.get(row['name'], [])))
    inventory.write_text(json.dumps(rows, indent=2, ensure_ascii=False) + '\n')
    view = args.output / 'inventory.md'
    view.write_text(markdown(rows))
    formatter = ROOT / 'node_modules/.bin/prettier'
    if formatter.is_file():
        subprocess.run([str(formatter), '--config', str(ROOT / '.prettierrc'), '--write', str(inventory), str(view)], check=True, stdout=subprocess.DEVNULL)


if __name__ == '__main__':
    main()
