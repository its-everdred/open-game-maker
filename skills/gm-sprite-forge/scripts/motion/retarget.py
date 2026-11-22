"""Retarget a source clip (KayKit GLB action or a BVH take) onto a fitted metarig, then plant the feet with an own
two-bone IK pass (Blender 4.3 module; #1202 rig spike).

Each bone's orientation comes from joint positions only: its direction plus an axis across the body (or the knee /
elbow hinge), built the same way on source and target, so a source whose rest pose is a T-pose, an A-pose or not a
standing pose at all (Bandai's BVH rest lies along +X) drives the fitted A-pose target. The hips' travel is scaled by the leg-length ratio, the take is turned to walk
toward -Y, the forward drift is removed (in place, like the pack sheets) and the loop seam is spread across the cycle.
The IK pass sets each ankle to the scaled source ankle (stance width corrected to the target's hips) and lowers the hips
when a leg cannot reach, so planted source feet stay planted.
"""
import math

import bpy
import numpy as np
from mathutils import Euler, Matrix, Quaternion, Vector


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


def pick_strike(src, m, f0, f1, seconds=1.1, fps=30.0):
    """One attack from a long take: a window around the fastest hand movement, 45% before it and 55% after."""
    fs = list(range(int(f0), int(f1) + 1))
    hands = {s: [] for s in 'LR'}
    for f in fs:
        bpy.context.scene.frame_set(f)
        for s in 'LR':
            hands[s].append(np.array(_src_world(src, m[f'hand.{s}'])[0]))
    speed = np.max([np.linalg.norm(np.diff(np.array(h), axis=0), axis=1) for h in hands.values()], axis=0)
    speed = np.convolve(speed, np.ones(3) / 3, 'same')
    peak = fs[int(speed.argmax())]
    n = seconds * fps
    a = max(f0, peak - 0.45 * n)
    return a, min(f1, a + n)


def _joints(arm, m, rest=False):
    """Named joint positions (world) of an armature through a target->source bone map (identity for the target)."""
    def head(t):
        return arm.matrix_world @ (arm.data.bones[m[t]].head_local if rest else arm.pose.bones[m[t]].head)
    def tail(t):
        return arm.matrix_world @ (arm.data.bones[m[t]].tail_local if rest else arm.pose.bones[m[t]].tail)
    j = {'pelvis': head('spine'), 'chest': head('spine.003'), 'head': head('spine.006'), 'head_end': tail('spine.006')}
    j['neck'] = head('spine.004') if 'spine.004' in m else j['head']
    for s in 'LR':
        j.update({f'hip.{s}': head(f'thigh.{s}'), f'knee.{s}': head(f'shin.{s}'), f'ankle.{s}': head(f'foot.{s}'),
                  f'ball.{s}': head(f'toe.{s}'), f'toe_end.{s}': tail(f'toe.{s}'), f'shoulder.{s}': head(f'upper_arm.{s}'),
                  f'elbow.{s}': head(f'forearm.{s}'), f'wrist.{s}': head(f'hand.{s}'), f'hand_end.{s}': tail(f'hand.{s}')})
    return j


def _frame(y, x):
    y = y.normalized()
    x = (x - y * x.dot(y)).normalized()
    return Matrix((x, y, x.cross(y))).transposed()  # columns: x, y, z


def _hinge(a, b, fallback, eps=0.15):
    """Bend axis of a two-segment limb; leans on `fallback` as the limb straightens, so it never flips at 0 deg."""
    return a.normalized().cross(b.normalized()) + fallback.normalized() * eps


