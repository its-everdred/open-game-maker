"""Discover equivalent Modern Farm assets without modifying vendor files."""
from collections import defaultdict
from pathlib import Path
import re

_SIZE = re.compile(r'(?i)(?:^|[_ -])(?:16x16|32x32|48x48)(?=$|[_ .-])')


def key(path: Path) -> str:
    """Normalize size suffixes while retaining the complete category path."""
    parts = [re.sub(r'_+(?=\.)', '', _SIZE.sub('', part)).strip('_ -').lower() for part in path.parts]
    return '/'.join('0_complete_tileset' if part == '0_complete_tileset_singles' else part for part in parts)


def variant_index(root: Path) -> dict[tuple[str, str], list[Path]]:
    index = defaultdict(list)
    for size in ('16x16', '32x32', '48x48'):
        for path in (root / size).rglob('*'):
            if path.is_file():
                index[(size, key(path.relative_to(root / size)))].append(path)
    return index


def size_variants(root: Path, canonical: Path, index=None) -> list[Path]:
    relative = canonical.relative_to(root / '32x32')
    index = index if index is not None else variant_index(root)
    variants = []
    for size in ('16x16', '48x48'):
        matches = index.get((size, key(relative)), [])
        if len(matches) > 1:
            raise ValueError(f'ambiguous {size} variant for {relative}')
        variants.extend(matches)
    return variants


def filename_tags(title: str) -> dict:
    words = re.findall(r'[a-z]+', title.lower())
    return {'objects': list(dict.fromkeys(['farm', *words[:1]]))}


