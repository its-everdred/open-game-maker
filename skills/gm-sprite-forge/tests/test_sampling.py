"""Checks for the #1282 bake-off sampling: which source frame each sheet frame shows.

The pack sheets have a fixed frame count (15), so a 3D clip must land on exactly that many frames: a loop must not
repeat its first pose at the end (a stutter at the seam), key-pose stepping must hold poses on the pack's beats and not
silently stretch or drop frames, and an in-place walk must remove travel without flattening the sway.
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/motion'))
from sampling import frames, in_place  # noqa: E402


class Even(unittest.TestCase):
    def test_loop_leaves_out_the_closing_frame(self):
        ts = frames({}, 4, 0, 32, loop=True)
        self.assertEqual(ts, [0, 8, 16, 24])  # 32 is frame 0 again: drawing it would hold the seam pose twice

    def test_one_shot_ends_on_the_last_pose(self):
        ts = frames({'sample': 'even'}, 5, 10, 30, loop=False)
        self.assertEqual(ts, [10, 15, 20, 25, 30])  # an attack must reach its recovery pose


class Keys(unittest.TestCase):
    def test_holds_repeat_each_key_pose(self):
        ts = frames({'sample': 'keys', 'keys': [2, 9, 20], 'holds': [1, 3, 2]}, 6, 0, 30, loop=False)
        self.assertEqual(ts, [2, 9, 9, 9, 20, 20])

    def test_holds_must_fill_the_pack_frame_count(self):
        with self.assertRaises(ValueError):  # 14 frames against a 15-frame pack clip would shift every later beat
            frames({'sample': 'keys', 'keys': [0, 10], 'holds': [7, 7]}, 15, 0, 30, loop=False)

    def test_a_key_cannot_be_held_for_zero_frames(self):
        with self.assertRaises(ValueError):
            frames({'sample': 'keys', 'keys': [0, 5, 10], 'holds': [3, 0, 3]}, 6, 0, 30, loop=False)

    def test_keys_and_holds_pair_up(self):
        with self.assertRaises(ValueError):
            frames({'sample': 'keys', 'keys': [0, 5], 'holds': [3, 2, 1]}, 6, 0, 30, loop=False)


class Times(unittest.TestCase):
    def test_times_must_match_the_sheet(self):
        self.assertEqual(frames({'sample': 'times', 'times': [1, 2, 3]}, 3, 0, 9, loop=False), [1, 2, 3])
        with self.assertRaises(ValueError):
            frames({'sample': 'times', 'times': [1, 2]}, 3, 0, 9, loop=False)

    def test_unknown_sampling_fails_loud(self):
        with self.assertRaises(ValueError):
            frames({'sample': 'smart'}, 3, 0, 9, loop=False)


class InPlace(unittest.TestCase):
    def test_removes_travel_but_keeps_sway(self):
        def track(t):  # walks 1 unit per 10 frames along -y, swaying +-0.05 in x
            return (0.05 if int(t) % 20 == 10 else 0.0, -t / 10)
        ts = [0, 10, 20]
        offs = in_place(track, ts, 0, 20)
        held = [(track(t)[0] + o[0], track(t)[1] + o[1]) for t, o in zip(ts, offs)]
        self.assertEqual([round(y, 9) for _, y in held], [0, 0, 0])  # no forward travel left
        self.assertEqual([x for x, _ in held], [0.0, 0.05, 0.0])  # the sway is still there


if __name__ == '__main__':
    unittest.main()
