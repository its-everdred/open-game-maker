"""World positions of guard_walk.py's joints, per frame, from BVH takes (Blender 4.3; LaFAN1 names, metres, Z up).

Usage: blender.sh --python bvh_track.py -- <out.json> <take.bvh>...
"""
import json
import sys

import bpy

JOINTS = ('Hips', 'Head', 'LeftFoot', 'RightFoot', 'LeftHand', 'RightHand', 'LeftToe', 'RightToe')
args = sys.argv[sys.argv.index('--') + 1:]
res = {}
for path in args[1:]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_anim.bvh(filepath=path, update_scene_fps=False, global_scale=0.01)  # LaFAN1 is in centimetres
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    f0, f1 = (int(x) for x in arm.animation_data.action.frame_range)
    tracks = {j: [] for j in JOINTS}
    for f in range(f0, f1 + 1):
        bpy.context.scene.frame_set(f)
        for j in JOINTS:
            p = arm.matrix_world @ arm.pose.bones[j].head
            tracks[j].append([round(p.x, 4), round(p.y, 4), round(p.z, 4)])
    res[path.rsplit('/', 1)[-1]] = {'f0': f0, 'tracks': tracks}
json.dump(res, open(args[0], 'w'))
print('TRACKED', list(res))