def body_frames(j):
    """Per target bone, an orientation built only from joint positions: direction along the bone, X across the body
    (or the knee/elbow hinge). Built the same way on source and target, so no rest pose has to agree."""
    lp = j['hip.L'] - j['hip.R']
    lc = j['shoulder.L'] - j['shoulder.R']
    F = {'spine': _frame(j['chest'] - j['pelvis'], lp), 'spine.001': _frame(j['chest'] - j['pelvis'], lp + lc)}
    up = j['neck'] - j['chest'] if (j['neck'] - j['chest']).length > 1e-6 else j['chest'] - j['pelvis']
    F['spine.002'] = F['spine.003'] = _frame(up, lc)
    F['spine.004'] = F['spine.005'] = _frame(j['head'] - j['neck'] if (j['head'] - j['neck']).length > 1e-6 else up, lc)
    F['spine.006'] = _frame(j['head_end'] - j['head'], lc)
    for s in 'LR':
        th, sh = j[f'knee.{s}'] - j[f'hip.{s}'], j[f'ankle.{s}'] - j[f'knee.{s}']
        knee = _hinge(th, sh, lp)
        F[f'thigh.{s}'], F[f'shin.{s}'] = _frame(th, knee), _frame(sh, knee)
        F[f'foot.{s}'] = _frame(j[f'ball.{s}'] - j[f'ankle.{s}'], lp)
        F[f'toe.{s}'] = _frame(j[f'toe_end.{s}'] - j[f'ball.{s}'], lp)
        ua, fa = j[f'elbow.{s}'] - j[f'shoulder.{s}'], j[f'wrist.{s}'] - j[f'elbow.{s}']
        elbow = _hinge(ua, fa, -lc)
        F[f'upper_arm.{s}'], F[f'forearm.{s}'] = _frame(ua, elbow), _frame(fa, elbow)
        F[f'hand.{s}'] = _frame(j[f'hand_end.{s}'] - j[f'wrist.{s}'], elbow)
        F[f'shoulder.{s}'] = F['spine.003']  # the clavicle rides the chest
    return F


def _turned(j, turn, origin):
    return {k: turn @ (v - origin) for k, v in j.items()}


def retarget(src, rig, f0, f1, n=15, loop=True, foot_ik=True, mapping=None, stance=None):
    """Bake n evenly spaced source poses from [f0, f1) onto rig as frames 1..n (+ frame n+1 = frame 1 when loop)."""
    sc = bpy.context.scene
    m = mapping or bone_map(src)
    ident = {b.name: b.name for b in rig.pose.bones}
    jt = _joints(rig, ident, rest=True)
    Ft = body_frames(jt)
    rest_t = {b.name: _rot(b.bone.matrix_local) for b in rig.pose.bones}
    offset = {t: Ft[t].transposed() @ rest_t[t] for t in Ft}  # bone orientation in its body frame, at the target's rest

    leg_t = (jt['knee.L'] - jt['hip.L']).length + (jt['ankle.L'] - jt['knee.L']).length
    half_t = abs(jt['ankle.L'].x - jt['ankle.R'].x) / 2
    root_t = jt['pelvis']
    times = [f0 + (f1 - f0) * i / n for i in range(n)]
    js = []
    for f in times:
        sc.frame_set(math.floor(f), subframe=f - math.floor(f))
        js.append(_joints(src, m))
    leg_s = np.median([(j['knee.L'] - j['hip.L']).length + (j['ankle.L'] - j['knee.L']).length for j in js])
    k = leg_t / leg_s

    # heading: turn the take so its travel over the cycle (or, in place, the body's facing at f0) points to -Y
    hp0, hp1 = js[0]['pelvis'], _src_world_at(src, m['spine'], f1)[0]
    trav = Vector((hp1.x - hp0.x, hp1.y - hp0.y, 0))
    walking = loop and trav.length > 0.3 * leg_s
    if not walking:
        trav = (js[0]['hip.L'] - js[0]['hip.R']).cross(Vector((0, 0, 1)))
    yaw = math.atan2(-1, 0) - math.atan2(trav.y, trav.x)
    turn = Matrix.Rotation(yaw, 3, 'Z')
    ground = min(min(j['ankle.L'].z, j['ankle.R'].z) for j in js)  # the source's ankle height when planted
    tj = []
    for i, j in enumerate(js):
        drift = hp0 + (hp1 - hp0) * (i / n) if walking else hp0
        tj.append(_turned(j, turn, Vector((drift.x, drift.y, 0))))
    src_half = np.mean([abs(j['ankle.L'].x - j['ankle.R'].x) for j in tj]) / 2
    ank_t = {s: jt[f'ankle.{s}'] for s in 'LR'}

    samples = []
    for j in tj:
        Fs = body_frames(j)
        pose = {'root': Vector((root_t.x + j['pelvis'].x * k, root_t.y + j['pelvis'].y * k,
                                ank_t['L'].z + (j['pelvis'].z - ground) * k)),
                'rot': {t: Fs[t] @ offset[t] for t in Fs}, 'ankle': {}}
        for s in 'LR':
            a = j[f'ankle.{s}']
            sgn = 1 if s == 'L' else -1
            pose['ankle'][s] = Vector((root_t.x + a.x * k + sgn * (half_t - src_half * k), root_t.y + a.y * k,
                                       ank_t[s].z + (a.z - ground) * k))
        samples.append(pose)
    if loop:
        _close_loop(samples)
    plant = plant_feet(samples, loop) if foot_ik else None
    apply_samples(rig, samples, loop=loop, foot_ik=foot_ik, stance=stance)
    return {'stance': stance, 'planted': plant is not None, 'ground_v': plant[1] if plant else None, 'k_leg': k, 'cycle': [f0, f1],
            'walking': walking, 'yaw_deg': round(math.degrees(yaw), 1), 'map': m}


