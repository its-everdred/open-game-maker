"""Tests for the card step's rules: each encodes a promise the cards make to agents searching them."""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
import build_audio_cards as b


def test_repo_root_tracks_the_worker_layout():
    """The worker must resolve repository paths correctly from scripts/py/audio."""
    assert (b.REPO / "scripts/py/audio").is_dir()


def test_composer_tempo_settles_the_octave():
    """Beat trackers often read half or double time; the composer's own tempo picks the right reading and keeps the others."""
    a = {"tempo_bpm": 150.0, "tempo_alternatives": [75.0]}
    assert b.settle_tempo(a, {"tempo_bpm": 75.0}) == 75.0
    assert a["tempo_bpm"] == 75.0 and a["tempo_alternatives"] == [150.0]


def test_composer_tempo_far_from_every_reading_is_ignored():
    """A vendor label that matches nothing measured (wrong project tempo, rubato) must not overwrite the measurement."""
    a = {"tempo_bpm": 120.0, "tempo_alternatives": [60.0, 240.0]}
    assert b.settle_tempo(a, {"tempo_bpm": 97.0}) is None and a["tempo_bpm"] == 120.0


def test_ids_are_kebab_paths():
    """C3 ids are lowercase kebab paths; camelCase Kenney names must split (bookOpen -> book-open) to match the examples."""
    assert b.kebab("Audio/bookOpen") == "audio/book-open"
    assert b.kebab("Audio (Hit)/jingles_HIT00") == "audio-hit/jingles-hit00"


def test_lift_keeps_only_labels_above_threshold():
    """A label CLAP likes everywhere must not be tagged on every track: only lift >= threshold survives, best first."""
    names = ["sunrise", "cave", "forest"]
    picked = b.pick(np.array([1.0, 2.5, 1.6]), np.array([0.5, 0.2, 0.3]), names, 1.5, 2)
    assert [n for n, _, _ in picked] == ["cave", "forest"]


def test_opposed_moods_never_share_a_card():
    """'calm' and 'energetic' on one track is a contradiction a search filter would surface; the weaker one is dropped."""
    assert frozenset(("calm", "energetic")) in b.OPPOSED


def _sfx(stem, pid, top_event="a scream"):
    i = [e[0] for e in b.L.SFX_EVENTS].index(top_event)
    p = np.full(len(b.L.SFX_EVENTS), 0.001)
    p[i] = 0.9
    d = {"_p": {"sfx_event": p / p.sum(), "sfx_material": np.full(len(b.L.MATERIALS), 1 / len(b.L.MATERIALS))}}
    lift = {"sfx_event": np.ones(len(p)), "sfx_material": np.ones(len(b.L.MATERIALS))}
    return b.sfx_describe(d, lift, b.prompts(), {"duration_s": 0.5}, stem, pid)


def test_voice_subkind_only_comes_from_voice_packs():
    """A retro 'lose' blip that CLAP hears as a scream is not a voice line; only the voiceover packs are voice."""
    desc, subkind, *_ = _sfx("lose8", "kenney-retro-sounds-2")
    assert subkind != "voice" and not desc["description"].startswith("Voice line")
    desc, subkind, *_ = _sfx("objective_complete", "kenney-voiceover-pack")
    assert subkind == "voice" and desc["keywords"] == ["objective", "complete"]


def test_filename_names_the_source_before_clap():
    """Kenney filenames say what the sound is; 'footstep_carpet' is a footstep on cloth even if CLAP hears a kick."""
    desc, subkind, *_ = _sfx("footstep_carpet_000", "kenney-impact-sounds", top_event="a kick")
    assert subkind == "sfx/footstep" and desc["materials"] == ["cloth"] and "kick" not in desc["objects"]


def test_album_series_number_is_the_catalog_number():
    """Sidetrax files have no title or composer tag; the only catalog number they carry is the series number in the album."""
    assert b.album_no("07 Rock Follies") == 7
    assert b.album_no("SideTrax 2024") is None and b.album_no(None) is None


def test_fast_situations_need_fast_loud_tracks():
    """Kevin: a slow, desolate track was tagged 'chase'. Chase, combat and boss need high measured energy and a quick tempo."""
    assert not b.fits("chase", eq=0.19, bpm=100, minor=False)
    assert b.fits("chase", eq=0.89, bpm=128, minor=False)


def test_stealth_never_goes_on_a_loud_track():
    """Kevin flagged 'stealth' on energetic songs again and again; sneaking music is quiet."""
    assert not b.fits("stealth", eq=0.9, bpm=80, minor=True) and b.fits("stealth", eq=0.2, bpm=80, minor=True)


def test_defeat_needs_minor_or_slow():
    """A cheerful 140 BPM major-key track is not game-over music."""
    assert not b.fits("defeat", eq=0.7, bpm=140, minor=False) and b.fits("defeat", eq=0.7, bpm=140, minor=True)


def test_vendor_genre_comes_from_the_pack_name():
    """CLAP's genre agreed with the pack's own genre only ~30% of the time; the vendor's pack name wins when it names one."""
    assert b.pack_genre("sidetrax-pack-16-orchestral-music-02") == ["orchestral", "cinematic"]
    assert b.pack_genre("sidetrax-pack-30-crimson") is None


