import json
import shutil
import subprocess
import wave
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

import tag_previews as p


def tone(path: Path, seconds=2.0, sample_rate=16000):
    t = np.arange(int(seconds * sample_rate), dtype=np.float32) / sample_rate
    y = (0.5 * np.sin(2 * np.pi * 440 * t) * np.minimum(1, t * 8)).astype(np.float32)
    with wave.open(str(path), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(sample_rate)
        out.writeframes((y * 32767).astype("<i2").tobytes())
    return y, sample_rate


def test_normalize_hints_flattens_manifest_shapes_without_inventing_measurements():
    hints = p.normalize_hints({"genre": ["Chiptune", "Dark retro"], "context": "Action-adventure / RPG", "empty": None})
    assert hints == ["Chiptune", "Dark retro", "Action-adventure / RPG"]
    assert p.normalize_hints(["same", "same", "x" * 121]) == ["same", "x" * 120]


def test_music_evidence_uses_cards_or_hints_instead_of_pack_ids():
    assert p.music_evidence("sfx/other", ["dark chiptune", "RPG music"])
    assert p.music_evidence("music/track", [])
    assert not p.music_evidence("sfx/other", ["dark impacts"])


def test_preview_bounds_choose_the_loudest_coherent_section_and_keep_short_tracks_short():
    sidecar = {
        "sections": [
            {"start_s": 0.0, "end_s": 18.0, "energy": 0.2},
            {"start_s": 18.0, "end_s": 43.0, "energy": 1.0},
        ],
        "loudness_short_term_1hz": [-30.0] * 18 + [-20.0] * 5 + [-5.0] * 10 + [-20.0] * 10,
    }
    assert p.preview_bounds(sidecar, 43.0) == (23.0, 10.0)
    assert p.preview_bounds({}, 3.5) == (0.0, 3.5)


def test_medley_plan_represents_every_track_once_and_aligns_available_bars():
    tracks = [
        {"id": f"track-{index:02}", "duration_s": 60.0, "sidecar": {"downbeats_s": [0.25, 1.25, 2.25]}}
        for index in range(46)
    ]
    plan = p.medley_plan(tracks, total_s=30.0)
    assert [entry["id"] for entry in plan] == [track["id"] for track in tracks]
    assert len(plan) == 46
    assert np.isclose(sum(entry["duration_s"] for entry in plan), 30.0)
    assert all(entry["start_s"] in tracks[0]["sidecar"]["downbeats_s"] for entry in plan)


def test_compatibility_sets_require_tempo_key_and_timbre_and_are_stable():
    rows = [
        {"id": "a", "hash": "a" * 64, "tempo_bpm": 120, "key": "C", "mode": "major", "key_strength": 0.9, "embedding": [1.0, 0.0]},
        {"id": "b", "hash": "b" * 64, "tempo_bpm": 124, "key": "A", "mode": "minor", "key_strength": 0.9, "embedding": [0.99, 0.01]},
        {"id": "c", "hash": "c" * 64, "tempo_bpm": 90, "key": "F#", "mode": "major", "key_strength": 0.9, "embedding": [0.0, 1.0]},
    ]
    first = p.compatibility_sets(rows, "pack")
    second = p.compatibility_sets(list(reversed(rows)), "pack")
    assert first == second
    assert first["a"] == first["b"]
    assert "c" not in first
    assert first["a"].startswith("pack-audio-")


def test_private_preview_prefix_comes_from_effective_rights():
    assert p.preview_prefix({"redistribution": "none"}) == "private/previews"
    assert p.preview_prefix({"redistribution": "in-build"}) == "previews"


def test_waveform_spectrogram_tiles_compose_into_a_labeled_pack_sheet(tmp_path):
    y, _ = tone(tmp_path / "tone.wav")
    tiles = []
    for label in ("01 dark", "02 battle"):
        tile = tmp_path / f"{label.split()[0]}.png"
        p.render_tile(y, label, tile)
        tiles.append(tile)
    sheet = tmp_path / "sheet.webp"
    p.compose_sheet(tiles, sheet)
    image = Image.open(sheet)
    assert image.width == 800
    assert image.height == 2 * p.TILE_HEIGHT
    assert np.asarray(image).std() > 0
    assert not sheet.with_name(sheet.name + ".part").exists()


@pytest.mark.skipif(not shutil.which("ffmpeg") or not shutil.which("ffprobe"), reason="ffmpeg and ffprobe are required")
def test_make_clip_writes_a_faded_ogg_without_padding_a_short_track(tmp_path):
    source = tmp_path / "tone.wav"
    tone(source, seconds=2.0)
    out = tmp_path / "clip.ogg"
    p.make_clip(source, out, start_s=0.0, duration_s=2.0)

    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(out)],
        check=True,
        capture_output=True,
        text=True,
    )
    assert 1.9 <= float(json.loads(probe.stdout)["format"]["duration"]) <= 2.1
    decoded = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(out), "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
        check=True,
        capture_output=True,
    ).stdout
    samples = np.frombuffer(decoded, dtype="<f4")
    assert np.abs(samples[:200]).mean() < np.abs(samples[2000:4000]).mean()
    assert np.abs(samples[-200:]).mean() < np.abs(samples[-4000:-2000]).mean()


@pytest.mark.skipif(not shutil.which("ffmpeg") or not shutil.which("ffprobe"), reason="ffmpeg and ffprobe are required")
def test_make_medley_represents_each_planned_track_in_the_requested_duration(tmp_path):
    sources = []
    for index in range(3):
        source = tmp_path / f"tone-{index}.wav"
        tone(source, seconds=2.0)
        sources.append({"id": f"track-{index}", "source": source, "start_s": 0.0, "duration_s": 1.0})
    out = tmp_path / "medley.ogg"
    p.make_medley(sources, out, total_s=3.0)

    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(out)],
        check=True,
        capture_output=True,
        text=True,
    )
    assert 2.9 <= float(json.loads(probe.stdout)["format"]["duration"]) <= 3.1


def test_private_preview_bucket_cannot_alias_public(tmp_path):
    from preview_paths import safe_preview
    (tmp_path / "private").mkdir()
    (tmp_path / "previews").mkdir()
    (tmp_path / "private" / "previews").symlink_to(tmp_path / "previews", target_is_directory=True)
    with pytest.raises(ValueError, match="symlink"):
        safe_preview(tmp_path, "private/previews/aa/clip.ogg", create=True)
