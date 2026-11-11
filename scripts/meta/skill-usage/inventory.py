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


def safe_github_url(url):
    try:
        parsed = urlparse(url)
        port = parsed.port
    except ValueError:
        return None
    if (parsed.scheme != 'https' or parsed.hostname != 'github.com' or parsed.username or parsed.password
            or parsed.query or parsed.fragment or port):
        return None
    if not re.fullmatch(r'/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(?:\.git)?/?', parsed.path):
        return None
    return 'https://github.com' + parsed.path.rstrip('/').removesuffix('.git')


@lru_cache(maxsize=None)
def repo_remote(repo):
    result = subprocess.run(['git', '-C', str(repo), 'remote', 'get-url', 'origin'], capture_output=True, text=True, check=False)
    return safe_github_url(result.stdout.strip()) if result.returncode == 0 else None


def provenance(directory):
    """Use only public GitHub remotes and explicitly present licence files."""
    directory = Path(directory)
    repo = next((parent for parent in (directory, *directory.parents) if (parent / '.git').exists()), None)
    if repo is None:
        return None, None
    return repo_remote(repo), identify_license(directory, repo)


def identify_license(directory, boundary):
    for parent in (directory, *directory.parents):
        if parent != boundary and boundary not in parent.parents:
            break
        for name in ('LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING'):
            file = parent / name
            if file.is_file():
                first = file.read_text(errors='replace')[:300].lower()
                if 'mit license' in first or 'permission is hereby granted, free of charge' in first:
                    return 'MIT'
                if 'apache license' in first and 'version 2' in first:
                    return 'Apache-2.0'
                return None
    return None



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
            if source.startswith(('claude-installed/', 'claude-2-installed/', 'codex-plugins/')):
                source_url, source_license = None, None
            else:
                source_url, source_license = provenance(path.parent.resolve())
            found[key] = {
                'name': name, 'source': identity,
                'url': safe_github_url(prior.get('url') or '') or (safe_github_url(url_match.group(1)) if url_match else source_url), 'license': prior.get('license') or (license_match.group(1).strip() if license_match else source_license),
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
            if 'url' in entry:
                entry['url'] = safe_github_url(entry['url'] or '')
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


def plugin_source_url(plugin_name, market):
    location = market.get('installLocation')
    manifest = Path(location) / '.claude-plugin/marketplace.json' if location else None
    if not manifest or not manifest.is_file():
        return False, None
    data = json.loads(manifest.read_text())
    entry = next((item for item in data.get('plugins', []) if item.get('name') == plugin_name), None)
    if not entry:
        return False, None
    source = entry.get('source')
    if isinstance(source, str) and source.startswith(('./', '../')):
        root = Path(location).resolve()
        if not (root / source).resolve().is_relative_to(root):
            return True, None
        origin = market.get('source', {})
        repo = origin.get('repo', '') if origin.get('source') == 'github' else ''
        return True, (f'https://github.com/{repo}' if re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repo) else None)
    if isinstance(source, dict):
        url = source.get('url', '')
        if not url and source.get('source') == 'github':
            repo = source.get('repo', '')
            url = f'https://github.com/{repo}' if re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repo) else ''
        return True, safe_github_url(url)
    return True, None


def installed_plugin_roots(home):
    roots = []
    dates = {}
    authoritative = []
    sources = {}
    for account in ('.claude', '.claude-2'):
        registry = home / account / 'plugins/installed_plugins.json'
        if not registry.is_file():
            continue
        data = json.loads(registry.read_text())
        market_file = registry.with_name('known_marketplaces.json')
        markets = json.loads(market_file.read_text()) if market_file.is_file() else {}
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
                    market = name.rsplit('@', 1)[-1]
                    known, url = plugin_source_url(name.rsplit('@', 1)[0], markets.get(market, {}))
                    sources[source] = (path, url, known)
                    installed = install.get('installedAt')
                    if installed:
                        dates[source] = min(dates.get(source, installed[:10]), installed[:10])
    return list(dict.fromkeys(roots)), dates, authoritative, sources


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--metadata-only', action='store_true', help='Refresh provenance on existing entries without a discovery scan')
    parser.add_argument('--output', type=Path, default=ROOT / 'docs/meta/skills')
    args = parser.parse_args()
    home = Path.home()
    roots = [('project-game', ROOT / 'skills'), ('project-claude', ROOT / '.claude/skills'), ('project-codex', ROOT / '.codex/skills'),
             ('project-agents', ROOT / '.agents/skills'), ('user-codex', home / '.codex/skills'),
             ('user-agents', home / '.agents/skills'), ('user-claude', home / '.claude/skills'),
             ('user-skills-repo', home / 'github/skills'),
             ('codex-plugins', home / '.aiur/accounts/codex/gamebuilder/plugins/cache')]
    plugin_roots, plugin_dates, plugin_prefixes, plugin_sources = installed_plugin_roots(home)
    roots.extend(plugin_roots)
    args.output.mkdir(parents=True, exist_ok=True)
    inventory = args.output / 'inventory.json'
    previous = json.loads(inventory.read_text()) if inventory.exists() else []
    rows = previous if args.metadata_only else discover(roots, previous, datetime.date.today().isoformat(), plugin_prefixes)
    if args.metadata_only:
        for row in rows:
            if 'url' in row:
                row['url'] = safe_github_url(row['url'] or '')
    for row in rows:
        matching = next((source for source in plugin_sources if row['source'].startswith(source + '/')), None)
        if matching:
            plugin_root, url, known = plugin_sources[matching]
            if matching in plugin_dates:
                row['date_added'] = plugin_dates[matching]
                row['date_added_basis'] = 'plugin registry'
            relative = row['source'][len(matching) + 1:]
            row['url'] = url if known else safe_github_url(row.get('url') or '')
            row['license'] = row.get('license') or identify_license((plugin_root / relative).resolve(), plugin_root.resolve())
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
