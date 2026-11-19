"""Pure audio-preview selection plus local ffmpeg/Pillow derivative writers."""

import hashlib
import json
import math
import re
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

TILE_WIDTH = 800
TILE_HEIGHT = 180
MUSIC_WORDS = {"music", "track", "song", "score", "soundtrack", "chiptune"}
PITCHES = {name: index for index, name in enumerate(("C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"))}


def normalize_hints(raw) -> list[str]:
    """Flatten intake/pack hint shapes while keeping the original human wording."""
    values = []

    def visit(value):
        if isinstance(value, str):
            text = " ".join(value.split())[:120]
            if text and text not in values:
                values.append(text)
        elif isinstance(value, dict):
            for child in value.values():
                visit(child)
        elif isinstance(value, (list, tuple)):
            for child in value:
                visit(child)

    visit(raw)
    return values[:12]


def music_evidence(subkind: str | None, hints: list[str]) -> bool:
    if (subkind or "").startswith("music/"):
        return True
    words = {word for hint in hints for word in re.findall(r"[a-z0-9]+", hint.lower())}
    return bool(words & MUSIC_WORDS)


def preview_prefix(rights: dict | None) -> str:
    return "previews" if (rights or {}).get("redistribution") in ("free", "in-build") else "private/previews"


def derivative_key(prefix: str, source_hash: str, kind: str, extension: str, **parameters) -> str:
    payload = json.dumps({"source": source_hash, "kind": kind, **parameters}, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(payload.encode()).hexdigest()
    return f"{prefix}/{digest[:2]}/{digest[:16]}-{kind}.{extension}"


def preview_bounds(sidecar: dict, duration_s: float, max_s=10.0) -> tuple[float, float]:
    duration_s = max(0.0, float(duration_s))
    length = min(float(max_s), duration_s)
    if length <= 0:
        return 0.0, 0.0
    sections = [
        section
        for section in sidecar.get("sections", [])
        if float(section.get("end_s", 0)) > float(section.get("start_s", 0))
    ]
    if not sections:
        return 0.0, round(length, 3)
    section = max(sections, key=lambda item: (float(item.get("energy", -1)), float(item.get("loudness", -120))))
    start = max(0.0, float(section["start_s"]))
    end = min(duration_s, float(section["end_s"]))
    length = min(length, max(0.0, end - start))
    curve = sidecar.get("loudness_short_term_1hz", [])
    window = max(1, int(math.ceil(length)))
    left, right = int(math.floor(start)), min(len(curve), int(math.ceil(end)))
    if right - left >= window:
        values = np.asarray(curve[left:right], dtype=float)
        sums = np.convolve(values, np.ones(window), mode="valid")
        start = left + int(np.argmax(sums))
    start = min(max(0.0, start), max(0.0, duration_s - length))
    return round(start, 3), round(length, 3)


def _aligned_start(sidecar: dict, target_s: float, latest_s: float) -> float:
    downbeats = [float(value) for value in sidecar.get("downbeats_s", []) if 0 <= float(value) <= latest_s]
    if downbeats:
        return min(downbeats, key=lambda value: (abs(value - target_s), value))
    beats = [float(value) for value in sidecar.get("beats_s", []) if 0 <= float(value) <= latest_s]
    meter = sidecar.get("meter")
    if beats and isinstance(meter, int) and meter > 0:
        bars = beats[::meter]
        return min(bars, key=lambda value: (abs(value - target_s), value))
    return round(min(max(0.0, target_s), latest_s), 3)


def medley_plan(tracks: list[dict], total_s=30.0) -> list[dict]:
    ordered = sorted(tracks, key=lambda item: item["id"])
    if not ordered:
        return []
    slot = float(total_s) / len(ordered)
    plan = []
    used = 0.0
    for index, track in enumerate(ordered):
        duration = float(total_s) - used if index == len(ordered) - 1 else slot
        used += duration
        source_duration = float(track.get("duration_s", duration))
        latest = max(0.0, source_duration - min(duration, source_duration))
        target = latest * ((index + 0.5) / len(ordered))
        plan.append(
            {
                "id": track["id"],
                "start_s": _aligned_start(track.get("sidecar", {}), target, latest),
                "duration_s": duration,
            }
        )
    return plan


def _tempo_close(left: float, right: float) -> bool:
    distances = [abs(left * factor - right) / max(left * factor, right) for factor in (0.5, 1.0, 2.0)]
    return min(distances) <= 0.08


def _key_close(left: dict, right: dict) -> bool:
    if min(float(left.get("key_strength", 0)), float(right.get("key_strength", 0))) < 0.5:
        return False
    if left.get("key") not in PITCHES or right.get("key") not in PITCHES:
        return False
    a, b = PITCHES[left["key"]], PITCHES[right["key"]]
    if a == b:
        return True
    if left.get("mode") != right.get("mode"):
        major, minor = (a, b) if left.get("mode") == "major" else (b, a)
        if (major - minor) % 12 == 3:
            return True
    return (a - b) % 12 in (5, 7)


def _cosine(left, right) -> float:
    a, b = np.asarray(left, dtype=float), np.asarray(right, dtype=float)
    denominator = float(np.linalg.norm(a) * np.linalg.norm(b))
    return float(a @ b / denominator) if denominator else -1.0


def compatible(left: dict, right: dict) -> bool:
    if left.get("tempo_bpm") is None or right.get("tempo_bpm") is None:
        return False
    return (
        _tempo_close(float(left["tempo_bpm"]), float(right["tempo_bpm"]))
        and _key_close(left, right)
        and _cosine(left.get("embedding", []), right.get("embedding", [])) >= 0.80
    )


def compatibility_sets(rows: list[dict], pack_id: str) -> dict[str, str]:
    groups: list[list[dict]] = []
    for row in sorted(rows, key=lambda item: item["id"]):
        group = next((candidate for candidate in groups if all(compatible(row, other) for other in candidate)), None)
        if group is None:
            groups.append([row])
        else:
            group.append(row)
    result = {}
    for group in groups:
        if len(group) < 2:
            continue
        members = sorted(str(row["hash"]) for row in group)
        suffix = hashlib.sha256((pack_id + "\0" + "\0".join(members)).encode()).hexdigest()[:8]
        set_id = f"{pack_id}-audio-{suffix}"
        result.update({row["id"]: set_id for row in group})
    return result


def _waveform(y: np.ndarray, width: int, height: int) -> Image.Image:
    image = Image.new("RGB", (width, height), "#111827")
    draw = ImageDraw.Draw(image)
    for x, column in enumerate(np.array_split(np.asarray(y, dtype=float), width)):
        if len(column):
            lo, hi = float(column.min()), float(column.max())
            draw.line((x, height / 2 - hi * height * 0.45, x, height / 2 - lo * height * 0.45), fill="#67e8f9")
    return image


def _spectrogram(y: np.ndarray, width: int, height: int) -> Image.Image:
    window = 256
    if len(y) < window:
        y = np.pad(y, (0, window - len(y)))
    starts = np.linspace(0, max(0, len(y) - window), max(2, min(width, len(y) // 64))).astype(int)
    spec = np.stack([np.abs(np.fft.rfft(y[start : start + window] * np.hanning(window))) for start in starts]).T
    values = np.log1p(spec)
    values = values / max(float(values.max()), 1e-9)
    rgb = np.zeros((*values.shape, 3), dtype=np.uint8)
    rgb[..., 0] = (255 * values**1.8).astype(np.uint8)
    rgb[..., 1] = (210 * values).astype(np.uint8)
    rgb[..., 2] = (255 * np.sqrt(values)).astype(np.uint8)
    return Image.fromarray(np.flipud(rgb), "RGB").resize((width, height), Image.Resampling.BILINEAR)


def render_tile(y, label: str, out: Path):
    label_h = 24
    waveform_h = 68
    image = Image.new("RGB", (TILE_WIDTH, TILE_HEIGHT), "#030712")
    image.paste(_waveform(np.asarray(y), TILE_WIDTH, waveform_h), (0, label_h))
    image.paste(_spectrogram(np.asarray(y), TILE_WIDTH, TILE_HEIGHT - label_h - waveform_h), (0, label_h + waveform_h))
    ImageDraw.Draw(image).text((8, 5), label[:100], fill="white", font=ImageFont.load_default())
    out.parent.mkdir(parents=True, exist_ok=True)
    image.save(out, optimize=True)


def compose_sheet(tiles: list[Path], out: Path):
    if not tiles:
        raise ValueError("at least one audio preview tile is required")
    sheet = Image.new("RGB", (TILE_WIDTH, TILE_HEIGHT * len(tiles)), "#030712")
    for index, tile in enumerate(tiles):
        with Image.open(tile) as image:
            sheet.paste(image.convert("RGB").resize((TILE_WIDTH, TILE_HEIGHT)), (0, index * TILE_HEIGHT))
    out.parent.mkdir(parents=True, exist_ok=True)
    staged = out.with_name(out.name + ".part")
    try:
        sheet.save(staged, "WEBP", quality=82, method=6)
        staged.replace(out)
    except Exception:
        staged.unlink(missing_ok=True)
        raise


def _write_ogg(arguments: list[str], out: Path, timeout: int):
    out.parent.mkdir(parents=True, exist_ok=True)
    staged = out.with_suffix(".part.ogg")
    command = ["ffmpeg", "-v", "error", "-y", *arguments, str(staged)]
    try:
        subprocess.run(command, check=True, capture_output=True, text=True, timeout=timeout)
        staged.replace(out)
    except Exception:
        staged.unlink(missing_ok=True)
        raise


def make_clip(source: Path, out: Path, start_s: float, duration_s: float):
    if duration_s <= 0:
        raise ValueError("clip duration must be positive")
    fade = min(0.12, duration_s / 4)
    fade_out = max(0.0, duration_s - fade)
    _write_ogg(
        [
            "-ss",
            f"{start_s:.3f}",
            "-t",
            f"{duration_s:.3f}",
            "-i",
            str(source),
            "-vn",
            "-af",
            f"afade=t=in:st=0:d={fade:.3f},afade=t=out:st={fade_out:.3f}:d={fade:.3f}",
            "-c:a",
            "libvorbis",
            "-q:a",
            "4",
        ],
        out,
        120,
    )


def make_medley(entries: list[dict], out: Path, total_s=30.0):
    if not entries:
        raise ValueError("at least one track is required for a medley")
    inputs = []
    filters = []
    labels = []
    for index, entry in enumerate(entries):
        duration = float(entry["duration_s"])
        fade = min(0.05, duration / 4)
        inputs += [
            "-ss",
            f"{float(entry['start_s']):.6f}",
            "-t",
            f"{duration:.6f}",
            "-i",
            str(entry["source"]),
        ]
        label = f"a{index}"
        filters.append(
            f"[{index}:a]aresample=48000,apad=pad_dur={duration:.6f},atrim=duration={duration:.6f},"
            f"asetpts=PTS-STARTPTS,afade=t=in:st=0:d={fade:.6f},"
            f"afade=t=out:st={max(0.0, duration - fade):.6f}:d={fade:.6f}[{label}]"
        )
        labels.append(f"[{label}]")
    filters.append(f"{''.join(labels)}concat=n={len(entries)}:v=0:a=1,atrim=duration={float(total_s):.6f}[out]")
    _write_ogg(
        [
            *inputs,
            "-filter_complex",
            ";".join(filters),
            "-map",
            "[out]",
            "-c:a",
            "libvorbis",
            "-q:a",
            "4",
        ],
        out,
        max(120, len(entries) * 10),
    )
