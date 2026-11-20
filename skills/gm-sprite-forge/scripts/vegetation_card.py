"""Construct a traceable asset card for a finished four-view vegetation sprite."""
from datetime import datetime, timezone
import hashlib
from pathlib import Path
import re
from io import BytesIO

from PIL import Image


def make_card(directory: Path, slug: str, source_id: str) -> dict:
    """Read four finished PNGs without modifying them; return a schema-shaped card."""
    if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', slug):
        raise ValueError('slug must contain lowercase letters, digits and hyphens')
    if not source_id.startswith('t1:'):
        raise ValueError('source_id must identify a source asset')
    files = []
    facings = {}
    for direction in 'NESW':
        name = f'{slug}_{direction}.png'
        data = (directory / name).read_bytes()
        try:
            with Image.open(BytesIO(data)) as image:
                image.load()
                if image.format != 'PNG' or image.size != (256, 256) or image.mode != 'RGBA':
                    raise ValueError(f'{name} must be a 256x256 RGBA PNG')
        except OSError as exc:
            raise ValueError(f'{name} is not a valid PNG') from exc
        digest = 'sha256:' + hashlib.sha256(data).hexdigest()
        files.append({'path': name, 'sha256': digest, 'bytes': len(data), 'format': 'png',
                      'role': 'primary' if direction == 'N' else 'companion'})
        facings[direction] = name
    return {
        'schema': 'ogm.asset-card/1.0', 'vocab': '2026-10-27',
        'id': f't1:smallscaleint-vegetation/{slug}@1', 'card_type': 'asset',
        'status': 'measured', 'title': slug.replace('-', ' ').title(),
        'kind': 'sprite', 'subkind': 'tile', 'collection': 't1:smallscaleint-vegetation@1',
        'generation': {'method': 'ai', 'tool': 'gm-sprite-forge procedural'},
        'source': {'files': files, 'content_hash': files[0]['sha256']},
        'related': [{'rel': 'derived-from', 'id': source_id}],
        'image': {'width_px': 256, 'height_px': 256, 'has_alpha': True, 'pixel_art': True},
        'sprite': {'drawn_view': 'iso', 'facings': facings,
                   'tile': {'layer': 'decor', 'autotile': 'none'}},
        'provenance': {'*': {'by': 'code', 'tool': 'gm-sprite-forge',
                             'at': datetime.now(timezone.utc).isoformat()}},
    }
