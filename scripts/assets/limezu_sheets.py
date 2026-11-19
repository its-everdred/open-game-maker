"""Generate local 3x pixel-art contact pages without copying source images."""
import argparse
import hashlib
import html
import os
import re
import sys
from collections import defaultdict
from pathlib import Path
from urllib.parse import quote
sys.path.insert(0, str(Path(__file__).resolve().parent))
from smallscaleint import png_info


def page(title: str, paths: list[Path], out: Path, lineup: bool = False, animations=None, ext=None) -> str:
    cells = []
    for path in paths:
        display = path
        width, height, _ = png_info(path)
        irregular = (path.name, width, height) in {
            ('Dogs_Doghouse_Sleeping_32x32.png', 512, 858), ('Duck_White_32x32.png', 1658, 256),
        }
        measured_animal = 'Animals_32x32' in path.parts and (width in (768, 1536, 2304) or irregular)
        measured_farmer = bool(re.fullmatch(r'Farmer_[12](?:_No_Hat)?_32x32', path.stem))
        if lineup and ext is not None and (measured_animal or measured_farmer):
            key = path.relative_to(ext).as_posix()
            thumbnail = out.parent / 'lineup-thumbs' / (hashlib.sha256(key.encode()).hexdigest() + '.png')
            if thumbnail.is_file() and not thumbnail.is_symlink():
                display = thumbnail
                width, height, _ = png_info(display)
        src = quote(os.path.relpath(display, out.parent), safe='/')
        label = html.escape(path.stem.replace('_32x32', '').replace('_', ' '))
        image = f'<img loading="lazy" src="{src}" width="{width * 3}" height="{height * 3}" alt="{label}">'
        actions = (animations or {}).get(path, [])
        suffix = f' — {html.escape(", ".join(actions))}' if actions else ''
        cells.append(f'<figure><figcaption>{label}{suffix}</figcaption><div class="image">{image}</div></figure>')
    return ('<!doctype html><meta charset="utf-8"><title>' + html.escape(title) + '</title>'
            '<style>*{box-sizing:border-box}body{background:#202124;color:#eee;font:14px system-ui}main{display:flex;flex-wrap:wrap;gap:12px;align-items:start}'
            'figure{margin:0;padding:8px;background:#303134;max-width:100%}.image{overflow:auto;max-height:420px}'
            + ('.image{width:min(384px,100%);height:384px;overflow:auto}' if lineup else '') +
            'img{display:block;image-rendering:pixelated}figcaption{margin-bottom:6px}</style><h1>'
            + html.escape(title) + '</h1><main>' + '\n'.join(cells) + '</main>\n')


def write_pages(pack: Path, ext: Path) -> list[Path]:
    groups = defaultdict(list)
    base = ext / '32x32'
    for path in sorted(base.rglob('*.png')):
        parts = path.relative_to(base).parts
        if len(parts) < 2:
            continue
        category = parts[0].replace('_32x32', '')
        if category == 'Animated' and 'gifs' in '/'.join(parts).lower():
            continue
        group = category
        if category == 'Single_Files' and len(parts) >= 3:
            group += '-' + parts[1].replace('_32x32', '')
        groups[group].append(path)
    groups['Icons'].extend(sorted((ext / 'Icons' / 'Icons_32x32').rglob('*.png')))
    out = pack / 'sheets'
    if out.is_symlink():
        raise ValueError('contact output directory must not be a symlink')
    out.mkdir(parents=True, exist_ok=True)
    written = []
    for group, paths in sorted(groups.items()):
        if not paths:
            continue
        name = re.sub(r'[^a-z0-9]+', '-', group.lower()).strip('-')
        target = out / f'{name}.html'
        if target.is_symlink():
            raise ValueError(f'contact output must not be a symlink: {target}')
        target.write_text(page(f'Modern Farm: {group.replace("_", " ")}', paths, target))
        written.append(target)
    characters = groups.get('Characters', [])
    farmers = [p for p in characters if re.fullmatch(r'Farmer_[12](?:_No_Hat)?_32x32', p.stem)]
    actions = {}
    for farmer in farmers:
        prefix = farmer.stem.removesuffix('_32x32') + '_'
        actions[farmer] = sorted({p.stem.removeprefix(prefix).removesuffix('_32x32').split('_')[0].lower()
                                  for p in characters if p != farmer and p.stem.startswith(prefix)
                                  and not (prefix == 'Farmer_2_' and p.stem.startswith('Farmer_2_No_Hat_'))})
    lineup = farmers + [p for p in groups.get('Animals', []) if not p.stem.lower().startswith('portraits_')]
    if lineup:
        target = out / 'lineup.html'
        if target.is_symlink():
            raise ValueError(f'contact output must not be a symlink: {target}')
        target.write_text(page('Modern Farm: characters and animals', lineup, target, lineup=True, animations=actions, ext=ext))
        written.append(target)
    return written


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('pack', type=Path)
    parser.add_argument('--version', default='1.3')
    args = parser.parse_args()
    for path in write_pages(args.pack, args.pack / args.version / 'extracted'):
        print(path)


if __name__ == '__main__':
    main()
