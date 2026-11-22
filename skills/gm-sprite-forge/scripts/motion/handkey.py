"""Hand-keyed motion with IK feet for a fitted metarig (Blender 4.3 module; #1202 rig spike, motion source "handkey").

walk: a contact / down / passing / up cycle in place. Each foot spends 60% of the cycle planted, sliding back at one
ground speed (so it stays planted when the sprite moves), rolls heel -> toe, and swings forward on an arc. The hips
drop after each contact and rise at passing, sway over the planted foot and turn with the forward leg; the chest turns
against them and the arms swing against the legs with more elbow bend going forward.
attack: key poses with eased timing. "chop": one overhead chop (ready -> anticipation -> strike -> follow-through ->
recover). "combo": two swings on the pack Attack1 beat (wind-up, overhead, diagonal strike, backhand, second strike). Feet stay locked by IK; the hips drop into the strike.
Rotations are world-axis deltas from the rest pose, chained parent -> child, so arms ride the chest's turn.
"""
import math

from mathutils import Euler, Matrix, Vector

import retarget

PARENT = {'spine.001': 'spine', 'spine.002': 'spine.001', 'spine.003': 'spine.002', 'spine.004': 'spine.003',
          'spine.005': 'spine.004', 'spine.006': 'spine.005'}
for _s in 'LR':
    PARENT.update({f'shoulder.{_s}': 'spine.003', f'upper_arm.{_s}': f'shoulder.{_s}', f'forearm.{_s}': f'upper_arm.{_s}',
                   f'hand.{_s}': f'forearm.{_s}', f'thigh.{_s}': 'spine', f'shin.{_s}': f'thigh.{_s}',
                   f'foot.{_s}': f'shin.{_s}', f'toe.{_s}': f'foot.{_s}'})


def _e(x=0.0, y=0.0, z=0.0):
    return Euler((math.radians(x), math.radians(y), math.radians(z)), 'XYZ').to_matrix()


def _ease(u):
    return u * u * (3 - 2 * u)


def _rest(rig):
    return {b.name: (b.bone.matrix_local.to_3x3().normalized(), b.bone.head_local.copy(), b.bone.tail_local.copy())
            for b in rig.pose.bones}


def _chain(rest, local):
    """World rotations from per-bone local deltas (world axes), composed down the hierarchy."""
    world = {}

    def get(n):
        if n not in world:
            p = PARENT.get(n)
            world[n] = (get(p) if p else Matrix.Identity(3)) @ local.get(n, Matrix.Identity(3))
        return world[n]
    return {n: get(n) @ rest[n][0] for n in rest if n in PARENT or n == 'spine'}


def walk(rig, n=15, stride=0.8, lift=0.13, bob=0.035, sway=0.03, yaw=9, lean=0, arm=24, elbow=(18, 38), stance=None):
    """stride, lift, bob, sway: fractions of leg length; angles in degrees."""
    R = _rest(rig)
    leg = (R['shin.L'][1] - R['thigh.L'][1]).length + (R['foot.L'][1] - R['shin.L'][1]).length
    foot_len = (R['foot.L'][2] - R['foot.L'][1])
    samples = []
    for i in range(n):
        t = i / n
        loc = {'spine': _e(lean, 0, yaw * math.cos(2 * math.pi * t)),  # right hip forward at t = 0
               'spine.002': _e(0, 0, -1.6 * yaw * math.cos(2 * math.pi * t)),  # shoulders against the hips
               'spine.004': _e(-lean * 0.8, 0, 0.6 * yaw * math.cos(2 * math.pi * t))}  # head keeps looking ahead
        ankles = {}
        for side, ph in (('R', t), ('L', (t + 0.5) % 1)):
            a0 = R[f'foot.{side}'][1]
            if ph < 0.6:  # planted: heel strike at the front, slide back at ground speed, roll onto the toe
                u = ph / 0.6
                y = -stride * leg / 2 + stride * leg * u
                pitch = 14 * (1 - u / 0.15) if u < 0.15 else (-28 * ((u - 0.7) / 0.3) if u > 0.7 else 0)
                z = a0.z
                if pitch < 0:  # heel up about the ball: the ankle rises
                    z += abs(foot_len.y) * math.sin(math.radians(-pitch))
            else:  # swing: forward on an eased arc
                u = (ph - 0.6) / 0.4
                y = stride * leg / 2 - stride * leg * _ease(u)
                z = a0.z + lift * leg * math.sin(math.pi * u)
                pitch = -28 * (1 - u / 0.3) if u < 0.3 else 10 * (u - 0.3) / 0.7
            ankles[side] = Vector((a0.x, a0.y + y, z))
            loc[f'foot.{side}'] = _e(-pitch, 0, 0)  # world X: positive tips the toe down when the foot faces -Y
        for side, sgn in (('R', -1), ('L', 1)):
            fwd = math.cos(2 * math.pi * (t + (0.5 if side == 'R' else 0)))  # arm opposite its own leg
            loc[f'upper_arm.{side}'] = _e(-arm * fwd, 0, 0)
            bend = elbow[0] + (elbow[1] - elbow[0]) * max(0.0, fwd)
            loc[f'forearm.{side}'] = _e(-bend, 0, 0)
        root = R['spine'][1].copy()
        root.z += -bob * leg + bob * leg * math.cos(2 * math.pi * 2 * (t - 0.3))  # up at passing, down after contact
        root.x += -sway * leg * math.sin(2 * math.pi * (t - 0.05))  # over the planted foot
        samples.append({'root': root, 'rot': _chain(R, loc), 'ankle': ankles})
    retarget.apply_samples(rig, samples, loop=True, foot_ik=True, stance=stance)
    return {'kind': 'handkey', 'clip': 'walk', 'stance': stance, 'stride': stride, 'lift': lift, 'bob': bob, 'sway': sway, 'yaw': yaw,
            'lean': lean, 'arm': arm, 'elbow': list(elbow)}


