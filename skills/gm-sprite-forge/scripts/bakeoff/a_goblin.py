"""Arm A, Goblin 01: procedural sculpt. Skin-modifier body over the shared skeleton (lanky limbs, big head, ears,
nose), subdivided twice, clothing regions by position (leather top, grey shorts, leg wraps), shared walk + axe."""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gob_common as G  # noqa: E402

R = {'hips': .085, 'chest': .1, 'neck': .045, 'head': .085, 'sh': .045, 'el': .028, 'ha': .032, 'fi': .02,
     'hip': .05, 'kn': .033, 'an': .026, 'to': .022}


def build(P):
    rig = G.armature()
    verts, edges, radii = [], [], []
    idx = {}
    for k, p in G.J.items():
        idx[k] = len(verts)
        verts.append(p)
        radii.append(R[k.split('.')[0]])
    for _, a, b, _ in G.BONES:
        edges.append((idx[a], idx[b]))
    for s in 'LR':
        edges.append((idx['chest'], idx[f'sh.{s}']))
        edges.append((idx['hips'], idx[f'hip.{s}']))
    me = bpy.data.meshes.new('goblin')
    me.from_pydata(verts, edges, [])
    ob = bpy.data.objects.new('goblin', me)
    bpy.context.scene.collection.objects.link(ob)
    ob.modifiers.new('skin', 'SKIN')
    for i, r in enumerate(radii):
        me.skin_vertices[0].data[i].radius = (r, r * (1.2 if i == idx['chest'] else 1.0))
    me.skin_vertices[0].data[idx['hips']].use_root = True
    sub = ob.modifiers.new('sub', 'SUBSURF')
    sub.levels = sub.render_levels = 2
    bpy.context.view_layer.objects.active = ob
    for m in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)
    # ears, nose: long pointed cones joined into the body mesh
    parts = []
    for s, sx in (('L', 1), ('R', -1)):
        bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=0.035, depth=0.2,
                                        location=(sx * 0.13, -0.33, 0.83), rotation=(0, sx * math.radians(70), sx * math.radians(-15)))
        parts.append(bpy.context.object)
    bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=0.02, depth=0.07, location=(0, -0.45, 0.78),
                                    rotation=(math.radians(100), 0, 0))
    parts.append(bpy.context.object)
    for p in parts:
        p.select_set(True)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.join()
    bpy.ops.object.shade_smooth()
    mats = [G.material('skin', (0.16, 0.30, 0.04)), G.material('leather', (0.17, 0.07, 0.02)),
            G.material('shorts', (0.12, 0.12, 0.12)), G.material('wraps', (0.15, 0.06, 0.02))]
    for m in mats:
        ob.data.materials.append(m)
    for f in ob.data.polygons:
        c = f.center
        if 0.5 < c.z < 0.74 and abs(c.x) < 0.15:
            f.material_index = 1
        elif 0.36 < c.z <= 0.5 and abs(c.x) < 0.14:
            f.material_index = 2
        elif 0.06 < c.z < 0.26:
            f.material_index = 3
    G.bind(ob, rig)
    G.axe(rig, 'hand.R')
    G.walk(rig)
    P['frame_start'], P['frame_end'] = 1, 16
    return [rig]
