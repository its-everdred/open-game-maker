"""Fit, animate and render one rig/motion cell through the pack camera (Blender 4.3, CPU; #1202 rig spike).

Usage: blender -b --factory-startup --python render_motion.py -- <out_dir> <spec.json> [key=value ...]
spec: {"mesh": glb, "rotz": deg, "motion": {"kind": "kaykit"|"bvh"|"handkey"|"none", "path", "action",
       "frames": [f0, f1] | "auto", "loop": true, "foot_ik": true, "clip": "walk"|"attack"},
       "weapon": {"path": glb, "bone": "hand.R", "length": 0.3, "spin": deg}}
keys: rows=1,2 (sheet rows E=0 SE=1 S=2 ...)  frames=15  cell=128  height_px=43  origin_row=88  engine=cycles|workbench
      samples=32 supersample=1 threads=6
Camera, light and scale match gpu_bake_rig.py: orthographic, 60 deg from vertical, yaw 45; the rig's rest pose in the
S view is scaled to height_px. Writes raw_<row>_<col>.png, feet.json (screen px of each foot's heel and ball per
frame, scored by score_cell.py), fit.json (landmarks, skinning report, retarget report) and render.json.
"""
import json
import math
import os
import sys
import time

import bpy
import numpy as np
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fit_rig  # noqa: E402
import retarget  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:]
OUT, SPEC = argv[0], json.load(open(argv[1]))
P = {'rows': '1,2', 'frames': 15, 'cell': 128, 'height_px': 43.0, 'origin_row': 88.0, 'engine': 'cycles',
     'samples': 32, 'supersample': 1, 'threads': 6, 'sun_elev': 55.0, 'sun_az': -60.0, 'sun_energy': 4.0, 'sky': 0.35}
for kv in argv[2:]:
    k, v = kv.split('=', 1)
    P[k] = v if k in ('rows', 'engine') else float(v)
CELL, SS, N = int(P['cell']), int(P['supersample']), int(P['frames'])
UNIT_PX = CELL / (2 * math.sqrt(2))


def scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    if P['engine'] == 'workbench':  # silhouettes for fast motion scoring (masks only)
        sc.render.engine = 'BLENDER_WORKBENCH'
        sc.display.shading.light = 'FLAT'
        sc.display.shading.color_type = 'TEXTURE'
    else:
        sc.render.engine = 'CYCLES'
        sc.cycles.device = 'CPU'
        sc.cycles.samples = int(P['samples'])
        sc.cycles.use_denoising = False
    sc.render.threads_mode = 'FIXED'
    sc.render.threads = int(P['threads'])
    sc.render.resolution_x = sc.render.resolution_y = CELL * SS
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.view_settings.view_transform = 'Standard'
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = P['sky']
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.75, 0.8, 0.9, 1)
    sc.world = world
    cam = bpy.data.cameras.new('cam')
    cam.type = 'ORTHO'
    cam.ortho_scale = CELL / UNIT_PX
    cam.shift_y = P['origin_row'] / CELL - 0.5
    co = bpy.data.objects.new('cam', cam)
    sc.collection.objects.link(co)
    co.rotation_euler = (math.radians(60), 0, math.radians(45))
    co.location = -(co.rotation_euler.to_matrix() @ Vector((0, 0, -1))) * 30
    cam.clip_end = 100
    sc.camera = co
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.angle = math.radians(8)
    sun.energy = P['sun_energy']
    so = bpy.data.objects.new('sun', sun)
    sc.collection.objects.link(so)
    so.rotation_euler = (math.radians(90 - P['sun_elev']), 0, math.radians(45 + P['sun_az']))
    return sc


def matte(ob):
    for m in ob.data.materials:  # as the Stage 1 bake: no metallic sheen from generated PBR maps
        if m and m.use_nodes:
            b = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
            if b:
                for name, val in (('Metallic', 0.0), ('Roughness', 0.85)):
                    for link in list(b.inputs[name].links):
                        m.node_tree.links.remove(link)
                    b.inputs[name].default_value = val


