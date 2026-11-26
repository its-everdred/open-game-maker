"""Blender side of pixel_preview.py: render many models through the pack camera, one process (Blender 4.3, CPU).

Usage: blender -b --factory-startup --python pixel_preview_rig.py -- <out_dir> <jobs.json> [key=value ...]
jobs.json: {"models": [{"name", "path"}], "anim": glb or null}
keys: dirs=S,SE  height_px=43  ref_height=0 (0 = median world height of the rigged characters in the run, else 1.8)
      samples=32 threads=2 margin=3 ss=1 passes=0
      finish C (#1338): ss=4 renders at 4x with a 0.01 px pixel filter (no anti-aliasing; pixel_finish_c.py
      downsamples by majority vote); passes=1 also writes alb_<name>_<dir>.png (diffuse colour, the material ID
      source) and depth_<name>_<dir>.png (16-bit, camera distance 20..40 units -> 0..1).
Camera, light and pixel scale match motion/render_motion.py: orthographic, 60 deg from vertical, yaw 45, 1 world unit
= 128/(2 sqrt 2) px; one scale for the whole run, chosen so a character of ref_height stands height_px tall. Rigged
characters take an action named like "idle" (their own, else from `anim` by bone name), else stay in their rest pose.
Writes raw_<name>_<dir>.png (transparent, cell sized to the model) and models.jsonl; marks nothing in any pack.
"""
import json
import math
import os
import sys
import time

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
OUT, JOBS = argv[0], json.load(open(argv[1]))
P = {'dirs': 'S,SE', 'height_px': 43.0, 'ref_height': 0.0, 'samples': 32, 'threads': 2, 'margin': 3,
     'ss': 1, 'passes': 0, 'sun_elev': 55.0, 'sun_az': -60.0, 'sun_energy': 4.0, 'sky': 0.35}
for kv in argv[2:]:
    k, v = kv.split('=', 1)
    P[k] = v if k == 'dirs' else float(v)
UNIT_PX = 128 / (2 * math.sqrt(2))
YAW = {'E': 135, 'SE': 90, 'S': 45, 'SW': 0, 'W': -45, 'NW': -90, 'N': -135, 'NE': 180}  # as render_motion rows
DIRS = P['dirs'].split(',')


def scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = int(P['samples'])
    sc.cycles.use_denoising = False
    sc.render.threads_mode = 'FIXED'
    sc.render.threads = int(P['threads'])
    sc.render.film_transparent = True
    if P['ss'] > 1:
        sc.cycles.filter_width = 0.01
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
    if P['passes']:
        passes(sc)
    return sc, co


def passes(sc):
    """Compositor: albedo and depth beside the colour render, written per render by name (see main)."""
    vl = sc.view_layers[0]
    vl.use_pass_diffuse_color = True
    vl.use_pass_z = True
    sc.use_nodes = True
    nt = sc.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    rl = nt.nodes.new('CompositorNodeRLayers')
    comp = nt.nodes.new('CompositorNodeComposite')
    nt.links.new(rl.outputs['Image'], comp.inputs['Image'])
    fo = nt.nodes.new('CompositorNodeOutputFile')
    fo.name = 'passes'
    fo.format.file_format = 'PNG'
    fo.format.color_mode = 'RGB'
    fo.file_slots.clear()
    fo.file_slots.new('alb_')
    fo.file_slots.new('depth_')
    fo.file_slots['depth_'].use_node_format = False
    fo.file_slots['depth_'].format.file_format = 'PNG'
    fo.file_slots['depth_'].format.color_mode = 'BW'
    fo.file_slots['depth_'].format.color_depth = '16'
    fo.file_slots['depth_'].format.color_management = 'OVERRIDE'
    fo.file_slots['depth_'].format.view_settings.view_transform = 'Raw'
    nt.links.new(rl.outputs['DiffCol'], fo.inputs['alb_'])
    mr = nt.nodes.new('CompositorNodeMapRange')
    mr.inputs['From Min'].default_value, mr.inputs['From Max'].default_value = 20, 40
    mr.use_clamp = True
    nt.links.new(rl.outputs['Depth'], mr.inputs['Value'])
    nt.links.new(mr.outputs['Value'], fo.inputs['depth_'])


def render_to(sc, path):
    """Render one still; with passes on, move the compositor's frame-numbered files next to it by name."""
    sc.render.filepath = path
    if P['passes']:
        fo = sc.node_tree.nodes['passes']
        fo.base_path = os.path.dirname(path) + '/.passes'
    bpy.ops.render.render(write_still=True)
    if P['passes']:
        tail = os.path.basename(path)[len('raw_'):]
        for k in ('alb_', 'depth_'):
            src = os.path.join(fo.base_path, f'{k}{sc.frame_current:04d}.png')
            os.replace(src, os.path.join(os.path.dirname(path), k + tail))


def clear(keep):
    for o in list(bpy.data.objects):
        if o not in keep:
            bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials, bpy.data.images, bpy.data.actions):
        for d in list(coll):
            if not d.use_fake_user:
                if d.users == 0 or coll is bpy.data.actions:
                    coll.remove(d)


def load(path):
    before = set(bpy.data.objects)
    ext = path.lower().rsplit('.', 1)[-1]
    if ext in ('glb', 'gltf'):
        bpy.ops.import_scene.gltf(filepath=path)
    elif ext == 'fbx':
        bpy.ops.import_scene.fbx(filepath=path)
    elif ext == 'obj':
        bpy.ops.wm.obj_import(filepath=path)
    else:
        raise ValueError(f'unsupported model: {path}')
    return [o for o in bpy.data.objects if o not in before]


