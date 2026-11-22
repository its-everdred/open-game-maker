"""Ground-truth check for fit_rig.landmarks: rigged characters whose own skeleton is known (Blender 4.3).

Usage: blender -b --python fit_accuracy.py -- <out.json> <height_px> <file[:mesh]> ...
Each case runs twice: as shipped (T-pose for most packs) and in an A-pose made by swinging the upper arms 40 deg down,
which is how image-to-3D meshes arrive. The error is the 3-D distance between the fitted joint and the rig's own joint,
in pixels at <height_px> (the sprite's height, 43 for the Warrior); the screen error is at most this.
"""
import json
import math
import os
import sys

import bpy
import mathutils

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fit_rig  # noqa: E402

# our joint -> source bone whose head sits on that joint, per rig family
MAPS = {
    'kaykit': {'hip': 'upperleg.{s}', 'knee': 'lowerleg.{s}', 'ankle': 'foot.{s}', 'shoulder': 'upperarm.{s}',
               'elbow': 'lowerarm.{s}', 'wrist': 'wrist.{s}', 'toe_ref': 'toes.{s}'},
    'kenney': {'hip': '{S}UpLeg', 'knee': '{S}Leg', 'ankle': '{S}Foot', 'shoulder': '{S}Arm', 'elbow': '{S}ForeArm',
               'wrist': '{S}Hand', 'toe_ref': '{S}Toes'},
    'synty': {'hip': 'UpperLeg_{s}', 'knee': 'LowerLeg_{s}', 'ankle': 'Ankle_{s}', 'shoulder': 'Shoulder_{s}',
              'elbow': 'Elbow_{s}', 'wrist': 'Hand_{s}', 'toe_ref': 'Toes_{s}'},
}


def family(arm):
    names = {b.name for b in arm.data.bones}
    return 'kaykit' if 'upperleg.l' in names else 'kenney' if 'LeftUpLeg' in names else 'synty'


def bone(m, fam, joint, side):
    s = side.lower() if fam == 'kaykit' else side
    return m[joint].format(s=s, S='Left' if side == 'L' else 'Right')


def run_case(path, mesh_name, apose):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    (bpy.ops.import_scene.fbx if path.lower().endswith('.fbx') else bpy.ops.import_scene.gltf)(filepath=path)
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    for o in [o for o in bpy.data.objects if o.type == 'MESH']:
        if (mesh_name and o.name != mesh_name) or (not mesh_name and not any(m.type == 'ARMATURE' for m in o.modifiers)):
            bpy.data.objects.remove(o)
    fam = family(arm)
    m = MAPS[fam]
    if arm.animation_data:
        arm.animation_data.action = None
    for pb in arm.pose.bones:
        pb.matrix_basis = mathutils.Matrix()
    bpy.context.view_layer.update()
    # orientation: toes must point to -Y after the fit's normalisation
    W = arm.matrix_world
    ank = W @ arm.pose.bones[bone(m, fam, 'ankle', 'L')].head
    toe = W @ arm.pose.bones[bone(m, fam, 'toe_ref', 'L')].head
    d = toe - ank
    rotz = -90 - math.degrees(math.atan2(d.y, d.x))  # rotate the toe direction onto -Y
    if apose:
        for side in ('L', 'R'):
            pb = arm.pose.bones[bone(m, fam, 'shoulder', side)]
            head = W @ pb.head
            # world swing about the front axis (after rotz this is Y; before it, the body's own front axis)
            fwd = mathutils.Matrix.Rotation(math.radians(-rotz), 3, 'Z') @ mathutils.Vector((0, -1, 0))
            best = None
            for ang in (math.radians(40), math.radians(-40)):  # whichever swing lowers the hand
                R = mathutils.Matrix.Translation(head) @ mathutils.Matrix.Rotation(ang, 4, fwd) @ mathutils.Matrix.Translation(-head)
                z = (R @ (W @ arm.pose.bones[bone(m, fam, 'elbow', side)].head)).z  # FBX tails are made up
                if best is None or z < best[0]:
                    best = (z, R)
            R = best[1]
            pb.matrix = W.inverted() @ R @ W @ pb.matrix
            bpy.context.view_layer.update()
    truth = {}
    for side in ('L', 'R'):
        for j in ('hip', 'knee', 'ankle', 'shoulder', 'elbow', 'wrist'):
            truth[f'{j}.{side}'] = W @ arm.pose.bones[bone(m, fam, j, side)].head
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    ob, M = fit_rig.prepare(meshes + [arm], rotz, apply_pose=True)
    pts = fit_rig.surface_samples(ob, 60000)
    lm = fit_rig.landmarks(ob)
    # the rig's own left (+X in Blender) may be on either side after normalisation; match by side of the body
    res = {}
    for key, t in truth.items():
        tn = M @ t
        joint, side = key.split('.')
        cand = [mathutils.Vector(lm[f'{joint}.{s}'].tolist()) for s in ('L', 'R')]
        res[key] = min((c - tn).length for c in cand)
    if os.environ.get('FITACC_DEBUG'):
        fit_rig.overlay(pts, lm, {k: M @ t for k, t in truth.items()}, os.environ['FITACC_DEBUG'] + f"/{os.path.basename(path)}_{mesh_name}_{'A' if apose else 'T'}.png")
    return fam, res, lm['H']


def main():
    argv = sys.argv[sys.argv.index('--') + 1:]
    out, hpx, cases = argv[0], float(argv[1]), argv[2:]
    rows = []
    for c in cases:
        path, _, mesh = c.partition(':')
        for apose in (False, True):
            try:
                fam, res, H = run_case(path, mesh or None, apose)
            except Exception as e:  # a failed fit is a result, not a crash
                rows.append({'case': os.path.basename(path) + (':' + mesh if mesh else ''), 'pose': 'A' if apose else 'T',
                             'error': repr(e)})
                continue
            px = {k: round(v / H * hpx, 2) for k, v in res.items()}
            rows.append({'case': os.path.basename(path) + (':' + mesh if mesh else ''), 'family': fam,
                         'pose': 'A' if apose else 'T', 'px': px,
                         'knee_elbow_max_px': max(px[k] for k in px if k.split('.')[0] in ('knee', 'elbow'))})
            print('FITACC', json.dumps(rows[-1]))
    json.dump({'height_px': hpx, 'rows': rows}, open(out, 'w'), indent=1)


main()
