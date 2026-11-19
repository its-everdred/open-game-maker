"""Tests for the excerpt windows and the run's work list: card tags average CLAP over excerpts, so every music track
needs two distinct views."""
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import analyze as a


def test_repo_root_tracks_the_worker_layout():
    """The worker must resolve repository paths correctly from scripts/py/audio."""
    assert (a.ROOT.parent / "scripts/py/audio").is_dir()


def test_short_music_gets_two_excerpts():
    """A 40 s stinger or a 12 s jingle must still be judged on two excerpts (its halves), not one window."""
    for dur in (12.0, 40.0, 60.0):
        spans = a.excerpts([-20.0] * int(dur), dur, music=True)
        assert [s[0] for s in spans] == ["first-half", "second-half"]
        assert spans[0][1] == 0.0 and spans[0][2] == spans[1][1] == dur / 2 and spans[1][2] == dur


def test_long_music_gets_typical_and_loudest_without_overlap():
    """Long tracks: the median-energy 30 s and the loudest 30 s, kept apart so they show different parts."""
    curve = [-30.0] * 60 + [-10.0] * 30 + [-30.0] * 60
    spans = a.excerpts(curve, 150.0, music=True)
    assert len(spans) == 2 and {s[0] for s in spans} == {"typical", "loudest"}
    (_, s1, e1), (_, s2, _) = spans
    assert e1 <= s2


def test_sound_effects_keep_one_whole_file_excerpt():
    """Short SFX are embedded whole; splitting a 0.3 s click would only add noise."""
    assert a.excerpts([], 0.3, music=False) == [("whole", 0.0, 0.3)]


class MusicFamilyTests(unittest.TestCase):
    def test_the_music_families_come_from_the_name_layer(self):
        """Sidetrax and Kenney music alone left the #509 families carded as effects: no key, tempo or loop points."""
        for pack in ("pixabay-music-curated", "abstraction-music-loop-01", "drive-barbarian-chiptune"):
            self.assertTrue(a.is_music(pack), pack)
        self.assertFalse(a.is_music("sonniss-gdc2026-part9-1of5"))


class JobListTests(unittest.TestCase):
    """The pool's work list: which files a run touches, and whether an existing sidecar is honoured."""

    def setUp(self):
        self.packs = Path(tempfile.mkdtemp())
        pack = self.packs / "sonniss-gdc2026-part9-1of5" / "v1" / "extracted" / "weapons"
        pack.mkdir(parents=True)
        (self.packs / "sonniss-gdc2026-part9-1of5" / "pack.json").write_text(json.dumps({"current": "v1"}))
        (self.packs / "sonniss-gdc2026-part9-1of5" / "collection.card.json").write_text(json.dumps({"rights": {"uses": ["vision-input"], "processing": "local-only", "redistribution": "free"}}))
        (pack / "Sword_Slice_01.wav").write_bytes(b"")
        (pack / "Sword_Slice_01.ogg").write_bytes(b"")  # one sound in two formats: the ogg is the one carded

    def tearDown(self):
        shutil.rmtree(self.packs, ignore_errors=True)

    def test_one_job_per_sound_not_per_format(self):
        jobs = a.job_list(self.packs, "*")
        self.assertEqual(len(jobs), 1)
        self.assertEqual(jobs[0]["file"].suffix, ".ogg")

    def test_refresh_reaches_every_job(self):
        """`--refresh` is the only way a new sidecar field reaches files carded before it existed."""
        self.assertTrue(all(job["refresh"] for job in a.job_list(self.packs, "*", refresh=True)))
        self.assertFalse(any(job["refresh"] for job in a.job_list(self.packs, "*")))

    def test_a_pack_glob_can_narrow_the_run(self):
        self.assertEqual(a.job_list(self.packs, "pixabay-*"), [])
        self.assertEqual(len(a.job_list(self.packs, "sonniss-*", limit=1)), 1)
def test_json_mode_keeps_records_on_stdout_and_summaries_on_stderr(capsys):
    a.emit({"file": "music.wav", "status": "ok"}, json_mode=True)
    a.emit({"done": {"ok": 1}}, json_mode=True, summary=True)
    captured = capsys.readouterr()
    assert captured.out.strip() == '{"file": "music.wav", "status": "ok"}'
    assert captured.err.strip() == '{"done": {"ok": 1}}'


def test_audio_jobs_use_card_and_manifest_evidence_with_rights_safe_prefix(tmp_path):
    packs = tmp_path / "packs"
    pack = packs / "drive-barbarian-chiptune"
    extracted = pack / "v1" / "extracted"
    extracted.mkdir(parents=True)
    (extracted / "01.wav").write_bytes(b"wav")
    (pack / "cards").mkdir()
    (pack / "pack.json").write_text(json.dumps({"current": "v1", "hints": {"mood": "dark retro", "genre": "chiptune"}}))
    (pack / "collection.card.json").write_text(json.dumps({"rights": {"uses": ["vision-input"], "processing": "local-only", "redistribution": "none"}}))
    (pack / "cards" / "01.card.json").write_text(
        json.dumps({"subkind": "sfx/other", "source": {"files": [{"path": "01.wav", "role": "primary"}]}})
    )

    [job] = a.audio_files(packs, "*")
    assert job["music"] is True
    assert job["preview_prefix"] == "private/previews"
    assert job["hints"] == ["dark retro", "chiptune"]


