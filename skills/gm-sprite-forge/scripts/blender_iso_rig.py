"""SmallScaleInt-style iso render rig for Blender 4.3 (CPU Cycles, headless).

Usage: blender -b --factory-startup --python blender_iso_rig.py -- <scene> <out_dir> [key=value ...]
  scene: 'tile'  -> a 1x1 ground tile (camera calibration against Ground/BLACK TILE)
         'rock'  -> the Stone A12 boulder rebuild (primitive mesh; shape=1|2|3)
         'hull'  -> an OBJ from carve_hull.py (env SPRITE_OBJ), to test the shading rig on the pack's own silhouettes
  key=value overrides: yaw0 (deg), sun_elev, sun_az, samples, band_hi/band_mid/band_lo (0-255 grey levels)

Camera (measured, report section 'Projection'): orthographic, 60 deg from vertical (30 deg elevation), yaw 45 deg,
256 x 256 px, 1 world unit = 128/sqrt(2) px, so a 1x1 tile is a 128 x 64 px diamond; world origin at pixel (128, 208).
Shading: toon by normal.light through a constant ColorRamp (emission, so no renderer lighting noise), plus a shadow
catcher ground for the soft contact shadow. Pixel filter 0.01 = point sampling: hard object edges, no anti-aliasing.
Outputs <out_dir>/<scene>_<N|E|S|W>.png (four yaws 90 deg apart). Marks nothing in the pack; writes only to out_dir.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
SCENE, OUT = argv[0], argv[1]
P = {'yaw0': 0.0, 'sun_elev': 65.0, 'sun_az': -30.0, 'samples': 64,
     'band_hi': 130, 'band_mid': 109, 'band_lo': 62, 'seed': 3,
     'ramp_mid': 0.25, 'ramp_hi': 0.62, 'shape': 1, 'sheet': 0, 'cell': 64,
     'frame_start': 1, 'frame_end': 15}
VIEWS = 'NWSE'
for kv in argv[2:]:
    k, v = kv.split('=')
    if k == 'views':
        VIEWS = v
    else:
        P[k] = float(v)

PX = int(P['cell']) if P['sheet'] else 256
if PX not in (64, 128, 256):
    raise ValueError('cell must be 64 or 128')
UNIT_PX = PX / (2 * math.sqrt(2))


def srgb_to_lin(c):
    c = c / 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = int(P['samples'])
    sc.cycles.use_denoising = False
    sc.cycles.pixel_filter_type = 'BOX'
    sc.cycles.filter_width = 0.01
    sc.render.resolution_x = sc.render.resolution_y = PX
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    world = bpy.data.worlds.new('w')
    world.color = (0, 0, 0)
    sc.world = world
    return sc


def camera(sc):
    cam = bpy.data.cameras.new('cam')
    cam.type = 'ORTHO'
    cam.ortho_scale = PX / UNIT_PX
    cam.shift_y = (208 - 128) / 256  # world origin lands at pixel row 208
    obj = bpy.data.objects.new('cam', cam)
    sc.collection.objects.link(obj)
    obj.rotation_euler = (math.radians(60), 0, math.radians(45))
    fwd = obj.rotation_euler.to_matrix() @ Vector((0, 0, -1))
    obj.location = -fwd * 20
    sc.camera = obj
    return obj


def sun_vector():
    el, az = math.radians(P['sun_elev']), math.radians(45 + P['sun_az'])
    # direction *towards* the light, in world space; az measured like the camera yaw
    return Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el))).normalized()


def toon_material(name, rgb_hi, rgb_mid, rgb_lo, noise=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    emit = nt.nodes.new('ShaderNodeEmission')
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    dot = nt.nodes.new('ShaderNodeVectorMath')
    dot.operation = 'DOT_PRODUCT'
    dot.inputs[1].default_value = sun_vector()
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.interpolation = 'CONSTANT'
    el = ramp.color_ramp.elements
    el[0].position, el[1].position = 0.0, P['ramp_hi']
    el[0].color = (*[srgb_to_lin(c) for c in rgb_lo], 1)
    el[1].color = (*[srgb_to_lin(c) for c in rgb_hi], 1)
    mid = el.new(P['ramp_mid'])
    mid.color = (*[srgb_to_lin(c) for c in rgb_mid], 1)
    nt.links.new(geo.outputs['Normal'], dot.inputs[0])
    nt.links.new(dot.outputs['Value'], ramp.inputs['Fac'])
    col = ramp.outputs['Color']
    if noise:
        tex = nt.nodes.new('ShaderNodeTexNoise')
        tex.inputs['Scale'].default_value = 18
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = noise
        nt.links.new(col, mix.inputs[6])
        nt.links.new(tex.outputs['Color'], mix.inputs[7])
        col = mix.outputs[2]
    nt.links.new(col, emit.inputs['Color'])
    nt.links.new(emit.outputs['Emission'], out.inputs['Surface'])
    return m


def shadow_catcher(sc):
    bpy.ops.mesh.primitive_plane_add(size=4, location=(0, 0, -0.002 if SCENE == 'tile' else 0))
    g = bpy.context.object
    g.is_shadow_catcher = True
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.angle = math.radians(25)  # soft contact shadow
    sun.energy = 3
    so = bpy.data.objects.new('sun', sun)
    sc.collection.objects.link(so)
    so.rotation_euler = sun_vector().to_track_quat('Z', 'Y').to_euler()
    return g


def tile(sc):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, -0.123))
    t = bpy.context.object
    t.scale = (1, 1, 0.25)  # top face 0.002 above the shadow catcher (no z-fighting)
    t.data.materials.append(toon_material('tile', (90, 140, 90), (70, 110, 70), (40, 70, 40)))
    return [t]


def rock(sc):
    import random
    random.seed(int(P['seed']))
    objs = []
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0.02, 0.0, 0.2))
    b = bpy.context.object
    b.scale = (0.62, 0.5, 0.42)
    b.rotation_euler = (math.radians(4), math.radians(-6), math.radians(18))
    if P['shape'] == 2:  # v2: taller, top sloping down to one side, faceted (less bevel), irregular
        b.location = (0.05, 0.02, 0.26)
        b.scale = (0.6, 0.5, 0.52)
        b.rotation_euler = (math.radians(14), math.radians(-12), math.radians(30))
    if P['shape'] == 3:  # v2: v1 footprint, top sloping slightly, a little wider
        b.scale = (0.66, 0.52, 0.42)
        b.rotation_euler = (math.radians(8), math.radians(-9), math.radians(22))
    bev = b.modifiers.new('bevel', 'BEVEL')
    bev.width, bev.segments = (0.16, 4) if P['shape'] == 1 else (0.2, 2)
    if P['shape'] == 2:
        disp = b.modifiers.new('disp', 'DISPLACE')
        tex = bpy.data.textures.new('lumps', 'VORONOI')
        tex.noise_scale = 0.6
        disp.texture, disp.strength = tex, 0.08
    sub = b.modifiers.new('sub', 'SUBSURF')
    sub.levels = sub.render_levels = 1
    bpy.ops.object.shade_smooth()
    b.data.materials.append(toon_material('boulder', (P['band_hi'],) * 2 + (P['band_hi'] - 8,),
                                          (P['band_mid'],) * 2 + (P['band_mid'] - 8,),
                                          (P['band_lo'],) * 2 + (P['band_lo'] - 6,), noise=0.08))
    objs.append(b)
    pebbles = [((-0.33, -0.36, 0.06), 0.12, (128, 118, 102)), ((-0.05, -0.42, 0.04), 0.08, (100, 100, 96)),
               ((0.36, -0.30, 0.05), 0.10, (118, 110, 98))]
    if P['shape'] == 2:  # pebbles cluster at the boulder's left foot, bigger, tan + grey
        pebbles = [((-0.42, -0.18, 0.09), 0.17, (128, 118, 102)), ((-0.30, -0.42, 0.06), 0.11, (100, 100, 96)),
                   ((-0.52, 0.12, 0.06), 0.10, (100, 100, 96)), ((-0.10, -0.47, 0.05), 0.08, (118, 110, 98))]
    if P['shape'] == 3:  # smaller pebbles, at the boulder's left/front foot
        pebbles = [((-0.40, -0.30, 0.05), 0.11, (128, 118, 102)), ((-0.18, -0.44, 0.04), 0.07, (100, 100, 96)),
                   ((-0.48, -0.05, 0.04), 0.07, (100, 100, 96))]
    # Seed 3 preserves the calibrated baseline. Other seeds reposition the
    # independently modelled pebbles so a rerun can produce a new sibling.
    offsets = random.Random(int(P['seed']))
    baseline = random.Random(3)
    for loc, r, rgb in pebbles:
        loc = (loc[0] + (offsets.random() - baseline.random()) * 0.1,
               loc[1] + (offsets.random() - baseline.random()) * 0.1, loc[2])
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=r, location=loc)
        p = bpy.context.object
        p.scale = (1.15, 1.0, 0.7)
        bpy.ops.object.shade_smooth()
        lo = tuple(int(c * 0.5) for c in rgb)
        mid = tuple(int(c * 0.84) for c in rgb)
        p.data.materials.append(toon_material('pebble', rgb, mid, lo))
        objs.append(p)
    return objs


def cube(sc):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.5))
    obj = bpy.context.object
    obj.data.materials.append(toon_material('cube', (180, 120, 80), (130, 80, 50), (70, 40, 25)))
    bpy.ops.mesh.primitive_cube_add(size=0.24, location=(0.4, 0, 1.12))
    marker = bpy.context.object
    marker.data.materials.append(toon_material('marker', (200, 50, 50), (150, 30, 30), (90, 20, 20)))
    return [obj, marker]


def blend(sc):
    with bpy.data.libraries.load(os.environ['SPRITE_BLEND']) as (source, target):
        target.objects = source.objects
    objects = [obj for obj in target.objects if obj is not None and obj.type in {'MESH', 'ARMATURE', 'EMPTY'}]
    for obj in objects:
        if obj.parent is not None and obj.parent not in objects:
            obj.parent = None
        sc.collection.objects.link(obj)
    return [obj for obj in objects if obj.parent is None]


def hull(sc):
    """A carved proxy (carve_hull.py OBJ, path in env SPRITE_OBJ), one toon material, smooth shaded."""
    import os
    bpy.ops.wm.obj_import(filepath=os.environ['SPRITE_OBJ'], forward_axis='Y', up_axis='Z')
    h = bpy.context.selected_objects[0]
    bpy.context.view_layer.objects.active = h
    sm_ = h.modifiers.new('smooth', 'SMOOTH')
    sm_.iterations = int(P.get('smooth', 4))
    bpy.ops.object.shade_smooth()
    h.data.materials.clear()
    h.data.materials.append(toon_material('hull', (P['band_hi'],) * 2 + (P['band_hi'] - 8,),
                                          (P['band_mid'],) * 2 + (P['band_mid'] - 8,),
                                          (P['band_lo'],) * 2 + (P['band_lo'] - 6,), noise=0.05))
    return [h]


def vegetation_palette(name, defaults):
    palette = tuple(tuple(P.get(f'{name}_{band}_{channel}', colour[index])
                          for index, channel in enumerate('rgb'))
                    for band, colour in zip(('hi', 'mid', 'lo'), defaults))
    if any(not math.isfinite(c) or not 0 <= c <= 255 for colour in palette for c in colour):
        raise ValueError('vegetation palette channels must be in 0..255')
    return palette


def vegetation(sc):
    from vegetation_mesh import bush, cluster, conifer, tree
    defaults = ((165, 111, 30), (123, 73, 17), (70, 41, 8)) if P.get('autumn', 0) else ((102, 145, 63), (75, 113, 46), (40, 67, 28))
    palette = vegetation_palette('foliage', defaults)
    green = toon_material('foliage', *palette, noise=0.08)
    if SCENE == 'plant':
        return cluster(int(P['seed']), green, count=int(P.get('count', 5)), extent=P.get('extent', 0.2),
                       height=P.get('plant_height', 0.18), leafy=bool(P.get('leafy', 0)),
                       leaves_per_cluster=int(P.get('leaves_per_cluster', 12)),
                       leaf_width=P.get('leaf_width', 1),
                       leaf_shading=bool(P.get('leaf_shading', 0)), batch_size=int(P.get('batch_size', 1)),
                       batch_radius=P.get('batch_radius', 0.05))
    if SCENE == 'bush':
        masses = bush(int(P['seed']), green, scale=P.get('height', 1),
                      count=int(P.get('bush_mass_count', 9)), mass_radius=P.get('bush_mass_radius', .15))
        if P.get('bush_leaf_detail', 0):
            from vegetation_bush_detail import leaf_cards
            def shade(factor):
                return tuple(tuple(min(255, c * factor) for c in band) for band in palette)
            bright = toon_material('leaf-bright', *shade(1.35))
            dark = toon_material('leaf-dark', *shade(.70))
            masses.append(leaf_cards(masses, (green, bright, dark), int(P['seed'])))
        return masses
    bark = toon_material('bark', *vegetation_palette('bark', ((117, 87, 56), (92, 65, 42), (52, 37, 25))), noise=0.08)
    if SCENE == 'conifer':
        if P.get('branched', 0):
            from vegetation_conifer import conifer_boughs
            return conifer_boughs(int(P['seed']), bark, green, height=P.get('height', 1.2),
                                  lean=P.get('lean', 0.1), tiers=int(P.get('tiers', 14)),
                                  spokes=int(P.get('spokes', 8)))
        return conifer(int(P['seed']), bark, green, height=P.get('height', 1.2), lean=P.get('lean', 0.1))
    return tree(int(P['seed']), bark, green, height=P.get('height', 1), lean=P.get('lean', 0.1), bare=SCENE == 'bare', dense=bool(P.get('dense', 0)), leaf_count=int(P.get('leaf_count', 24000)),
                branch_radius=P.get('branch_radius', 0.07),
                attachment_min=P.get('attachment_min', 0.55),
                crown_shape=(P.get('crown_width', 1), P.get('crown_depth', 1), P.get('crown_height', 1)),
                levels=int(P.get('levels', 3)), canopy_scale=P.get('canopy_scale', 1),
                fanout=int(P.get('fanout', 2)),
                spread=(P.get('spread_min', 0.55), P.get('spread_max', 0.85)))


def main():
    sc = reset()
    camera(sc)
    if P.get('shadows', 1):
        shadow_catcher(sc)
    objs = {'tile': tile, 'rock': rock, 'hull': hull, 'cube': cube, 'blend': blend, 'tree': vegetation, 'plant': vegetation, 'bush': vegetation, 'conifer': vegetation, 'bare': vegetation}[SCENE](sc)
    root = bpy.data.objects.new('root', None)
    sc.collection.objects.link(root)
    if SCENE == 'bare':
        spread = P.get('branch_width', 1.0)
        if not math.isfinite(spread) or spread <= 0:
            raise ValueError('branch_width must be positive and finite')
        root.scale = (spread, spread, 1.0)
    if SCENE == 'bush':
        vertical_scale = P.get('bush_vertical_scale', 1.0)
        if not math.isfinite(vertical_scale) or vertical_scale <= 0:
            raise ValueError('bush_vertical_scale must be positive and finite')
        root.scale = (1.0, 1.0, vertical_scale)
    for o in objs:
        o.parent = root
    os.makedirs(OUT, exist_ok=True)
    if P['sheet']:
        start, end = int(P['frame_start']), int(P['frame_end'])
        if end < start:
            raise ValueError('frame_end must be >= frame_start')
        for row in range(8):
            root.rotation_euler = (0, 0, math.radians(P['yaw0'] - 45 * row))
            for column in range(15):
                sc.frame_set(round(start + (end - start) * column / 14))
                sc.render.filepath = f'{OUT}/frame_{row}_{column}.png'
                bpy.ops.render.render(write_still=True)
        return
    for i, d in enumerate('NWSE'):
        if d not in VIEWS:
            continue
        root.rotation_euler = (0, 0, math.radians(P['yaw0'] + 90 * i))
        sc.render.filepath = f'{OUT}/{SCENE}_{d}.png'
        bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    main()
