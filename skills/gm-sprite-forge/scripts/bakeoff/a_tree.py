"""Arm A, Tree E3: procedural bare tree (recursive branch curves, tapered radius, bark shader).
Space-colonisation-lite: straight short trunk, 4-5 scaffold limbs from ~35% height, 5 levels of forking twigs."""
import math
import random

import bpy
from mathutils import Vector


def bark():
    m = bpy.data.materials.new('bark')
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    noise = nt.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 40
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (0.055, 0.035, 0.018, 1)
    ramp.color_ramp.elements[1].color = (0.25, 0.17, 0.08, 1)
    nt.links.new(noise.outputs['Fac'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.85
    return m


def build(P):
    rnd = random.Random(int(P.get('seed', 7)))
    cu = bpy.data.curves.new('tree', 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = 1.0
    cu.bevel_resolution = 1
    cu.use_fill_caps = True

    def jitter(s):
        return Vector((rnd.gauss(0, s), rnd.gauss(0, s), rnd.gauss(0, s * 0.5)))

    def branch(start, d, length, r0, depth, wobble):
        seg = 4
        pts = [start]
        for i in range(seg):
            d = (d + jitter(wobble)).normalized()
            d.z += 0.04  # mild phototropism
            d.normalize()
            pts.append(pts[-1] + d * length / seg)
        sp = cu.splines.new('POLY')
        sp.points.add(seg)
        r1 = r0 * 0.55
        for i, p in enumerate(pts):
            sp.points[i].co = (*p, 1)
            sp.points[i].radius = max(0.0065, r0 + (r1 - r0) * i / seg)
        if depth == 0:
            return
        n = 3 if depth > 1 else rnd.randint(2, 4)
        for k in range(n):
            t = rnd.uniform(0.5, 1.0) if k else 1.0
            idx = max(1, min(seg, round(t * seg)))
            axis = (pts[idx] - pts[idx - 1]).normalized()
            side = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-.2, .5))).normalized()
            nd = (axis * 0.6 + side * rnd.uniform(0.5, 0.9)).normalized()
            branch(pts[idx], nd, length * rnd.uniform(0.7, 0.85), r1 * rnd.uniform(0.6, 0.85), depth - 1,
                   min(0.2, wobble * 1.25))

    trunk_top = Vector((0, 0, 0.75))
    sp = cu.splines.new('POLY')
    sp.points.add(1)
    sp.points[0].co = (0, 0, -0.05, 1)
    sp.points[0].radius = 0.13
    sp.points[1].co = (*trunk_top, 1)
    sp.points[1].radius = 0.1
    limbs = 5
    for k in range(limbs):
        ang = k * 2 * math.pi / limbs + rnd.uniform(-.4, .4)
        tilt = math.radians(rnd.uniform(50, 70))
        d = Vector((math.cos(ang) * math.sin(tilt), math.sin(ang) * math.sin(tilt), math.cos(tilt)))
        branch(trunk_top - Vector((0, 0, rnd.uniform(0, .15))), d, rnd.uniform(0.62, 0.75), 0.075, 4, 0.07)
    for a in range(6):  # root flare
        ang = a * 2 * math.pi / 6 + rnd.uniform(-.3, .3)
        sp = cu.splines.new('POLY')
        sp.points.add(1)
        sp.points[0].co = (0, 0, 0.15, 1)
        sp.points[0].radius = 0.06
        sp.points[1].co = (math.cos(ang) * 0.24, math.sin(ang) * 0.24, 0.0, 1)
        sp.points[1].radius = 0.012
    ob = bpy.data.objects.new('tree', cu)
    bpy.context.scene.collection.objects.link(ob)
    ob.data.materials.append(bark())
    return [ob]
