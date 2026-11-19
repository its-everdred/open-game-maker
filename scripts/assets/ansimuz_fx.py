"""Index animation previews and their sibling sprite files from Ansimuz FX packs."""
from pathlib import Path
import re

from limezu_gif import metadata
from smallscaleint import NOW, source


def build_cards(root: Path, collection: dict) -> list[dict]:
    cards = []
    for gif in sorted(p for p in root.rglob('*') if p.is_file() and p.suffix.lower() == '.gif'):
        info = metadata(gif)
        relative = gif.parent.relative_to(root)
        slug = re.sub(r'[^a-z0-9/]+', '-', relative.as_posix().lower()).strip('-/').replace('/', '-') or 'explosion'
        title = relative.name.replace('-', ' ') if relative.parts else 'Explosion tutorial'
        siblings = sorted(p for p in gif.parent.rglob('*.png') if p.is_file())
        files = [source(root, gif, True), *(source(root, p) for p in siblings)]
        animation = {'name': title, 'frames': list(range(info['frames'])),
                     'frame_size': {'width': info['width'], 'height': info['height']},
                     'files': [gif.relative_to(root).as_posix()]}
        if info['fps'] is not None:
            animation['fps'] = info['fps']
        pack, version = collection['id'].rsplit('@', 1)
        cards.append({'schema': collection['schema'], 'vocab': collection['vocab'],
                      'id': f'{pack}/{slug}@{version}', 'card_type': 'asset', 'status': 'measured',
                      'title': title, 'kind': 'sprite', 'subkind': 'fx', 'collection': collection['id'],
                      'describe': {'objects': ['explosion'] if 'explosion' in slug else ['effect']},
                      'source': {'files': files, 'content_hash': files[0]['sha256']},
                      'image': {'width_px': info['width'], 'height_px': info['height'],
                                'has_alpha': info['has_alpha'], 'pixel_art': True},
                      'sprite': {'drawn_view': 'none', 'animations': [animation]},
                      'provenance': {'*': {'by': 'code', 'tool': 'ansimuz-fx@0.1', 'at': NOW,
                                           'input': 'GIF metadata and sibling PNG files'}}})
    if len({c['id'] for c in cards}) != len(cards):
        raise ValueError('duplicate FX card id')
    return cards
