"""Normalize per-candidate controls for draft vegetation renders."""
import math

CONTROLS = {'height', 'lean', 'canopy_scale', 'levels', 'count', 'extent', 'fanout',
            'spread_min', 'spread_max', 'leaf_count', 'crown_width', 'crown_depth',
            'crown_height', 'dense', 'autumn', 'shadows', 'leafy', 'plant_height',
            'leaves_per_cluster', 'leaf_shading', 'batch_size', 'batch_radius',
            'branched', 'tiers', 'spokes', 'samples'}


def matrix_parameters(job):
    allowed = CONTROLS | {'row', 'variant', 'scene', 'seed', 'yaw', 'palette'}
    if set(job) - allowed:
        raise ValueError('unknown matrix render options')
    result = {'height': 1, 'lean': 0.1, 'canopy_scale': 1, 'levels': 2,
              'fanout': 2, 'count': 6, 'extent': 0.2}
    result.update({key: job[key] for key in CONTROLS if key in job})
    result.update(seed=job['seed'], yaw0=job.get('yaw', 0))
    scene = job.get('scene')
    if type(result['seed']) is not int:
        raise ValueError('invalid seed')
    if ((result.get('leafy') and scene != 'plant') or (result.get('dense') and scene != 'tree')
            or (result.get('branched') and scene != 'conifer')
            or (result.get('leaf_shading') and not result.get('leafy'))):
        raise ValueError('style option does not apply to scene')
    limits = {'levels': (0, 5), 'count': (1, 100), 'fanout': (1, 4), 'leaf_count': (1, 100000),
              'leaves_per_cluster': (1, 64), 'batch_size': (1, 16), 'samples': (1, 256),
              'tiers': (2, 24), 'spokes': (3, 32)}
    for key, (low, high) in limits.items():
        if key in result and (type(result[key]) is not int or not low <= result[key] <= high):
            raise ValueError(f'invalid {key}')
    positive = ('height', 'canopy_scale', 'crown_width', 'crown_depth', 'crown_height', 'plant_height')
    nonnegative = ('lean', 'extent', 'batch_radius')
    for key in positive + nonnegative + ('spread_min', 'spread_max', 'yaw0'):
        if key in result and (not isinstance(result[key], (int, float)) or not math.isfinite(result[key])):
            raise ValueError(f'invalid {key}')
    if any(result.get(key, 1) <= 0 for key in positive) or any(result.get(key, 0) < 0 for key in nonnegative):
        raise ValueError('invalid geometry')
    if not 0 <= result.get('spread_min', 0.55) <= result.get('spread_max', 0.85) < 1:
        raise ValueError('invalid branch spread')
    if 'palette' in job:
        palette = job['palette']
        if not isinstance(palette, dict) or set(palette) != {'foliage', 'bark'}:
            raise ValueError('palette must contain foliage and bark')
        for material in ('foliage', 'bark'):
            bands = palette[material]
            if not isinstance(bands, dict) or set(bands) != {'hi', 'mid', 'lo'}:
                raise ValueError('palette must contain hi, mid and lo')
            for band, rgb in bands.items():
                if not isinstance(rgb, list) or len(rgb) != 3 or any(type(x) is not int or not 0 <= x <= 255 for x in rgb):
                    raise ValueError('palette values must be RGB integers in 0..255')
                result.update({f'{material}_{band}_{c}': value for c, value in zip('rgb', rgb)})
    return result