def test_music_sidecar_is_rebuilt_when_new_preview_derivatives_are_missing(tmp_path):
    current = {
        "sha256": "abc",
        "music": True,
        "hints": ["dark chiptune"],
        "preview": {"waveform": "private/previews/wave.png", "clip": "private/previews/clip.ogg"},
        "preview_tile": "analysis/tile.png",
    }
    assert not a.analysis_current(current, "abc", tmp_path, True, "private/previews", ["dark chiptune"], tmp_path)
    (tmp_path / "analysis").mkdir()
    (tmp_path / "analysis" / "tile.png").write_bytes(b"png")
    (tmp_path / "private" / "previews").mkdir(parents=True)
    (tmp_path / "private" / "previews" / "wave.png").write_bytes(b"png")
    (tmp_path / "private" / "previews" / "clip.ogg").write_bytes(b"ogg")
    assert a.analysis_current(current, "abc", tmp_path, True, "private/previews", ["dark chiptune"], tmp_path)
    assert not a.analysis_current(current, "abc", tmp_path, True, "previews", ["dark chiptune"], tmp_path)
    assert not a.analysis_current(current, "abc", tmp_path, True, "private/previews", ["new hint"], tmp_path)
    (tmp_path / "previews").mkdir()
    (tmp_path / "previews" / "wave.png").write_bytes(b"png")
    sound = {"sha256": "abc", "music": False, "hints": [], "preview": {"waveform": "previews/wave.png"}}
    assert a.analysis_current(sound, "abc", tmp_path, False, "previews", [], tmp_path)
    assert not a.analysis_current(sound, "abc", tmp_path, True, "previews", [], tmp_path)


def test_audio_jobs_skip_packs_outside_the_repeated_only_list(tmp_path):
    """Only the collections gm selected are analysed; others under the same packs root stay untouched."""
    for pid in ("kept", "refused"):
        (tmp_path / pid).mkdir()
        (tmp_path / pid / "pack.json").write_text(json.dumps({"current": "v1"}))
        (tmp_path / pid / "collection.card.json").write_text(json.dumps({"rights": {"uses": ["vision-input"], "processing": "local-only", "redistribution": "free"}}))
        (tmp_path / pid / "v1" / "extracted").mkdir(parents=True)
        (tmp_path / pid / "v1" / "extracted" / "hit.wav").write_bytes(b"wav")
    assert {job["pack"] for job in a.audio_files(tmp_path, ["kept"])} == {"kept"}
    assert {job["pack"] for job in a.audio_files(tmp_path, None)} == {"kept", "refused"}


def test_per_track_rights_gate_inference_and_narrow_preview_prefix(tmp_path):
    pack = tmp_path / "pack"
    ext = pack / "v1" / "extracted"
    ext.mkdir(parents=True)
    (pack / "cards").mkdir()
    (pack / "pack.json").write_text(json.dumps({"current": "v1"}))
    (pack / "collection.card.json").write_text(json.dumps({"rights": {"uses": ["vision-input"], "processing": "local-only", "redistribution": "free"}}))
    for name, uses in (("denied", []), ("private", ["vision-input"])):
        (ext / f"{name}.wav").write_bytes(b"wav")
        (pack / "cards" / f"{name}.card.json").write_text(json.dumps({"source": {"files": [{"path": f"{name}.wav", "role": "primary"}]}, "rights": {"uses": uses, "processing": "local-only", "redistribution": "none"}}))
    jobs = a.audio_files(tmp_path)
    assert [job["file"].name for job in jobs] == ["private.wav"]
    assert jobs[0]["preview_prefix"] == "private/previews"


def test_restricted_alternate_format_blocks_preferred_format(tmp_path):
    pack = tmp_path / "pack"
    ext = pack / "v1" / "extracted"
    ext.mkdir(parents=True)
    (pack / "cards").mkdir()
    (pack / "pack.json").write_text(json.dumps({"current": "v1"}))
    (pack / "collection.card.json").write_text(json.dumps({"rights": {"uses": ["vision-input"], "processing": "local-only", "redistribution": "free"}}))
    (ext / "song.wav").write_bytes(b"wav")
    (ext / "song.ogg").write_bytes(b"ogg")
    (pack / "cards" / "song.card.json").write_text(json.dumps({"source": {"files": [{"path": "song.wav"}]}, "rights": {"uses": [], "processing": "local-only", "redistribution": "none"}}))
    assert a.audio_files(tmp_path) == []


def test_absent_processing_defaults_to_local_only():
    assert a.audio_rights.allows_vision({"uses": ["vision-input"]})


def test_audio_jobs_work_with_a_symlinked_library(tmp_path):
    library = tmp_path / "library"
    pack = library / "packs" / "pack"
    ext = pack / "v1" / "extracted"
    ext.mkdir(parents=True)
    (pack / "pack.json").write_text(json.dumps({"current": "v1"}))
    (pack / "collection.card.json").write_text(json.dumps({"rights": {"uses": ["vision-input"]}}))
    (ext / "sound.wav").write_bytes(b"wav")
    link = tmp_path / "assets-local"
    link.symlink_to(library, target_is_directory=True)
    [job] = a.audio_files(link / "packs")
    assert a.sidecar_path(job["version_dir"], job["file"]) == pack / "v1" / "analysis" / "sound.analysis.json"


def test_rights_index_rejects_restricted_source_alias(tmp_path):
    import pytest
    pack = tmp_path / "pack"
    ext = pack / "v1" / "extracted"
    ext.mkdir(parents=True)
    (pack / "cards").mkdir()
    (pack / "pack.json").write_text(json.dumps({"current": "v1"}))
    (pack / "collection.card.json").write_text(json.dumps({"rights": {"uses": ["vision-input"]}}))
    (ext / "real.wav").write_bytes(b"wav")
    (ext / "alias.wav").symlink_to(ext / "real.wav")
    (pack / "cards" / "denied.card.json").write_text(json.dumps({"source": {"files": [{"path": "alias.wav"}]}, "rights": {"uses": []}}))
    with pytest.raises(ValueError, match="source alias"):
        a.audio_files(tmp_path)