def weapon(rig, w):
    """A separate weapon mesh on a hand bone: its longest axis along the grip, scaled to `length` (rig units)."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=w['path'])
    new = [o for o in bpy.data.objects if o not in before]
    ob, M = fit_rig.prepare(new, 0.0, apply_pose=False)
    v = fit_rig.verts(ob)
    ext = v.max(0) - v.min(0)
    ax = int(ext.argmax())  # the long axis becomes the grip axis (bone-local X: across the fist)
    s = w.get('length', 0.3) / ext[ax]
    lo = v.min(0)
    grip = lo.copy()
    grip[ax] = lo[ax] + ext[ax] * w.get('grip', 0.25)  # hold near the end of the handle
    for i in range(3):
        if i != ax:
            grip[i] = (v[:, i].min() + v[:, i].max()) / 2
    to_x = {0: Matrix(), 1: Matrix.Rotation(-math.pi / 2, 4, 'Z'), 2: Matrix.Rotation(math.pi / 2, 4, 'Y')}[ax]
    ob.data.transform(Matrix.Rotation(math.radians(w.get('spin', 0)), 4, 'X') @ to_x @ Matrix.Scale(s, 4) @
                      Matrix.Translation(Vector(-grip)))
    pb = rig.pose.bones[w.get('bone', 'hand.R')]
    ob.parent = rig
    ob.parent_type = 'BONE'
    ob.parent_bone = pb.name
    # parent space is the bone tail; put the grip at 60% along the hand
    ob.matrix_parent_inverse = Matrix()
    ob.location = (0, -pb.bone.length * 0.4, 0)
    matte(ob)
    return ob


def motion(rig, mo):
    kind = mo.get('kind', 'none')
    if kind == 'none':
        return {}
    if kind == 'handkey':
        import handkey
        return handkey.build(rig, mo, N)
    src = retarget.import_source('bvh' if kind == 'bvh' else 'gltf', mo['path'], mo.get('action'))
    if kind == 'bvh':
        bpy.context.scene.render.fps = 30
    fr = mo.get('frames', 'auto')
    loop = mo.get('loop', mo.get('clip', 'walk') == 'walk')  # an attack is a one-shot unless a spec says otherwise
    m = retarget.bone_map(src)
    if fr == 'auto' or not fr:
        a = src.animation_data.action
        f0, f1 = a.frame_range
        if loop and kind == 'bvh':
            f0, f1 = retarget.pick_cycle(src, m, f0, f1)
        elif kind == 'bvh':
            f0, f1 = retarget.pick_strike(src, m, f0, f1, mo.get('seconds', 1.1), mo.get('fps', 30.0))
    else:
        f0, f1 = fr
    rep = retarget.retarget(src, rig, f0, f1, n=N, loop=loop, foot_ik=mo.get('foot_ik', True), mapping=m,
                          stance=mo.get('stance'))
    bpy.data.objects.remove(src)
    return rep


def foot_points(rig):
    out = {}
    for s in 'LR':
        f = rig.pose.bones[f'foot.{s}']
        h = rig.pose.bones[f'heel.02.{s}']
        out[s] = {'ball': rig.matrix_world @ f.tail, 'heel': rig.matrix_world @ ((h.head + h.tail) / 2)}
    return out


def fitted(spec):
    """Fit once per mesh: the fitted mesh, rig and weights are cached beside the mesh's cells and appended after."""
    cache = spec.get('rig_cache')
    key = {'mesh': os.path.abspath(spec['mesh']), 'mtime': os.path.getmtime(spec['mesh']), 'rotz': spec.get('rotz', 0),
           'fit_rig': os.path.getmtime(fit_rig.__file__)}  # a new mesh, turn or fitter refits
    if cache and os.path.exists(cache) and os.path.exists(cache + '.json') and \
            json.load(open(cache + '.json')).get('key') == key:
        with bpy.data.libraries.load(cache) as (src, dst):
            dst.objects = ['fit_mesh', 'rig']
        for o in dst.objects:
            bpy.context.scene.collection.objects.link(o)
        info = json.load(open(cache + '.json'))
        lm = {k: (np.array(v) if isinstance(v, list) else v) for k, v in info['landmarks'].items()}
        return dst.objects[0], dst.objects[1], lm, info['skin'] | {'cached': cache}
    ob, rig, lm, rep = fit_rig.fit(spec['mesh'], spec.get('rotz', 0), debug=f'{OUT}/landmarks.png')
    if cache:
        ob.name, rig.name = 'fit_mesh', 'rig'
        bpy.ops.file.pack_all()
        bpy.data.libraries.write(cache, {ob, rig}, fake_user=True)
        json.dump({'key': key, 'landmarks': {k: (v.tolist() if hasattr(v, 'tolist') else v) for k, v in lm.items()},
                   'skin': rep},
                  open(cache + '.json', 'w'))
    return ob, rig, lm, rep


