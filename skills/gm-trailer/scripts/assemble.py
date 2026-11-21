#!/usr/bin/env python3
"""Cut a trailer from a cut list: shots timed in music beats, framed without stretching, mixed with game audio.

    python3 -I .claude/skills/gm-trailer/scripts/assemble.py cut.json --out review/<ticket>/trailer-landscape.mp4

The cut list format is in references/cut-list.md. Every shot lasts a whole number of beats of the music segment it
plays under, so every cut lands on a beat. Each shot's frame is a 16:9 crop of its source (optionally panning to a
second crop of the same size) scaled to the output size; a crop that is not 16:9 is refused rather than stretched.
Output: H.264 Main level 4.1, yuv420p, faststart, AAC; the shipped trailer still has to pass `gm trailer --check`.
Needs ffmpeg and ffprobe on PATH.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


class CutError(ValueError):
    pass


def timeline(plan: dict) -> list[dict]:
    """Start and length of every shot, consuming the music segments' beats in order."""
    segments = [dict(seg) for seg in plan["music"]]
    if not segments:
        raise CutError("the cut list needs at least one music segment")
    out, t, seg_i, left = [], 0.0, 0, segments[0]["beats"]
    for shot in plan["shots"]:
        beats = shot["beats"]
        if seg_i >= len(segments):
            raise CutError(f"shot {shot['id']} starts after the music ends; add beats to the music")
        if beats > left:
            raise CutError(f"shot {shot['id']} ({beats} beats) crosses the end of music segment {seg_i + 1}")
        length = beats * 60.0 / segments[seg_i]["bpm"]
        out.append({"id": shot["id"], "start": t, "length": length, "segment": seg_i})
        t += length
        left -= beats
        if left == 0:
            seg_i += 1
            left = segments[seg_i]["beats"] if seg_i < len(segments) else 0
    if seg_i < len(segments):
        raise CutError(f"music segment {seg_i + 1} has {left} beats no shot uses")
    return out


def check_frame(shot: dict, size: tuple[int, int]) -> None:
    """Refuse any crop that would stretch: crops are the output's aspect, and a pan keeps the crop size."""
    for key in ("crop", "crop_to"):
        box = shot.get(key)
        if box is None:
            continue
        _, _, w, h = box
        if w * size[1] != h * size[0]:
            raise CutError(f"shot {shot['id']} {key} {w}x{h} is not {size[0]}:{size[1]}; it would stretch")
    if shot.get("crop_to") and not shot.get("crop"):
        raise CutError(f"shot {shot['id']} pans (crop_to) without a starting crop")
    if shot.get("crop_to") and shot["crop_to"][2:] != shot["crop"][2:]:
        raise CutError(f"shot {shot['id']} pans between crops of different sizes; punch in with a cut instead")


def video_filter(shot: dict, frames: int, size: tuple[int, int]) -> str:
    parts = []
    if shot.get("crop"):
        x0, y0, w, h = shot["crop"]
        x1, y1 = (shot.get("crop_to") or shot["crop"])[:2]
        span = max(frames - 1, 1)
        # whole source pixels, so pixel art moves in clean steps
        x = f"floor({x0}+({x1 - x0})*n/{span})" if x1 != x0 else str(x0)
        y = f"floor({y0}+({y1 - y0})*n/{span})" if y1 != y0 else str(y0)
        parts.append(f"crop={w}:{h}:{x}:{y}")
    flags = "neighbor" if shot.get("scale", "nearest") == "nearest" else "lanczos"
    # JPEG frames decode as full-range yuvj420p; phones and the trailer gate want limited-range yuv420p
    parts += [f"scale={size[0]}:{size[1]}:flags={flags}:out_range=tv", "setsar=1", "format=yuv420p"]
    return ",".join(parts)


def run(cmd: list[str]) -> None:
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode:
        raise SystemExit(f"{cmd[0]} failed: {proc.stderr[-1500:]}")


def source_args(src: Path, start: float, fps: int) -> list[str]:
    if src.is_dir():
        first = int(round(start * fps))
        ext = "jpg" if (src / "f00000.jpg").exists() else "png"
        return ["-framerate", str(fps), "-start_number", str(first), "-i", str(src / f"f%05d.{ext}")]
    return ["-ss", f"{start:.3f}", "-i", str(src)]


