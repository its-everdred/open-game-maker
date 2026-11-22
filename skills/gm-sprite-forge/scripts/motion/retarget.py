"""Retarget a source clip (KayKit GLB action or a BVH take) onto a fitted metarig, then plant the feet with an own
two-bone IK pass (Blender 4.3 module; #1202 rig spike).

Limbs copy the source bone's armature-space direction and twist against a reference pose in which the source bone is
swung onto the target's rest direction, so a T-pose source drives an A-pose target. Hips, spine, neck and head copy the
source's rotation change from rest. The hips' travel is scaled by the leg-length ratio, the take is turned to walk
toward -Y, the forward drift is removed (in place, like the pack sheets) and the loop seam is spread across the cycle.
The IK pass sets each ankle to the scaled source ankle (stance width corrected to the target's hips) and lowers the hips
when a leg cannot reach, so planted source feet stay planted.
"""
import math

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

LEGS = ('thigh', 'shin', 'foot', 'toe')
ARMS = ('shoulder', 'upper_arm', 'forearm', 'hand')
SPINE = ('spine', 'spine.001', 'spine.002', 'spine.003', 'spine.004', 'spine.005', 'spine.006')

ROLE_NAMES = {  # lower-case source name stems with the side marker removed
    'thigh': ('upleg', 'upperleg', 'thigh'),
    'shin': ('leg', 'lowerleg', 'shin', 'knee', 'calf'),
    'foot': ('foot', 'ankle'),
    'toe': ('toe', 'toes', 'toebase', 'ball'),
    'shoulder': ('shoulder', 'clavicle', 'collar'),
    'upper_arm': ('arm', 'upperarm'),
    'forearm': ('forearm', 'lowerarm', 'elbow'),
    'hand': ('hand',),
}


def _side_of(name):
    n = name.lower()
    for s, marks in (('L', ('left', '_l', '.l', 'l_')), ('R', ('right', '_r', '.r', 'r_'))):
        for mk in marks:
            if n.startswith(mk) if mk.endswith('_') else (mk in n if mk in ('left', 'right') else n.endswith(mk)):
                return s, n.replace(mk, '')
    return None, n


def bone_map(src):
    """target bone -> source bone name. Lower body and arms by name; the spine by position along hips -> head."""
    m = {}
    names = [b.name for b in src.data.bones]
    for b in names:
        side, stem = _side_of(b)
        if not side:
            continue
        stem = stem.replace('_', '').replace('.', '').strip()
        for role, stems in ROLE_NAMES.items():
            if stem in stems and f'{role}.{side}' not in m:
                m[f'{role}.{side}'] = b
    if 'shoulder.L' in m and m.get('upper_arm.L') == m['shoulder.L']:  # Synty: Shoulder_* is the upper arm
        m.pop('shoulder.L'), m.pop('shoulder.R', None)
    hips = next(b for b in src.data.bones if b.name.lower() in ('hips', 'pelvis', 'hip'))
    head = next(b for b in src.data.bones if b.name.lower() == 'head')
    chain = []
    b = head
    while b and b != hips:
        chain.append(b.name)
        b = b.parent
    chain = chain[::-1]  # spine bones from above the hips to the head
    neck = [n for n in chain if 'neck' in n.lower()]
    trunk = [n for n in chain if n not in neck and n != head.name]
    m['spine'] = hips.name
    for i, t in enumerate(('spine.001', 'spine.002', 'spine.003')):
        if trunk:
            m[t] = trunk[min(len(trunk) - 1, round(i * (len(trunk) - 1) / 2))]
    if neck:
        m['spine.004'] = neck[0]
    m['spine.006'] = head.name
    return m


def _rot(M):
    return M.to_3x3().normalized()


def _swing(a, b):
    return a.rotation_difference(b).to_matrix()


