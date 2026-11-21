"""Kevin, 2026-11-21: every trailer must be exciting and dynamic and show the game's full variety. These tests pin the
rules that make the scripts enforce that, without needing ffmpeg."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from assemble import CutError, check_frame, timeline  # noqa: E402
from selfcheck import cuts_seen, frozen_spans, plan_report  # noqa: E402


def shot(i, beats=2, kind="action", **tags):
    return {"id": f"s{i}", "src": "takes/x", "beats": beats, "tags": {"kind": kind, **tags}}


def plan(shots, music=None, inventory=None, targets=None):
    total = sum(s["beats"] for s in shots)
    return {
        "music": music or [{"file": "m.wav", "bpm": 120, "beats": total}],
        "shots": shots,
        "inventory": inventory or {},
        "targets": targets or {},
    }


class Timeline(unittest.TestCase):
    def test_every_cut_lands_on_a_beat(self):
        times = timeline(plan([shot(0, 4), shot(1, 1), shot(2, 3)]))
        self.assertEqual([t["start"] for t in times], [0.0, 2.0, 2.5])

    def test_a_track_change_is_a_cut(self):
        music = [{"file": "a.wav", "bpm": 120, "beats": 4}, {"file": "b.wav", "bpm": 150, "beats": 4}]
        times = timeline(plan([shot(0, 4), shot(1, 4)], music=music))
        self.assertAlmostEqual(times[1]["length"], 1.6)
        with self.assertRaises(CutError):
            timeline(plan([shot(0, 3), shot(1, 5)], music=music))

    def test_unused_music_is_refused(self):
        with self.assertRaises(CutError):
            timeline(plan([shot(0, 2)], music=[{"file": "a.wav", "bpm": 120, "beats": 8}]))


class Framing(unittest.TestCase):
    def test_a_crop_that_would_stretch_is_refused(self):
        with self.assertRaises(CutError):
            check_frame({"id": "x", "crop": [0, 0, 960, 720]}, (1280, 720))
        check_frame({"id": "x", "crop": [0, 0, 960, 540]}, (1280, 720))

    def test_a_pan_keeps_its_size(self):
        with self.assertRaises(CutError):
            check_frame({"id": "x", "crop": [0, 0, 960, 540], "crop_to": [0, 0, 640, 360]}, (1280, 720))


class Variety(unittest.TestCase):
    def full(self, **kw):
        shots = [shot(0, kind="hook", location="house")] + [
            shot(i, location=["house", "cave"][i % 2], move=["slash", "fire"][i % 2]) for i in range(1, 14)
        ]
        return plan(shots, inventory={"location": ["house", "cave"], "move": ["slash", "fire"]}, **kw)

    def test_a_varied_fast_cut_passes(self):
        report, failures = plan_report(self.full())
        self.assertEqual(failures, [])
        self.assertEqual(report["shots"], 14)

    def test_an_unshown_location_fails(self):
        p = self.full()
        p["inventory"]["location"].append("summit")
        _, failures = plan_report(p)
        self.assertTrue(any("summit" in f for f in failures))

    def test_few_long_snippets_fail_like_blobs_round_3(self):
        shots = [shot(i, beats=7) for i in range(4)]
        _, failures = plan_report(plan(shots))
        self.assertTrue(any("4 shots" in f for f in failures))
        self.assertTrue(any("average shot" in f for f in failures))

    def test_one_long_shot_fails(self):
        _, failures = plan_report(self.full_with_long())
        self.assertTrue(any("shot s1 runs 5.00 s" in f for f in failures))

    def full_with_long(self):
        p = self.full()
        p["shots"][1]["beats"] = 10
        p["music"][0]["beats"] += 8
        return p

    def test_a_trailer_without_action_fails(self):
        shots = [shot(0, kind="hook")] + [shot(i, kind="world") for i in range(1, 14)]
        _, failures = plan_report(plan(shots))
        self.assertTrue(any("action is" in f for f in failures))

    def test_it_opens_on_the_hook(self):
        shots = [shot(i, kind="world" if i == 0 else "action") for i in range(14)]
        _, failures = plan_report(plan(shots))
        self.assertTrue(any("open on the hook" in f for f in failures))


class Video(unittest.TestCase):
    def test_frozen_spans_are_read_from_ffmpeg(self):
        log = "lavfi.freezedetect.freeze_start: 3.5\nlavfi.freezedetect.freeze_duration: 1.2\n"
        self.assertEqual(frozen_spans(log), [(3.5, 1.2)])

    def test_a_cut_must_change_the_picture(self):
        self.assertEqual(cuts_seen([1.0, 2.0], [1.02], 30), 0.5)
        self.assertEqual(cuts_seen([1.0, 2.0], [1.0, 2.05], 30), 1.0)


if __name__ == "__main__":
    unittest.main()
