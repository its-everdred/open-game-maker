"""Hand-keyed poses on a rigged body (#1282 round 2; Blender 4.3 module reached through rigged.py).

`motion.kind: pose` keys a clip from key poses written in the body's own frame, no mocap: [r, f, u] = right, forward,
up, for a body facing -Y (so right is -X). Per key (fields left out carry over from the key before; posekey.py):

  t        sheet frame (0 .. n-1); ease: how the segment into this key moves (in, out, io, linear)
  pelvis   degrees the hips turn toward the right side; hips [r, f, u] metres from rest (a crouch is negative u)
  torso    [turn right, lean forward, lean right] degrees, spread over the spine bones, on top of the pelvis
  head     [turn right, lean forward] degrees on top of the torso
  arm_r, fore_r, arm_l, fore_l   upper arm and forearm directions, in the torso's frame (they turn with it)
  axe      direction of the right hand's weapon, in the torso's frame; the wrist is straight along the forearm
  foot_l, foot_r   [r, f, u] metres from the rest ankle: the stance. A leg reaches its ankle by a two-bone solve
           (knee toward the front), so a held stance does not slide while the hips crouch and lunge.

Metres are for a 1.8 m body and scale with the rig's height. Frames are keyed 1..n with constant interpolation, each
quaternion on the previous one's side.
"""
import math
import os
import sys

import bpy
from mathutils import Matrix, Quaternion, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import posekey  # noqa: E402
import sampling  # noqa: E402

ROLES = ('hips', 'spine', 'neck', 'head', 'shoulder_r', 'arm_r', 'fore_r', 'hand_r', 'shoulder_l', 'arm_l',
         'fore_l', 'hand_l', 'thigh_l', 'shin_l', 'foot_l', 'thigh_r', 'shin_r', 'foot_r')


def body(v):
    """[r, f, u] in the body frame to world (the body faces -Y, so right is -X)."""
    return Vector((-v[0], -v[1], v[2]))


def turn_matrix(turn, lean=0.0, side=0.0):
    """Turn right `turn` degrees about up, then lean forward and to the right in the turned frame."""
    return (Matrix.Rotation(math.radians(-turn), 3, 'Z') @ Matrix.Rotation(math.radians(lean), 3, 'X') @
            Matrix.Rotation(math.radians(-side), 3, 'Y'))


def aim(R, rest_dir, d):
    """R turned by the shortest rotation that takes rest_dir onto d."""
    return rest_dir.rotation_difference(d).to_matrix() @ R


def frame(d, a, y_local, w_local):
    """The rotation taking bone-local y onto d and the weapon axis w onto a (as near as a stays square to d)."""
    def basis(y, w):
        w = (w - y * w.dot(y)).normalized()
        return Matrix((y, w, y.cross(w))).transposed()
    return basis(d.normalized(), a.normalized()) @ basis(y_local.normalized(), w_local.normalized()).inverted()


def two_bone(hip, ankle, l1, l2, pole):
    """Knee position for a thigh l1 and shin l2 from hip to ankle, bending toward pole."""
    v = ankle - hip
    d = min(v.length, (l1 + l2) * 0.999)
    u = v.normalized()
    a = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
    h = math.sqrt(max(l1 * l1 - a * a, 0.0))
    p = (pole - u * pole.dot(u)).normalized()
    return hip + u * a + p * h


