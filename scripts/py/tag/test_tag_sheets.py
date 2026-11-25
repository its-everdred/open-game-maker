import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).parent))
import tag_sheets as t


def card():
    return {
        "schema": "ogm.asset-card/1.0",
        "vocab": "2026-10-27",
        "id": "t1:pack/sm-bld-prop-torch-01@v1",
        "card_type": "asset",
        "status": "measured",
        "title": "Torch",
        "kind": "model",
        "subkind": "prop",
        "collection": "t1:pack@v1",
        "source": {
            "files": [{"path": "models/SM_Bld_Prop_Torch_01.glb", "sha256": "sha256:" + "a" * 64, "bytes": 1, "format": "glb", "role": "primary"}],
            "content_hash": "sha256:" + "a" * 64,
        },
        "previews": {"sheet": "private/previews/aa/sheet.webp"},
        "geometry": {"bounds_m": {"min": [0, 0, 0], "max": [1, 1, 1]}, "triangles": 1, "normalized": True},
        "rights": {"uses": ["vision-input"], "audience": "private", "redistribution": "none", "processing": "local-only", "basis": []},
        "provenance": {"*": {"by": "code", "at": "2026-11-01T00:00:00Z"}},
    }


def test_lift_ranking_uses_the_full_baseline_and_respects_threshold_and_cap():
    probabilities = np.array(
        [
            [0.8, 0.1, 0.1],
            [0.1, 0.8, 0.1],
            [0.1, 0.1, 0.8],
            [0.1, 0.1, 0.8],
        ]
    )
    ranked = t.rank_group(probabilities, ["wall", "hero", "decor"], cap=1, threshold=1.5)
    assert ranked[0]["values"] == ["wall"]
    assert ranked[1]["values"] == ["hero"]
    assert ranked[2]["values"] == ["decor"]
    assert all(row["baseline_count"] == 4 for row in ranked)


def test_merge_writes_only_descriptive_fields_and_filename_objects():
    original = card()
    merged = t.merge_card(
        original,
        {
            "environments": {"values": ["dungeon"], "confidence": 0.82},
            "settings": {"values": ["fantasy"], "confidence": 0.76},
            "roles": {"values": ["light-source", "decor"], "confidence": 0.84},
            "materials": {"values": ["metal"], "confidence": 0.72},
            "condition": {"values": ["new"], "confidence": 0.8},
            "moods": {"values": ["eerie"], "confidence": 0.9},
            "objects": {"values": ["goblin"], "confidence": 0.99},
        },
        baseline_count=24,
        now="2026-11-01T00:00:00Z",
    )
    assert merged["describe"]["objects"] == ["torch"]
    assert merged["describe"]["roles"] == ["light-source", "decor"]
    assert "moods" not in merged["describe"]  # model/sprite assets do not get visual mood guesses
    assert merged["status"] == "tagged"
    assert "proposed_tags" not in merged
    for field in ("source", "rights", "geometry", "previews"):
        assert merged[field] == original[field]


def test_locked_human_descriptions_survive_and_high_confidence_removes_only_owned_flag():
    original = card()
    original["describe"] = {"roles": ["hero"], "objects": ["kevin-object"], "description": "Kevin's locked description."}
    original["flags"] = ["low-confidence", "needs-review"]
    original["provenance"].update(
        {
            "describe.roles": {"by": "human", "at": "2026-11-01T00:00:00Z", "locked": True},
            "describe.objects": {"by": "human", "at": "2026-11-01T00:00:00Z", "locked": True},
            "describe.description": {"by": "human", "at": "2026-11-01T00:00:00Z", "locked": True},
            "flags.low_confidence": {"by": "model", "model": t.CLIP_ID, "tool": t.TOOL, "at": "2026-11-01T00:00:00Z", "confidence": 0.4},
        }
    )
    merged = t.merge_card(
        original,
        {"roles": {"values": ["enemy"], "confidence": 0.9}},
        baseline_count=20,
        now="2026-11-02T00:00:00Z",
    )
    assert merged["describe"] == original["describe"]
    assert merged["flags"] == ["needs-review"]
    assert merged["provenance"]["describe.roles"] == original["provenance"]["describe.roles"]


