"""Finish and export four rendered vegetation views with inherited rights.

This only packages existing render files; it does not approve them or bypass the
reference/review gate. Source packs are read-only. Output must be a separate set.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import shutil
import tempfile

import numpy as np
from PIL import Image

from finish import finish
from vegetation_card import make_card


def _outside_packs(path):
    resolved = Path(path).resolve()
    if 'packs' in resolved.parts:
        raise ValueError('pack directories are read-only')
    return resolved


def export(render_dir, set_dir, slug, source_card, source_collection, recipe):
    """Create a new variant folder and cards without modifying any source file."""
    render_dir, set_dir = _outside_packs(render_dir), _outside_packs(set_dir)
    if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', slug):
        raise ValueError('invalid variant slug')
    if source_card.get('collection') != source_collection.get('id'):
        raise ValueError('source card and source collection do not match')
    if source_card.get('card_type') != 'asset' or source_collection.get('card_type') != 'collection':
        raise ValueError('source cards must be an asset and its collection')
    if not source_collection.get('rights') or not source_collection.get('license'):
        raise ValueError('source collection must contain confirmed rights and license')
    if not isinstance(recipe, dict) or not recipe:
        raise ValueError('a nonempty render recipe is required')
    if set_dir == render_dir or set_dir.is_relative_to(render_dir) or render_dir.is_relative_to(set_dir):
        raise ValueError('render and output directories must not overlap')
    set_dir.mkdir(parents=True, exist_ok=True)
    collection_path = set_dir / 'collection.card.json'
    if collection_path.exists():
        collection = json.loads(collection_path.read_text())
        if (collection.get('id') != 't1:smallscaleint-vegetation@1'
                or collection.get('rights') != source_collection['rights']
                or collection.get('license') != source_collection['license']
                or source_collection['id'] not in collection.get('collection_info', {}).get('requires', [])):
            raise ValueError('existing collection does not preserve source rights')
    else:
        collection = {
            'schema': 'ogm.asset-card/1.0', 'vocab': '2026-10-27',
            'id': 't1:smallscaleint-vegetation@1', 'card_type': 'collection', 'status': 'draft',
            'title': 'SmallScaleInt vegetation variants', 'license': source_collection['license'],
            'rights': source_collection['rights'],
            'collection_info': {'vendor': 'smallscaleint', 'version': '1', 'origin': 'agent-made',
                                'counts': {}, 'requires': [source_collection['id']]},
            'provenance': {'*': {'by': 'code', 'tool': 'gm-sprite-forge',
                                 'at': datetime.now(timezone.utc).isoformat()}},
        }
    target = set_dir / slug
    if target.exists() or target.is_symlink():
        raise FileExistsError(f'variant already exists: {target}')
    with tempfile.TemporaryDirectory(prefix='.vegetation-', dir=set_dir) as temp:
        staged = Path(temp)
        for view in 'NESW':
            path = _outside_packs(render_dir / f'{view}.png')
            with Image.open(path) as image:
                if image.format != 'PNG' or image.size != (256, 256) or image.mode != 'RGBA':
                    raise ValueError(f'{view} must be a 256x256 RGBA PNG')
                pixels = np.asarray(image)
            Image.fromarray(finish(pixels)).save(staged / f'{slug}_{view}.png')
        card = make_card(staged, slug, source_card['id'])
        for item in card['source']['files']:
            item['path'] = f"{slug}/{item['path']}"
        card['sprite']['facings'] = {view: f'{slug}/{name}' for view, name in card['sprite']['facings'].items()}
        card['license'], card['rights'] = collection['license'], collection['rights']
        (staged / f'{slug}.card.json').write_text(json.dumps(card, indent=2) + '\n')
        (staged / 'recipe.json').write_text(json.dumps({**recipe, 'derived_from': source_card['id'],
                                                        'ai_generated': True}, indent=2) + '\n')
        # mkdir is exclusive. A failed copy removes only this newly created folder.
        target.mkdir()
        try:
            card_path = staged / f'{slug}.card.json'
            for path in staged.iterdir():
                if path != card_path:
                    shutil.copy2(path, target / path.name)
            if not collection_path.exists():
                with collection_path.open('x') as f:
                    f.write(json.dumps(collection, indent=2) + '\n')
            # Publish the card last, after its files and recipe exist.
            shutil.copy2(card_path, target / card_path.name)
        except Exception:
            shutil.rmtree(target)
            raise
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('render_dir', type=Path, help='directory containing N.png, E.png, S.png, W.png')
    parser.add_argument('set_dir', type=Path)
    parser.add_argument('slug')
    parser.add_argument('--source-card', type=Path, required=True)
    parser.add_argument('--source-collection', type=Path, required=True)
    parser.add_argument('--recipe', type=Path, required=True)
    args = parser.parse_args()
    print(export(args.render_dir, args.set_dir, args.slug, json.loads(args.source_card.read_text()),
                 json.loads(args.source_collection.read_text()), json.loads(args.recipe.read_text())))


if __name__ == '__main__':
    main()