ATTACK_KEYS = [  # (time 0..1, root drop as a fraction of leg length, local deltas in degrees)
    (0.00, 0.03, {'spine': (8, 0, 0), 'upper_arm.R': (-20, 0, 0), 'forearm.R': (-40, 0, 0), 'upper_arm.L': (-10, 0, 0),
                  'forearm.L': (-30, 0, 0)}),
    (0.30, 0.01, {'spine': (-6, 0, 25), 'spine.002': (-10, 0, 20), 'upper_arm.R': (-150, 0, -20), 'forearm.R': (-70, 0, 0),
                  'hand.R': (-30, 0, 0), 'upper_arm.L': (-50, 0, 30), 'forearm.L': (-40, 0, 0)}),
    (0.42, 0.07, {'spine': (24, 0, -18), 'spine.002': (14, 0, -20), 'upper_arm.R': (-50, 0, 10), 'forearm.R': (-5, 0, 0),
                  'hand.R': (20, 0, 0), 'upper_arm.L': (20, 0, -10), 'forearm.L': (-50, 0, 0)}),
    (0.55, 0.08, {'spine': (26, 0, -24), 'spine.002': (16, 0, -24), 'upper_arm.R': (10, 0, 20), 'forearm.R': (-10, 0, 0),
                  'hand.R': (25, 0, 0), 'upper_arm.L': (30, 0, -10), 'forearm.L': (-50, 0, 0)}),
    (1.00, 0.03, {'spine': (8, 0, 0), 'upper_arm.R': (-20, 0, 0), 'forearm.R': (-40, 0, 0), 'upper_arm.L': (-10, 0, 0),
                  'forearm.L': (-30, 0, 0)}),
]


