"""Checks for handpose.py (#1282 round 2): a hand-keyed attack on a rigged body.

The keyed attack replaces mocap because Kevin wants one large swing he can read. That only works if the body goes where
its keys say: the swinging arm and the axe point the keyed way at each key (in the torso's turned frame), and the feet
stay planted while the hips crouch and lunge (a sliding foot was one of the round-1 tells).
"""
import json
import math
import shutil
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_rigged import run_blender  # noqa: E402

POSE = '''
import sys, json, math
import bpy
from mathutils import Vector, Matrix
sys.path.insert(0, sys.argv[sys.argv.index('--') + 1])
import handpose
out = sys.argv[sys.argv.index('--') + 2]
bpy.ops.wm.read_factory_settings(use_empty=True)
a = bpy.data.armatures.new('body')
rig = bpy.data.objects.new('body', a)
bpy.context.scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
def bone(n, h, t, parent=None):
    b = a.edit_bones.new(n); b.head, b.tail = h, t
    if parent: b.parent = a.edit_bones[parent]; b.use_connect = False
# a 1.8 m body facing -Y: right is -X
bone('hips', (0, 0, 1.0), (0, 0, 1.1)); bone('sp1', (0, 0, 1.1), (0, 0, 1.25), 'hips')
bone('sp2', (0, 0, 1.25), (0, 0, 1.4), 'sp1'); bone('neck', (0, 0, 1.4), (0, 0, 1.5), 'sp2')
bone('head', (0, 0, 1.5), (0, 0, 1.8), 'neck')
for s, x in (('r', -1), ('l', 1)):
    bone('sh_' + s, (0, 0, 1.38), (0.18 * x, 0, 1.38), 'sp2')
    bone('arm_' + s, (0.18 * x, 0, 1.38), (0.3 * x, 0, 1.12), 'sh_' + s)
    bone('fore_' + s, (0.3 * x, 0, 1.12), (0.4 * x, 0, 0.88), 'arm_' + s)
    bone('hand_' + s, (0.4 * x, 0, 0.88), (0.43 * x, 0, 0.78), 'fore_' + s)
    bone('thigh_' + s, (0.1 * x, 0, 0.95), (0.11 * x, 0, 0.52), 'hips')
    bone('shin_' + s, (0.11 * x, 0, 0.52), (0.12 * x, 0.02, 0.1), 'thigh_' + s)
    bone('foot_' + s, (0.12 * x, 0.02, 0.1), (0.12 * x, -0.12, 0.02), 'shin_' + s)
bpy.ops.object.mode_set(mode='OBJECT')
roles = {'hips': 'hips', 'spine': ['sp1', 'sp2'], 'neck': 'neck', 'head': 'head'}
for s in 'rl':
    roles |= {k + '_' + s: k + '_' + s for k in ('arm', 'fore', 'hand', 'thigh', 'shin', 'foot')}
    roles['shoulder_' + s] = 'sh_' + s
keys = [{'t': 0, 'pelvis': 0, 'torso': [0, 0, 0], 'hips': [0, 0, -0.05], 'foot_l': [0, 0.1, 0], 'foot_r': [0, -0.1, 0],
         'arm_r': [0, 0, 1], 'fore_r': [0, -0.6, 0.8], 'axe': [0, 0, -1]},
        {'t': 4, 'ease': 'in', 'pelvis': -10, 'torso': [-30, 20, 0], 'hips': [0, 0.1, -0.15],
         'arm_r': [0, 1, 0], 'fore_r': [0, 0.8, -0.6], 'axe': [0, 0, -1]}]
spec = {'motion': {'kind': 'pose', 'bones': roles, 'keys': keys}}
ts = handpose.build(rig, spec, 5, Vector((1, 0, 0)), 1.8)
M = rig.matrix_world
res = {'times': ts, 'frames': []}
for f in ts:
    bpy.context.scene.frame_set(int(f))
    bpy.context.view_layer.update()
    pb = rig.pose.bones
    arm = (pb['arm_r'].tail - pb['arm_r'].head).normalized()
    axe = (M.to_3x3() @ pb['hand_r'].matrix.to_3x3() @ Vector((1, 0, 0))).normalized()
    res['frames'].append({'arm': list(arm), 'axe': list(axe), 'hips_z': pb['hips'].head.z,
                          'ankles': {s: list(M @ pb['foot_' + s].head) for s in 'lr'}})
json.dump(res, open(out, 'w'))
'''


def torso(turn, lean, v):
    """[r, f, u] in a torso turned right `turn` and leaned forward `lean`, to world (body faces -Y, right is -X)."""
    w = (-v[0], -v[1], v[2])
    lr = math.radians(lean)
    w = (w[0], w[1] * math.cos(lr) - w[2] * math.sin(lr), w[1] * math.sin(lr) + w[2] * math.cos(lr))
    tr = math.radians(-turn)
    return (w[0] * math.cos(tr) - w[1] * math.sin(tr), w[0] * math.sin(tr) + w[1] * math.cos(tr), w[2])


def square(axe, fore):
    """The keyed axe direction made square to the forearm (the wrist is straight, so the haft crosses the fist)."""
    d = sum(x * y for x, y in zip(axe, fore)) / sum(x * x for x in fore)
    return [x - d * y for x, y in zip(axe, fore)]


def dot(a, b):
    n = math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(x * x for x in b))
    return sum(x * y for x, y in zip(a, b)) / n


@unittest.skipUnless(shutil.which('blender'), 'needs Blender 4.3')
class PoseTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.got = run_blender(POSE)

    def test_every_sheet_frame_is_keyed(self):
        self.assertEqual(self.got['times'], [1.0, 2.0, 3.0, 4.0, 5.0])

    def test_arm_and_axe_point_where_the_keys_say(self):
        first, last = self.got['frames'][0], self.got['frames'][-1]
        self.assertGreater(dot(first['arm'], torso(0, 0, [0, 0, 1])), 0.995)  # overhead
        # axe hanging behind the head, as near straight down as a haft square to the forearm can be
        self.assertGreater(dot(first['axe'], square(torso(0, 0, [0, 0, -1]), torso(0, 0, [0, -0.6, 0.8]))), 0.995)
        # the strike is keyed in the torso's frame: pelvis -10 plus torso -30 turns it 40 degrees left, leaned 20
        self.assertGreater(dot(last['arm'], torso(-40, 20, [0, 1, 0])), 0.995)
        self.assertGreater(dot(last['axe'], square(torso(-40, 20, [0, 0, -1]), torso(-40, 20, [0, 0.8, -0.6]))), 0.995)

    def test_feet_stay_planted_through_the_lunge(self):
        fr = self.got['frames']
        self.assertLess(fr[-1]['hips_z'], fr[0]['hips_z'] - 0.09)  # crouched 0.1 m further (a 1.8 m body)
        for s in 'lr':
            a0 = fr[0]['ankles'][s]
            for f in fr[1:]:
                self.assertLess(math.dist(a0, f['ankles'][s]), 0.005, s)


if __name__ == '__main__':
    unittest.main()
