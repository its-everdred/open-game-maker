"""Tests for the map card rules added after Kevin's first swipe review; each encodes a judgment he made on a real card."""
import sys
import json
import subprocess
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import hash_manifest as h
import import_profantasy_docs as d
import tag_maps as t


def test_repo_root_tracks_the_worker_layout():
    """Every map worker must resolve repository paths correctly from scripts/py/maps."""
    assert (t.REPO / "scripts/py/maps").is_dir()
    assert t.REPO == h.REPO == d.REPO


def test_standees_and_symbol_sheets_are_not_maps():
    """Kevin: paper standees and a military-symbol chart are 'not a usable map'; agents must be able to filter them out."""
    assert t.sheet_kind("Annual/Issue 86 - Paper Standees/Monsters/Monster - Goblin 3.png") == "standee"
    assert t.sheet_kind("Annual/Issue 35 - Military Symbols/CA35 Division Chart Example.png") == "symbol-sheet"
    assert t.sheet_kind("Examples/DD3/dumour.png") is None


def test_tutorial_steps_and_blank_frames_are_unusable():
    """Kevin called WT 30 'a useless mostly blank asset' and Tutorial 4 'a lake in an empty map'."""
    assert t.usable_of("Annual/Issue 36A/Step-by-Step Maps/WT_30.png", True, "building", 0.5) == ("no", "tutorial-step")
    assert t.usable_of("Annual/Issue 116 - Scorching Sun/CA116 Tutorial 4.png", True, "battlemap", 0.7) == ("no", "tutorial-step")
    assert t.usable_of("Castles/test.png", True, "building", 0.0) == ("no", "near-empty")
    assert t.usable_of("Examples/DD3/dumour.png", True, "battlemap", 0.9) == ("yes", None)


def test_zoomed_out_maps_are_reference_only():
    """Kevin: Operation Manna shows all of Greece; it is a paper map, not one a player walks on."""
    assert t.text_type("WWII/Operation Manna.png") == "region"
    assert t.usable_of("WWII/Operation Manna.png", True, t.scale_of("WWII/Operation Manna.png", "region"), 0.4) == ("reference-only", "zoomed-out")


def test_panoramas_and_side_views_are_not_top_down():
    """Kevin asked to tell top-down tile maps apart from forward-looking views such as the Drakkenhall panorama."""
    assert t.view_of("Annual/Issue 103 - City Panoramas/CA103 Drakkenhall.png") == "perspective"
    assert t.view_of("Annual/Issue 36A - Side Views and Cross-sections/CA36A Tower.png") == "side"
    assert t.view_of("Castles/Restormel3D.png") == "perspective"
    assert t.view_of("Examples/DD3/dumour.png") == "topdown"


def test_cellar_does_not_inherit_other_floors():
    """Kevin: the cellar map was tagged with upper stories and roofs, words from its links legend to the other floors."""
    assert t.level_of("CA197 City Block Cellar no SS4") == "cellar"
    assert t.level_of("CA161 Ryecroft Town") is None


def test_worker_card_record_has_only_the_json_lines_contract_fields():
    assert t.card_record("inspiration/cards/map.card.json", {"status": "tagged"}) == {
        "card": "inspiration/cards/map.card.json",
        "status": "tagged",
        "flags": [],
    }


def test_staged_card_preserves_previous_file_until_promotion(tmp_path):
    out = tmp_path / "map.card.json"
    out.write_text("old\n")
    staged = t.stage_json(out, {"status": "tagged"})

    assert out.read_text() == "old\n"
    t.promote(staged, out)
    assert '"status": "tagged"' in out.read_text()


def test_existing_card_keeps_protected_and_locked_fields():
    previous = {"rights": {"uses": []}, "source": {"files": ["original"]},
                "describe": {"description": "human"},
                "provenance": {"describe.description": {"by": "human", "locked": True}}}
    generated = {"source": {"files": ["changed"]}, "describe": {"description": "model"}, "provenance": {}}
    result = t.preserve_card(previous, generated)
    assert result["rights"] == previous["rights"]
    assert result["source"] == previous["source"]
    assert result["describe"]["description"] == "human"
    assert result["provenance"]["describe.description"]["locked"] is True


