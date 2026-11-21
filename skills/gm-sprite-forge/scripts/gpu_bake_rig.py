"""Shared GPU render rig for sprite bake-offs (Blender 4.3+, Cycles on OptiX/CUDA, headless).

Usage: blender -b --factory-startup --python gpu_bake_rig.py -- <out_dir> <builder.py> [key=value ...]
  builder.py defines build(P) -> list of root objects, built at any size around the origin, Z up, front -Y.
  keys: mode=props|sheet  height_px=<target sprite height>  cell=256|128|64  samples=128  supersample=4  shadow=1
        sun_elev=55 sun_az=-60 (deg, relative to the camera)  frame_start=1 frame_end=24 (sheet; a builder may set
        them, end = start of the next loop)  origin_row=<pixel row of the feet, default cell*208/256>
The builder may also set P['frame_start'] / P['frame_end'] for its own action.
Same camera for every arm: orthographic, 60 deg from vertical, yaw 45 deg, world origin at (cell/2, cell*208/256).
The model is scaled uniformly so its projected height in the S view equals height_px; nothing else is fitted.
props: writes <out>/raw_<N|E|S|W>.png at cell*supersample. sheet: raw_<row>_<col>.png for 8 rows
(E, SE, S, SW, W, NW, N, NE) x 15 frames. Finish with gpu_bake_finish.py. Writes only to out_dir; prints GPU use.
"""
import json
import math
import os
import runpy
import sys
import time

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
OUT, BUILDER = argv[0], argv[1]
P = {'mode': 'props', 'height_px': 150.0, 'cell': 256, 'samples': 128, 'supersample': 4,
     'sun_elev': 55.0, 'sun_az': -60.0, 'sun_energy': 4.0, 'sky': 0.35, 'shadow': 1, 'frame_start': 1, 'frame_end': 24}
for kv in argv[2:]:
    k, v = kv.split('=', 1)
    P[k] = v if k == 'mode' else float(v)
CELL = int(P['cell'])
P.setdefault('origin_row', CELL * 208 / 256)  # pixel row of the world origin (the feet); Goblin 01 uses 90
RES = CELL * int(P['supersample'])
UNIT_PX = CELL / (2 * math.sqrt(2))


def scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for backend in ('OPTIX', 'CUDA'):
        try:
            prefs.compute_device_type = backend
            prefs.get_devices()
        except TypeError:
            continue
        gpus = [d for d in prefs.devices if d.type == backend]
        if gpus:
            for d in prefs.devices:
                d.use = d.type == backend
            break
    else:
        raise SystemExit('no GPU backend: this rig refuses to fall back to CPU')
    sc.cycles.device = 'GPU'
    sc.cycles.samples = int(P['samples'])
    sc.cycles.use_denoising = True
    sc.render.resolution_x = sc.render.resolution_y = RES
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.view_settings.view_transform = 'Standard'
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = P['sky']
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.75, 0.8, 0.9, 1)
    sc.world = world
    print('RIG_BACKEND', prefs.compute_device_type, [d.name for d in prefs.devices if d.use])
    return sc


def camera(sc):
    cam = bpy.data.cameras.new('cam')
    cam.type = 'ORTHO'
    cam.ortho_scale = CELL / UNIT_PX
    cam.shift_y = P['origin_row'] / CELL - 0.5
    obj = bpy.data.objects.new('cam', cam)
    sc.collection.objects.link(obj)
    obj.rotation_euler = (math.radians(60), 0, math.radians(45))
    obj.location = -(obj.rotation_euler.to_matrix() @ Vector((0, 0, -1))) * 30
    cam.clip_end = 100
    sc.camera = obj
    return obj


def lights(sc):
    if P['shadow']:  # set shadow=0 when the original has no cast shadow
        bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 0, 0))
        bpy.context.object.is_shadow_catcher = True
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.angle = math.radians(8)
    sun.energy = P['sun_energy']
    so = bpy.data.objects.new('sun', sun)
    sc.collection.objects.link(so)
    so.rotation_euler = (math.radians(90 - P['sun_elev']), 0, math.radians(45 + P['sun_az']))


def projected_box(sc, objs):
    dg = bpy.context.evaluated_depsgraph_get()
    ys, xs = [], []
    for o in objs:
        for ob in [o] + list(o.children_recursive):
            if ob.type not in {'MESH', 'CURVE'}:
                continue
            ev = ob.evaluated_get(dg)
            mesh = ev.to_mesh()
            for v in mesh.vertices:
                c = world_to_camera_view(sc, sc.camera, ev.matrix_world @ v.co)
                xs.append(c.x)
                ys.append(c.y)
            ev.to_mesh_clear()
    return min(xs), max(xs), min(ys), max(ys)


def gpu_mb():
    try:
        import subprocess
        out = subprocess.run(['nvidia-smi', '--query-gpu=memory.used', '--format=csv,noheader,nounits'],
                             capture_output=True, text=True).stdout
        return int(out.split()[0])
    except Exception:
        return None


def main():
    t0 = time.time()
    sc = scene()
    camera(sc)
    lights(sc)
    objs = runpy.run_path(BUILDER)['build'](P)
    root = bpy.data.objects.new('root', None)
    sc.collection.objects.link(root)
    for o in objs:
        o.parent = root
    sc.frame_set(int(P['frame_start']))
    root.rotation_euler = (0, 0, math.radians(45 if P['mode'] == 'sheet' else 180))  # S view
    bpy.context.view_layer.update()
    x0, x1, y0, y1 = projected_box(sc, objs)
    s = P['height_px'] / ((y1 - y0) * CELL)
    root.scale = (s, s, s)
    os.makedirs(OUT, exist_ok=True)
    for old in os.listdir(OUT):  # a reused directory must not mix earlier props and sheet frames
        if old.startswith('raw_') and old.endswith('.png'):
            os.remove(os.path.join(OUT, old))
    peak = 0
    if P['mode'] == 'sheet':
        start, end = P['frame_start'], P['frame_end']
        for row in range(8):  # E, SE, S, SW, W, NW, N, NE; a -Y front faces the camera at yaw 45 (screen-right at 135)
            root.rotation_euler = (0, 0, math.radians(135 - 45 * row))
            for col in range(15):
                f = start + (end - start) * col / 15  # even steps; a 24-frame loop needs subframes
                sc.frame_set(math.floor(f), subframe=f - math.floor(f))
                sc.render.filepath = f'{OUT}/raw_{row}_{col}.png'
                bpy.ops.render.render(write_still=True)
                peak = max(peak, gpu_mb() or 0)
    else:
        for i, d in enumerate('NWSE'):
            root.rotation_euler = (0, 0, math.radians(90 * i))
            sc.render.filepath = f'{OUT}/raw_{d}.png'
            bpy.ops.render.render(write_still=True)
            peak = max(peak, gpu_mb() or 0)
    json.dump({'blender': bpy.app.version_string, 'backend': bpy.context.preferences.addons['cycles'].preferences
               .compute_device_type, 'samples': int(P['samples']), 'resolution': RES, 'cell': CELL,
               # device-wide memory in use after each render (includes other processes), not a per-process peak
               'scale': s, 'render_minutes': round((time.time() - t0) / 60, 2), 'peak_gpu_mb_total': peak,
               'params': P, 'builder': os.path.abspath(BUILDER)},
              open(f'{OUT}/render.json', 'w'), indent=2)


main()