def _src_world_at(src, name, f):
    bpy.context.scene.frame_set(int(f), subframe=f - int(f))
    return _src_world(src, name)


def _close_loop(samples):
    """Spread the seam between the last sample and the first across the cycle (rotations, root and ankles).
    The seam is measured once, from the untouched samples, before any of them is corrected."""
    n = len(samples)
    a, b, c = samples[0], samples[-1], samples[-2] if n > 2 else samples[-1]
    rot_delta = {}
    for name in a['rot']:
        q_end = b['rot'][name].to_quaternion()
        q_next = q_end @ (c['rot'][name].to_quaternion().inverted() @ q_end)  # the would-be sample n
        rot_delta[name] = a['rot'][name].to_quaternion() @ q_next.inverted()
    root_delta = a['root'] - (2 * b['root'] - c['root'])
    ankle_delta = {sd: a['ankle'][sd] - (2 * b['ankle'][sd] - c['ankle'][sd]) for sd in 'LR'}
    for i, s in enumerate(samples):
        t = i / n
        s['rot'] = {name: (Quaternion().slerp(rot_delta[name], t) @ R.to_quaternion()).to_matrix()
                    for name, R in s['rot'].items()}
        s['root'] = s['root'] + root_delta * t
        s['ankle'] = {sd: s['ankle'][sd] + ankle_delta[sd] * t for sd in 'LR'}


def plant_feet(samples, loop=True, low=0.25):
    """Foot lock. An ankle is in contact on frames within `low` of its vertical range above its lowest point. During
    contact it moves at one ground speed (the median contact velocity of the clip) for a loop, or stays where contact
    began for a one-shot. The offset this leaves at the end of a contact fades out over the following swing.
    Returns (contact flags per side, ground velocity)."""
    n = len(samples)
    flags, steps = {}, []
    for s in 'LR':
        z = np.array([p['ankle'][s].z for p in samples])
        span = z.max() - z.min()
        flags[s] = (z - z.min()) <= low * span if span > 1e-4 else np.ones(n, bool)
        for i in range(n if loop else n - 1):
            j = (i + 1) % n
            if flags[s][i] and flags[s][j]:
                steps.append(np.array(samples[j]['ankle'][s] - samples[i]['ankle'][s])[:2])
    v = np.median(steps, 0) if (steps and loop) else np.zeros(2)
    for s in 'LR':
        f = flags[s]
        idx = (lambda i: i % n) if loop else (lambda i: i)
        starts = [i for i in range(n) if f[i] and not (f[i - 1] if (loop or i) else False)]
        if loop and f.all():
            starts = [0]
        for st in starts:
            base = samples[st]['ankle'][s].copy()
            k, last = 0, None
            while k < n and (loop or st + k < n) and f[idx(st + k)]:
                p = samples[idx(st + k)]['ankle'][s]
                new = Vector((base.x + v[0] * k, base.y + v[1] * k, p.z))
                last = (idx(st + k), new - p)
                p.x, p.y = new.x, new.y
                k += 1
            if last is None:
                continue
            swing = []  # frames after this contact until the next one
            j = 1
            while j < n and (loop or last[0] + j < n) and not f[idx(last[0] + j)]:
                swing.append(idx(last[0] + j))
                j += 1
            for m_, i in enumerate(swing):
                fade = 1 - (m_ + 1) / (len(swing) + 1)
                samples[i]['ankle'][s] += Vector((last[1].x, last[1].y, 0)) * fade
    return {s: flags[s].tolist() for s in 'LR'}, v.tolist()


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


