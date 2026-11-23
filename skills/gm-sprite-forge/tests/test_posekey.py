"""Checks for hand-keyed poses (#1282 round 2): how a swing moves between its key poses.

Kevin rejected every round-1 attack because the axe "glitched back and forth instead of being a large swing with follow
through". A keyed swing must therefore pass through every sheet frame between its keys, one way only, at the speed its
easing says (slow into the wind-up, fast through the strike), and never take the long way round a rotation.
"""
import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/motion'))
from posekey import filled, pose_at, segment, slerp_dir  # noqa: E402
from sampling import compatible  # noqa: E402

UP, FRONT, DOWN = [0, 0, 1], [0, 1, 0], [0, 0, -1]


def angle(a, b):
    return math.degrees(math.acos(max(-1, min(1, sum(x * y for x, y in zip(a, b))))))


class Swing(unittest.TestCase):
    KEYS = [{'t': 0, 'axe': UP}, {'t': 4, 'ease': 'in', 'axe': FRONT}, {'t': 8, 'ease': 'out', 'axe': DOWN}]

    def test_axe_moves_one_way_through_every_frame(self):
        # From overhead through the front to the ground: each frame further along the arc, none back.
        dirs = [pose_at(self.KEYS, t)['axe'] for t in range(9)]
        along = [angle(UP, d) for d in dirs]
        self.assertEqual(along, sorted(along))
        self.assertTrue(all(b - a > 1 for a, b in zip(along, along[1:])), along)  # no held frame mid-swing

    def test_strike_speeds_up_and_follow_through_slows(self):
        steps = [angle(pose_at(self.KEYS, t)['axe'], pose_at(self.KEYS, t + 1)['axe']) for t in range(8)]
        self.assertLess(steps[0], steps[3])  # 'in': the swing gathers speed into the strike
        self.assertGreater(steps[4], steps[7])  # 'out': it bleeds off through the follow-through

    def test_opposite_directions_need_a_key_between(self):
        # Up to down has no shortest way: the swing could go in front or behind, so the keys must say which.
        with self.assertRaises(ValueError):
            slerp_dir(UP, DOWN, 0.5)


class Keys(unittest.TestCase):
    def test_a_field_carries_over_until_a_key_changes_it(self):
        ks = filled([{'t': 0, 'pelvis': 10, 'hips': [0, 0, -0.1]}, {'t': 3, 'pelvis': 30}])
        self.assertEqual(ks[1]['hips'], [0, 0, -0.1])  # the crouch holds: not a jump back to standing

    def test_blend_lands_on_the_keys(self):
        keys = [{'t': 0, 'pelvis': 0}, {'t': 4, 'ease': 'linear', 'pelvis': 40}]
        self.assertEqual([pose_at(keys, t)['pelvis'] for t in (0, 2, 4, 6)], [0, 20, 40, 40])

    def test_keys_must_rise(self):
        with self.assertRaises(ValueError):
            segment([{'t': 0}, {'t': 0}], 0.5)

    def test_unknown_ease_fails(self):
        with self.assertRaises(ValueError):
            segment([{'t': 0}, {'t': 2, 'ease': 'bounce'}], 1)


class Hemisphere(unittest.TestCase):
    def test_next_key_takes_the_previous_keys_side(self):
        # q and -q are one rotation; keyed on opposite sides, an interpolation spins the bone about 360 degrees.
        prev = [0.7, 0.7, 0, 0]
        self.assertEqual(compatible(prev, [-0.6, -0.8, 0, 0]), [0.6, 0.8, 0, 0])
        self.assertEqual(compatible(prev, [0.6, 0.8, 0, 0]), [0.6, 0.8, 0, 0])


if __name__ == '__main__':
    unittest.main()