def test_synth_coin_is_not_metal():
    """Kevin: a retro 'coin' blip is not metal sounding. In synth packs only a word naming the material outright counts."""
    desc, *_ = _sfx("coin4", "kenney-retro-sounds-2")
    assert "materials" not in desc
    desc, *_ = _sfx("impactMetal_000", "kenney-sci-fi-sounds")
    assert desc.get("materials") == ["metal"]


def test_plate_is_not_a_material_word():
    """Kevin: 'plates slide' sounds like a blade on a whetstone; 'plate' says nothing reliable about the material."""
    assert "plate" not in b.MAT_WORDS


def test_worker_card_record_has_only_the_json_lines_contract_fields():
    assert b.card_record("packs/music/cards/track.card.json", {"status": "tagged", "flags": ["low-confidence"]}) == {
        "card": "packs/music/cards/track.card.json",
        "status": "tagged",
        "flags": ["low-confidence"],
    }


def test_staged_card_preserves_previous_file_until_promotion(tmp_path):
    out = tmp_path / "track.card.json"
    out.write_text("old\n")
    staged = b.stage_json(out, {"status": "tagged"})

    assert out.read_text() == "old\n"
    assert staged.name.endswith(".part")
    b.promote(staged, out)
    assert '"status": "tagged"' in out.read_text()


def test_manifest_hints_supply_genre_without_pack_id_heuristics():
    assert b.hint_genres(["Dark retro", "Chiptune", "Action-adventure / RPG"]) == ["chiptune"]
    assert b.hint_genres(["Dark impacts"]) == []


def test_locked_human_set_and_hints_survive_a_generated_card_merge():
    previous = {
        "describe": {"set": "kevin-set", "hints": ["hand-picked"]},
        "provenance": {
            "describe.set": {"by": "human", "at": "2026-11-01T00:00:00Z", "locked": True},
            "describe.hints": {"by": "human", "at": "2026-11-01T00:00:00Z", "locked": True},
        },
    }
    generated = {
        "describe": {"set": "model-set", "hints": ["manifest"]},
        "provenance": {"describe.set": {"by": "model"}, "describe.hints": {"by": "collection"}},
    }
    merged = b.preserve_locked(previous, generated)
    assert merged["describe"]["set"] == "kevin-set"
    assert merged["describe"]["hints"] == ["hand-picked"]
    assert merged["provenance"]["describe.set"]["locked"] is True


def test_existing_card_keeps_rights_license_and_source_when_retagged():
    previous = {"rights": {"uses": ["vision-input"]}, "license": "owned", "source": {"files": ["original"]}}
    generated = {"rights": {"uses": []}, "license": "other", "source": {"files": ["changed"]}}
    assert b.preserve_locked(previous, generated) == previous


def test_pack_derivatives_write_private_sheet_and_medley_to_collection(tmp_path, monkeypatch):
    pid = "drive-barbarian-chiptune"
    pack = tmp_path / "packs" / pid
    for name in ("01", "02"):
        (pack / "v1" / "extracted").mkdir(parents=True, exist_ok=True)
        (pack / "v1" / "extracted" / f"{name}.wav").write_bytes(b"wav")
        tile = pack / "v1" / "analysis" / f"{name}.preview.png"
        tile.parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", (b.P.TILE_WIDTH, b.P.TILE_HEIGHT), "black").save(tile)
    items = [
        {
            "file": f"{name}.wav",
            "music": True,
            "sha256": name * 32,
            "_ver": "v1",
            "preview_tile": f"analysis/{name}.preview.png",
            "measure": {"audio": {"duration_s": 60.0}, "sidecar": {"downbeats_s": [0.0]}},
        }
        for name in ("01", "02")
    ]
    collection = {"rights": {"redistribution": "free"}}
    items[0]["_preview_prefix"] = "private/previews"
    medley_entries = []

    def fake_medley(entries, out):
        medley_entries.extend(entries)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(b"ogg")

    monkeypatch.setattr(b, "ROOT", tmp_path)
    monkeypatch.setattr(b.P, "make_medley", fake_medley)
    assert b.build_pack_derivatives(pid, items, collection, tmp_path / "packs")
    assert collection["previews"]["sheet"].startswith("private/previews/")
    assert collection["previews"]["clip"].startswith("private/previews/")
    assert len(medley_entries) == 2
    first_clip = collection["previews"]["clip"]
    for item in items:
        item["measure"]["sidecar"]["downbeats_s"] = [5.0]
    second_collection = {"rights": {"redistribution": "none"}}
    assert b.build_pack_derivatives(pid, items, second_collection, tmp_path / "packs")
    assert second_collection["previews"]["clip"] != first_clip


