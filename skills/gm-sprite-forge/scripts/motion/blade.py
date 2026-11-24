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

import numpy as np


def spin_delta(frames):
    """Degrees to turn the blade about the haft (right hand) so it faces the head's motion, and the share of the
    motion it then faces (1 = every step's motion across the haft lies along the blade, by speed squared; 0 = it never
    moves across the haft)."""
    head = np.array([f['head'] for f in frames], float)
    haft = np.array([f['haft'] for f in frames], float)
    blade = np.array([f['blade'] for f in frames], float)
    v = head[1:] - head[:-1]  # the step from each frame to the next, scored against the blade at its start
    a, b = haft[:-1], blade[:-1]
    a /= np.linalg.norm(a, axis=1, keepdims=True)
    b = b - a * np.sum(a * b, axis=1, keepdims=True)  # keep the blade across the haft
    b /= np.linalg.norm(b, axis=1, keepdims=True)
    c = np.cross(a, b)  # b turned 90 degrees about the haft
    vp = v - a * np.sum(a * v, axis=1, keepdims=True)  # only motion across the haft can be faced
    w = np.linalg.norm(vp, axis=1, keepdims=True)  # each step weighted by its own speed once more
    # b(t) = b cos t + c sin t, so sum w v.b(t) = C cos t + S sin t peaks at t = atan2(S, C)
    C, S = float(np.sum(w * vp * b)), float(np.sum(w * vp * c))
    total = float(np.sum(w ** 2))
    return math.degrees(math.atan2(S, C)), (math.hypot(C, S) / total if total else 0.0)


if __name__ == '__main__':
    for p in sys.argv[1:]:
        d, share = spin_delta(json.load(open(p))['frames'])
        print(f'{p}: spin {d:+.0f} deg (faces {share:.2f} of the swing)')
