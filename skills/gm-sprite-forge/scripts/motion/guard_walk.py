"""Rank one-cycle walk windows in long mocap takes by how guarded they look (#1282 round 3).

Kevin (2026-11-23): the pack's walk is "slightly hunched, more on guard, the axe held more carefully ready to swing";
casual library walks read too relaxed. Fight takes (LaFAN1 fight1_*) hold such stepping between exchanges, so this
finds it: a cycle runs from one left-foot plant to the next; kept are cycles whose hips travel 0.5-1.5 m/s with less
than 25 degrees of turn and whose toes point along the travel (forward stepping, not backing off or sidestepping).
Score: head ahead of the hips along the travel (hunch) x4, head below the take's standing height x2, and hands ahead of
the hips and between hip and head height (held up) x1.

Usage: guard_walk.py <tracks.json> <out.json> [--top 12]
tracks.json comes from bvh_track.py: {take: {"f0": first frame, "tracks": {joint: [[x, y, z], ...]}}}, metres, Z up.
"""
import argparse
import json
import math

FPS = 30


def _flat(a, b):
    return b[0] - a[0], b[1] - a[1]


def _unit(v):
    n = math.hypot(*v)
    return (v[0] / n, v[1] / n) if n else (0.0, 0.0)


def cycles(take, t, fps=FPS):
    """Every kept cycle of one take, scored; frames are the take's own (t['f0'] added)."""
    T = t['tracks']
    n = len(T['Hips'])
    H, Hd, LF = T['Hips'], T['Head'], T['LeftFoot']
    stand = sorted(p[2] for p in Hd)[int(0.95 * (n - 1))]
    sp = [0.0] + [math.hypot(*_flat(LF[i - 1], LF[i])) * fps for i in range(1, n)]
    plants = [i for i in range(1, n - 1) if sp[i] < 0.15 <= sp[i - 1]]
    out = []
    for a, b in zip(plants, plants[1:]):
        L = b - a
        if not 24 <= L <= 45:
            continue
        travel = _flat(H[a], H[b])
        v = math.hypot(*travel) * fps / L
        if not 0.5 <= v <= 1.5:
            continue
        u = _unit(travel)
        h1, h2 = _flat(H[a], H[a + L // 2]), _flat(H[a + L // 2], H[b])
        turn = abs(math.degrees(math.atan2(h1[0] * h2[1] - h1[1] * h2[0], h1[0] * h2[0] + h1[1] * h2[1])))
        if turn > 25:
            continue
        lean = low = hands = fwd = 0.0
        for i in range(a, b):
            ahead = lambda p: (p[i][0] - H[i][0]) * u[0] + (p[i][1] - H[i][1]) * u[1]  # noqa: E731
            lean += ahead(Hd)
            low += stand - Hd[i][2]
            for hd in (T['LeftHand'], T['RightHand']):
                hands += (ahead(hd) > 0.12) + (H[i][2] < hd[i][2] < Hd[i][2])
            for foot, toe in (('LeftFoot', 'LeftToe'), ('RightFoot', 'RightToe')):
                d = _unit(_flat(T[foot][i], T[toe][i]))
                fwd += d[0] * u[0] + d[1] * u[1]
        lean, low, hands, fwd = lean / L, low / L, hands / (4 * L), fwd / (2 * L)
        if fwd < 0.5:
            continue
        out.append({'take': take, 'f0': t['f0'] + a, 'f1': t['f0'] + b, 'len': L, 'v': round(v, 2),
                    'turn': round(turn), 'lean': round(lean, 3), 'low': round(low, 3), 'hands': round(hands, 2),
                    'fwd': round(fwd, 2), 'score': round(lean * 4 + low * 2 + hands, 3)})
    return out


def rank(data, fps=FPS):
    return sorted((c for take, t in data.items() for c in cycles(take, t, fps)), key=lambda c: -c['score'])


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('tracks')
    ap.add_argument('out')
    ap.add_argument('--top', type=int, default=12)
    a = ap.parse_args()
    ranked = rank(json.load(open(a.tracks)))
    json.dump(ranked, open(a.out, 'w'), indent=0)
    for c in ranked[:a.top]:
        print(c)
    print(len(ranked), 'cycles')
