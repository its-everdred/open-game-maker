#!/usr/bin/env python3
"""Check a cut trailer for variety and pace before anyone sees it.

    python3 -I .claude/skills/gm-trailer/scripts/selfcheck.py cut.json review/<ticket>/trailer-landscape.mp4

Reads the cut list (references/cut-list.md) for what each shot shows and the video for what it really does. Fails
(exit 1) when the trailer has too few shots, drags (average or longest shot), leaves an inventory item out, has too
little action, has cuts the eye cannot see (two shots that look alike) or dead frames (a frozen or black stretch).
Writes <video>.contact.png, one still from the middle of every shot, to look at before posting.
Needs ffmpeg and ffprobe on PATH.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from assemble import timeline  # noqa: E402

DEFAULTS = {
    "min_shots": 12,  # a 25-30 s trailer
    "max_average": 2.5,  # seconds
    "max_shot": 4.0,
    "min_action_share": 0.35,  # of the runtime, shots whose kind is action or boss
    "action_kinds": ["action", "boss"],
    "max_frozen": 0.8,  # seconds without visible change
    "min_cuts_seen": 0.8,  # of planned cuts the scene detector finds
}


def plan_report(plan: dict) -> tuple[dict, list[str]]:
    """Shot statistics and inventory coverage from the cut list alone."""
    targets = {**DEFAULTS, **plan.get("targets", {})}
    times = timeline(plan)
    lengths = [t["length"] for t in times]
    total = sum(lengths)
    shots = plan["shots"]
    tags = [s.get("tags", {}) for s in shots]
    kinds = [t.get("kind", "") for t in tags]
    action = sum(length for length, kind in zip(lengths, kinds) if kind in targets["action_kinds"])
    shown = {key: set() for key in plan.get("inventory", {})}
    for tag in tags:
        for key in shown:
            value = tag.get(key)
            shown[key].update(value if isinstance(value, list) else [value] if value else [])
    report = {
        "seconds": round(total, 2),
        "shots": len(shots),
        "average": round(total / len(shots), 2),
        "longest": round(max(lengths), 2),
        "action_share": round(action / total, 2),
        "coverage": {key: sorted(shown[key]) for key in shown},
    }
    failures = []
    if len(shots) < targets["min_shots"]:
        failures.append(f"{len(shots)} shots; a trailer this long needs at least {targets['min_shots']}")
    if report["average"] > targets["max_average"]:
        failures.append(f"average shot {report['average']} s drags; keep it under {targets['max_average']} s")
    for shot, length in zip(shots, lengths):
        if length > targets["max_shot"]:
            failures.append(f"shot {shot['id']} runs {length:.2f} s; cut it under {targets['max_shot']} s")
    if report["action_share"] < targets["min_action_share"]:
        failures.append(f"action is {report['action_share']:.0%} of the runtime; give it at least {targets['min_action_share']:.0%}")
    for key, wanted in plan.get("inventory", {}).items():
        missing = [item for item in wanted if item not in shown[key]]
        if missing:
            failures.append(f"inventory {key} never shown: {', '.join(missing)}")
    if kinds and kinds[0] not in ("hook", *targets["action_kinds"]):
        failures.append(f"opens on a {kinds[0] or 'untagged'} shot; open on the hook")
    return report, failures


def frozen_spans(log: str) -> list[tuple[float, float]]:
    """(start, duration) of each freezedetect span in an ffmpeg log."""
    starts = [float(x) for x in re.findall(r"freeze_start: ([\d.]+)", log)]
    durations = [float(x) for x in re.findall(r"freeze_duration: ([\d.]+)", log)]
    return list(zip(starts, durations))


def cuts_seen(planned: list[float], detected: list[float], fps: float) -> float:
    """Share of planned cuts with a detected scene change within two frames."""
    if not planned:
        return 1.0
    hit = sum(1 for cut in planned if any(abs(cut - d) <= 2.0 / fps for d in detected))
    return hit / len(planned)


def video_report(video: Path, plan: dict) -> tuple[dict, list[str]]:
    targets = {**DEFAULTS, **plan.get("targets", {})}
    fps = float(plan.get("fps", 30))
    log = subprocess.run(
        ["ffmpeg", "-v", "info", "-i", str(video), "-vf",
         f"freezedetect=n=0.002:d={targets['max_frozen']},blackdetect=d=0.2:pix_th=0.06,"
         "select='gt(scene,0.18)',showinfo", "-an", "-f", "null", "-"],
        capture_output=True, text=True).stderr
    frozen = frozen_spans(log)
    black = re.findall(r"black_start:([\d.]+) black_end:([\d.]+)", log)
    detected = [float(x) for x in re.findall(r"pts_time:([\d.]+)", log)]
    times = timeline(plan)
    planned = [t["start"] for t in times[1:]]
    seen = cuts_seen(planned, detected, fps)
    report = {"frozen": frozen, "black": black, "cuts_seen": round(seen, 2)}
    failures = [f"frozen {d:.1f} s at {s:.1f} s (dead air)" for s, d in frozen]
    failures += [f"black from {a} s to {b} s" for a, b in black]
    if seen < targets["min_cuts_seen"]:
        missed = [round(c, 2) for c in planned if not any(abs(c - d) <= 2.0 / fps for d in detected)]
        failures.append(f"only {seen:.0%} of cuts change the picture; shots look alike at {missed}")
    # one still from the middle of every shot, five across
    mids = [int((t["start"] + t["length"] / 2) * fps) for t in times]
    pick = "+".join(f"eq(n\\,{m})" for m in mids)
    rows = (len(mids) + 4) // 5
    sheet = video.with_suffix(".contact.png")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(video), "-vf",
                    f"select='{pick}',scale=384:-1,tile=5x{rows}:padding=4", "-frames:v", "1", "-fps_mode", "vfr", str(sheet)],
                   check=True)
    report["contact_sheet"] = str(sheet)
    return report, failures


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("cut", type=Path)
    parser.add_argument("video", type=Path)
    args = parser.parse_args(argv)
    plan = json.loads(args.cut.read_text())
    report, failures = plan_report(plan)
    vreport, vfailures = video_report(args.video, plan)
    report.update(vreport)
    failures += vfailures
    print(json.dumps(report, indent=1))
    for failure in failures:
        print(f"FAIL {failure}", file=sys.stderr)
    if not failures:
        print(f"PASS {report['shots']} shots, {report['seconds']} s, average {report['average']} s; now look at {report['contact_sheet']}",
              file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