def matte(objs):  # as render_motion.matte: no metallic sheen
    for ob in objs:
        if ob.type != 'MESH':
            continue
        for m in ob.data.materials:
            if m and m.use_nodes:
                b = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
                if b:
                    for name, val in (('Metallic', 0.0), ('Roughness', 0.85)):
                        for link in list(b.inputs[name].links):
                            m.node_tree.links.remove(link)
                        b.inputs[name].default_value = val


def rigged_meshes(objs):
    return [o for o in objs if o.type == 'MESH' and any(m.type == 'ARMATURE' and m.object for m in o.modifiers)]


def idle(objs, library, own):
    """Pose each armature on an idle action: its own first, else one from the library whose bones it shares."""
    name = None
    for arm in (o for o in objs if o.type == 'ARMATURE'):
        bones = {b.name for b in arm.data.bones}
        pick = next(iter(sorted([a for a in own if 'idle' in a.name.lower()], key=lambda a: len(a.name))), None)
        if pick is None:
            fits = [a for a in library if len({fc.data_path.split('"')[1] for fc in a.fcurves
                                               if fc.data_path.startswith('pose.bones')} & bones) >= 0.5 * len(bones)]
            pick = next(iter(sorted(fits, key=lambda a: len(a.name))), None)
        if pick is None:
            continue
        arm.animation_data_create()
        for t in list(arm.animation_data.nla_tracks):
            arm.animation_data.nla_tracks.remove(t)
        arm.animation_data.action = pick
        bpy.context.scene.frame_set(int(pick.frame_range[0]))
        name = pick.name
    return name


def visible_meshes(objs):
    return [o for o in objs if o.type == 'MESH' and not o.hide_render and o.visible_get()]


def world_points(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in visible_meshes(objs):
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        pts += [ev.matrix_world @ v.co for v in me.vertices]
        ev.to_mesh_clear()
    return pts


def main():
    t0 = time.time()
    sc, cam = scene()
    keep = set(bpy.data.objects)
    library = []
    if JOBS.get('anim'):
        new = load(JOBS['anim'])
        library = [a for a in bpy.data.actions if 'idle' in a.name.lower()]
        for a in library:
            a.use_fake_user = True
        for o in new:
            bpy.data.objects.remove(o, do_unlink=True)
    os.makedirs(OUT, exist_ok=True)
    models, heights = [], []
    for job in JOBS['models']:  # pass 1: what each file is, and the characters' height for the run's scale
        rec = dict(job)
        try:
            objs = load(job['path'])
        except Exception as e:  # a broken file is reported, not fatal to the pack
            rec['error'] = str(e)[:200]
            models.append(rec)
            clear(keep)
            continue
        rec['character'] = bool(rigged_meshes(objs))
        pts = world_points(objs)
        if not pts:
            rec['error'] = 'no visible mesh'
        elif rec['character']:
            heights.append(max(p.z for p in pts) - min(p.z for p in pts))
        models.append(rec)
        clear(keep)
    ref = P['ref_height'] or (sorted(heights)[len(heights) // 2] if heights else 1.8)
    scale = P['height_px'] / (ref * UNIT_PX * math.sin(math.radians(60)))
    log = open(os.path.join(OUT, 'models.jsonl'), 'w')
    for rec in models:
        if 'error' in rec:
            log.write(json.dumps(rec) + '\n')
            continue
        acts = set(bpy.data.actions)
        objs = load(rec['path'])
        matte(objs)
        own = [a for a in bpy.data.actions if a not in acts]
        rec['idle'] = idle(objs, library, own) if rec['character'] else None
        root = bpy.data.objects.new('root', None)
        sc.collection.objects.link(root)
        for o in objs:
            if o.parent is None:
                o.parent = root
        root.scale = (scale,) * 3
        inv = cam.matrix_world.inverted()
        boxes = {}
        for d in DIRS:
            root.rotation_euler = (0, 0, math.radians(YAW[d]))
            bpy.context.view_layer.update()
            xy = [(inv @ p) * UNIT_PX for p in world_points(objs)]
            boxes[d] = (min(v.x for v in xy), max(v.x for v in xy), min(v.y for v in xy), max(v.y for v in xy))
        span = max(max(b[1] - b[0], b[3] - b[2]) for b in boxes.values())
        cell = max(32, int(math.ceil((span + 2 * P['margin']) / 16) * 16))
        sc.render.resolution_x = sc.render.resolution_y = cell * int(P['ss'])
        cam.data.ortho_scale = cell / UNIT_PX
        for d in DIRS:
            x0, x1, y0, y1 = boxes[d]
            root.rotation_euler = (0, 0, math.radians(YAW[d]))
            cam.data.shift_x, cam.data.shift_y = (x0 + x1) / 2 / cell, (y0 + y1) / 2 / cell
            render_to(sc, os.path.join(OUT, f"raw_{rec['name']}_{d}.png"))
        cam.data.shift_x = cam.data.shift_y = 0
        rec.update(cell=cell, dirs=DIRS)
        log.write(json.dumps(rec) + '\n')
        log.flush()
        clear(keep)
    json.dump({'blender': bpy.app.version_string, 'scale': scale, 'ref_height': ref, 'unit_px': UNIT_PX,
               'params': P, 'minutes': round((time.time() - t0) / 60, 2)},
              open(os.path.join(OUT, 'render.json'), 'w'), indent=1)


main()
