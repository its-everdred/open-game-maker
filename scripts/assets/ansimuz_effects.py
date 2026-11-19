"""Group locally supplied effect frames into measured sprite cards."""
import re
from pathlib import Path
from limezu_gif import metadata
from smallscaleint import NOW, natural, png_info, source


def build_cards(root: Path, collection: dict) -> list[dict]:
    cards = []
    for directory in sorted(p for p in root.rglob('*') if p.is_dir() and p.name.lower() == 'sprites'):
        frames = sorted(directory.glob('*.png'), key=natural)
        if not frames:
            continue
        width, height, alpha = png_info(frames[0])
        if any(png_info(path)[:2] != (width, height) for path in frames):
            raise ValueError(f'inconsistent effect frames: {directory}')
        parent = directory.parent
        sheets = [p for p in sorted(parent.glob('*.png')) if png_info(p)[:2] == (width * len(frames), height)]
        primary = sheets[0] if len(sheets) == 1 else frames[0]
        paths = [primary, *(p for p in frames if p != primary)]
        gif = next((p for p in sorted(parent.iterdir()) if p.suffix.lower() == '.gif'), None)
        animation = {'name': 'effect', 'frames': list(range(len(frames)))}
        if primary in sheets:
            animation['sheets'] = [{'path': primary.relative_to(root).as_posix(), 'frame_w': width, 'frame_h': height,
                                    'cols': len(frames), 'rows': 1}]
        else:
            animation['files'] = [p.relative_to(root).as_posix() for p in frames]
        if gif:
            info = metadata(gif)
            if info['frames'] == len(frames) and info['fps'] is not None:
                animation['fps'] = info['fps']
            paths.append(gif)
        files = [source(root, path, i == 0) for i, path in enumerate(paths)]
        iw, ih, ia = png_info(primary)
        name = parent.name if parent != root else 'Explosion'
        relative = parent.relative_to(root).as_posix() if parent != root else 'explosion'
        slug = re.sub(r'[^a-z0-9/]+', '-', relative.lower()).strip('-')
        cards.append({
            'schema': collection['schema'], 'vocab': collection['vocab'],
            'id': f"{collection['id'].rsplit('@', 1)[0]}/{slug}@{collection['id'].rsplit('@', 1)[1]}",
            'card_type': 'asset', 'status': 'measured', 'title': name,
            'kind': 'sprite', 'subkind': 'fx', 'collection': collection['id'],
            'source': {'files': files, 'content_hash': files[0]['sha256']},
            'image': {'width_px': iw, 'height_px': ih, 'has_alpha': ia, 'pixel_art': True},
            'sprite': {'drawn_view': 'none', 'animations': [animation]},
            'provenance': {'*': {'by': 'code', 'tool': 'ansimuz-effects@0.1', 'at': NOW,
                                 'input': 'frame PNGs and matching sheet and GIF'}},
        })
    return cards
