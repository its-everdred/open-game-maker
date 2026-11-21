"""Write local contact pages for ticket 997's measured cards."""
import argparse
import html
import json
import os
from pathlib import Path
from urllib.parse import quote


def write(pack: Path) -> Path:
    collection = json.loads((pack / 'collection.card.json').read_text())
    ext = pack / collection['collection_info']['version'] / 'extracted'
    cards = [json.loads(p.read_text()) for p in sorted((pack / 'cards').rglob('*.card.json'))]
    outdir = pack / 'sheets'
    if outdir.is_symlink():
        raise ValueError('sheet directory is a symlink')
    outdir.mkdir(exist_ok=True)
    out = outdir / 'contact.html'
    if out.is_symlink():
        raise ValueError('sheet output is a symlink')
    cells = []
    for card in cards:
        label = html.escape(card['title'])
        if card['kind'] == 'audio':
            body = f"{label} — {card['audio']['duration_s']:.2f}s"
        else:
            primary = card['source']['files'][0]['path']
            url = quote(os.path.relpath(ext / primary, outdir), safe='/')
            animations = card.get('sprite', {}).get('animations', [])
            counts = ', '.join(f"{a['name']}: {len(a['frames'])}" for a in animations)
            width = card['image']['width_px'] * 3
            body = f'<strong>{label}</strong> — {html.escape(counts)}<br><img src="{url}" width="{width}" alt="{label}">'
        cells.append(f'<figure>{body}</figure>')
    out.write_text('<!doctype html><meta charset="utf-8"><title>Contact sheet</title>'
                   '<style>body{background:#202124;color:#eee;font:14px system-ui}main{display:flex;flex-wrap:wrap}'
                   'figure{background:#303134;padding:1em;max-width:100%;overflow:auto}img{image-rendering:pixelated}</style>'
                   f'<h1>{html.escape(collection["title"])}</h1><main>' + ''.join(cells) + '</main>\n')
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('packs', type=Path, nargs='+')
    for pack in parser.parse_args().packs:
        print(write(pack))


if __name__ == '__main__':
    main()
