import importlib.util
import io
import json
from pathlib import Path
import tarfile
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location("backfill_pack_discovery", Path(__file__).with_name("backfill_pack_discovery.py"))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def write_package(path, logical="Assets/Tavern/Demo.unity", content=b"scene", sidecar=True, sidecar_content=None):
    members = [("a" * 32 + "/pathname", logical.encode()), ("a" * 32 + "/asset", content)]
    if sidecar:
        members.append(("a" * 32 + "/asset.meta", sidecar_content if sidecar_content is not None else b"guid: " + b"a" * 32))
    with tarfile.open(path, "w:gz") as tar:
        for name, data in members:
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))


class BackfillTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.pack = self.root / "packs" / "example-tavern"
        self.originals = self.pack / "1" / "originals"
        self.originals.mkdir(parents=True)
        fixture = Path(__file__).resolve().parents[2] / "packages/contracts/fixtures/cards/collection-kenney-mini-dungeon.json"
        self.card = json.loads(fixture.read_text())
        self.card.update({"id": "t1:example-tavern@1", "status": "measured", "title": "Example Tavern"})
        self.card["collection_info"]["version"] = "1"
        self.card["collection_info"]["counts"] = {"model": 2}
        (self.pack / "collection.card.json").write_text(json.dumps(self.card))
        self.archive = self.originals / "pack.unitypackage"
        write_package(self.archive)

    def tearDown(self):
        self.temp.cleanup()

    def test_apply_exits_nonzero_when_sources_are_unchecked(self):
        script = Path(__file__).with_name("backfill_pack_discovery.py")
        result = subprocess.run([sys.executable, "-I", str(script), "--root", str(self.root), "--only", "example-tavern", "--metadata-only", "--apply"], capture_output=True, text=True, check=False, timeout=120)
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn("scene-sources-not-scanned", json.loads(result.stdout)["missing"])

    def test_bundle_source_is_reported_and_does_not_create_empty_scenes(self):
        (self.pack / "pack.json").write_text(json.dumps({"versions": {"1": {"format": "bundle", "bundle": "shared@1"}}}))
        self.archive.unlink()
        result = mod.backfill(self.root, "example-tavern", {}, True)
        self.assertIn("bundle-source-not-scanned", result["missing"])
        updated = json.loads((self.pack / "collection.card.json").read_text())
        self.assertNotIn("scenes", updated)
        self.assertNotIn("prefabs", updated)

    def test_style_neutral_collection_does_not_require_visual_family(self):
        self.card.setdefault("describe", {})["style_family"] = "any"
        (self.pack / "collection.card.json").write_text(json.dumps(self.card))
        result = mod.backfill(self.root, "example-tavern", {}, metadata_only=True)
        self.assertIn("style_family", result["not_applicable"])
        self.assertNotIn("style_family", result["missing"])

    def test_settings_do_not_join_unrelated_names_or_match_inn_suffixes(self):
        self.assertEqual(mod.settings(["medieval", "village", "finn"]), [])
        self.assertEqual(mod.settings(["medieval-village", "the_inn"]), ["medieval-village", "tavern"])

    def test_dry_run_then_recover_without_touching_originals(self):
        original = self.archive.read_bytes()
        self.assertEqual(mod.backfill(self.root, "example-tavern", {"example-tavern": "detailed-low-poly"})["scenes"], 1)
        self.assertEqual(json.loads((self.pack / "collection.card.json").read_text()), self.card)
        result = mod.backfill(self.root, "example-tavern", {"example-tavern": "detailed-low-poly"}, True)
        self.assertTrue(result["applied"])
        card = json.loads((self.pack / "collection.card.json").read_text())
        self.assertEqual(card["cameras"], mod.CAMERAS)
        self.assertEqual(card["style_family"], "detailed-low-poly")
        self.assertEqual(card["settings"], ["tavern"])
        scene = card["scenes"][0]
        self.assertEqual((self.root / scene["path"]).read_bytes(), b"scene")
        self.assertEqual((self.root / (scene["path"] + ".meta")).read_bytes(), b"guid: " + b"a" * 32)
        self.assertIsNone(scene["preview"])
        self.assertEqual(self.archive.read_bytes(), original)
        repeated = mod.backfill(self.root, "example-tavern", {}, True)
        self.assertTrue(repeated["applied"])
        self.assertEqual(len(json.loads((self.pack / "collection.card.json").read_text())["scenes"]), 1)

    def test_rejects_mismatched_sidecar_before_publication(self):
        write_package(self.archive, sidecar_content=b"guid: " + b"b" * 32)
        with self.assertRaisesRegex(ValueError, "sidecar GUID"):
            mod.backfill(self.root, "example-tavern", {}, True)
        self.assertFalse((self.pack / "1" / "discovery-sources").exists())
        self.assertEqual(json.loads((self.pack / "collection.card.json").read_text()), self.card)

    def test_rejects_ambiguous_mixed_line_endings_before_publication(self):
        write_package(self.archive, sidecar_content=b"guid: " + b"b" * 32 + b"\rignored\nguid: " + b"a" * 32)
        with self.assertRaisesRegex(ValueError, "sidecar GUID"):
            mod.backfill(self.root, "example-tavern", {}, True)
        self.assertFalse((self.pack / "1" / "discovery-sources").exists())
        self.assertEqual(json.loads((self.pack / "collection.card.json").read_text()), self.card)

    def test_retries_recovered_sources_without_sidecars(self):
        write_package(self.archive, sidecar=False)
        mod.backfill(self.root, "example-tavern", {}, True)
        first = json.loads((self.pack / "collection.card.json").read_text())
        mod.backfill(self.root, "example-tavern", {}, True)
        second = json.loads((self.pack / "collection.card.json").read_text())
        self.assertEqual(second["scenes"], first["scenes"])
        self.assertEqual(len(second["scenes"]), 1)

    def test_retries_after_source_publication_before_card_write(self):
        write_package(self.archive, sidecar=False)
        stale_stage = self.pack / "1" / ".discovery-stage-stale"
        stale_stage.mkdir()
        (stale_stage / "partial").write_text("leave untouched")
        destination = self.pack / "1" / "discovery-sources" / "0"
        mod.recover(self.archive, mod.unity_sources(self.archive), destination)
        mod.backfill(self.root, "example-tavern", {}, True)
        card = json.loads((self.pack / "collection.card.json").read_text())
        self.assertEqual(len(card["scenes"]), 1)
        self.assertEqual((self.root / card["scenes"][0]["path"]).read_bytes(), b"scene")
        self.assertEqual((stale_stage / "partial").read_text(), "leave untouched")

    def test_audio_only_pack_does_not_claim_missing_camera_or_visual_style(self):
        self.archive.unlink()
        self.card["collection_info"]["counts"] = {"audio": 2, "audio/sfx/other": 2}
        (self.pack / "collection.card.json").write_text(json.dumps(self.card))
        result = mod.backfill(self.root, "example-tavern", {}, False)
        self.assertEqual(result["not_applicable"], ["style_family", "cameras"])
        self.assertNotIn("style_family", result["missing"])
        self.assertNotIn("cameras", result["missing"])

    def test_reviewed_classification_is_validated_and_applied(self):
        families = {"some-pack": "detailed-low-poly"}
        classification = {"style_family": "detailed-low-poly", "cameras": ["first-person"]}
        mod.backfill(self.root, "example-tavern", families, True, classification, True)
        metadata_only = json.loads((self.pack / "collection.card.json").read_text())
        self.assertNotIn("scenes", metadata_only)
        mod.backfill(self.root, "example-tavern", families, True, classification)
        card = json.loads((self.pack / "collection.card.json").read_text())
        self.assertEqual(card["style_family"], "detailed-low-poly")
        self.assertEqual(card["cameras"], ["first-person"])
        revised = {"style_family": "detailed-low-poly", "cameras": ["side"]}
        mod.backfill(self.root, "example-tavern", families, True, revised, True)
        card = json.loads((self.pack / "collection.card.json").read_text())
        self.assertEqual(card["cameras"], ["side"])
        self.assertEqual(len(card["scenes"]), 1)
        with self.assertRaisesRegex(ValueError, "unknown style family"):
            mod.backfill(self.root, "example-tavern", families, False, {"style_family": "invented"})
        with self.assertRaisesRegex(ValueError, "invalid or duplicate cameras"):
            mod.backfill(self.root, "example-tavern", families, False, {"cameras": ["invented"]})
        with self.assertRaisesRegex(ValueError, "unknown style family"):
            mod.backfill(self.root, "example-tavern", families, False, {"style_family": []})

    def test_backfill_merges_new_settings_and_respects_locked_settings(self):
        self.card["settings"] = []
        (self.pack / "collection.card.json").write_text(json.dumps(self.card))
        mod.backfill(self.root, "example-tavern", {}, True)
        card = json.loads((self.pack / "collection.card.json").read_text())
        self.assertEqual(card["settings"], ["tavern"])
        self.archive.unlink()
        card["settings"] = []
        card.setdefault("provenance", {})["settings"] = {"by": "human", "at": "2026-11-01T00:00:00Z", "locked": True}
        (self.pack / "collection.card.json").write_text(json.dumps(card))
        mod.backfill(self.root, "example-tavern", {}, True)
        self.assertEqual(json.loads((self.pack / "collection.card.json").read_text())["settings"], [])

    def test_backfill_keeps_existing_matching_scene_and_preview_without_duplicate(self):
        extracted = self.pack / "1" / "extracted" / "wrapped" / "Tavern"
        extracted.mkdir(parents=True)
        (extracted / "Demo.unity").write_bytes(b"scene")
        (extracted / "Demo.unity.meta").write_text("guid: " + "a" * 32)
        scene_path = "packs/example-tavern/1/extracted/wrapped/Tavern/Demo.unity"
        self.card["scenes"] = [{"path": scene_path, "engine": "unity", "settings": ["tavern"], "preview": "previews/demo.webp"}]
        (self.pack / "collection.card.json").write_text(json.dumps(self.card))
        mod.backfill(self.root, "example-tavern", {}, True)
        card = json.loads((self.pack / "collection.card.json").read_text())
        self.assertEqual(card["scenes"], self.card["scenes"])
        self.assertFalse((self.pack / "1" / "discovery-sources").exists())
        (extracted / "Demo.unity.meta").write_text("guid: " + "b" * 32)
        mod.backfill(self.root, "example-tavern", {}, True)
        card = json.loads((self.pack / "collection.card.json").read_text())
        self.assertEqual(len(card["scenes"]), 2)
        recovered = next(scene for scene in card["scenes"] if "discovery-sources" in scene["path"])
        self.assertEqual((self.root / recovered["path"]).read_bytes(), b"scene")

    def test_existing_glb_scene_and_unscanned_archives_are_reported(self):
        self.archive.unlink()
        extracted = self.pack / "1" / "extracted" / "scenes"
        extracted.mkdir(parents=True)
        (extracted / "castle.glb").write_bytes(b"glTF")
        (extracted / "forest.umap").write_bytes(b"unreal")
        (self.originals / "unknown.zip").write_bytes(b"unscanned")
        result = mod.backfill(self.root, "example-tavern", {}, True)
        self.assertIn("unscanned-archives", result["missing"])
        card = json.loads((self.pack / "collection.card.json").read_text())
        self.assertEqual(card["scenes"][0]["engine"], "glb")
        self.assertEqual(card["scenes"][0]["settings"], ["tavern", "castle"])
        self.assertTrue((self.root / card["scenes"][0]["path"]).is_file())
        self.assertEqual(card["scenes"][1]["engine"], "unreal")
        self.assertEqual(card["scenes"][1]["settings"], ["tavern", "forest"])

    def test_tier_two_leaves_scene_sources_for_rights_review(self):
        self.card["id"] = "t2:example-tavern@1"
        (self.pack / "collection.card.json").write_text(json.dumps(self.card))
        result = mod.backfill(self.root, "example-tavern", {}, True)
        self.assertIn("per-file-rights", result["missing"])
        card = json.loads((self.pack / "collection.card.json").read_text())
        self.assertNotIn("scenes", card)
        self.assertFalse((self.pack / "1" / "discovery-sources").exists())

    def test_wildcard_lock_preserves_metadata_and_skips_recovery(self):
        self.card["provenance"]["*"] = {"by": "human", "at": "2026-11-01T00:00:00Z", "locked": True}
        (self.pack / "collection.card.json").write_text(json.dumps(self.card))
        mod.backfill(self.root, "example-tavern", {"example-tavern": "detailed-low-poly"}, True)
        self.assertEqual(json.loads((self.pack / "collection.card.json").read_text()), self.card)
        self.assertFalse((self.pack / "1" / "discovery-sources").exists())

    def test_curated_set_perspective_supplies_cameras(self):
        registry = Path(__file__).resolve().parents[2] / "packages/asset-cards/data/style-families.json"
        perspectives = mod.perspective_map(registry)
        self.assertEqual(perspectives["limezu-modern-interiors"], ["top-down"])
        self.archive.unlink()
        self.card["collection_info"]["counts"] = {}
        self.card.get("describe", {}).pop("pov_fit", None)
        (self.pack / "collection.card.json").write_text(json.dumps(self.card))
        mod.backfill(self.root, "example-tavern", {}, True, perspectives={"example-tavern": ["top-down"]})
        card = json.loads((self.pack / "collection.card.json").read_text())
        self.assertEqual(card["cameras"], ["top-down"])

    def test_legacy_camera_evidence_includes_first_and_third_person(self):
        self.archive.unlink()
        self.card["collection_info"]["counts"] = {}
        self.card.setdefault("describe", {})["pov_fit"] = ["fps", "follow"]
        (self.pack / "collection.card.json").write_text(json.dumps(self.card))
        mod.backfill(self.root, "example-tavern", {}, True)
        card = json.loads((self.pack / "collection.card.json").read_text())
        self.assertEqual(card["cameras"], ["third-person", "first-person"])

    def test_concurrent_edit_during_validation_is_not_overwritten(self):
        edited = dict(self.card, title="Edited during validation")
        def change_card(*_args, **_kwargs):
            (self.pack / "collection.card.json").write_text(json.dumps(edited))
            return mock.Mock(returncode=0, stderr="", stdout="")
        with mock.patch.object(mod.subprocess, "run", side_effect=change_card):
            with self.assertRaisesRegex(ValueError, "card changed"):
                mod.backfill(self.root, "example-tavern", {}, True)
        self.assertEqual(json.loads((self.pack / "collection.card.json").read_text()), edited)
        self.assertFalse((self.pack / "1" / "discovery-sources").exists())

    def test_validation_failure_restores_card_and_removes_recovered_files(self):
        failure = mock.Mock(returncode=1, stderr="invalid card", stdout="")
        with mock.patch.object(mod.subprocess, "run", return_value=failure):
            with self.assertRaisesRegex(ValueError, "card validation failed"):
                mod.backfill(self.root, "example-tavern", {}, True)
        self.assertEqual(json.loads((self.pack / "collection.card.json").read_text()), self.card)
        self.assertFalse((self.pack / "1" / "discovery-sources").exists())

    def test_rejects_control_characters_and_compression_bombs(self):
        write_package(self.archive, "Assets/\x1b]52;bad.unity")
        with self.assertRaisesRegex(ValueError, "unsafe Unity pathname"):
            mod.backfill(self.root, "example-tavern", {}, True)
        write_package(self.archive, content=b"0" * (2 * 1024 * 1024))
        with self.assertRaisesRegex(ValueError, "compression-ratio"):
            mod.backfill(self.root, "example-tavern", {}, True)
        self.assertFalse((self.pack / "1" / "discovery-sources").exists())

    def test_rejects_archives_over_the_size_limit(self):
        with mock.patch.object(mod, "MAX_TOTAL", 1):
            with self.assertRaisesRegex(ValueError, "size limit"):
                mod.backfill(self.root, "example-tavern", {}, True)
        self.assertFalse((self.pack / "1" / "discovery-sources").exists())

    def test_rejects_unsafe_path_and_executable_without_writing_card(self):
        write_package(self.archive, "../escape.unity")
        with self.assertRaises(ValueError):
            mod.backfill(self.root, "example-tavern", {}, True)
        write_package(self.archive, content=b"MZbinary")
        with self.assertRaises(ValueError):
            mod.backfill(self.root, "example-tavern", {}, True)
        self.assertEqual(json.loads((self.pack / "collection.card.json").read_text()), self.card)
        self.assertFalse((self.pack / "1" / "discovery-sources").exists())


if __name__ == "__main__":
    unittest.main()
