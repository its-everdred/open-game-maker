"""Checks for trim_bvh.py (#1282 round 3): a 100STYLE take must reach guard_walk.py at 30 fps with LaFAN1 toe names.

guard_walk.py measures speed in frames at 30 fps; a 60 fps take passed through unchanged doubles every speed and
drops each real walk cycle. bvh_track.py dumps `LeftToe`; a take that still says `LeftToeBase` fails there.
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/motion'))
from trim_bvh import trim  # noqa: E402

TAKE = '\n'.join(['HIERARCHY', 'ROOT Hips', '{', '\tJOINT LeftToeBase', '\t{', '\t\tEnd Site', '\t}', '}', 'MOTION',
                  'Frames: 8', 'Frame Time: 0.016667'] + [f'{f} 0 0' for f in range(8)]) + '\n'


class TrimTest(unittest.TestCase):
    def test_a_60_fps_window_comes_out_at_30_fps(self):
        out = trim(TAKE, 2, 8).split('\n')
        i = out.index('MOTION')
        self.assertEqual(out[i + 1], 'Frames: 3')
        self.assertAlmostEqual(float(out[i + 2].split(':')[1]), 1 / 30, places=4)
        self.assertEqual([l.split()[0] for l in out[i + 3:] if l], ['2', '4', '6'])

    def test_toes_take_lafan1_names(self):
        out = trim(TAKE, 0, 8)
        self.assertIn('JOINT LeftToe\n', out)
        self.assertNotIn('ToeBase', out)

    def test_a_30_fps_take_keeps_every_frame(self):
        out = trim(TAKE.replace('0.016667', '0.033333'), 0, 4).split('\n')
        self.assertEqual(out[out.index('MOTION') + 1], 'Frames: 4')


if __name__ == '__main__':
    unittest.main()