def assemble(plan: dict, base: Path, out: Path) -> dict:
    fps = int(plan.get("fps", 30))
    size = tuple(plan.get("size", [1280, 720]))
    times = timeline(plan)
    for shot in plan["shots"]:
        check_frame(shot, size)
    work = Path(tempfile.mkdtemp(prefix="gm-trailer-"))
    try:
        listing = []
        total_frames = 0
        for i, (shot, when) in enumerate(zip(plan["shots"], times)):
            # frame-exact lengths: round the running end, not each shot, so the cuts stay on the beat grid
            end_frames = int(round((when["start"] + when["length"]) * fps))
            frames = end_frames - total_frames
            total_frames = end_frames
            seg = work / f"s{i:03d}.mp4"
            run(["ffmpeg", "-v", "error", "-y", *source_args(base / shot["src"], shot.get("in", 0.0), fps),
                 "-frames:v", str(frames), "-vf", video_filter(shot, frames, size), "-r", str(fps),
                 "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "12", str(seg)])
            listing.append(f"file '{seg}'")
        (work / "list.txt").write_text("\n".join(listing) + "\n")
        silent = work / "video.mp4"
        run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(work / "list.txt"), "-c", "copy", str(silent)])
        duration = total_frames / fps

        # music: each segment cut from its track at a whole beat, with 15 ms edges so the joins never click
        inputs, chains, labels = [], [], []
        for i, seg in enumerate(plan["music"]):
            length = seg["beats"] * 60.0 / seg["bpm"]
            inputs += ["-i", str(base / seg["file"])]
            gain = seg.get("gain", 1.0)
            chains.append(f"[{i}:a]atrim=start={seg.get('start', 0.0):.4f}:duration={length:.4f},asetpts=PTS-STARTPTS,"
                          f"aformat=sample_rates=48000:channel_layouts=stereo,volume={gain},"
                          f"afade=t=in:d=0.015,afade=t=out:st={max(length - 0.015, 0):.4f}:d=0.015[m{i}]")
            labels.append(f"[m{i}]")
        chains.append(f"{''.join(labels)}concat=n={len(labels)}:v=0:a=1[music]")
        mix = ["[music]"]
        n = len(plan["music"])
        for shot, when in zip(plan["shots"], times):
            for cue in shot.get("cues", []):
                at = when["start"] + cue["t"]
                if cue["t"] < 0 or cue["t"] >= when["length"]:
                    continue
                inputs += ["-i", str(base / cue["file"])]
                trim = f"atrim=start={cue['from']:.4f}:duration={cue.get('len', 2.5):.4f}," if "from" in cue else ""
                chains.append(f"[{n}:a]{trim}asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,"
                              f"volume={cue.get('gain', 0.8)},adelay={int(at * 1000)}|{int(at * 1000)}[c{n}]")
                mix.append(f"[c{n}]")
                n += 1
        chains.append(f"{''.join(mix)}amix=inputs={len(mix)}:normalize=0:duration=first,"
                      f"atrim=duration={duration:.4f},alimiter=limit=0.95[aout]")
        audio = work / "audio.m4a"
        run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(chains), "-map", "[aout]",
             "-c:a", "aac", "-b:a", "160k", str(audio)])
        out.parent.mkdir(parents=True, exist_ok=True)
        run(["ffmpeg", "-v", "error", "-y", "-i", str(silent), "-i", str(audio), "-map", "0:v", "-map", "1:a",
             "-c:v", "libx264", "-profile:v", "main", "-level:v", "4.1", "-pix_fmt", "yuv420p", "-color_range", "tv", "-preset", "slow",
             "-crf", "17", "-r", str(fps), "-c:a", "copy", "-shortest", "-movflags", "+faststart", str(out)])
        return {"out": str(out), "seconds": round(duration, 3), "shots": len(times),
                "cuts": [round(t["start"], 3) for t in times[1:]]}
    finally:
        shutil.rmtree(work, ignore_errors=True)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("cut", type=Path, help="cut list JSON (references/cut-list.md)")
    parser.add_argument("--out", type=Path, required=True, help="output MP4")
    args = parser.parse_args(argv)
    if not shutil.which("ffmpeg"):
        print("ffmpeg is not installed", file=sys.stderr)
        return 2
    plan = json.loads(args.cut.read_text())
    try:
        result = assemble(plan, args.cut.parent, args.out)
    except CutError as error:
        print(error, file=sys.stderr)
        return 1
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
