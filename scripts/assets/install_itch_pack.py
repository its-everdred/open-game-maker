#!/usr/bin/env python3
"""Install a pack downloaded by fetch_itch_owned.py / fetch_itch_free.py into assets-local/packs.

    python3 -I scripts/assets/install_itch_pack.py <download dir> <pack id> "<title>" <licence> "<licence summary>" --extract REGEX [--category 2d]
        [--skip REGEX] [--rights rights.json]

Copies every downloaded file (except --skip matches, e.g. engine-project duplicates) to <id>/<version>/originals (untouched), unzips the archives matching --extract (any zip, with or
without the .zip suffix; macOS junk dropped) into extracted/ and copies loose matching files there, writes License.txt (the summary plus the store page) and pack.json, keyed by today's date as version.
Never runs anything from the download. Rebuild the catalog afterwards (build_catalog.py).
"""
import argparse, json, os, re, shutil, time, zipfile
from collections import Counter
from pathlib import Path

ap = argparse.ArgumentParser()
for x in ('src', 'id', 'title', 'license', 'summary'): ap.add_argument(x)
ap.add_argument('--extract', required=True); ap.add_argument('--category', default='2d')
ap.add_argument('--skip'); ap.add_argument('--rights', help='usage_rights JSON (default: bought pack, private, no redistribution)')
a = ap.parse_args()
src = Path(a.src).expanduser(); meta = json.loads((src / 'sources.json').read_text())
ver = time.strftime('%Y-%m-%d'); root = Path(__file__).resolve().parents[2] / 'assets-local' / 'packs' / a.id
orig, ext = root / ver / 'originals', root / ver / 'extracted'; orig.mkdir(parents=True, exist_ok=True); ext.mkdir(parents=True, exist_ok=True)
for f in src.iterdir():
    if a.skip and re.search(a.skip, f.name, re.I): print('skip', f.name); continue
    if f.is_file() and not (orig / f.name).exists(): shutil.copy2(f, orig / f.name)
for z in sorted(orig.iterdir()):
    if not re.search(a.extract, z.name, re.I): continue
    if not zipfile.is_zipfile(z):
        if z.name != 'sources.json': shutil.copy2(z, ext / z.name)
        continue
    with zipfile.ZipFile(z) as zf:
        for m in zf.infolist():
            if m.filename.startswith('__MACOSX/') or m.filename.endswith('.DS_Store'): continue
            p = (ext / m.filename).resolve()
            if not str(p).startswith(str(ext.resolve())): continue   # no paths escaping the folder
            zf.extract(m, ext)
(ext / 'License.txt').write_text(f"{a.title}\n{meta.get('page')}\n\n{a.summary}\n\nVerified on the store page {ver}.\n")
ft = dict(Counter(f.suffix.lower().lstrip('.') for f in ext.rglob('*') if f.is_file()).most_common())
pj = root / 'pack.json'; m = json.loads(pj.read_text()) if pj.exists() else {}
m.update({'id': a.id, 'vendor': a.id.split('-')[0], 'title': a.title, 'category': a.category, 'license': a.license,
          'license_source': f'{ver}/extracted/License.txt', 'requires': [], 'current': ver})
m.setdefault('versions', {})[ver] = {'format': 'loose', 'extracted_files': sum(ft.values()), 'file_types': ft, 'added': ver,
                                     'source': {'type': 'itch.io', 'official': meta.get('page'), 'purchase': meta.get('purchase', True)}}
m['usage_rights'] = json.loads(Path(a.rights).read_text()) if a.rights else {'uses': ['in-game', 'placeholder', 'derive-layout', 'style-reference', 'vision-input'], 'audience': 'private',
                     'redistribution': 'not-allowed', 'attribution': a.title, 'basis': f'{ver}/extracted/License.txt',
                     'confirmed_by': 'kevin', 'confirmed': ver, 'note': 'Kevin bought it on itch.io and asked to install it.'}
pj.write_text(json.dumps(m, indent=2) + '\n'); print(a.id, sum(ft.values()), 'files', list(ft.items())[:4])