def build(rig, spec, n, weapon_axis, height):
    """Key frames 1..n of `spec['motion']['keys']` on the rig (bones by role in `spec['motion']['bones']`); returns the
    keyed frame numbers. weapon_axis: the weapon's long axis (toward its head) in the right hand bone's local space;
    height: the body's standing height in world units (the skinned mesh's, head top to sole)."""
    mo = spec['motion']
    bones = mo['bones']
    missing = [r for r in ROLES if r != 'spine' and r not in bones]
    if missing or not bones.get('spine'):
        raise SystemExit(f'pose: motion.bones needs every role: missing {missing or ["spine"]}')
    M = rig.matrix_world
    M3 = M.to_3x3().normalized()
    rb = rig.data.bones
    rest = {n_: (M @ rb[n_].matrix_local).to_3x3().normalized() for n_ in rb.keys()}
    head0 = {n_: M @ rb[n_].head_local for n_ in rb.keys()}

    def rest_dir(role, child):
        return (head0[bones[child]] - head0[bones[role]]).normalized()
    dirs = {'arm_r': rest_dir('arm_r', 'fore_r'), 'fore_r': rest_dir('fore_r', 'hand_r'),
            'arm_l': rest_dir('arm_l', 'fore_l'), 'fore_l': rest_dir('fore_l', 'hand_l'),
            'thigh_l': rest_dir('thigh_l', 'shin_l'), 'shin_l': rest_dir('shin_l', 'foot_l'),
            'thigh_r': rest_dir('thigh_r', 'shin_r'), 'shin_r': rest_dir('shin_r', 'foot_r')}
    legs = {s: ((head0[bones['shin_' + s]] - head0[bones['thigh_' + s]]).length,
                (head0[bones['foot_' + s]] - head0[bones['shin_' + s]]).length) for s in 'lr'}
    k = height / 1.8  # metres in the keys are for a 1.8 m body

    order = [b.name for b in rig.data.bones]  # parents before children (Blender keeps the hierarchy order)
    used = {bones[r] for r in ROLES if r != 'spine'} | set(bones['spine'])
    order = [b for b in order if b in used]
    act = bpy.data.actions.new('pose')
    rig.animation_data_create()
    rig.animation_data.action = act
    for pb in rig.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    last, carry, T_prev = {}, {}, None

    def aimed(name, R_rest, d_rest, d, turn):
        """Aim a bone at d from its previous frame (turned by the torso's change), not from rest: an arm raised
        overhead points nearly opposite its rest direction, where the shortest rotation from rest has no stable axis
        and the bone would twist round between frames."""
        R0, d0 = carry.get(name, (R_rest, d_rest))
        if name in carry:
            R0, d0 = turn @ R0, turn @ d0
        R = aim(R0, d0, d)
        carry[name] = (R, d.normalized())
        return R
    for i in range(n):
        p = posekey.pose_at(mo['keys'], i)
        P = turn_matrix(p.get('pelvis', 0))
        tt = p.get('torso', [0, 0, 0])
        T = P @ turn_matrix(*tt)
        hh = p.get('head', [0, 0])
        dT = T @ T_prev.inverted() if T_prev is not None else Matrix.Identity(3)
        T_prev = T
        world, pos = {}, {}
        world[bones['hips']] = P @ rest[bones['hips']]
        pos[bones['hips']] = head0[bones['hips']] + body(p.get('hips', [0, 0, 0])) * k
        sp = bones['spine']
        qT = (P.inverted() @ T).to_quaternion()
        for j, name in enumerate(sp):
            world[name] = P @ Quaternion().slerp(qT, (j + 1) / len(sp)).to_matrix() @ rest[name]
        world[bones['neck']] = T @ turn_matrix(hh[0] / 2, hh[1] / 2) @ rest[bones['neck']]
        world[bones['head']] = T @ turn_matrix(*hh) @ rest[bones['head']]
        for s in 'rl':
            world[bones['shoulder_' + s]] = T @ rest[bones['shoulder_' + s]]
            for role, child in (('arm_' + s, 'fore_' + s), ('fore_' + s, 'hand_' + s)):
                d = (T @ body(p[role])) if role in p else T @ dirs[role]
                world[bones[role]] = aimed(bones[role], T @ rest[bones[role]], T @ dirs[role], d, dT)
            fore = T @ body(p['fore_' + s]) if 'fore_' + s in p else T @ dirs['fore_' + s]
            if s == 'r' and 'axe' in p:
                world[bones['hand_r']] = frame(fore, T @ body(p['axe']), Vector((0, 1, 0)), weapon_axis)
            else:
                hd = (head0[bones['hand_' + s]] - head0[bones['fore_' + s]]).normalized()
                world[bones['hand_' + s]] = aimed(bones['hand_' + s], T @ rest[bones['hand_' + s]], T @ hd, fore, dT)
        # legs: hip joint from the posed pelvis, ankle from the stance, knee toward the front
        hip_c = pos[bones['hips']]
        for s in 'lr':
            hj = hip_c + P @ (head0[bones['thigh_' + s]] - head0[bones['hips']])
            ank = head0[bones['foot_' + s]] + body(p.get('foot_' + s, [0, 0, 0])) * k
            knee = two_bone(hj, ank, *legs[s], P @ body([0, 1, 0]))
            one = Matrix.Identity(3)
            world[bones['thigh_' + s]] = aimed(bones['thigh_' + s], rest[bones['thigh_' + s]], dirs['thigh_' + s],
                                               knee - hj, one)
            world[bones['shin_' + s]] = aimed(bones['shin_' + s], rest[bones['shin_' + s]], dirs['shin_' + s],
                                              ank - knee, one)
            world[bones['foot_' + s]] = rest[bones['foot_' + s]]
        Mi = M.inverted()
        for name in order:  # parents first: a bone's head follows its posed parent
            pb = rig.pose.bones[name]
            bpy.context.view_layer.update()
            head = Mi @ pos[name] if name in pos else pb.matrix.translation.copy()
            R = M3.inverted() @ world.get(name, rest[name])
            pb.matrix = Matrix.Translation(head) @ R.to_4x4()
        bpy.context.view_layer.update()
        for name in order:
            pb = rig.pose.bones[name]
            q = sampling.compatible(last[name], pb.rotation_quaternion) if name in last else pb.rotation_quaternion
            pb.rotation_quaternion = q
            last[name] = list(q)
            pb.keyframe_insert('rotation_quaternion', frame=1 + i)
            if name == bones['hips']:
                pb.keyframe_insert('location', frame=1 + i)
    for fc in act.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = 'CONSTANT'
    return [float(1 + i) for i in range(n)]