def test_map_rights_gate_analysis_and_preexisting_rows(tmp_path, monkeypatch):
    monkeypatch.setattr(t, "COLL_DIR", tmp_path)
    (tmp_path / "cards").mkdir()
    (tmp_path / "collection.card.json").write_text(json.dumps({"rights": {"uses": ["vision-input"], "processing": "local-only"}}))
    (tmp_path / "cards" / "custom.card.json").write_text(json.dumps({"source": {"files": [{"path": "maps/denied.png", "role": "companion"}]}, "rights": {"uses": [], "processing": "local-only"}}))
    assert t.rights_allow_map("allowed.png")
    (tmp_path / "collection.card.json").write_text(json.dumps({"rights": {"uses": ["vision-input"]}}))
    assert t.rights_allow_map("allowed.png")
    assert not t.rights_allow_map("denied.png")
    (tmp_path / "cards" / "custom.card.json").write_text(json.dumps({"source": {"files": [{"path": "maps/denied.png", "role": "companion"}]}, "rights": {}}))
    assert not t.rights_allow_map("denied.png")


def test_map_worker_starts_with_isolated_python():
    result = subprocess.run([sys.executable, "-I", str(Path(t.__file__)), "--help"], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert "analyse" in result.stdout


def test_map_sidecar_rejects_source_and_preview_escapes(tmp_path, monkeypatch):
    import pytest
    coll = tmp_path / "collection"
    maps = coll / "maps"
    analysis = coll / "analysis"
    maps.mkdir(parents=True)
    analysis.mkdir()
    monkeypatch.setattr(t, "COLL_DIR", coll)
    monkeypatch.setattr(t, "MAPS", maps)
    monkeypatch.setattr(t, "ANALYSIS", analysis)
    monkeypatch.setattr(t, "ASSETS_ROOT", tmp_path)
    sidecar = analysis / "map.analysis.json"
    sidecar.write_text(json.dumps({"map": "../../secret.png", "thumb": "private/previews/ok.webp"}))
    with pytest.raises(ValueError, match="does not match"):
        t.safe_analysis_row(sidecar)
    sidecar.write_text(json.dumps({"map": "map.png", "thumb": "../../secret.webp"}))
    with pytest.raises(ValueError, match="preview bucket"):
        t.safe_analysis_row(sidecar)


def test_direct_collection_update_preserves_rights_and_license(tmp_path, monkeypatch):
    monkeypatch.setattr(t, "COLL_DIR", tmp_path)
    path = tmp_path / "collection.card.json"
    original = {"rights": {"uses": ["vision-input"], "redistribution": "none"}, "license": "owned", "collection_info": {"counts": {}}, "provenance": {}}
    path.write_text(json.dumps(original))
    t.write_collection(3, {})
    result = json.loads(path.read_text())
    assert result["rights"] == original["rights"]
    assert result["license"] == original["license"]
    assert result["collection_info"]["counts"]["inspiration/map"] == 3


def test_map_discovery_allows_symlinked_library_root(tmp_path, monkeypatch):
    library = tmp_path / "library"
    coll = library / "inspiration" / "pack"
    maps = coll / "maps"
    maps.mkdir(parents=True)
    (coll / "cards").mkdir()
    (coll / "collection.card.json").write_text(json.dumps({"rights": {"uses": ["vision-input"]}}))
    (maps / "map.png").write_bytes(b"png")
    (maps / "map.json").write_text(json.dumps({"ok": True}))
    link = tmp_path / "assets-local"
    link.symlink_to(library, target_is_directory=True)
    monkeypatch.setattr(t, "COLL_DIR", link / "inspiration" / "pack")
    monkeypatch.setattr(t, "MAPS", link / "inspiration" / "pack" / "maps")
    assert len(list(t.maps())) == 1


def test_map_rights_index_rejects_restricted_source_alias(tmp_path, monkeypatch):
    import pytest
    maps = tmp_path / "maps"
    maps.mkdir()
    (tmp_path / "cards").mkdir()
    (tmp_path / "collection.card.json").write_text(json.dumps({"rights": {"uses": ["vision-input"]}}))
    (maps / "real.png").write_bytes(b"png")
    (maps / "alias.png").symlink_to(maps / "real.png")
    (tmp_path / "cards" / "denied.card.json").write_text(json.dumps({"source": {"files": [{"path": "maps/alias.png"}]}, "rights": {"uses": []}}))
    monkeypatch.setattr(t, "COLL_DIR", tmp_path)
    monkeypatch.setattr(t, "MAPS", maps)
    with pytest.raises(ValueError, match="source alias"):
        t.map_rights()
