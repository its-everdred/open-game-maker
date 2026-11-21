"""Measure Tiny RPG character animation strips without altering the source pack."""
from pathlib import Path
import re

from smallscaleint import NOW, png_info, source

ACTIONS = ('Idle', 'Walk', 'Attack01', 'Attack02', 'Hurt', 'Death')


def build_cards(root: Path, collection: dict) -> list[dict]:
    cards = []
    folder = root / 'Characters(100x100 split)'
    for character in sorted(p for p in folder.iterdir() if p.is_dir()):
        plain = character / character.name
        shadow = character / (character.name + ' with shadows')
        paths, animations = [], []
        for action in ACTIONS:
            path = plain / f'{character.name}_{action}.png'
            if not path.is_file():
                raise ValueError(f'missing animation strip: {path}')
            width, height, _ = png_info(path)
            if height != 100 or width % 100:
                raise ValueError(f'invalid 100px animation strip: {path}')
            paths.append(path)
            sheet = {'path': path.relative_to(root).as_posix(), 'frame_w': 100, 'frame_h': 100,
                     'cols': width // 100, 'rows': 1, 'variant': 'shadowless'}
            sheets = [sheet]
            shadow_path = shadow / path.name
            if shadow_path.is_file():
                sw, sh, _ = png_info(shadow_path)
                if (sw, sh) != (width, height):
                    raise ValueError(f'mismatched shadow strip: {shadow_path}')
                paths.append(shadow_path)
                sheets.append({**sheet, 'path': shadow_path.relative_to(root).as_posix(), 'variant': 'shadow'})
            animations.append({'name': action, 'frames': list(range(width // 100)),
                               'frame_size': {'width': 100, 'height': 100}, 'sheets': sheets})
        files = [source(root, p, i == 0) for i, p in enumerate(paths)]
        width, height, alpha = png_info(paths[0])
        slug = re.sub(r'[^a-z0-9]+', '-', character.name.lower()).strip('-')
        pack, version = collection['id'].rsplit('@', 1)
        cards.append({'schema': collection['schema'], 'vocab': collection['vocab'],
                      'id': f'{pack}/{slug}@{version}', 'card_type': 'asset', 'status': 'measured',
                      'title': character.name.replace('_', ' '), 'kind': 'sprite', 'subkind': 'character',
                      'collection': collection['id'], 'describe': {'objects': [slug]},
                      'source': {'files': files, 'content_hash': files[0]['sha256']},
                      'image': {'width_px': width, 'height_px': height, 'has_alpha': alpha, 'pixel_art': True},
                      'sprite': {'drawn_view': 'side', 'animations': animations},
                      'provenance': {'*': {'by': 'code', 'tool': 'tinyrpg-layout@0.1', 'at': NOW,
                                           'input': 'named animation strips and PNG dimensions'}}})
    return cards