COMBO_KEYS = [  # two swings on the pack Attack1 beat (15 frames): wind-up, overhead, diagonal strike, follow-through,
    # backhand wind-up, second strike, recover. Right arm holds the weapon; X lifts back, Y lifts sideways, Z turns.
    (0.00, 0.03, {'spine': (8, 0, 0), 'upper_arm.R': (-20, 0, 0), 'forearm.R': (-40, 0, 0), 'upper_arm.L': (-10, 0, 0),
                  'forearm.L': (-30, 0, 0)}),
    (0.07, 0.02, {'spine': (4, 0, -15), 'upper_arm.R': (0, 80, 0), 'forearm.R': (-20, 0, 0), 'upper_arm.L': (-30, 0, -20)}),
    (0.14, 0.01, {'spine': (-4, 0, -25), 'upper_arm.R': (150, 20, 0), 'forearm.R': (60, 0, 0), 'upper_arm.L': (-40, -30, 0),
                  'forearm.L': (-30, 0, 0)}),
    (0.21, 0.01, {'spine': (-8, 0, -20), 'upper_arm.R': (175, 0, 0), 'forearm.R': (20, 0, 0), 'upper_arm.L': (-40, -40, 0)}),
    (0.29, 0.07, {'spine': (20, 0, 30), 'spine.002': (8, 0, 10), 'upper_arm.R': (-70, 0, 40), 'forearm.R': (-5, 0, 0),
                  'upper_arm.L': (30, -30, 0), 'forearm.L': (-50, 0, 0)}),
    (0.36, 0.09, {'spine': (28, 0, 35), 'spine.002': (10, 0, 12), 'upper_arm.R': (-40, 0, 60), 'forearm.R': (-10, 0, 0),
                  'upper_arm.L': (40, -30, 0), 'forearm.L': (-50, 0, 0)}),
    (0.43, 0.06, {'spine': (15, 0, -10), 'upper_arm.R': (0, 80, -20), 'forearm.R': (-10, 0, 0), 'upper_arm.L': (-20, -20, 0)}),
    (0.50, 0.09, {'spine': (25, 0, 15), 'upper_arm.R': (-60, 0, 30), 'forearm.R': (-30, 0, 0), 'upper_arm.L': (10, -20, 0)}),
    (0.57, 0.04, {'spine': (5, 0, -20), 'upper_arm.R': (120, 40, 0), 'forearm.R': (40, 0, 0), 'upper_arm.L': (-30, -30, 0)}),
    (0.64, 0.03, {'spine': (-5, 0, -25), 'upper_arm.R': (150, 40, 0), 'forearm.R': (20, 0, 0), 'upper_arm.L': (-40, -30, 0)}),
    (0.71, 0.09, {'spine': (25, 0, 10), 'spine.002': (8, 0, 5), 'upper_arm.R': (-80, 0, 10), 'forearm.R': (-5, 0, 0),
                  'upper_arm.L': (30, -20, 0), 'forearm.L': (-50, 0, 0)}),
    (0.86, 0.05, {'spine': (12, 0, 0), 'upper_arm.R': (-30, 0, 0), 'forearm.R': (-40, 0, 0), 'upper_arm.L': (-10, 0, 0),
                  'forearm.L': (-30, 0, 0)}),
    (1.00, 0.03, {'spine': (8, 0, 0), 'upper_arm.R': (-20, 0, 0), 'forearm.R': (-40, 0, 0), 'upper_arm.L': (-10, 0, 0),
                  'forearm.L': (-30, 0, 0)}),
]


def attack(rig, n=15, step=0.16, stance=None, keys='chop'):
    R = _rest(rig)
    leg = (R['shin.L'][1] - R['thigh.L'][1]).length + (R['foot.L'][1] - R['shin.L'][1]).length
    ankles = {'L': R['foot.L'][1] + Vector((0.03 * leg, -step * leg, 0)),  # left foot forward, right back
              'R': R['foot.R'][1] + Vector((-0.03 * leg, step * leg * 0.6, 0))}
    table = COMBO_KEYS if keys == 'combo' else ATTACK_KEYS
    samples = []
    for i in range(n):
        t = i / (n - 1)
        k = max(j for j, key in enumerate(table) if key[0] <= t + 1e-9)
        k = min(k, len(table) - 2)
        (t0, d0, p0), (t1, d1, p1) = table[k], table[k + 1]
        u = _ease((t - t0) / (t1 - t0))
        loc = {}
        for b in set(p0) | set(p1):
            a, c = Vector(p0.get(b, (0, 0, 0))), Vector(p1.get(b, (0, 0, 0)))
            loc[b] = _e(*(a + (c - a) * u))
        root = R['spine'][1].copy()
        root.z -= (d0 + (d1 - d0) * u) * leg
        samples.append({'root': root, 'rot': _chain(R, loc), 'ankle': dict(ankles)})
    retarget.apply_samples(rig, samples, loop=False, foot_ik=True, stance=stance)
    return {'kind': 'handkey', 'clip': 'attack', 'keys': keys, 'times': [k[0] for k in table], 'step': step, 'stance': stance}


def build(rig, mo, n=15):
    p = {'n': n} | mo.get('params', {}) | ({'stance': mo['stance']} if mo.get('stance') else {})
    return walk(rig, **p) if mo.get('clip', 'walk') == 'walk' else attack(rig, **p)
