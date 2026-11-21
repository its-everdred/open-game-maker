"""Arm C, Goblin 01: Hunyuan3D-2 mesh (from the original S frame) decimated, scaled to the shared skeleton's height,
bound with nearest-bone weights and driven by the shared walk. Its own axe comes from the image. env MODEL=<glb>"""
import os
import sys

import bpy
import mathutils

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gob_common as G  # noqa: E402


def build(P):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.environ['MODEL'])
    meshes = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
    ob = meshes[0]
    bpy.context.view_layer.objects.active = ob
    for o in bpy.data.objects:
        o.select_set(o in meshes)
    if len(meshes) > 1:
        bpy.ops.object.join()
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    dec = ob.modifiers.new('dec', 'DECIMATE')
    dec.ratio = min(1.0, 80000 / max(1, len(ob.data.polygons)))
    bpy.ops.object.modifier_apply(modifier='dec')
    pts = [v.co for v in ob.data.vertices]
    lo = mathutils.Vector([min(p[k] for p in pts) for k in range(3)])
    hi = mathutils.Vector([max(p[k] for p in pts) for k in range(3)])
    s = 0.86 / (hi.z - lo.z)  # the shared skeleton's head top is ~0.86
    ob.data.transform(mathutils.Matrix.Scale(s, 4) @ mathutils.Matrix.Translation(
        (-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z)))
    m = bpy.data.materials.new('vcol')
    m.use_nodes = True
    vc = m.node_tree.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = ob.data.color_attributes[0].name if ob.data.color_attributes else ''
    m.node_tree.links.new(vc.outputs['Color'], m.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
    ob.data.materials.clear()
    ob.data.materials.append(m)
    bpy.ops.object.shade_smooth()
    rig = G.armature()
    G.bind(ob, rig)
    G.walk(rig)
    P['frame_start'], P['frame_end'] = 1, 16
    return [rig]