STANCES = {  # additive pose layers (world-axis degrees, chained parent -> child) and a crouch as a fraction of leg length
    # SmallScaleInt HD barbarians: hunched forward, head pushed out and down, arms hanging in front, knees soft
    'ssi-barbarian': {'crouch': 0.05, 'rot': {'spine': (14, 0, 0), 'spine.002': (12, 0, 0), 'spine.004': (-12, 0, 0),
                                               'upper_arm.L': (-14, 0, 0), 'upper_arm.R': (-14, 0, 0),
                                               'forearm.L': (-12, 0, 0), 'forearm.R': (-12, 0, 0)}},
    # SmallScaleInt HD 3Wizard and 5BarbArcher Idles: a sideways fighting stance, torso turned off the facing,
    # knees bent, arms held out from the body with the elbows bent (matched by eye on the base bodies, #1202)
    'ssi-wizard': {'crouch': 0.2, 'rot': {'spine': (18, 0, -35), 'spine.004': (-12, 0, 14),
                                           'upper_arm.L': (-10, -12, 0), 'upper_arm.R': (-10, 12, 0),
                                           'forearm.L': (-35, 0, 0), 'forearm.R': (-35, 0, 0)}},
    'ssi-ranger': {'crouch': 0.15, 'rot': {'spine': (12, 0, -35), 'spine.004': (-8, 0, 14),
                                           'upper_arm.L': (-8, -12, 0), 'upper_arm.R': (-8, 12, 0),
                                           'forearm.L': (-25, 0, 0), 'forearm.R': (-25, 0, 0)}},
}


def apply_stance(rig, samples, stance):
    """Kevin (2026-11-22): stance changes belong to the rigging step. Rotate each sample's bones by the stance
    layer and lower the hips; the feet stay where the motion put them, so the knees take the crouch."""
    st = STANCES[stance] if isinstance(stance, str) else stance
    parent = {b.name: (b.parent.name if b.parent else None) for b in rig.pose.bones}
    local = {n: Euler(tuple(math.radians(a) for a in v), 'XYZ').to_matrix() for n, v in st.get('rot', {}).items()}
    world = {}

    def get(n):
        if n not in world:
            p = parent[n]
            world[n] = (get(p) if p else Matrix.Identity(3)) @ local.get(n, Matrix.Identity(3))
        return world[n]
    leg = (rig.data.bones['shin.L'].head_local - rig.data.bones['thigh.L'].head_local).length + \
          (rig.data.bones['foot.L'].head_local - rig.data.bones['shin.L'].head_local).length
    for smp in samples:
        smp['rot'] = {n: get(n) @ R for n, R in smp['rot'].items()}
        smp['root'] = smp['root'] - Vector((0, 0, st.get('crouch', 0) * leg))


def apply_samples(rig, samples, loop=True, foot_ik=True, stance=None):
    """Key each sample on frames 1..n (and n+1 = 1 for a loop): root, rotations, then the leg IK."""
    if stance:
        apply_stance(rig, samples, stance)
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
        for tries in range(4):  # pose, then lower the hips and pose again until both ankles are in reach
            set_rot(rig, 'spine', s['rot'].get('spine', Matrix()), root)
            for name in order:
                if name != 'spine' and name in s['rot']:
                    set_rot(rig, name, s['rot'][name])
            if not foot_ik:
                break
            over = max((s['ankle'][sd] - bones[f'thigh.{sd}'].head).length - 0.998 * (a_len[sd] + b_len[sd]) for sd in 'LR')
            if over <= 0 or tries == 3:
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
