"""Checks for guard_walk.py (#1282 round 3): which mocap cycles count as a guarded walk.

Kevin rejected relaxed walks: the pack's barbarian walks "slightly hunched, more on guard". The finder must rank a
hunched cycle with the hands up above an upright one with the arms hanging, and must drop cycles that would play
wrong on a walk sheet: backing off (toes against the travel) and turning on the spot.
"""
import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/motion'))
from guard_walk import rank  # noqa: E402

FPS, CYCLE, SPEED = 30, 30, 0.9


def take(lean=0.0, head=1.7, hand_z=0.8, hand_fwd=0.0, toe=1.0, turn_deg=0.0, cycles=3):
    """Synthetic walk along a heading that bends by turn_deg per cycle: the left foot plants for 10 of every
    30 frames and swings for the rest; toe=1 points the toes along the travel, -1 against it."""
    T = {j: [] for j in ('Hips', 'Head', 'LeftFoot', 'RightFoot', 'LeftHand', 'RightHand', 'LeftToe', 'RightToe')}
    x = y = 0.0
    foot = [0.0, 0.0]
    for f in range(CYCLE * cycles + 2):
        a = math.radians(turn_deg * f / CYCLE)
        ux, uy = math.cos(a), math.sin(a)
        x, y = x + ux * SPEED / FPS, y + uy * SPEED / FPS
        if f % CYCLE >= 10:  # swing: the foot catches up with the hips
            foot = [x, y]
        T['Hips'].append([x, y, 1.0])
        T['Head'].append([x + ux * lean, y + uy * lean, head])
        for s in ('Left', 'Right'):
            T[s + 'Foot'].append([foot[0], foot[1], 0.1] if s == 'Left' else [x, y, 0.1])
            base = T[s + 'Foot'][-1]
            T[s + 'Toe'].append([base[0] + ux * 0.15 * toe, base[1] + uy * 0.15 * toe, 0.02])
            T[s + 'Hand'].append([x + ux * hand_fwd, y + uy * hand_fwd, hand_z])
    return {'f0': 1, 'tracks': T}


class GuardWalk(unittest.TestCase):
    def test_hunched_hands_up_ranks_above_upright(self):
        got = rank({'guard': take(lean=0.3, head=1.5, hand_z=1.2, hand_fwd=0.3), 'relaxed': take()})
        self.assertTrue(got)
        self.assertEqual(got[0]['take'], 'guard')
        self.assertGreater(min(c['score'] for c in got if c['take'] == 'guard'),
                           max(c['score'] for c in got if c['take'] == 'relaxed'))

    def test_backing_off_is_dropped(self):
        self.assertEqual(rank({'back': take(lean=0.3, head=1.5, hand_z=1.2, hand_fwd=0.3, toe=-1.0)}), [])

    def test_turning_is_dropped(self):
        self.assertEqual(rank({'turn': take(lean=0.3, head=1.5, hand_z=1.2, hand_fwd=0.3, turn_deg=90)}), [])

    def test_cycle_spans_one_plant_to_the_next(self):
        c = rank({'guard': take(lean=0.3)})[0]
        self.assertEqual(c['f1'] - c['f0'], CYCLE)


if __name__ == '__main__':
    unittest.main()
