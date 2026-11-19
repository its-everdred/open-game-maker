"""Write a private contact page for measured sprite cards."""
import argparse
import html
import json
import os
import sys
from pathlib import Path
from urllib.parse import quote
sys.path.insert(0, str(Path(__file__).resolve().parent))
from smallscaleint import png_info


def write_page(pack: Path, ext: Path, cards: list[dict], title: str) -> Path:
    out = pack / 'sheets'
    if out.is_symlink():
        raise ValueError('contact output directory must not be a symlink')
    out.mkdir(parents=True, exist_ok=True)
    target = out / 'items.html'
    if target.is_symlink():
        raise ValueError('contact output must not be a symlink')
    cells = []
    for card in cards:
        if card.get('kind') != 'sprite':
            continue
        label = html.escape(card['title'])
        animation_list = card.get('sprite', {}).get('animations', [])
        animations = ', '.join(f"{a['name']}: {len(a['frames'])} frames" for a in animation_list)
        paths = next((a['files'] for a in animation_list if a.get('files') and all(p.lower().endswith('.png') for p in a['files'])),
                     [card['source']['files'][0]['path']])
        images = []
        for name in paths:
            rel = Path(name)
            if rel.is_absolute() or '..' in rel.parts:
                raise ValueError('source path escapes extracted directory')
            path = ext / rel
            if not path.resolve().is_relative_to(ext.resolve()):
                raise ValueError('source path escapes extracted directory')
            if path.suffix.lower() != '.png':
                continue
            width, height, _ = png_info(path)
            src = quote(os.path.relpath(path, out), safe='/')
            images.append(f'<img loading="lazy" src="{src}" width="{width*3}" height="{height*3}" alt="{label}">')
        if images:
            cells.append(f'<figure><figcaption>{label} {html.escape(animations)}</figcaption><div class="frames">{"".join(images)}</div></figure>')
    target.write_text('<!doctype html><meta charset="utf-8"><title>' + html.escape(title) + '</title><style>body{background:#202124;color:#eee;font:14px system-ui}main{display:flex;flex-wrap:wrap;gap:12px;align-items:start}figure{margin:0;padding:8px;background:#303134;overflow:auto;max-width:100%;max-height:420px}.frames{display:flex}img{display:block;image-rendering:pixelated}</style><h1>' + html.escape(title) + '</h1><main>' + '\n'.join(cells) + '</main>\n')
    return target


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('pack', type=Path)
    args = parser.parse_args()
    collection = json.loads((args.pack / 'collection.card.json').read_text())
    ext = args.pack / collection['collection_info']['version'] / 'extracted'
    cards = [json.loads(path.read_text()) for path in sorted((args.pack / 'cards').rglob('*.card.json'))]
    print(write_page(args.pack, ext, cards, collection['title']))


if __name__ == '__main__':
    main()