def build_cards(root: Path, collection: dict) -> list[dict]:
    """Create one measured sprite card per canonical 32 px PNG.

    Sibling resolutions are companion originals, not separate device-tier variants.
    """
    from smallscaleint import NOW, png_info, source
    from limezu_gif import metadata

    index = variant_index(root)
    cards = []
    seen = set()

    def animations(gif, title, canonical_sheet=None):
        result, sources = [], []
        for current in [gif, *size_variants(root, gif, index)]:
            info = metadata(current)
            sources.append(current)
            animation = {'name': title, 'frames': list(range(info['frames'])),
                         'frame_size': {'width': info['width'], 'height': info['height']}}
            if info['fps'] is not None:
                animation['fps'] = info['fps']
            size = current.relative_to(root).parts[0]
            matches = index.get((size, key(canonical_sheet.relative_to(root / '32x32'))), []) if canonical_sheet else []
            if len(matches) > 1:
                raise ValueError(f'ambiguous {size} animation sheet for {gif}')
            if matches:
                width, height, _ = png_info(matches[0])
                fw, fh = info['width'], info['height']
                if width % fw == 0 and height % fh == 0 and width // fw * (height // fh) == info['frames']:
                    animation['sheets'] = [{'path': matches[0].relative_to(root).as_posix(), 'frame_w': fw,
                                            'frame_h': fh, 'cols': width // fw, 'rows': height // fh}]
            if 'sheets' not in animation:
                animation['files'] = [current.relative_to(root).as_posix()]
            result.append(animation)
        return result, sources

    for path in sorted((root / '32x32').rglob('*.png')):
        relative = path.relative_to(root / '32x32')
        normalized = key(relative)
        rel_id = re.sub(r'[^a-z0-9/]+', '-', normalized.removesuffix('.png')).strip('-')
        if rel_id in seen:
            raise ValueError(f'duplicate Modern Farm card id: {rel_id}')
        seen.add(rel_id)
        title = _SIZE.sub('', path.stem).strip('_ -').replace('_', ' ')
        category = normalized.split('/', 1)[0]
        subkind = 'character' if category.startswith(('characters', 'animals')) else 'item' if 'pickup' in normalized else 'tile' if 'autotile' in category else 'prop'
        files = [source(root, path, True), *(source(root, p) for p in size_variants(root, path, index))]
        width, height, alpha = png_info(path)
        sprite = {'drawn_view': 'topdown', 'tile_px': 32}
        if path.parent.name == 'Animated_sheets_32x32':
            gif = path.parent.parent / 'Animated_gifs_32x32' / (path.stem + '.gif')
            if gif.is_file():
                info = metadata(gif)
                found_animations, gif_sources = animations(gif, title, path)
                files.extend(source(root, p) for p in gif_sources)
                fw, fh = info['width'], info['height']
                if 'sheets' not in found_animations[0]:
                    if width % fw == 0 and height % fh == 0:
                        sprite['sheet'] = {'frame_w': fw, 'frame_h': fh,
                                           'cols': width // fw, 'rows': height // fh}
                sprite['animations'] = found_animations
        cards.append({
            'schema': collection['schema'], 'vocab': collection['vocab'],
            'id': f"{collection['id'].rsplit('@', 1)[0]}/{rel_id}@{collection['id'].rsplit('@', 1)[1]}",
            'card_type': 'asset', 'status': 'measured', 'title': title,
            'kind': 'sprite', 'subkind': subkind, 'collection': collection['id'],
            'describe': filename_tags(title),
            'source': {'files': files, 'content_hash': files[0]['sha256']},
            'image': {'width_px': width, 'height_px': height, 'has_alpha': alpha, 'pixel_art': True},
            'sprite': sprite,
            'provenance': {'*': {'by': 'code', 'tool': 'limezu-layout@0.1', 'at': NOW,
                                 'input': '32px PNG and matching resolution siblings'},
                           'describe': {'by': 'filename', 'tool': 'limezu-layout@0.1', 'at': NOW,
                                        'input': 'pack and filename'}},
        })
    icons = root / 'Icons'
    def icon_key(path):
        return re.sub(r'(?i)(?:^|[_ -])(?:16x16|24x24|32x32)(?=$|[_ ./-])', '', path.as_posix()).lower()
    icon_index = defaultdict(list)
    for size in (16, 24):
        directory = icons / f'Icons_{size}x{size}'
        for path in directory.rglob('*.png'):
            icon_index[(size, icon_key(path.relative_to(directory)))].append(path)
    icon_dir = icons / 'Icons_32x32'
    for path in sorted(icon_dir.rglob('*.png')):
        relative = path.relative_to(icon_dir)
        normalized = icon_key(relative)
        rel_id = 'icons/' + re.sub(r'[^a-z0-9/]+', '-', normalized.removesuffix('.png')).strip('-')
        if rel_id in seen:
            raise ValueError(f'duplicate Modern Farm card id: {rel_id}')
        seen.add(rel_id)
        siblings = []
        for size in (16, 24):
            matches = icon_index.get((size, normalized), [])
            if len(matches) > 1:
                raise ValueError(f'ambiguous icon variant for {relative}')
            siblings.extend(matches)
        files = [source(root, path, True), *(source(root, p) for p in siblings)]
        width, height, alpha = png_info(path)
        title = _SIZE.sub('', path.stem).strip('_ -').replace('_', ' ')
        cards.append({
            'schema': collection['schema'], 'vocab': collection['vocab'],
            'id': f"{collection['id'].rsplit('@', 1)[0]}/{rel_id}@{collection['id'].rsplit('@', 1)[1]}",
            'card_type': 'asset', 'status': 'measured', 'title': title,
            'kind': 'sprite', 'subkind': 'item', 'collection': collection['id'],
            'describe': filename_tags(title),
            'source': {'files': files, 'content_hash': files[0]['sha256']},
            'image': {'width_px': width, 'height_px': height, 'has_alpha': alpha, 'pixel_art': True},
            'sprite': {'drawn_view': 'none', 'tile_px': 32},
            'provenance': {'*': {'by': 'code', 'tool': 'limezu-layout@0.1', 'at': NOW,
                                 'input': '32px icon and matching resolution siblings'},
                           'describe': {'by': 'filename', 'tool': 'limezu-layout@0.1', 'at': NOW,
                                        'input': 'pack and filename'}},
        })
    gif_dir = root / '32x32' / 'Animated_32x32' / 'Animated_gifs_32x32'
    strip_dir = gif_dir.parent / 'Animated_sheets_32x32'
    for gif in sorted(gif_dir.glob('*.gif')):
        if (strip_dir / (gif.stem + '.png')).is_file():
            continue
        info = metadata(gif)
        normalized = key(gif.relative_to(root / '32x32'))
        rel_id = re.sub(r'[^a-z0-9/]+', '-', normalized.removesuffix('.gif')).strip('-')
        if rel_id in seen:
            raise ValueError(f'duplicate Modern Farm card id: {rel_id}')
        seen.add(rel_id)
        title = _SIZE.sub('', gif.stem).strip('_ -').replace('_', ' ')
        files = [source(root, gif, True), *(source(root, p) for p in size_variants(root, gif, index))]
        found_animations, _ = animations(gif, title)
        cards.append({
            'schema': collection['schema'], 'vocab': collection['vocab'],
            'id': f"{collection['id'].rsplit('@', 1)[0]}/{rel_id}@{collection['id'].rsplit('@', 1)[1]}",
            'card_type': 'asset', 'status': 'measured', 'title': title,
            'kind': 'sprite', 'subkind': 'fx', 'collection': collection['id'],
            'describe': filename_tags(title),
            'source': {'files': files, 'content_hash': files[0]['sha256']},
            'image': {'width_px': info['width'], 'height_px': info['height'],
                      'has_alpha': info['has_alpha'], 'pixel_art': True},
            'sprite': {'drawn_view': 'topdown', 'tile_px': 32, 'animations': found_animations},
            'provenance': {'*': {'by': 'code', 'tool': 'limezu-layout@0.1', 'at': NOW,
                                 'input': 'GIF metadata and matching resolution siblings'},
                           'describe': {'by': 'filename', 'tool': 'limezu-layout@0.1', 'at': NOW,
                                        'input': 'pack and filename'}},
        })
    return cards
