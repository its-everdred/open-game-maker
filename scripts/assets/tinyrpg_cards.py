"""Read Tiny RPG split character animations, preserving original sheets."""
import re
from pathlib import Path
from smallscaleint import NOW, png_info, source


def build_cards(root: Path, collection: dict) -> list[dict]:
    cards = []
    characters = root / 'Characters(100x100 split)'
    for character in sorted(p for p in characters.iterdir() if p.is_dir()) if characters.is_dir() else ():
        normal = character / character.name
        shadow = character / f'{character.name} with shadows'
        if not normal.is_dir():
            continue
        animations, paths = [], []
        prefix = character.name + '_'
        for path in sorted(normal.glob(f'{character.name}_*.png')):
            action = path.stem.removeprefix(prefix)
            width, height, _ = png_info(path)
            if height != 100 or width % 100:
                raise ValueError(f'invalid Tiny RPG animation geometry: {path}')
            frames = width // 100
            sheets = [{'path': path.relative_to(root).as_posix(), 'frame_w': 100, 'frame_h': 100,
                       'cols': frames, 'rows': 1, 'variant': 'shadowless'}]
            paths.append(path)
            companion = shadow / path.name
            if companion.is_file():
                if png_info(companion)[:2] != (width, height):
                    raise ValueError(f'shadow sheet geometry mismatch: {companion}')
                sheets.append({**sheets[0], 'path': companion.relative_to(root).as_posix(), 'variant': 'shadow'})
                paths.append(companion)
            animations.append({'name': action.lower(), 'frames': list(range(frames)), 'sheets': sheets})
        if not animations:
            continue
        files = [source(root, path, i == 0) for i, path in enumerate(paths)]
        width, height, alpha = png_info(paths[0])
        slug = re.sub(r'[^a-z0-9]+', '-', character.name.lower()).strip('-')
        cards.append({
            'schema': collection['schema'], 'vocab': collection['vocab'],
            'id': f"{collection['id'].rsplit('@', 1)[0]}/characters/{slug}@{collection['id'].rsplit('@', 1)[1]}",
            'card_type': 'asset', 'status': 'measured', 'title': character.name,
            'kind': 'sprite', 'subkind': 'character', 'collection': collection['id'],
            'source': {'files': files, 'content_hash': files[0]['sha256']},
            'image': {'width_px': width, 'height_px': height, 'has_alpha': alpha, 'pixel_art': True},
            'sprite': {'drawn_view': 'side', 'animations': animations},
            'provenance': {'*': {'by': 'code', 'tool': 'tinyrpg-layout@0.1', 'at': NOW,
                                 'input': 'split animation sheets, 100px frame geometry'}},
        })
    projectiles = {}
    for path in sorted(root.rglob('*(32x32).png')):
        if not any('projectile' in part.lower() for part in path.relative_to(root).parts):
            continue
        name = path.name.removesuffix('(32x32).png')
        if name in projectiles:
            if path.read_bytes() != projectiles[name].read_bytes():
                raise ValueError(f'ambiguous projectile: {name}')
            continue
        projectiles[name] = path
    for name, path in projectiles.items():
        alternate = path.with_name(f'{name}(100x100).png')
        paths = [path] + ([alternate] if alternate.is_file() else [])
        files = [source(root, p, i == 0) for i, p in enumerate(paths)]
        width, height, alpha = png_info(path)
        slug = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
        cards.append({
            'schema': collection['schema'], 'vocab': collection['vocab'],
            'id': f"{collection['id'].rsplit('@', 1)[0]}/projectiles/{slug}@{collection['id'].rsplit('@', 1)[1]}",
            'card_type': 'asset', 'status': 'measured', 'title': name,
            'kind': 'sprite', 'subkind': 'item', 'collection': collection['id'],
            'source': {'files': files, 'content_hash': files[0]['sha256']},
            'image': {'width_px': width, 'height_px': height, 'has_alpha': alpha, 'pixel_art': True},
            'sprite': {'drawn_view': 'side'},
            'provenance': {'*': {'by': 'code', 'tool': 'tinyrpg-layout@0.1', 'at': NOW,
                                 'input': 'projectile PNG and matching size sibling'}},
        })
    return cards