def import_source(kind, path, action=None):
    before = set(bpy.data.objects)
    if kind == 'bvh':
        bpy.ops.import_anim.bvh(filepath=path, axis_forward='-Z', axis_up='Y', rotate_mode='NATIVE',
                                update_scene_fps=False, update_scene_duration=False)
    else:
        bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    src = next(o for o in new if o.type == 'ARMATURE')
    for o in [o for o in new if o.type == 'MESH' or (o.type == 'EMPTY' and o != src.parent)]:
        bpy.data.objects.remove(o)  # meshes and helper empties go; the armature's own parent chain stays
    if action:
        src.animation_data.action = next(a for a in bpy.data.actions if a.name.startswith(action))
    return src


def _src_world(src, name):
    pb = src.pose.bones[name]
    return src.matrix_world @ pb.head, src.matrix_world @ pb.tail, _rot(src.matrix_world) @ _rot(pb.matrix)


def find_cycles(src, m, f0, f1):
    """Left heel strikes: maxima of the left ankle's lead over the right one along the walking direction."""
    fs = list(range(int(f0), int(f1) + 1))
    hips, la, ra = [], [], []
    for f in fs:
        bpy.context.scene.frame_set(f)
        hips.append(np.array(_src_world(src, m['spine'])[0]))
        la.append(np.array(_src_world(src, m['foot.L'])[0]))
        ra.append(np.array(_src_world(src, m['foot.R'])[0]))
    hips, la, ra = map(np.array, (hips, la, ra))
    v = hips[-1] - hips[0]
    v[2] = 0
    d = v / (np.linalg.norm(v) + 1e-9)
    lead = (la - ra) @ d
    lead = np.convolve(lead, np.ones(3) / 3, 'same')
    peaks = [i for i in range(2, len(fs) - 2) if lead[i] == lead[i - 2:i + 3].max() and lead[i] > 0.3 * lead.max()]
    return [fs[i] for i in peaks], d


def pick_cycle(src, m, f0, f1):
    peaks, _ = find_cycles(src, m, f0, f1)
    if len(peaks) < 2:
        return f0, f1
    per = np.diff(peaks)
    med = np.median(per)
    mid = len(peaks) // 2  # steady state: a cycle from the middle of the take with the typical period
    best = min(range(len(per)), key=lambda i: (abs(per[i] - med) > 0.15 * med, abs(i - mid)))
    return peaks[best], peaks[best + 1]


