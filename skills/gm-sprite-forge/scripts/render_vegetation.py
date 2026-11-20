"""Render four vegetation views and export them with a source card and recipe.

This command does not approve assets or bypass the required reference and creator
review gates. Use it only for variants already approved for production.
"""
import argparse
import json
import hashlib
import math
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

from vegetation_export import _outside_packs, export, validate_source

RIG = Path(__file__).with_name('blender_iso_rig.py')
GENERATOR_FILES = ('render_vegetation.py', 'blender_iso_rig.py', 'vegetation_mesh.py', 'vegetation_layout.py',
                   'vegetation_canopy.py', 'vegetation_leaves.py', 'vegetation_conifer.py',
                   'vegetation_export.py', 'vegetation_card.py', 'finish.py', 'spritemetrics.py')
SCENES = ('tree', 'bare', 'conifer', 'bush', 'plant')
BANDS = ('hi', 'mid', 'lo')


def palette_parameters(palette):
    """Validate a complete foliage and bark palette for reproducible renders."""
    if not isinstance(palette, dict) or set(palette) != {'foliage', 'bark'}:
        raise ValueError('palette must contain foliage and bark')
    result = {}
    for material in ('foliage', 'bark'):
        bands = palette[material]
        if not isinstance(bands, dict) or set(bands) != set(BANDS):
            raise ValueError('each material needs hi, mid and lo RGB bands')
        for band in BANDS:
            rgb = bands[band]
            if (not isinstance(rgb, list) or len(rgb) != 3
                    or any(type(value) is not int or not 0 <= value <= 255 for value in rgb)):
                raise ValueError('palette bands must be three integers in 0..255')
            result.update({f'{material}_{band}_{channel}': value for channel, value in zip('rgb', rgb)})
    return result


