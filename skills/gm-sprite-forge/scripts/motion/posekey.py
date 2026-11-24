"""Hand-keyed poses on a rigged body (#1282 round 2): the timing half. No Blender: handpose.py and the tests import it.

A clip is a list of key poses on the sheet's own frame grid (`t` = sheet frame, 0 .. n-1). Every sheet frame is drawn
from the two keys around it, with the segment's easing, so a swing passes through every frame between its keys instead
of jumping from one held pose to the next. Directions are slerped and angles and offsets blended, so nothing reverses
between two keys unless a key says so.
"""
import math

EASE = {
    'linear': lambda u: u,
    'in': lambda u: u * u,                      # slow start, fast end: the strike
    'out': lambda u: 1 - (1 - u) ** 2,          # fast start, slow end: into the wind-up, the follow-through
    'io': lambda u: u * u * (3 - 2 * u),        # both: ready to draw, recovery
}


def segment(keys, t):
    """(index of the key before t, index after, eased fraction): the segment uses the later key's `ease`."""
    ts = [k['t'] for k in keys]
    if ts != sorted(ts) or len(set(ts)) != len(ts):
        raise ValueError(f'key times must rise strictly: {ts}')
    if t <= ts[0]:
        return 0, 0, 0.0
    if t >= ts[-1]:
        return len(keys) - 1, len(keys) - 1, 0.0
    i = next(i for i in range(1, len(ts)) if ts[i] >= t)
    u = (t - ts[i - 1]) / (ts[i] - ts[i - 1])
    ease = keys[i].get('ease', 'io')
    if ease not in EASE:
        raise ValueError(f'unknown ease {ease!r}: {sorted(EASE)}')
    return i - 1, i, EASE[ease](u)


def filled(keys):
    """Each key with every field it leaves out carried over from the key before (write the full pose once, at key 0)."""
    out, cur = [], {}
    for k in keys:
        cur = {**cur, **k}
        out.append(dict(cur))
    return out


def _norm(v):
    n = math.sqrt(sum(x * x for x in v))
    if n < 1e-9:
        raise ValueError(f'zero direction {v}')
    return [x / n for x in v]


def slerp_dir(a, b, u):
    """The unit direction a fraction u along the great circle from a to b."""
    a, b = _norm(a), _norm(b)
    d = max(-1.0, min(1.0, sum(x * y for x, y in zip(a, b))))
    if d < -0.999:
        raise ValueError(f'directions {a} and {b} are opposite: add a key between them to say which way round')
    w = math.acos(d)
    if w < 1e-6:
        return a
    s = math.sin(w)
    return _norm([(math.sin((1 - u) * w) * x + math.sin(u * w) * y) / s for x, y in zip(a, b)])


DIRS = ('arm_r', 'fore_r', 'axe', 'arm_l', 'fore_l')
VECS = ('hips', 'foot_l', 'foot_r')
ANGLES = ('pelvis', 'torso', 'head')


def pose_at(keys, t):
    """The blended pose at sheet frame t: directions slerped, offsets and angles blended linearly."""
    ks = filled(keys)
    i, j, u = segment(ks, t)
    a, b = ks[i], ks[j]
    p = {}
    for name in DIRS:
        if name in a:
            p[name] = slerp_dir(a[name], b[name], u)
    for name in VECS + ANGLES:
        if name in a:
            va, vb = a[name], b[name]
            p[name] = [x + u * (y - x) for x, y in zip(va, vb)] if isinstance(va, list) else va + u * (vb - va)
    return p
