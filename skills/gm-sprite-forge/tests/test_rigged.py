"""Checks for rigged.py (#1282 bake-off): the plain copy retarget and the facing turn.

Arm C's whole point is that a standard retarget, with none of retarget.py's rebuild, carries the source motion over
as it is. So a target whose rest pose differs from the source's (an A-pose body driven by a T-pose clip) must still
end with every bone pointing where the source bone points, and the body must be turned to face the pack camera's
-Y from its feet alone.
"""
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

COPY = '''
import sys, json, math
import bpy
from mathutils import Vector, Matrix
sys.path.insert(0, sys.argv[sys.argv.index('--') + 1])
import rigged
out = sys.argv[sys.argv.index('--') + 2]
bpy.ops.wm.read_factory_settings(use_empty=True)

def arm(name, arm_dir):
    a = bpy.data.armatures.new(name)
    o = bpy.data.objects.new(name, a)
    bpy.context.scene.collection.objects.link(o)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.mode_set(mode='EDIT')
    def bone(n, h, t, parent=None):
        b = a.edit_bones.new(n); b.head, b.tail = h, t
        if parent: b.parent = a.edit_bones[parent]; b.use_connect = False
    bone('hips', (0, 0, 1.0), (0, 0, 1.1))
    bone('upper', (0.2, 0, 1.5), (0.2 + 0.3 * arm_dir[0], 0, 1.5 + 0.3 * arm_dir[1]), 'hips')
    bone('lower', (0.2 + 0.3 * arm_dir[0], 0, 1.5 + 0.3 * arm_dir[1]),
         (0.2 + 0.6 * arm_dir[0], 0, 1.5 + 0.6 * arm_dir[1]), 'upper')
    bpy.ops.object.mode_set(mode='OBJECT')
    o.animation_data_create()
    return o

src = arm('src', (1, 0))                                        # T-pose arm, straight out to the side
tgt = arm('tgt', (math.cos(math.radians(-45)), math.sin(math.radians(-45))))  # A-pose arm, 45 degrees down
act = bpy.data.actions.new('lift')
src.animation_data.action = act
pb = src.pose.bones['upper']
pb.rotation_mode = 'XYZ'
for f, ang in ((1, 0.0), (11, 30.0)):                           # swing the arm 30 degrees about its own X
    pb.rotation_euler = (math.radians(ang), 0, 0)
    pb.keyframe_insert('rotation_euler', frame=f)
mp = {'hips': 'hips', 'upper': 'upper', 'lower': 'lower'}
rigged.copy_rotations(src, tgt, mp, 'hips', 'hips', [1.0, 11.0])
res = {}
for i, f in enumerate((1, 11)):
    bpy.context.scene.frame_set(f)
    bpy.context.view_layer.update()
    s = (src.matrix_world @ src.pose.bones['lower'].head) - (src.matrix_world @ src.pose.bones['upper'].head)
    bpy.context.scene.frame_set(1 + i)
    bpy.context.view_layer.update()
    t = (tgt.matrix_world @ tgt.pose.bones['lower'].head) - (tgt.matrix_world @ tgt.pose.bones['upper'].head)
    res[str(f)] = {'src': list(s.normalized()), 'tgt': list(t.normalized())}
json.dump(res, open(out, 'w'))
'''

FACING = '''
import sys, json, math
import bpy
sys.path.insert(0, sys.argv[sys.argv.index('--') + 1])
import rigged
out = sys.argv[sys.argv.index('--') + 2]
bpy.ops.wm.read_factory_settings(use_empty=True)
a = bpy.data.armatures.new('a'); o = bpy.data.objects.new('a', a)
bpy.context.scene.collection.objects.link(o); bpy.context.view_layer.objects.active = o
bpy.ops.object.mode_set(mode='EDIT')
for s, x in (('L', 0.1), ('R', -0.1)):                         # feet point +X: the body faces +X
    f = a.edit_bones.new('foot' + s); f.head, f.tail = (x, 0, 0.1), (x + 0.1, 0, 0.02)
    t = a.edit_bones.new('toe' + s); t.head, t.tail = (x + 0.1, 0, 0.02), (x + 0.15, 0, 0.02)
bpy.ops.object.mode_set(mode='OBJECT')
turn = rigged.facing_turn(o, {'L': ['footL', 'toeL'], 'R': ['footR', 'toeR']})
json.dump({'turn_deg': math.degrees(turn)}, open(out, 'w'))
'''

