"""Assemble individual review cells for a seven-column vegetation matrix.

The manifest names local source, render and mock PNGs. Outputs are review media,
not approved game assets. This tool does not submit a Command or modify packs.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import tempfile

import numpy as np
from PIL import Image

from finish import finish
from vegetation_export import _outside_packs
from vegetation_footprint import compare


def assemble(manifest, output, recipe):
    """Create Original, V1–V5 and Mock cells for each uniquely named row."""
    output = _outside_packs(output)
    rows = manifest.get('rows') if isinstance(manifest, dict) else None
    if not isinstance(rows, list) or not 10 <= len(rows) <= 16:
        raise ValueError('matrix needs 10 to 16 rows')
    if not isinstance(recipe, dict) or not recipe:
        raise ValueError('a nonempty review recipe is required')
    seen_ids, seen_names = set(), set()
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError('each row must be an object')
        slug, name, variants = row.get('id'), row.get('name'), row.get('variants')
        if not isinstance(slug, str) or not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', slug):
            raise ValueError('row ID must be a lowercase slug')
        if not isinstance(name, str) or not name.strip() or '/' in name or len(name) > 100:
            raise ValueError('row name must be nonempty, at most 100 characters, and contain no slash')
        if slug in seen_ids or name in seen_names:
            raise ValueError('row IDs and names must be unique')
        if not isinstance(variants, list) or len(variants) != 5 or not all(isinstance(v, str) for v in variants):
            raise ValueError('each row needs exactly five render paths')
        if not isinstance(row.get('original'), str) or not isinstance(row.get('mock'), str):
            raise ValueError('each row needs original and mock paths')
        seen_ids.add(slug)
        seen_names.add(name)
    if output.exists() or output.is_symlink():
        raise FileExistsError(f'review directory already exists: {output}')
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.matrix-', dir=output.parent) as temp:
        stage = Path(temp)
        options = []
        for row in rows:
            labels = ['Original', 'V1', 'V2', 'V3', 'V4', 'V5', 'Mock']
            paths = [row['original'], *row['variants'], row['mock']]
            variant_hashes = set()
            for index, (label, path) in enumerate(zip(labels, paths)):
                with Image.open(path) as image:
                    image.load()
                    if image.format != 'PNG' or image.width != image.height:
                        raise ValueError(f'{row["name"]} / {label} must be a square PNG')
                    rgba = image.convert('RGBA')
                    if index != 6 and rgba.size != (256, 256):
                        raise ValueError(f'{row["name"]} / {label} must be 256x256')
                    if index == 6:
                        rgba = rgba.resize((256, 256), Image.Resampling.NEAREST)
                    elif index:
                        rgba = Image.fromarray(finish(np.asarray(rgba)))
                if 1 <= index <= 5:
                    if not compare(row['original'], rgba)['pass']:
                        raise ValueError(f'{row["name"]} / {label} fails the 15% footprint and shadow gate')
                    variant_hashes.add(hashlib.sha256(rgba.tobytes()).digest())
                background = Image.new('RGBA', (256, 256), (78, 78, 78, 255))
                background.alpha_composite(rgba)
                cell = background.convert('RGB').resize((1024, 1024), Image.Resampling.NEAREST)
                filename = f'{row["id"]}-{label.lower()}.png'
                cell.save(stage / filename)
                options.append({'id': f'{row["id"]}-{label.lower()}', 'label': f'{row["name"]} / {label}',
                                'media': [{'kind': 'image', 'mime_type': 'image/png',
                                           'locator': str(output / filename),
                                           'alt_text': f'{row["name"]}, {label}'}]})
            if len(variant_hashes) != 5:
                raise ValueError(f'{row["name"]} has duplicate render cells')
        (stage / 'recipe.json').write_text(json.dumps(recipe, indent=2) + '\n')
        (stage / 'options.json').write_text(json.dumps(options, indent=2) + '\n')
        output.mkdir()
        try:
            # Publish options last, after every image and recipe is present.
            options_file = stage / 'options.json'
            for path in stage.iterdir():
                if path != options_file:
                    shutil.copy2(path, output / path.name)
            shutil.copy2(options_file, output / options_file.name)
        except Exception:
            shutil.rmtree(output)
            raise
    return options


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--recipe', type=Path, required=True)
    args = parser.parse_args()
    options = assemble(json.loads(args.manifest.read_text()), args.output, json.loads(args.recipe.read_text()))
    print(f'Prepared {len(options)} review cells at {args.output}')


if __name__ == '__main__':
    main()
