"""Normalize per-candidate controls for draft vegetation renders."""

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