def retarget(src, rig, f0, f1, n=15, loop=True, foot_ik=True, mapping=None):
    """Bake n evenly spaced source poses from [f0, f1) onto rig as frames 1..n (+ frame n+1 = frame 1 when loop)."""
    sc = bpy.context.scene
    m = mapping or bone_map(src)
    targets = [b for b in rig.pose.bones if b.name in m]
    rest_t = {b.name: _rot(rig.matrix_world) @ _rot(b.bone.matrix_local) for b in targets}
    def rest_head(arm, name):
        return arm.matrix_world @ arm.data.bones[name].head_local
    # the source's rest pose may face anywhere: C turns it to face -Y like the target
    toe_dir = rest_head(src, m['toe.L']) - rest_head(src, m['foot.L'])
    C = Matrix.Rotation(math.atan2(-1, 0) - math.atan2(toe_dir.y, toe_dir.x), 3, 'Z')
    rest_s = {t: C @ _rot(src.matrix_world) @ _rot(src.data.bones[s].matrix_local) for t, s in m.items()}
    dir_t = {t: rest_t[t] @ Vector((0, 1, 0)) for t in rest_t}
    ref_s = {}
    for t, R in rest_s.items():
        ds = R @ Vector((0, 1, 0))
        ref_s[t] = R if t in SPINE else _swing(ds, dir_t[t]) @ R

    # proportions: leg length (hip -> ankle) and hip half-width, target over source, at rest
    leg_t = (rest_head(rig, 'shin.L') - rest_head(rig, 'thigh.L')).length + (rest_head(rig, 'foot.L') - rest_head(rig, 'shin.L')).length
    leg_s = (rest_head(src, m['shin.L']) - rest_head(src, m['thigh.L'])).length + \
            (rest_head(src, m['foot.L']) - rest_head(src, m['shin.L'])).length
    k = leg_t / leg_s
    half_t = abs(rest_head(rig, 'thigh.L').x - rest_head(rig, 'thigh.R').x) / 2
    root_t = rest_head(rig, 'spine')
    ank_rest_t = {s: rest_head(rig, f'foot.{s}') for s in 'LR'}

    # heading: turn the take so its travel over the cycle (or, in place, the hips' facing at f0) points to -Y
    hp0 = _src_world_at(src, m['spine'], f0)[0]
    R0 = _src_world(src, m['spine'])[2]
    hp1 = _src_world_at(src, m['spine'], f1)[0]
    trav = Vector((hp1.x - hp0.x, hp1.y - hp0.y, 0))
    walking = loop and trav.length > 0.3 * leg_s
    if not walking:
        trav = R0 @ _rot(src.matrix_world @ src.data.bones[m['spine']].matrix_local).inverted() @ C.inverted() @ Vector((0, -1, 0))
    yaw = math.atan2(-1, 0) - math.atan2(trav.y, trav.x)
    turn = Matrix.Rotation(yaw, 3, 'Z')
    sa_rest = {s: rest_head(src, m[f'foot.{s}']) for s in 'LR'}
    src_half = (sa_rest['L'] - sa_rest['R']).length / 2

    samples = []
    for i in range(n):
        f = f0 + (f1 - f0) * i / n
        fl = math.floor(f)
        sc.frame_set(fl, subframe=f - fl)
        hips_w = _src_world(src, m['spine'])[0]
        drift = (hp0 + (hp1 - hp0) * (i / n)) if walking else hp0
        rel = turn @ (hips_w - Vector((drift.x, drift.y, 0)))
        rel.z = hips_w.z
        pose = {'root': Vector((root_t.x + rel.x * k, root_t.y + rel.y * k, root_t.z + (hips_w.z - rest_head(src, m['spine']).z) * k)),
                'rot': {}, 'ankle': {}}
        for t in rest_t:
            R_s = turn @ _src_world(src, m[t])[2]
            if t in SPINE:
                pose['rot'][t] = R_s @ rest_s[t].inverted() @ rest_t[t]
            else:
                pose['rot'][t] = R_s @ ref_s[t].inverted() @ rest_t[t]
        for s in 'LR':
            a = turn @ (_src_world(src, m[f'foot.{s}'])[0] - Vector((drift.x, drift.y, 0)))
            sgn = 1 if s == 'L' else -1
            pose['ankle'][s] = Vector((root_t.x + a.x * k + sgn * (half_t - src_half * k), root_t.y + a.y * k,
                                       ank_rest_t[s].z + (a.z - sa_rest[s].z) * k))
        samples.append(pose)
    if loop:
        _close_loop(samples)
    apply_samples(rig, samples, loop=loop, foot_ik=foot_ik)
    return {'k_leg': k, 'cycle': [f0, f1], 'walking': walking, 'yaw_deg': round(math.degrees(yaw), 1), 'map': m}


def _src_world_at(src, name, f):
    bpy.context.scene.frame_set(int(f), subframe=f - int(f))
    return _src_world(src, name)


def _close_loop(samples):
    """Spread the seam between the last sample and the first across the cycle (rotations, root and ankles)."""
    n = len(samples)
    a, b = samples[0], samples[-1]
    # the next sample after the last one is the first; extrapolate the would-be sample n from the last step
    for i, s in enumerate(samples):
        t = i / n
        for name, R in s['rot'].items():
            q_end = b['rot'][name].to_quaternion()
            q_n = q_end @ (samples[-2]['rot'][name].to_quaternion().inverted() @ q_end) if n > 2 else q_end
            delta = a['rot'][name].to_quaternion() @ q_n.inverted()
            s['rot'][name] = (Quaternion().slerp(delta, t) @ R.to_quaternion()).to_matrix()
        for key in ('root',):
            nxt = 2 * b[key] - samples[-2][key]
            s[key] = s[key] + (a[key] - nxt) * t
        for side in 'LR':
            nxt = 2 * b['ankle'][side] - samples[-2]['ankle'][side]
            s['ankle'][side] = s['ankle'][side] + (a['ankle'][side] - nxt) * t


