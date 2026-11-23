"""Swing curves of one rigged cell (#1282 round 2; Blender), to diagnose a swing that jitters.

Per sheet frame: the right arm's world rotation step (upper arm, forearm, hand; the true angle, at most 180 degrees)
and the hand's swing about the shoulder in the body's side plane (0 straight forward, 90 up, 180 back). Counts the
swing's reversals and the source clip's quaternion keys on opposite hemispheres. swing_chart.py draws the JSONs.

Usage: <blender wrapper> --python swing_curves.py -- cells.json <cell name> out.json
"""
import json
import math
import os
import sys

import bpy

a = sys.argv[sys.argv.index('--') + 1:]
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rigged  # noqa: E402
C = json.load(open(a[0]))
spec = next(c for c in C['cells'] if c['name'] == a[1])
spec.pop('rotz', None)  # measure in the body's own frame (facing -Y)
bpy.ops.wm.read_factory_settings(use_empty=True)
flips = {}
mo = spec['motion']
src_path = mo['path'] if mo['kind'] == 'copy' else spec['rigged']['path'] if mo['kind'] == 'own' else None
name = mo.get('action') or spec['rigged'].get('action')
if src_path and name:
    new, acts = rigged._import(src_path)
    act = rigged._action(name, acts)
    by = {}
    for fc in act.fcurves:
        if fc.data_path.endswith('rotation_quaternion'):
            by.setdefault(fc.data_path, [None] * 4)[fc.array_index] = fc
    for dp, fcs in by.items():
        if None in fcs:
            continue
        ks = list(zip(*[[k.co[1] for k in f.keyframe_points] for f in fcs]))
        n = sum(1 for i in range(1, len(ks)) if sum(x * y for x, y in zip(ks[i - 1], ks[i])) < 0)
        if n:
            flips[dp] = n
    for o in new:
        bpy.data.objects.remove(o)
    for ac in list(bpy.data.actions):
        bpy.data.actions.remove(ac)
ob, rig, ts, off, rep = rigged.setup(spec, 15)
pb_names = next(ns for ns in (['mixamorig:RightArm', 'mixamorig:RightForeArm', 'mixamorig:RightHand'],
                               ['RightArm', 'RightForeArm', 'RightHand'], ['upperarm_r', 'lowerarm_r', 'hand_r'])
                if all(n in rig.pose.bones for n in ns))
M = rig.matrix_world
out, prev = [], {}
for t in ts:
    bpy.context.scene.frame_set(int(math.floor(t)), subframe=t - math.floor(t))
    row = {'t': t}
    for n in pb_names:
        q = (M @ rig.pose.bones[n].matrix).to_quaternion()
        ang = 0.0
        if n in prev:
            d = abs(sum(x * y for x, y in zip(q, prev[n])))
            ang = math.degrees(2 * math.acos(min(1.0, d)))
        prev[n] = q
        row[n] = round(ang, 1)
    sh = M @ rig.pose.bones[pb_names[0]].head
    hand = M @ rig.pose.bones[pb_names[2]].tail
    v = hand - sh
    row['swing'] = round(math.degrees(math.atan2(v.z, -v.y)) % 360, 1)  # forward is -Y
    out.append(row)
sw = [r['swing'] for r in out]
d = [((b - a + 180) % 360) - 180 for a, b in zip(sw, sw[1:])]
rev = sum(1 for x, y in zip(d, d[1:]) if abs(x) > 3 and abs(y) > 3 and x * y < 0)
res = {'cell': a[1], 'flips': flips, 'reversals': rev, 'max_step': max(max(r[n] for n in pb_names) for r in out),
       'frames': out, 'bones': pb_names}
json.dump(res, open(a[2], 'w'), indent=1)
print('RESULT', json.dumps({k: res[k] for k in ('cell', 'flips', 'reversals', 'max_step')}), 'swing', sw)