def render_variant(scene, output, slug, source_card, source_collection, *, seed, height=1.0,
                   lean=0.1, canopy_scale=1.0, levels=2, count=6, extent=0.2,
                   samples=8, dense=False, autumn=False, shadows=True, metadata=None,
                   fanout=2, spread_min=0.55, spread_max=0.85, leaf_count=24000,
                   crown_width=1.0, crown_depth=1.0, crown_height=1.0, palette=None,
                   leafy=False, plant_height=0.18, leaves_per_cluster=12, leaf_width=1.0, leaf_shading=False,
                   batch_size=1, batch_radius=0.05, branched=False, tiers=14, spokes=8, yaw=0.0):
    """Run a seeded four-view render, then package its finished outputs."""
    output = _outside_packs(output)
    if scene not in SCENES or not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', slug):
        raise ValueError('invalid scene or variant slug')
    if (not all(math.isfinite(v) for v in (height, lean, canopy_scale, extent, spread_min, spread_max,
                                            crown_width, crown_depth, crown_height, plant_height, leaf_width, batch_radius, yaw))
            or height <= 0 or lean < 0 or canopy_scale <= 0 or extent < 0
            or min(crown_width, crown_depth, crown_height, plant_height, leaf_width) <= 0
            or not isinstance(leaves_per_cluster, int) or not 1 <= leaves_per_cluster <= 64
            or not isinstance(batch_size, int) or not 1 <= batch_size <= 16 or batch_radius < 0
            or not 0 <= spread_min <= spread_max < 1
            or not isinstance(fanout, int) or not 1 <= fanout <= 4
            or not isinstance(leaf_count, int) or not 1 <= leaf_count <= 100000
            or not isinstance(levels, int) or not 0 <= levels <= 5
            or not isinstance(count, int) or not 1 <= count <= 100
            or not isinstance(samples, int) or not 1 <= samples <= 256
            or not isinstance(seed, int) or (leaf_shading and not leafy)
            or (leaf_width != 1.0 and not leafy)
            or (leafy and scene != 'plant') or (dense and scene != 'tree')
            or (branched and scene != 'conifer')
            or not isinstance(tiers, int) or not 2 <= tiers <= 24
            or not isinstance(spokes, int) or not 3 <= spokes <= 32):
        raise ValueError('invalid render parameters')
    validate_source(source_card, source_collection)
    if (not isinstance(metadata, dict) or not isinstance(metadata.get('agent'), dict)
            or not metadata['agent'].get('backend') or not metadata['agent'].get('model')
            or not isinstance(metadata.get('skills'), list) or not metadata['skills']
            or not isinstance(metadata.get('tool_versions'), dict) or not metadata['tool_versions'].get('blender')):
        raise ValueError('metadata must include agent backend/model, skills and Blender version')
    palette_values = palette_parameters(palette) if palette is not None else {}
    if (output / slug).exists() or (output / slug).is_symlink():
        raise FileExistsError(f'variant already exists: {output / slug}')
    params = {'seed': seed, 'height': height, 'lean': lean, 'canopy_scale': canopy_scale,
              'levels': levels, 'count': count, 'extent': extent, 'samples': samples,
              'dense': int(dense), 'autumn': int(autumn), 'shadows': int(shadows),
              'fanout': fanout, 'spread_min': spread_min, 'spread_max': spread_max,
              'leaf_count': leaf_count, 'crown_width': crown_width, 'crown_depth': crown_depth,
              'crown_height': crown_height, 'leafy': int(leafy), 'plant_height': plant_height,
              'leaves_per_cluster': leaves_per_cluster, 'leaf_width': leaf_width, 'leaf_shading': int(leaf_shading),
              'batch_size': batch_size, 'batch_radius': batch_radius,
              'branched': int(branched), 'tiers': tiers, 'spokes': spokes, 'yaw0': yaw, **palette_values}
    with tempfile.TemporaryDirectory(prefix='vegetation-render-') as temp:
        raw = Path(temp) / 'raw'
        raw.mkdir()
        cmd = ['nice', '-n', '10', 'blender', '-b', '--factory-startup', '--threads', '2',
               '--python-exit-code', '1', '--python', str(RIG), '--', scene, str(raw)]
        cmd.extend(f'{key}={value}' for key, value in params.items())
        subprocess.run(cmd, check=True)
        normalized = Path(temp) / 'views'
        normalized.mkdir()
        for view in 'NESW':
            shutil.copyfile(raw / f'{scene}_{view}.png', normalized / f'{view}.png')
        recipe = {**metadata, 'generator': 'gm-sprite-forge', 'scene': scene, 'rig': RIG.name,
                  'rig_sha256': hashlib.sha256(RIG.read_bytes()).hexdigest(),
                  'generator_sha256': {name: hashlib.sha256(RIG.with_name(name).read_bytes()).hexdigest()
                                       for name in GENERATOR_FILES},
                  'parameters': params, 'directions': list('NESW'),
                  'materials': {'palette': palette, 'default': 'autumn' if autumn else 'green',
                                'shading': 'stepped toon foliage and bark'}}
        return export(normalized, output, slug, source_card, source_collection, recipe)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('scene', choices=SCENES)
    parser.add_argument('set_dir', type=Path)
    parser.add_argument('slug')
    parser.add_argument('--source-card', type=Path, required=True)
    parser.add_argument('--source-collection', type=Path, required=True)
    parser.add_argument('--metadata', type=Path, required=True, help='JSON agent, skills and tool_versions provenance')
    parser.add_argument('--palette', type=Path, help='JSON foliage and bark hi/mid/lo RGB palette')
    parser.add_argument('--seed', type=int, required=True)
    parser.add_argument('--yaw', type=float, default=0.0)
    parser.add_argument('--height', type=float, default=1.0)
    parser.add_argument('--lean', type=float, default=0.1)
    parser.add_argument('--canopy-scale', type=float, default=1.0)
    parser.add_argument('--levels', type=int, default=2)
    parser.add_argument('--count', type=int, default=6)
    parser.add_argument('--extent', type=float, default=0.2)
    parser.add_argument('--samples', type=int, default=8)
    parser.add_argument('--fanout', type=int, default=2)
    parser.add_argument('--spread-min', type=float, default=0.55)
    parser.add_argument('--spread-max', type=float, default=0.85)
    parser.add_argument('--leaf-count', type=int, default=24000)
    parser.add_argument('--crown-width', type=float, default=1.0)
    parser.add_argument('--crown-depth', type=float, default=1.0)
    parser.add_argument('--crown-height', type=float, default=1.0)
    parser.add_argument('--dense', action='store_true')
    parser.add_argument('--leafy', action='store_true')
    parser.add_argument('--leaf-shading', action='store_true')
    parser.add_argument('--branched', action='store_true')
    parser.add_argument('--tiers', type=int, default=14)
    parser.add_argument('--spokes', type=int, default=8)
    parser.add_argument('--batch-size', type=int, default=1)
    parser.add_argument('--batch-radius', type=float, default=0.05)
    parser.add_argument('--plant-height', type=float, default=0.18)
    parser.add_argument('--leaves-per-cluster', type=int, default=12)
    parser.add_argument('--leaf-width', type=float, default=1.0)
    parser.add_argument('--autumn', action='store_true')
    parser.add_argument('--shadowless', action='store_true')
    args = parser.parse_args()
    result = render_variant(args.scene, args.set_dir, args.slug,
                            json.loads(args.source_card.read_text()), json.loads(args.source_collection.read_text()),
                            seed=args.seed, height=args.height, lean=args.lean, canopy_scale=args.canopy_scale,
                            levels=args.levels, count=args.count, extent=args.extent, samples=args.samples,
                            dense=args.dense, autumn=args.autumn, shadows=not args.shadowless,
                            metadata=json.loads(args.metadata.read_text()), fanout=args.fanout,
                            spread_min=args.spread_min, spread_max=args.spread_max, leaf_count=args.leaf_count,
                            crown_width=args.crown_width, crown_depth=args.crown_depth, crown_height=args.crown_height,
                            palette=json.loads(args.palette.read_text()) if args.palette else None, leafy=args.leafy,
                            plant_height=args.plant_height, leaves_per_cluster=args.leaves_per_cluster, leaf_width=args.leaf_width,
                            leaf_shading=args.leaf_shading, batch_size=args.batch_size, batch_radius=args.batch_radius,
                            branched=args.branched, tiers=args.tiers, spokes=args.spokes, yaw=args.yaw)
    print(result)


if __name__ == '__main__':
    main()