def set_rot(rig, name, R_world, head=None):
    """Pose a bone so its armature-space orientation is R_world (rig has identity rotation), keeping its head."""
    pb = rig.pose.bones[name]
    h = head if head is not None else pb.head
    M = R_world.to_4x4()
    M.translation = h
    pb.matrix = M
    bpy.context.view_layer.update()


def two_bone(H, G, K_hint, a, b):
    d = max(1e-6, min((G - H).length, a + b - 1e-5))
    u = (G - H).normalized()
    x = (a * a - b * b + d * d) / (2 * d)
    h = math.sqrt(max(0.0, a * a - x * x))
    w = (K_hint - H) - u * (K_hint - H).dot(u)
    w = w.normalized() if w.length > 1e-6 else Vector((0, -1, 0))
    return H + u * x + w * h


def apply_samples(rig, samples, loop=True, foot_ik=True):
    """Key each sample on frames 1..n (and n+1 = 1 for a loop): root, rotations, then the leg IK."""
    rig.animation_data_create()
    rig.animation_data.action = bpy.data.actions.new(rig.name + '_motion')
    bones = rig.pose.bones
    rest = {b.name: b.bone.head_local.copy() for b in bones}
    order = [b.name for b in sorted(bones, key=lambda b: len(b.parent_recursive))]
    a_len = {s: (rest[f'shin.{s}'] - rest[f'thigh.{s}']).length for s in 'LR'}
    b_len = {s: (rest[f'foot.{s}'] - rest[f'shin.{s}']).length for s in 'LR'}
    frames = samples + ([samples[0]] if loop else [])
    for fi, s in enumerate(frames, start=1):
        bpy.context.scene.frame_set(fi)
        for b in bones:
            b.matrix_basis = Matrix()
        bpy.context.view_layer.update()
        root = s['root'].copy()
        for _ in range(2):  # lower the hips until both ankles are in reach
            set_rot(rig, 'spine', s['rot'].get('spine', Matrix()), root)
            for name in order:
                if name != 'spine' and name in s['rot']:
                    set_rot(rig, name, s['rot'][name])
            if not foot_ik:
                break
            over = max((s['ankle'][sd] - bones[f'thigh.{sd}'].head).length - 0.998 * (a_len[sd] + b_len[sd]) for sd in 'LR')
            if over <= 0:
                break
            root.z -= over
        if foot_ik:
            for sd in 'LR':
                Hh = bones[f'thigh.{sd}'].head.copy()
                G = s['ankle'][sd]
                K = two_bone(Hh, G, bones[f'shin.{sd}'].head.copy(), a_len[sd], b_len[sd])
                foot_R = s['rot'][f'foot.{sd}']
                toe_R = s['rot'].get(f'toe.{sd}')
                for nm, p0, p1 in ((f'thigh.{sd}', Hh, K), (f'shin.{sd}', K, G)):
                    cur = _rot(bones[nm].matrix)
                    set_rot(rig, nm, _swing(cur @ Vector((0, 1, 0)), p1 - p0) @ cur, p0)
                set_rot(rig, f'foot.{sd}', foot_R)
                if toe_R is not None:
                    set_rot(rig, f'toe.{sd}', toe_R)
        for b in bones:
            b.keyframe_insert('location', frame=fi)
            b.keyframe_insert('rotation_quaternion', frame=fi)
            b.keyframe_insert('scale', frame=fi)
    for fc in rig.animation_data.action.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = 'LINEAR'
