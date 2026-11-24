"""Checks for blade.py: which way to turn a weapon about its haft so the edge leads the strike (#1282 round 4).

Kevin liked the round 3 attacks but not the axe angle: the pack Barbarian chops with the edge facing the swing. The turn
must follow the fast strike, not the slower wind-up that travels the other way, or the axe chops with its back.
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/motion'))
from blade import spin_delta  # noqa: E402


def swing(steps, blade=(0, 1, 0), haft=(0, 0, 1)):
    """Frames whose head moves along x by each step, with a fixed haft and blade."""
    x, frames = 0.0, []
    for s in [0.0] + steps:
        x += s
        frames.append({'head': [x, 0, 0], 'haft': list(haft), 'blade': list(blade)})
    return frames


class SpinDelta(unittest.TestCase):
    def test_turns_the_edge_onto_the_strike(self):
        d, share = spin_delta(swing([0.5]))
        self.assertAlmostEqual(d, -90, places=3)  # +y turned -90 degrees about +z is +x, the strike's direction
        self.assertAlmostEqual(share, 1.0, places=3)

    def test_slow_wind_up_does_not_outvote_the_strike(self):
        # six slow steps back (0.6 in all) then one fast chop forward (0.5): by distance the wind-up wins and the
        # axe would lead with its back; by speed the chop wins
        d, _ = spin_delta(swing([-0.1] * 6 + [0.5]))
        self.assertAlmostEqual(d, -90, places=3)

    def test_already_facing_needs_no_turn(self):
        d, _ = spin_delta(swing([0.3, 0.4], blade=(1, 0, 0)))
        self.assertAlmostEqual(d, 0, places=3)

    def test_motion_along_the_haft_is_ignored(self):
        frames = swing([0.5])
        frames[1]['head'][2] = 5.0  # a thrust along the haft cannot be faced by turning about it
        d, _ = spin_delta(frames)
        self.assertAlmostEqual(d, -90, places=3)

    def test_symmetric_head_fails_loudly(self):
        # a double-bit axe's head has no single edge: an angle from a zero vector would be noise
        with self.assertRaises(ValueError):
            spin_delta(swing([0.5], blade=(0, 0, 0)))


if __name__ == '__main__':
    unittest.main()
