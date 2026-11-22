"""Checks for the #1202 rig/motion spike tools: foot slide, loop phase search and the landmark fit."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts/motion'))
from score_cell import best_shift, foot_slide  # noqa: E402

CELL = 128
PX_PER_UNIT = CELL / (2 * 2 ** 0.5)


def feet_doc(tracks):
    """tracks: {side: [(x_px, y_px, z_world), ...]} -> feet.json shape with heel == ball."""
    n = len(next(iter(tracks.values())))
    frames = [{s: {'heel': list(t[i]), 'ball': list(t[i])} for s, t in tracks.items()} for i in range(n)]
    return {'cell': CELL, 'feet': {'2': frames}}


def treadmill(n=15, speed=2.0, jitter=0.0, seed=0):
    """In-place walk: each foot is down for 9 of 15 frames, moving back at `speed` px per frame while down."""
    rng = np.random.default_rng(seed)
    out = {}
    for side, offset in (('L', 0), ('R', 7)):
        track = []
        for i in range(n):
            ph = (i + offset) % n
            down = ph < 9
            y = 60 + speed * ph if down else 60 + speed * 9 - (speed * 9) * (ph - 9) / (n - 9)
            z = 0.0 if down else 0.05
            dx = rng.normal(0, jitter) if down else 0.0
            track.append((64 + dx, y, z))
        out[side] = track
    return out


class FootSlideTest(unittest.TestCase):
    def test_planted_treadmill_feet_do_not_slide(self):
        # a foot that keeps the ground's pace is planted, whatever that pace is
        for speed in (0.5, 2.0, 4.0):
            res = foot_slide(feet_doc(treadmill(speed=speed)), [2], loop=True)
            self.assertLess(res['mean_px'], 0.01, speed)

    def test_wandering_contact_foot_is_measured_in_pixels(self):
        clean = foot_slide(feet_doc(treadmill(jitter=0.0)), [2], loop=True)['mean_px']
        slid = foot_slide(feet_doc(treadmill(jitter=1.5)), [2], loop=True)['mean_px']
        self.assertGreater(slid, 1.0)
        self.assertGreater(slid, clean + 1.0)

    def test_attack_feet_must_stay_put(self):
        # no locomotion in an attack: any contact movement is slide, even a steady one
        still = {s: [(64, 80, 0.0)] * 15 for s in 'LR'}
        drift = {s: [(64, 80 + i, 0.0) for i in range(15)] for s in 'LR'}
        self.assertEqual(foot_slide(feet_doc(still), [2], loop=False)['mean_px'], 0.0)
        self.assertAlmostEqual(foot_slide(feet_doc(drift), [2], loop=False)['mean_px'], 1.0, places=6)

    def test_lifted_frames_are_not_contact(self):
        tracks = treadmill()
        res = foot_slide(feet_doc(tracks), [2], loop=True)['rows'][0]
        # 9 planted frames per foot give 8 planted-to-planted steps each
        self.assertEqual(res['contact_steps'], 16)


def walk_sheet(path, shift=0, rows=8):
    """A blob whose width pulses twice per 15-frame loop, like a walk's silhouette, rotated by `shift` frames."""
    a = np.zeros((rows * CELL, 15 * CELL, 4), np.uint8)
    for r in range(rows):
        for c in range(15):
            ph = (c + shift) % 15
            w = 10 + int(8 * abs(np.sin(2 * np.pi * ph / 15)) + 3 * (ph % 5 == 0))
            a[r * CELL + 40:r * CELL + 90, c * CELL + 64 - w:c * CELL + 64 + w] = (200, 150, 120, 255)
    Image.fromarray(a).save(path)


class PhaseTest(unittest.TestCase):
    def test_recovers_the_loop_start(self):
        # the pack's first frame is arbitrary; the search must undo a rotation of our frames
        with tempfile.TemporaryDirectory() as t:
            pack, ours = Path(t) / 'pack.png', Path(t) / 'ours.png'
            walk_sheet(pack, rows=2)
            walk_sheet(ours, shift=-4)
            shift, unshifted = best_shift(pack, ours, [1, 2])
            self.assertEqual(shift, 4)
            self.assertLess(unshifted, 0.99)


SYNTH = '''
import sys, json
sys.path.insert(0, sys.argv[-3])
import bpy
from mathutils import Vector
import fit_rig
bpy.ops.wm.read_factory_settings(use_empty=True)
hand = Vector(json.loads(sys.argv[-2]))
def limb(a, b, r):
    a, b = Vector(a), Vector(b)
    d = b - a
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=d.length, location=(a + b) / 2, vertices=24)
    o = bpy.context.object
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d)
    return o
parts = [limb((0, 0, 0.72), (0, 0, 1.45), 0.17), limb((0, 0, 1.45), (0, 0, 1.8), 0.1)]
for s in (1, -1):
    parts += [limb((0.09 * s, 0, 0.8), (0.09 * s, 0, 0.0), 0.06), limb((0.09 * s, 0.03, 0.025), (0.09 * s, -0.12, 0.025), 0.025),
              limb((0.19 * s, 0, 1.40), (0.25 * s, 0, 1.12), 0.045),
              limb((0.25 * s, 0, 1.12), (hand.x * s, hand.y, hand.z), 0.04)]
ob, M = fit_rig.prepare(parts, 0.0)
lm = fit_rig.landmarks(ob)
back = M.inverted()
out = {k: list(back @ Vector(lm[k].tolist())) for k in ('ankle.L', 'wrist.L', 'wrist.R')}
out['crotch'] = (back @ Vector((0, 0, lm['crotch']))).z
open(sys.argv[-1], 'w').write(json.dumps(out))
'''


@unittest.skipUnless(shutil.which('blender'), 'needs Blender 4.3')
class FitTest(unittest.TestCase):
    def test_measured_joints_land_on_a_known_body(self):
        # Joints the fit measures from geometry (crotch, ankles, wrists) at two arm angles. Knees and elbows are then
        # placed by proportion between them; fit_accuracy.py checks those on real rigged characters.
        px = 1.8 / 43  # 1.8 m body as a 43 px sprite
        for hand in ((0.36, -0.02, 0.86), (0.48, -0.02, 0.98)):
            with tempfile.TemporaryDirectory() as t:
                script, out = Path(t) / 'synth.py', Path(t) / 'out.json'
                script.write_text(SYNTH)
                env = os.environ | {'PYTHONPATH': os.environ.get('OGM_FORGE_SITE', '')}
                subprocess.run(['blender', '-b', '--factory-startup', '--python-use-system-env', '--python-exit-code', '1',
                                '--python', str(script), '--', str(ROOT / 'scripts/motion'), json.dumps(hand), str(out)],
                               check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env)
                got = json.loads(out.read_text())
                self.assertLess(abs(got['crotch'] - 0.72), 2 * px, got)  # the torso's underside
                self.assertLess(abs(got['ankle.L'][0] - 0.09), px, got)
                elbow, tip = np.array([0.25, 0, 1.12]), np.array(hand)
                wrist = tip - (tip - elbow) / np.linalg.norm(tip - elbow) * 0.07 * 1.8  # a hand's length back from the tip
                for side, sgn in (('wrist.L', 1), ('wrist.R', -1)):
                    self.assertLess(np.linalg.norm(np.array(got[side]) * [sgn, 1, 1] - wrist), 2 * px, (side, got))


if __name__ == '__main__':
    unittest.main()
