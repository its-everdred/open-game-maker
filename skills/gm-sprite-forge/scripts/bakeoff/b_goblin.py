"""Arm B, Goblin 01: Quaternius 'Goblin' (CC0, poly.pizza/m/OdCOFSmEhl) with its own Walk action, smoothed with one
subdivision level, the shared axe in the right hand. env MODEL=<glb>"""
import os
import sys

import bpy
import mathutils

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gob_common as G  # noqa: E402


def build(P):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.environ['MODEL'])
    new = [o for o in bpy.data.objects if o not in before]
    for o in [o for o in new if o.name.startswith('Icosphere')]:  # an unused helper sphere in the file
        new.remove(o)
        bpy.data.objects.remove(o)
    rig = next(o for o in new if o.type == 'ARMATURE')
    act = next(a for a in bpy.data.actions if a.name.endswith('Walk'))
    rig.animation_data_create()
    rig.animation_data.action = act
    for t in rig.animation_data.nla_tracks:  # the importer stacks every clip as NLA; they override the action
        t.mute = True
    for o in new:
        if o.type == 'MESH':
            s = o.modifiers.new('sub', 'SUBSURF')
            s.levels = s.render_levels = 1
            o.modifiers.move(len(o.modifiers) - 1, 0)  # smooth before the armature deform
    bpy.context.view_layer.update()
    zs = [(o.matrix_world @ mathutils.Vector(c)).z for o in new if o.type == 'MESH' for c in o.bound_box]
    # one bone per arm in this rig: the arm's end bone sits at the hand; axe sized to the body like arm A's
    G.axe(rig, 'Arm.R_end', scale=max(zs) - min(zs))
    P['frame_start'], P['frame_end'] = 0, 24  # the 48-frame clip repeats a 24-frame cycle
    return [o for o in new if o.parent is None]
