"""Measure paired WAV/OGG UI sounds using only the vendor's local files."""
import math
import html
import os
import re
import argparse
import json
import sys
import wave
from pathlib import Path
from urllib.parse import quote

sys.path.insert(0, str(Path(__file__).resolve().parent))
from smallscaleint import NOW, source


def measure(path: Path) -> dict:
    try:
        return _measure(path)
    except (wave.Error, EOFError) as error:
        raise ValueError(f'invalid WAV: {path}') from error


def _measure(path: Path) -> dict:
    with wave.open(str(path), 'rb') as audio:
        width, rate, channels, frames = audio.getsampwidth(), audio.getframerate(), audio.getnchannels(), audio.getnframes()
        if width not in (1, 2, 3, 4) or not rate:
            raise ValueError(f'unsupported PCM format: {path}')
        peak = 0
        bytes_read = 0
        while chunk := audio.readframes(8192):
            bytes_read += len(chunk)
            for offset in range(0, len(chunk), width):
                data = chunk[offset:offset + width]
                if len(data) != width:
                    raise ValueError(f'truncated PCM data: {path}')
                value = data[0] - 128 if width == 1 else int.from_bytes(data, 'little', signed=True)
                peak = max(peak, abs(value))
        if bytes_read != frames * channels * width:
            raise ValueError(f'truncated PCM data: {path}')
    db = max(-120.0, 20 * math.log10(peak / (2 ** (8 * width - 1)))) if peak else -120.0
    return {'duration_s': frames / rate, 'sample_rate': rate, 'channels': channels, 'peak_dbfs': db}


def build_cards(root: Path, collection: dict) -> list[dict]:
    cards = []
    for path in sorted((root / 'WAV').rglob('*.wav')):
        rel = path.relative_to(root / 'WAV')
        ogg = (root / 'OGG' / rel).with_suffix('.ogg')
        files = [source(root, path, True)]
        if ogg.is_file():
            files.append(source(root, ogg))
        card_id = re.sub(r'[^a-z0-9/]+', '-', rel.with_suffix('').as_posix().lower()).strip('-')
        title = path.stem.replace('_', ' ')
        info = measure(path)
        info['search_notes'] = f'UI sound: {title}'[:120]
        cards.append({
            'schema': collection['schema'], 'vocab': collection['vocab'],
            'id': f"{collection['id'].rsplit('@', 1)[0]}/{card_id}@{collection['id'].rsplit('@', 1)[1]}",
            'card_type': 'asset', 'status': 'tagged', 'title': title,
            'kind': 'audio', 'subkind': 'sfx/ui', 'collection': collection['id'],
            'source': {'files': files, 'content_hash': files[0]['sha256']}, 'audio': info,
            'describe': {'description': f'UI feedback sound: {title}', 'objects': ['sound'],
                         'roles': ['feedback'], 'style_family': 'any'},
            'previews': {}, 'flags': ['missing-preview'],
            'provenance': {'*': {'by': 'code', 'tool': 'caseportman-audio@0.1', 'at': NOW,
                                 'input': 'WAV PCM and paired OGG filename'},
                           'describe': {'by': 'filename', 'tool': 'caseportman-audio@0.1', 'at': NOW,
                                        'input': 'UI pack and filename'}},
        })
    return cards


def write_contact(pack: Path, root: Path, cards: list[dict]) -> Path:
    out = pack / 'sheets'
    if out.is_symlink():
        raise ValueError('contact output directory must not be a symlink')
    out.mkdir(parents=True, exist_ok=True)
    lines = []
    for card in cards:
        filename = card['source']['files'][0]['path']
        src = quote(os.path.relpath(root / filename, out), safe='/')
        title = html.escape(card['title'])
        duration = card['audio']['duration_s']
        lines.append(f'<li>{title} — {duration:.3f} s <audio controls preload="none" src="{src}"></audio></li>')
    target = out / 'sounds.html'
    if target.is_symlink():
        raise ValueError('contact output must not be a symlink')
    target.write_text('<!doctype html><meta charset="utf-8"><title>UI sounds</title><h1>UI sounds</h1><ul>' + '\n'.join(lines) + '</ul>\n')
    return target


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('pack', type=Path)
    args = parser.parse_args()
    collection = json.loads((args.pack / 'collection.card.json').read_text())
    root = args.pack / collection['collection_info']['version'] / 'extracted'
    print(write_contact(args.pack, root, build_cards(root, collection)))


if __name__ == '__main__':
    main()
