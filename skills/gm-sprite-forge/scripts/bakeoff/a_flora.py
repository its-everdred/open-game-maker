"""Arm A, Flora B1: procedural dry-grass clump. ~30 tufts in an irregular square footprint, ~110 tapered,
curved blades each (one mesh), dry-straw shader with per-blade colour variation."""
import math
import random

import bpy
from mathutils import Vector


def straw():
    m = bpy.data.materials.new('straw')
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    attr = nt.nodes.new('ShaderNodeAttribute')
    attr.attribute_name = 'tint'
    attr.attribute_type = 'GEOMETRY'
    nt.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.7
    return m


def build(P):
    rnd = random.Random(int(P.get('seed', 11)))
    verts, faces, cols = [], [], []
    half = 0.5
    tufts = []
    while len(tufts) < 70:
        x, y = rnd.uniform(-half, half), rnd.uniform(-half, half)
        if max(abs(x), abs(y)) < half * rnd.uniform(0.8, 1.0):
            tufts.append((x, y))
    for tx, ty in tufts:
        h0 = rnd.uniform(0.2, 0.34) * (1.25 - 0.6 * max(abs(tx), abs(ty)) / half)
        for _ in range(80):
            ang = rnd.uniform(0, 2 * math.pi)
            r = abs(rnd.gauss(0, 0.07))
            base = Vector((tx + math.cos(ang) * r, ty + math.sin(ang) * r, 0))
            out = Vector((math.cos(ang), math.sin(ang), 0))
            h = h0 * rnd.uniform(0.6, 1.15)
            lean = rnd.uniform(0.2, 0.9)
            w = rnd.uniform(0.006, 0.011)
            side = Vector((-out.y, out.x, 0)) * w
            tint = (rnd.uniform(0.55, 0.8), rnd.uniform(0.27, 0.4), rnd.uniform(0.08, 0.14))
            seg = 4
            kb = rnd.choice((0.6, 0.85, 1.0, 1.0, 1.25))
            start = len(verts)
            for i in range(seg + 1):
                t = i / seg
                p = base + out * (lean * h * t * t) + Vector((0, 0, h * t * (1 - 0.25 * lean * t)))
                taper = 1 - t
                verts += [p - side * taper, p + side * taper]
                bright = (0.55 + 0.6 * t) * kb
                cols += [tuple(c * bright for c in tint)] * 2
            for i in range(seg):
                a = start + 2 * i
                faces.append((a, a + 1, a + 3, a + 2))
    me = bpy.data.meshes.new('flora')
    me.from_pydata(verts, [], faces)
    attr = me.color_attributes.new('tint', 'FLOAT_COLOR', 'POINT')
    for i, c in enumerate(cols):
        attr.data[i].color = (*c, 1)
    ob = bpy.data.objects.new('flora', me)
    bpy.context.scene.collection.objects.link(ob)
    ob.data.materials.append(straw())
    return [ob]
