"""Arm B: an existing CC0 model, imported unchanged except for optional material-based face removal.
env MODEL=<.gltf/.glb/.fbx/.obj>  DROP=<regex of material names whose faces are deleted, e.g. leaf>
    TINT=r,g,b (optional, multiplies base colour: restyle toward the pack hue before the shared colour pass)
    KEEP=<regex of object names to keep>"""
import os
import re

import bpy
import bmesh


def build(P):
    path = os.environ['MODEL']
    before = set(bpy.data.objects)
    ext = path.rsplit('.', 1)[1].lower()
    if ext in ('gltf', 'glb'):
        bpy.ops.import_scene.gltf(filepath=path)
    elif ext == 'fbx':
        bpy.ops.import_scene.fbx(filepath=path)
    else:
        bpy.ops.wm.obj_import(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    keep = os.environ.get('KEEP')
    if keep:
        for o in [o for o in new if o.type == 'MESH' and not re.search(keep, o.name, re.I)]:
            new.remove(o)
            bpy.data.objects.remove(o)
    print('B_MATERIALS', sorted({s.material.name for o in new if o.type == 'MESH' for s in o.material_slots if s.material}))
    drop = os.environ.get('DROP')
    for o in new:
        if o.type != 'MESH':
            continue
        if drop:
            idx = [i for i, s in enumerate(o.material_slots) if s.material and re.search(drop, s.material.name, re.I)]
            if idx:
                bm = bmesh.new()
                bm.from_mesh(o.data)
                bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index in idx], context='FACES')
                bm.to_mesh(o.data)
                bm.free()
    if os.environ.get('VCOL'):  # image-to-3D meshes carry colour per vertex
        m = bpy.data.materials.new('vcol')
        m.use_nodes = True
        nt = m.node_tree
        ca = nt.nodes.new('ShaderNodeVertexColor')
        nt.links.new(ca.outputs['Color'], nt.nodes['Principled BSDF'].inputs['Base Color'])
        nt.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.8
        for o in new:
            if o.type == 'MESH':
                o.data.materials.clear()
                o.data.materials.append(m)
                ca.layer_name = o.data.color_attributes[0].name if o.data.color_attributes else ''
    tint = os.environ.get('TINT')
    if tint:
        rgb = [float(c) for c in tint.split(',')]
        for m in {s.material for o in new if o.type == 'MESH' for s in o.material_slots if s.material}:
            nt = m.node_tree
            bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
            if not bsdf:
                continue
            mix = nt.nodes.new('ShaderNodeMix')
            mix.data_type = 'RGBA'
            mix.blend_type = 'MULTIPLY'
            mix.inputs['Factor'].default_value = 1
            mix.inputs[7].default_value = (*rgb, 1)
            src = bsdf.inputs['Base Color']
            if src.is_linked:
                nt.links.new(src.links[0].from_socket, mix.inputs[6])
            else:
                mix.inputs[6].default_value = src.default_value
            nt.links.new(mix.outputs[2], src)
    scatter = int(os.environ.get('SCATTER', 0))
    if scatter:  # SCATTER=N copies of the file's variants over one tile, each scaled to VH world units tall
        import random
        import mathutils
        rnd = random.Random(5)
        vh = float(os.environ.get('VH', 0.3))
        meshes = [o for o in new if o.type == 'MESH']
        bpy.context.view_layer.update()
        copies = []
        for i in range(scatter):
            src = rnd.choice(meshes)
            pts = [src.matrix_world @ mathutils.Vector(c) for c in src.bound_box]
            lo = mathutils.Vector([min(p[k] for p in pts) for k in range(3)])
            hi = mathutils.Vector([max(p[k] for p in pts) for k in range(3)])
            c = bpy.data.objects.new(f'{src.name}.{i}', src.data)
            bpy.context.scene.collection.objects.link(c)
            s = vh / max(hi.z - lo.z, 1e-6) * rnd.uniform(0.75, 1.15)
            c.matrix_world = (mathutils.Matrix.Translation((rnd.uniform(-.45, .45), rnd.uniform(-.45, .45), 0))
                              @ mathutils.Matrix.Rotation(rnd.uniform(0, 6.28), 4, 'Z') @ mathutils.Matrix.Scale(s, 4)
                              @ mathutils.Matrix.Translation(-mathutils.Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z)))
                              @ src.matrix_world)
            copies.append(c)
        for o in new:
            bpy.data.objects.remove(o)
        new = copies
    roots = [o for o in new if o.parent is None]
    import math
    import mathutils
    rx, rz = float(os.environ.get('ROTX', 0)), float(os.environ.get('ROTZ', 0))
    if rx or rz:  # ROTX/ROTZ degrees: fix image-to-3D axis conventions and the reference camera tilt
        R = mathutils.Matrix.Rotation(math.radians(rz), 4, 'Z') @ mathutils.Matrix.Rotation(math.radians(rx), 4, 'X')
        for r in roots:
            r.matrix_world = R @ r.matrix_world
    bpy.context.view_layer.update()
    import mathutils
    pts = [o.matrix_world @ mathutils.Vector(c) for o in new if o.type == 'MESH' for c in o.bound_box]
    cx = sum(p.x for p in pts) / len(pts)
    cy = sum(p.y for p in pts) / len(pts)
    zmin = min(p.z for p in pts)
    for r in roots:
        r.location -= mathutils.Vector((cx, cy, zmin))
    return roots
