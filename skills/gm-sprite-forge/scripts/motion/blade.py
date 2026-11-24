"""Turn a weapon about its haft so the blade leads the swing (#1282 round 4).

Kevin (2026-11-24) liked the round 3 attacks but not the axe: the pack Barbarian swings with the blade's edge facing
the way it moves. `render_motion.py ... blade_only=1` writes `blade.json` (per sampled frame, in world space: the head
centroid, the haft direction and the blade direction, from the haft toward the edge). `spin_delta` returns the turn
about the haft, in degrees, that points the blade along the head's motion over the whole clip. Each step counts by its
speed squared, so the fast strike decides and the slower wind-up, which runs the other way, cannot cancel it. Add the
result to the cell's weapon `spin`.

Usage: python3 blade.py <blade.json> ...   (prints each file's spin delta)
"""
import json
import math
import sys


def _dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def _sub(a, b):
    return [x - y for x, y in zip(a, b)]


def _scale(a, k):
    return [x * k for x in a]


def _unit(a):
    n = math.sqrt(_dot(a, a))
    if n < 1e-9:
        raise ValueError('a zero haft or blade vector: the weapon head has no single edge to face the swing')
    return _scale(a, 1 / n)


def _cross(a, b):
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def spin_delta(frames):
    """Degrees to turn the blade about the haft (right hand) so it faces the head's motion, and the share of the
    motion it then faces (1 = every step's motion across the haft lies along the blade, by speed squared; 0 = it never
    moves across the haft)."""
    C = S = total = 0.0
    for f, g in zip(frames, frames[1:]):  # the step from each frame to the next, scored against the blade at its start
        a = _unit(f['haft'])
        b = _unit(_sub(f['blade'], _scale(a, _dot(a, f['blade']))))  # keep the blade across the haft
        c = _cross(a, b)  # b turned 90 degrees about the haft
        v = _sub(g['head'], f['head'])
        vp = _sub(v, _scale(a, _dot(a, v)))  # only motion across the haft can be faced
        w = math.sqrt(_dot(vp, vp))  # each step weighted by its own speed once more
        # b(t) = b cos t + c sin t, so the sum of w vp.b(t) = C cos t + S sin t peaks at t = atan2(S, C)
        C += w * _dot(vp, b)
        S += w * _dot(vp, c)
        total += w * w
    return math.degrees(math.atan2(S, C)), (math.hypot(C, S) / total if total else 0.0)


if __name__ == '__main__':
    for p in sys.argv[1:]:
        d, share = spin_delta(json.load(open(p))['frames'])
        print(f'{p}: spin {d:+.0f} deg (faces {share:.2f} of the swing)')