WEAPON = '''
import sys, json, math
import bpy
from mathutils import Vector, Matrix
sys.path.insert(0, sys.argv[sys.argv.index('--') + 1])
import rigged
out = sys.argv[sys.argv.index('--') + 2]
bpy.ops.wm.read_factory_settings(use_empty=True)
a = bpy.data.armatures.new('a'); rig = bpy.data.objects.new('a', a)
bpy.context.scene.collection.objects.link(rig); bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
h = a.edit_bones.new('hand'); h.head, h.tail = (0.5, 0, 1.0), (0.5, 0, 0.9)   # a hand hanging down
h.roll = math.radians(70)                                                     # an arbitrary vendor roll
bpy.ops.object.mode_set(mode='OBJECT')
rig.scale = (0.5, 0.5, 0.5)                                                   # a rig at half scale
bpy.ops.mesh.primitive_cube_add(size=1)
body = bpy.context.active_object
body.scale = (0.3, 0.3, 2.0)                                                  # 2 m tall before the rig's scale
body.parent = rig
bpy.context.view_layer.update()
roll = rigged.weapon_roll(rig, 'hand')
R = (rig.matrix_world @ a.bones['hand'].matrix_local).to_3x3().normalized()
axis = R @ (Matrix.Rotation(math.radians(roll), 3, 'Y') @ Vector((1, 0, 0)))
json.dump({'axis': list(axis.normalized()), 'length': rigged.weapon_length(rig, body, 0.75)}, open(out, 'w'))
'''


def run_blender(script):
    with tempfile.TemporaryDirectory() as t:
        p, out = Path(t) / 's.py', Path(t) / 'out.json'
        p.write_text(script)
        env = os.environ | {'PYTHONPATH': os.environ.get('OGM_FORGE_SITE', '')}
        subprocess.run(['blender', '-b', '--factory-startup', '--python-use-system-env', '--python-exit-code', '1',
                        '--python', str(p), '--', str(ROOT / 'scripts/motion'), str(out)],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env)
        return json.loads(out.read_text())


@unittest.skipUnless(shutil.which('blender'), 'needs Blender 4.3')
class CopyTest(unittest.TestCase):
    def test_an_a_pose_target_follows_a_t_pose_source(self):
        got = run_blender(COPY)
        for f, d in got.items():
            dot = sum(a * b for a, b in zip(d['src'], d['tgt']))
            self.assertGreater(dot, 0.999, (f, d))  # within ~2.5 degrees: the rest-pose gap is gone
        self.assertLess(sum(a * b for a, b in zip(got['1']['src'], got['11']['src'])), 0.95)  # the source did move


@unittest.skipUnless(shutil.which('blender'), 'needs Blender 4.3')
class FacingTest(unittest.TestCase):
    def test_a_body_facing_plus_x_is_turned_to_minus_y(self):
        turn = run_blender(FACING)['turn_deg'] % 360
        self.assertAlmostEqual(turn, 270, delta=1)  # +X turned by -90 (= 270) degrees faces -Y



@unittest.skipUnless(shutil.which('blender'), 'needs Blender 4.3')
class WeaponTest(unittest.TestCase):
    def test_a_vendor_hand_holds_the_weapon_forward_at_body_scale(self):
        got = run_blender(WEAPON)
        self.assertLess(got['axis'][1], -0.999, got)  # the haft points forward (-Y) whatever the hand's roll
        # 0.75 is sized for a 1.8 m body: a 1 m body (2 m mesh in a half-scale rig) gets 0.75 / 1.8 of a metre,
        # which is 2 * 0.75 / 1.8 in the rig's own units
        self.assertAlmostEqual(got['length'], 0.75 * 1.0 / 1.8 / 0.5, places=3)


if __name__ == '__main__':
    unittest.main()