def test_low_confidence_is_owned_and_missing_descriptive_core_stays_measured():
    original = card()
    original["source"]["files"][0]["path"] = "models/001.glb"
    merged = t.merge_card(
        original,
        {"roles": {"values": [], "confidence": 0.4}},
        baseline_count=8,
        now="2026-11-01T00:00:00Z",
    )
    assert merged["status"] == "measured"
    assert merged["flags"] == ["low-confidence"]
    assert merged["provenance"]["flags.low_confidence"]["tool"] == t.TOOL


def test_existing_unowned_low_confidence_flag_is_never_claimed_or_removed():
    original = card()
    original["flags"] = ["low-confidence"]
    low = t.merge_card(
        original,
        {"roles": {"values": [], "confidence": 0.4}},
        baseline_count=8,
        now="2026-11-01T00:00:00Z",
    )
    assert "flags.low_confidence" not in low["provenance"]
    high = t.merge_card(
        low,
        {"roles": {"values": ["decor"], "confidence": 0.9}},
        baseline_count=8,
        now="2026-11-02T00:00:00Z",
    )
    assert "low-confidence" in high["flags"]


def test_model_loading_is_cache_only_and_names_the_missing_identifier():
    calls = []

    class Missing:
        @classmethod
        def from_pretrained(cls, identifier, **options):
            calls.append((identifier, options))
            raise OSError("not cached")

    with pytest.raises(RuntimeError, match=t.CLIP_ID):
        t.load_clip(Missing, Missing)
    assert calls == [(t.CLIP_ID, {"local_files_only": True})]


def test_stage_keeps_the_previous_card_until_promotion(tmp_path):
    out = tmp_path / "card.json"
    out.write_text(json.dumps({"status": "measured"}))
    staged = t.stage_json(out, {"status": "tagged"})
    assert json.loads(out.read_text())["status"] == "measured"
    t.promote(staged, out)
    assert json.loads(out.read_text())["status"] == "tagged"


def test_eligible_cards_require_local_vision_rights_and_a_preview(tmp_path):
    pack = tmp_path / "pack"
    (pack / "cards").mkdir(parents=True)
    (pack / "v1" / "extracted" / "models").mkdir(parents=True)
    (pack / "pack.json").write_text(json.dumps({"current": "v1"}))
    (pack / "v1" / "extracted" / "models" / "SM_Bld_Prop_Torch_01.glb").write_bytes(b"glb")
    collection = card()
    collection.update({"id": "t1:pack@v1", "card_type": "collection"})
    (pack / "collection.card.json").write_text(json.dumps(collection))
    eligible = card()
    import hashlib
    eligible["source"]["files"][0]["sha256"] = "sha256:" + hashlib.sha256(b"glb").hexdigest()
    eligible["previews"]["sheet"] = t.expected_sheet_key(eligible, collection["rights"])
    (pack / "cards" / "torch.card.json").write_text(json.dumps(eligible))
    assert len(t.eligible_cards(pack)) == 1
    assert len(t.eligible_cards(pack, "model")) == 1
    assert t.eligible_cards(pack, "sprite") == []
    reviewed = json.loads(json.dumps(eligible))
    reviewed["status"] = "reviewed"
    reviewed["previews"]["sheet"] = t.expected_sheet_key(reviewed, collection["rights"])
    (pack / "cards" / "reviewed.card.json").write_text(json.dumps(reviewed))
    assert len(t.eligible_cards(pack, "model")) == 1
    malformed = json.loads(json.dumps(eligible))
    malformed["rights"] = {}
    malformed["previews"]["sheet"] = t.expected_sheet_key(malformed, collection["rights"])
    (pack / "cards" / "malformed.card.json").write_text(json.dumps(malformed))
    assert t.eligible_cards(pack, "model") == []
    (pack / "cards" / "malformed.card.json").unlink()
    fbx = json.loads(json.dumps(eligible))
    fbx["source"]["files"][0]["format"] = "fbx"
    (pack / "cards" / "fbx.card.json").write_text(json.dumps(fbx))
    assert len(t.eligible_cards(pack, "model")) == 1
    collection["rights"]["uses"] = []
    (pack / "collection.card.json").write_text(json.dumps(collection))
    assert t.eligible_cards(pack) == []