def main():
    t0 = time.time()
    sc = scene()
    os.makedirs(OUT, exist_ok=True)
    ob, rig, lm, rep = fitted(SPEC)
    matte(ob)
    wob = weapon(rig, SPEC['weapon']) if SPEC.get('weapon') else None
    mrep = motion(rig, SPEC.get('motion', {}))
    root = bpy.data.objects.new('root', None)
    sc.collection.objects.link(root)
    rig.parent = root
    rig.data.pose_position = 'REST'
    root.rotation_euler = (0, 0, math.radians(45))  # S view
    bpy.context.view_layer.update()
    ys = []
    dg = bpy.context.evaluated_depsgraph_get()
    for o in [ob] + ([wob] if wob else []):
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        ys += [world_to_camera_view(sc, sc.camera, ev.matrix_world @ v.co).y for v in me.vertices if o is ob]
        ev.to_mesh_clear()
    s = P['height_px'] / ((max(ys) - min(ys)) * CELL)
    root.scale = (s, s, s)
    rig.data.pose_position = 'POSE'
    os.makedirs(OUT, exist_ok=True)
    for old in os.listdir(OUT):
        if old.startswith('raw_') and old.endswith('.png'):
            os.remove(os.path.join(OUT, old))
    feet = {}
    rows = [int(r) for r in str(P['rows']).split(',')]
    for row in rows:
        root.rotation_euler = (0, 0, math.radians(135 - 45 * row))
        feet[row] = []
        for col in range(N):
            sc.frame_set(1 + col)
            fp = foot_points(rig)
            feet[row].append({sd: {k: list(world_to_camera_view(sc, sc.camera, w))[:2] + [w.z]
                                   for k, w in d.items()} for sd, d in fp.items()})
            sc.render.filepath = f'{OUT}/raw_{row}_{col}.png'
            bpy.ops.render.render(write_still=True)
    def px(w):  # camera-view [0, 1] coordinates -> cell pixels (x right, y down)
        x, y = world_to_camera_view(sc, sc.camera, w)[:2]
        return [x * CELL, (1 - y) * CELL]
    for row in feet:  # keep world height for contact
        for fr in feet[row]:
            for d in fr.values():
                for k, (x, y, z) in d.items():
                    d[k] = [x * CELL, (1 - y) * CELL, z]
    forward = {}
    for row in rows:  # the screen direction the character faces in each row: the ground moves against it
        root.rotation_euler = (0, 0, math.radians(135 - 45 * row))
        bpy.context.view_layer.update()
        o = root.matrix_world.translation
        a, b = px(o), px(o + root.matrix_world.to_3x3().normalized() @ Vector((0, -1, 0)))
        forward[row] = [b[0] - a[0], b[1] - a[1]]
    json.dump({'cell': CELL, 'scale': s, 'unit_px': UNIT_PX, 'forward': forward, 'feet': feet},
              open(f'{OUT}/feet.json', 'w'))
    json.dump({'landmarks': {k: (v.tolist() if hasattr(v, 'tolist') else v) for k, v in lm.items()},
               'skin': rep, 'motion': {k: v for k, v in mrep.items() if k != 'map'}, 'map': mrep.get('map')},
              open(f'{OUT}/fit.json', 'w'), indent=1, default=str)
    json.dump({'blender': bpy.app.version_string, 'backend': 'CPU', 'engine': P['engine'], 'samples': int(P['samples']),
               'cell': CELL, 'scale': s, 'render_minutes': round((time.time() - t0) / 60, 2), 'params': P,
               'spec': SPEC}, open(f'{OUT}/render.json', 'w'), indent=1)


main()