def test_limit_still_builds_pack_derivatives_from_every_analysed_track(tmp_path, monkeypatch):
    packs = tmp_path / "packs"
    pack = packs / "music-pack"
    pack.mkdir(parents=True)
    (pack / "collection.card.json").write_text('{"id":"t1:music-pack@v1","collection_info":{"counts":{}}}')
    probabilities = np.full(len(b.L.SFX_EVENTS), 1 / len(b.L.SFX_EVENTS))
    materials = np.full(len(b.L.MATERIALS), 1 / len(b.L.MATERIALS))
    rows = [
        {
            "_pack": "music-pack",
            "_ver": "v1",
            "_sidecar": pack / "v1" / "analysis" / f"sound-{index}.analysis.json",
            "file": f"sound-{index}.wav",
            "sha256": str(index + 1) * 64,
            "bytes": 10,
            "music": False,
            "measure": {"audio": {"duration_s": 1.0, "peak_dbfs": -1.0}},
            "preview": {"waveform": f"private/previews/{index}.png"},
            "vendor": {},
            "_p": {"sfx_event": probabilities, "sfx_material": materials},
        }
        for index in range(2)
    ]
    derivative_sizes = []
    monkeypatch.setattr(
        b,
        "build_pack_derivatives",
        lambda _pid, items, _collection, _packs: derivative_sizes.append(len(items)) or False,
    )
    means = {(False, "sfx_event"): probabilities, (False, "sfx_material"): materials}

    written, _, records, _ = b.build(rows, b.prompts(), means, packs, update_counts=False, limit=1)

    assert written == 1
    assert len(records) == 1
    assert derivative_sizes == [2]


def test_voice_lines_have_no_material():
    """'We need wood' is a spoken line, not a wooden sound."""
    desc, *_ = _sfx("we_need_wood", "kenney-synth-voice-2")
    assert "materials" not in desc


def test_search_note_says_what_the_file_is_within_the_cap():
    """The row an agent searches must name the track and the facts that narrow it, and never exceed C3's 120 chars."""
    describe = {"moods": ["calm", "cozy"], "genre": ["orchestral"]}
    note = b.search_note(describe, {"duration_s": 92.4, "tempo_bpm": 90.0, "loopable": True}, "music/loop")
    assert note == "calm cozy orchestral loop · 90 BPM · seamless · 1:32"
    assert b.search_note(describe, {"duration_s": 92.4}, "music/track") == "calm cozy orchestral track · 1:32"
    long = b.search_note({"moods": ["calm"] * 3, "genre": ["experimental"]}, {"duration_s": 4000.0}, "music/track")
    assert len(long) <= b.NOTE_MAX


def test_sound_effect_search_note_names_the_kind_and_its_material():
    """A footstep row reads 'stone footstep', not the CLAP sentence: it is the words an agent queries with."""
    note = b.search_note({"objects": ["footstep", "gravel"], "materials": ["stone"]}, {"duration_s": 0.42}, "sfx/footstep")
    assert note == "stone footstep gravel · 0.42 s"
    voice = b.search_note({"objects": ["voice"]}, {"duration_s": 1.2}, "voice")
    assert voice == "voice · 1.20 s"


def test_library_summary_is_one_line_within_the_cap():
    """One line per library: what it holds, then the moods and genres it covers most, inside C3's 200 chars."""
    entries = [("sfx/footstep", {"materials": ["stone"], "moods": []})] * 3
    entries += [("music/loop", {"moods": ["tense"], "genre": ["chiptune"]})] * 2
    summary = b.library_summary(entries)
    assert summary == "3 footstep; 2 loop; moods tense; genres chiptune; materials stone"
    assert b.library_summary([("music/track", {})]) == "1 track"
    assert len(b.library_summary([("sfx/other", {"moods": [f"m{i}" for i in range(3)] * 2})] * 40)) <= b.SUMMARY_MAX
def test_pack_derivatives_wait_for_every_music_preview_tile(tmp_path):
    """A --limit run leaves older sidecars without preview tiles; the pack sheet waits for them instead of crashing."""
    items = [
        {"file": "01.wav", "music": True, "sha256": "1" * 64, "_ver": "v1", "preview_tile": "analysis/01.preview.png"},
        {"file": "02.wav", "music": True, "sha256": "2" * 64, "_ver": "v1"},
    ]
    collection = {"rights": {"redistribution": "none"}}
    assert b.build_pack_derivatives("pack", items, collection, tmp_path / "packs") is False
    assert "previews" not in collection


def test_only_selects_exactly_the_repeated_packs():
    """gm passes one --only per rights-eligible collection; a refused pack must not ride along on a shared glob."""
    assert b.matches_any("kenney-music-loops", ["kenney-music-loops", "drive-barbarian-chiptune"])
    assert not b.matches_any("refused-pack", ["kenney-music-loops", "drive-barbarian-chiptune"])
    assert b.matches_any("anything", None)
    assert b.matches_any("kenney-music-loops", "kenney-*")


def test_validation_ignores_unselected_invalid_pack(tmp_path):
    fixture = b.REPO / "packages/contracts/fixtures/cards/collection-kenney-mini-dungeon.json"
    selected = tmp_path / "selected"
    other = tmp_path / "other"
    selected.mkdir()
    other.mkdir()
    (selected / "collection.card.json").write_text(fixture.read_text())
    (other / "collection.card.json").write_text("not json")
    result = b.validate(tmp_path, [], ["selected"])
    assert result[0] == 0, result[-1]