def test_tagged_fixture_passes_schema_and_model_write_allowlist(tmp_path):
    fixture = t.REPO / "packages/contracts/fixtures/cards/model-kit-kenney-mini-dungeon-wall.json"
    merged = t.merge_card(
        json.loads(fixture.read_text()),
        {
            "environments": {"values": ["dungeon"], "confidence": 0.8},
            "roles": {"values": ["wall"], "confidence": 0.8},
            "materials": {"values": ["stone"], "confidence": 0.8},
            "condition": {"values": ["new"], "confidence": 0.8},
        },
        baseline_count=20,
        now="2026-11-01T00:00:00Z",
    )
    out = tmp_path / "wall.card.json"
    out.write_text(json.dumps(merged))
    result = subprocess.run(["node", str(t.VALIDATOR), str(out)], capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "ok   model-writes-allowlist" in result.stdout


def test_filename_seed_is_retained_when_clip_prefers_another_label():
    ranked = t.rank_group([[0.1, 0.9], [0.9, 0.1]], ["wall", "hero"], 1, seeds=[["wall"], []])
    assert ranked[0]["values"] == ["wall"]


def test_any_low_confidence_emitted_group_marks_the_card():
    result = t.merge_card(card(), {"roles": {"values": ["wall"], "confidence": 0.4},
                                   "materials": {"values": ["stone"], "confidence": 0.9}}, baseline_count=20)
    assert "low-confidence" in result["flags"]


def test_tall_floor_role_flags_conflict_with_measured_height():
    result = t.merge_card(card(), {"roles": {"values": ["floor"], "confidence": 0.8}}, baseline_count=20)
    assert "conflicts-with-measured" in result["flags"]


def test_validation_ignores_unselected_invalid_pack(tmp_path):
    fixture = t.REPO / "packages/contracts/fixtures/cards/collection-kenney-mini-dungeon.json"
    selected = tmp_path / "selected"
    other = tmp_path / "other"
    selected.mkdir()
    other.mkdir()
    (selected / "collection.card.json").write_text(fixture.read_text())
    (other / "collection.card.json").write_text("not json")
    result = t.validate(tmp_path, [], ["selected"])
    assert result[0] == 0, result[-1]


def test_image_encoding_reports_each_completed_batch(tmp_path, capsys):
    import json
    import torch
    from PIL import Image

    paths = []
    for index in range(3):
        path = tmp_path / f"{index}.png"
        Image.new("RGB", (1, 1)).save(path)
        paths.append(path)

    class Model:
        def get_image_features(self, **_inputs):
            return torch.ones((1, 2))

    t._image_features(paths, Model(), lambda **_kwargs: {}, batch_size=1)
    records = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert records == [{"progress": {"done": i, "total": 3}} for i in (1, 2, 3)]


def test_sheet_images_are_encoded_once_across_vocabulary_groups(monkeypatch):
    calls = []
    monkeypatch.setattr(t, "label_groups", lambda: {"roles": ["wall"], "materials": ["stone"]})
    monkeypatch.setattr(t, "_image_features", lambda images, _model, _processor: calls.append(images) or np.ones((len(images), 2)))
    monkeypatch.setattr(t, "_probabilities", lambda features, prompts, _model, _processor: np.ones((len(features), len(prompts))))
    rows = [{"card": card(), "preview": Path("sheet.webp")}]
    t.score_rows(rows, None, None)
    assert calls == [[Path("sheet.webp")]]


def test_validator_accepts_paths_on_stdin():
    fixture = t.REPO / "packages/contracts/fixtures/cards/collection-kenney-mini-dungeon.json"
    result = subprocess.run(["node", str(t.VALIDATOR), "--paths-stdin"], input=json.dumps([str(fixture)]), capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr


def test_visual_rights_index_rejects_restricted_source_alias(tmp_path):
    pack = tmp_path / "pack"
    extracted = pack / "v1" / "extracted" / "models"
    extracted.mkdir(parents=True)
    (pack / "cards").mkdir()
    (pack / "pack.json").write_text(json.dumps({"current": "v1"}))
    (pack / "collection.card.json").write_text(json.dumps({"id": "t1:pack@v1", "rights": {"uses": ["vision-input"]}}))
    (extracted / "real.glb").write_bytes(b"glb")
    (extracted / "alias.glb").symlink_to(extracted / "real.glb")
    denied = card()
    denied["source"]["files"][0]["path"] = "models/alias.glb"
    denied["rights"] = {"uses": []}
    (pack / "cards" / "denied.card.json").write_text(json.dumps(denied))
    with pytest.raises(ValueError, match="source alias"):
        t.eligible_cards(pack, "model")


def test_visual_worker_rejects_collection_directory_alias(tmp_path):
    real = tmp_path / "real"
    real.mkdir()
    alias = tmp_path / "alias"
    alias.symlink_to(real, target_is_directory=True)
    with pytest.raises(ValueError, match="collection directory symlinks"):
        t.eligible_cards(alias, "model")


def test_search_may_include_reviewed_cards_but_requires_both_rights(tmp_path):
    import hashlib

    pack = tmp_path / "pack"
    (pack / "cards").mkdir(parents=True)
    (pack / "v1" / "extracted" / "models").mkdir(parents=True)
    (pack / "pack.json").write_text(json.dumps({"current": "v1"}))
    (pack / "v1" / "extracted" / "models" / "SM_Bld_Prop_Torch_01.glb").write_bytes(b"glb")
    collection = card()
    collection.update({"id": "t1:pack@v1", "card_type": "collection"})
    collection["rights"]["uses"] = ["vision-input", "in-game"]
    (pack / "collection.card.json").write_text(json.dumps(collection))
    asset = card()
    asset["status"] = "reviewed"
    asset["source"]["files"][0]["sha256"] = "sha256:" + hashlib.sha256(b"glb").hexdigest()
    asset["rights"]["uses"] = ["vision-input", "in-game"]
    asset["previews"]["sheet"] = t.expected_sheet_key(asset, collection["rights"])
    (pack / "cards" / "torch.card.json").write_text(json.dumps(asset))
    assert t.eligible_cards(pack) == []
    assert len(t.eligible_cards(pack, include_reviewed=True, required_uses=("vision-input", "in-game"))) == 1
    asset["rights"]["uses"] = ["vision-input"]
    (pack / "cards" / "torch.card.json").write_text(json.dumps(asset))
    assert t.eligible_cards(pack, include_reviewed=True, required_uses=("vision-input", "in-game")) == []


def test_directional_search_checks_the_selected_source_and_its_alias_rights(tmp_path):
    import hashlib

    pack = tmp_path / "pack"
    extracted = pack / "v1" / "extracted" / "models"
    extracted.mkdir(parents=True)
    (pack / "cards").mkdir()
    (pack / "pack.json").write_text(json.dumps({"current": "v1"}))
    collection = card()
    collection.update({"id": "t1:pack@v1", "card_type": "collection"})
    collection["rights"]["uses"] = ["vision-input", "in-game"]
    (pack / "collection.card.json").write_text(json.dumps(collection))
    for name in ("east.png", "south.png"):
        (extracted / name).write_bytes(name.encode())
    asset = card()
    asset.update({"kind": "sprite", "status": "reviewed", "sprite": {"facings": {"E": "models/east.png", "S": "models/south.png"}}})
    asset["rights"]["uses"] = ["vision-input", "in-game"]
    asset["source"]["files"] = [{"path": f"models/{name}", "sha256": "sha256:" + hashlib.sha256(name.encode()).hexdigest(), "role": "primary" if name == "east.png" else "companion"} for name in ("east.png", "south.png")]
    (pack / "cards" / "sprite.card.json").write_text(json.dumps(asset))
    rows = t.eligible_cards(pack, "sprite", include_reviewed=True, required_uses=("vision-input", "in-game"), facing="E")
    assert len(rows) == 1 and rows[0]["preview"].name == "east.png"
    alias = json.loads(json.dumps(asset))
    alias["id"] += "-restricted"
    alias["source"]["files"] = [asset["source"]["files"][1]]
    alias["rights"]["uses"] = ["vision-input"]
    (pack / "cards" / "restricted.card.json").write_text(json.dumps(alias))
    assert not t.eligible_cards(pack, "sprite", include_reviewed=True, required_uses=("vision-input", "in-game"), facing="S")
    (extracted / "east.png").write_bytes(b"tampered")
    assert not t.eligible_cards(pack, "sprite", include_reviewed=True, required_uses=("vision-input", "in-game"), facing="E")
