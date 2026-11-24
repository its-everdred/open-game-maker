"""Synthetic coverage for the SmallScaleInt asset-card reader.

Run: python3 -I scripts/assets/test_smallscaleint.py -v
"""

import binascii
import io
import json
import subprocess
import struct
import sys
import tarfile
import tempfile
import unittest
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import smallscaleint as ssi  # noqa: E402
import smallscaleint_unity as ssiu  # noqa: E402


def png(width: int, height: int) -> bytes:
    """A small valid transparent RGBA PNG with the requested dimensions."""

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", binascii.crc32(kind + data) & 0xFFFFFFFF)

    rows = b"".join(b"\0" + b"\0" * (width * 4) for _ in range(height))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)) + chunk(
        b"IDAT", zlib.compress(rows)
    ) + chunk(b"IEND", b"")


def write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def collection(pid: str, world: str = "fantasy") -> dict:
    return {
        "schema": "ogm.asset-card/1.0",
        "vocab": "2026-10-27",
        "id": f"t1:{pid}@1.0",
        "card_type": "collection",
        "status": "draft",
        "title": pid,
        "license": "LicenseRef-smallscaleint-itch",
        "rights": {
            "uses": ["in-game", "placeholder", "style-reference", "vision-input"],
            "audience": "private",
            "redistribution": "in-build",
            "attribution": None,
            "processing": "local-only",
            "basis": [],
        },
        "describe": {"style_family": "isometric-2d", "set": "smallscaleint", "world": world},
        "collection_info": {"vendor": "smallscaleint", "version": "1.0", "origin": "vendor-pack", "counts": {}, "creation_choice": False, "pack_manifest": f"assets-local/packs/{pid}/pack.json", "files_total": 0},
        "provenance": {"*": {"by": "code", "tool": "test"}},
    }


class Reader(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.pack = self.root / "packs" / "smallscaleint-2d-character-knight"
        self.ext = self.pack / "1.0" / "extracted"

    def tearDown(self):
        self.tmp.cleanup()

    def test_collection_previews_reference_local_outputs_and_verified_store_fallback(self):
        store = self.pack / "store"
        store.mkdir(parents=True)
        (store / "fallback.gif").write_bytes(b"GIF89a")
        (store / "media.json").write_text(json.dumps({
            "pack_id": self.pack.name,
            "media": [{"path": "fallback.gif"}],
            "selected_fallback": "fallback.gif",
        }))
        card = collection(self.pack.name)
        ssi.decorate_collection(card, self.pack.name, self.pack)
        self.assertEqual(card["previews"], {
            "specimen": f"packs/{self.pack.name}/specimen.png",
            "diorama": "sets/smallscaleint/diorama.fantasy.256.png",
            "loop": "sets/smallscaleint/diorama.fantasy.256.gif",
            "store": f"packs/{self.pack.name}/store/fallback.gif",
        })
        self.assertEqual(card["provenance"]["previews.store"]["by"], "vendor-metadata")

    def test_collection_store_fallback_rejects_traversal_and_missing_files(self):
        store = self.pack / "store"
        store.mkdir(parents=True)
        outside = self.pack / "outside.gif"
        outside.write_bytes(b"GIF89a")
        manifest = {
            "pack_id": self.pack.name,
            "media": [{"path": "../outside.gif"}],
            "selected_fallback": "../outside.gif",
        }
        (store / "media.json").write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, "invalid store media manifest"):
            ssi.decorate_collection(collection(self.pack.name), self.pack.name, self.pack)

        manifest["media"] = [{"path": "missing.gif"}]
        manifest["selected_fallback"] = "missing.gif"
        (store / "media.json").write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, "invalid store media manifest"):
            ssi.decorate_collection(collection(self.pack.name), self.pack.name, self.pack)

    def test_all_27_imported_packs_have_one_of_the_three_worlds(self):
        self.assertEqual(len(ssi.PACKS), 27)
        self.assertEqual({ssi.world_for(pack) for pack in ssi.PACKS}, {"fantasy", "modern-zombie", "creatures"})
        self.assertEqual(sum(ssi.world_for(pack) == "creatures" for pack in ssi.PACKS), 1)

    def test_character_actions_use_measured_sheet_order_and_merge_shadow_variants(self):
        for action, frames in (("Attack", 2), ("Idle", 1)):
            for direction in ssi.DIRECTIONS:
                for frame in range(frames):
                    write(self.ext / "Knight" / action / direction / f"{frame}.png", png(64, 64))
            write(self.ext / "Spritesheets" / "Shadowless" / "Knight" / f"{action}_Shadowless.png", png(64 * frames, 64 * 8))
            write(self.ext / "Spritesheets" / "With shadows" / "Knight" / f"{action}.png", png(64 * frames, 64 * 8))
        (self.ext / "Knight" / "Attack.anim").write_text("m_SampleRate: 12\n")

        cards = ssi.build_cards(self.pack, collection(self.pack.name))
        self.assertEqual([(card["subkind"], card["title"]) for card in cards], [("character", "Knight")])
        actions = {action["name"]: action for action in cards[0]["sprite"]["animations"]}
        self.assertEqual(actions["attack"]["directions"], ["E", "SE", "S", "SW", "W", "NW", "N", "NE"])
        self.assertEqual(cards[0]["sprite"]["directions"], ["E", "SE", "S", "SW", "W", "NW", "N", "NE"])
        self.assertEqual((actions["attack"]["frames"], actions["attack"]["fps"]), ([0, 1], 12))
        self.assertEqual(actions["idle"]["fps"], 12)
        self.assertEqual(
            [(sheet["variant"], sheet["cols"], sheet["rows"], sheet["frame_w"], sheet["frame_h"]) for sheet in actions["attack"]["sheets"]],
            [("shadow", 2, 8, 64, 64), ("shadowless", 2, 8, 64, 64)],
        )
        self.assertEqual(set(actions), {"attack", "idle"})
        self.assertTrue(all("/Knight/Attack/" not in file["path"] for file in cards[0]["source"]["files"]))
        self.assertFalse(any("/sequences/spritesheets-" in card["id"] for card in cards))

    def test_measured_sheet_layouts_become_characters(self):
        fixtures = {
            "smallscaleint-fantasy-tileset-2d-isometric": {
                "Characters/Player/Walk.png": png(128 * 2, 128 * 8),
            },
            "smallscaleint-2d-demons-topdown-assetpack": {
                "Combined/Demon/Attack 1.png": png(64 * 3, 64),
            },
            "smallscaleint-2d-zombie-pack-2-top-down": {
                "Zombies with shadow/Zombie Cop 01/Walk.png": png(64 * 3, 64),
                "Zombies shadowless/Zombie Cop 01/Walk_Shadowless.png": png(64 * 3, 64),
            },
            "smallscaleint-2d-character-knight": {
                "Spritesheets/With Shadow/Attack.png": png(64 * 2, 64 * 8),
                "Spritesheets/Shadowless/Attack_Shadowless.png": png(64 * 2, 64 * 8),
            },
            "smallscaleint-free-character-16-bit-thug-outlined": {
                "Walk.png": png(64 * 2, 64 * 8),
            },
            "smallscaleint-knight-demo-character": {
                "Knight Character HD Version/Walk.png": png(128 * 2, 128 * 8),
            },
        }
        for pid, files in fixtures.items():
            with self.subTest(pid=pid):
                pack = self.root / "packs" / pid
                for rel, data in files.items():
                    write(pack / "1.0" / "extracted" / rel, data)
                cards = ssi.build_cards(pack, collection(pid))
                characters = [card for card in cards if card["subkind"] == "character"]
                self.assertEqual(len(characters), 1)
                animation = characters[0]["sprite"]["animations"][0]
                self.assertEqual(animation["fps"], 12)
                is_topdown = "topdown" in pid or "top-down" in pid
                self.assertEqual(animation["sheets"][0]["rows"], 1 if is_topdown else 8)
                if is_topdown:
                    self.assertNotIn("directions", characters[0]["sprite"])
                else:
                    self.assertEqual(characters[0]["sprite"]["directions"], list(ssi.SHEET_DIRECTIONS))

    def test_root_action_archer_is_a_character_but_projectile_packs_are_not(self):
        archer = self.root / "packs" / "smallscaleint-2d-topdown-archer-character"
        for direction in ssi.DIRECTIONS:
            for frame in range(2):
                write(archer / "1.0" / "extracted" / "Attack" / direction / f"{frame}.png", png(64, 64))
        cards = ssi.build_cards(archer, collection(archer.name))
        character = self.assert_single_character(cards)
        self.assertEqual(character["title"], "Archer")
        self.assertEqual(character["sprite"]["animations"][0]["fps"], 12)

        projectiles = self.root / "packs" / "smallscaleint-2d-projectiles-character-pack-1"
        for frame in range(3):
            write(projectiles / "1.0" / "extracted" / "Arrows" / f"Arrow{frame}.png", png(32, 32))
        cards = ssi.build_cards(projectiles, collection(projectiles.name))
        self.assertFalse(any(card["subkind"] == "character" for card in cards))
        self.assertTrue(all(animation["fps"] == 12 for card in cards for animation in card["sprite"].get("animations", [])))

    def assert_single_character(self, cards: list[dict]) -> dict:
        characters = [card for card in cards if card["subkind"] == "character"]
        self.assertEqual(len(characters), 1)
        return characters[0]

    def test_tiles_effects_and_projectiles_are_grouped_not_emitted_per_frame(self):
        self.pack = self.root / "packs" / "smallscaleint-2d-desert-fantasy-tileset"
        self.ext = self.pack / "1.0" / "extracted"
        for direction in ("E", "N", "S", "W"):
            write(self.ext / "Environment" / "Sprites" / f"Desert Chest_{direction}.png", png(256, 256))
        for frame in range(3):
            write(self.ext / "Animations" / "Effects" / "Dust" / f"{frame:02}.png", png(128, 128))
            write(self.ext / "Projectiles" / "Arrow" / f"{frame:02}.png", png(64, 64))
        (self.ext / "Animations" / "Effects" / "Dust.anim").write_text("m_SampleRate: 8\n")

        cards = ssi.build_cards(self.pack, collection(self.pack.name))
        by_title = {card["title"]: card for card in cards}
        self.assertEqual(set(by_title), {"Arrow", "Desert Chest", "Dust"})
        self.assertEqual(by_title["Desert Chest"]["sprite"]["facings"], {
            direction: f"Environment/Sprites/Desert Chest_{direction}.png" for direction in ("E", "N", "S", "W")
        })
        self.assertEqual(by_title["Desert Chest"]["sprite"]["directions"], ["E", "N", "S", "W"])
        self.assertEqual(by_title["Dust"]["sprite"]["animations"][0]["fps"], 8)
        self.assertEqual(len(by_title["Arrow"]["sprite"]["animations"][0]["files"]), 3)
        self.assertEqual(len(cards), 3)

    def test_partial_direction_groups_remain_available_as_sequences(self):
        for direction in ("E", "N"):
            for frame in range(2):
                write(self.ext / "Knight" / "Wave" / direction / f"{frame}.png", png(64, 64))

        cards = ssi.build_cards(self.pack, collection(self.pack.name))
        source_paths = {file["path"] for card in cards for file in card["source"]["files"]}
        self.assertEqual(source_paths, {
            f"Knight/Wave/{direction}/{frame}.png" for direction in ("E", "N") for frame in range(2)
        })

    def test_contact_sheets_use_south_first_frames_and_world_lineups(self):
        for action in ("Attack", "Idle"):
            write(self.ext / "Knight" / action / "S" / "0.png", png(64, 64))
            write(self.ext / "Spritesheets" / "Shadowless" / "Knight" / f"{action}.png", png(64, 512))
        cards = ssi.build_cards(self.pack, collection(self.pack.name))
        pages = ssi.write_contact_sheets(self.root, {self.pack.name: collection(self.pack.name)}, {self.pack.name: cards})
        character = self.root / "sets" / "smallscaleint" / "sheets" / "characters" / f"{self.pack.name}-knight.html"
        lineup = self.root / "sets" / "smallscaleint" / "sheets" / "worlds" / "fantasy.html"
        self.assertIn(character, pages)
        self.assertIn("Knight/Attack/S/0.png", character.read_text())
        self.assertIn("Knight", lineup.read_text())
        stale = self.root / "sets" / "smallscaleint" / "sheets" / "stale.html"
        stale.write_text("old output")
        ssi.write_contact_sheets(self.root, {self.pack.name: collection(self.pack.name)}, {self.pack.name: cards})
        self.assertFalse(stale.exists())

    def test_item_card_write_is_stable_when_only_provenance_time_changes(self):
        for direction in ssi.DIRECTIONS:
            write(self.ext / "Knight" / "Idle" / direction / "0.png", png(64, 64))
        write(self.ext / "Spritesheets" / "Shadowless" / "Knight" / "Idle.png", png(64, 512))
        cards = ssi.build_cards(self.pack, collection(self.pack.name))
        self.assertEqual(ssi.write_cards(self.pack, cards), 1)
        target = next((self.pack / "cards").rglob("*.card.json"))
        before = target.read_bytes()
        original_now = ssi.NOW
        try:
            ssi.NOW = "2099-01-01T00:00:00+00:00"
            rebuilt = ssi.build_cards(self.pack, collection(self.pack.name))
            self.assertEqual(ssi.write_cards(self.pack, rebuilt), 0)
        finally:
            ssi.NOW = original_now
        self.assertEqual(target.read_bytes(), before)


class UnityPackage(unittest.TestCase):
    @staticmethod
    def add_member(archive: tarfile.TarFile, name: str, data: bytes) -> None:
        info = tarfile.TarInfo(name)
        info.size = len(data)
        archive.addfile(info, io.BytesIO(data))

    @staticmethod
    def package(path: Path, pathname: str, asset: bytes = b"sprite", extra: tuple[str, bytes] | None = None) -> None:
        with tarfile.open(path, "w:gz") as archive:
            for name, data in (("guid/asset", asset), ("guid/pathname", pathname.encode()), ("guid/asset.meta", b"m_SortingOrder: 7\n")):
                UnityPackage.add_member(archive, name, data)
            if extra:
                UnityPackage.add_member(archive, *extra)

    def test_extracts_layers_and_records_unity_sorting_order(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            package = tmp / "creator.unitypackage"
            self.package(package, "Assets/Creator/Body.png")
            dest = tmp / "pack"
            manifest = ssi.extract_unitypackage(package, dest)
            self.assertEqual((dest / "1.0" / "extracted" / "Assets" / "Creator" / "Body.png").read_bytes(), b"sprite")
            self.assertEqual(manifest["layers"][0]["order"], 7)
            self.assertEqual(json.loads((dest / "layer-order.json").read_text()), manifest)

    def test_modern_creator_manifest_records_the_hand_written_part_order(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            package = tmp / "modern.unitypackage"
            self.package(package, "Assets/Spritesheets/NakedBody/Idle.png")
            manifest = ssi.extract_unitypackage(package, tmp / "modern-pack", "modern-zombie")
            self.assertEqual(
                manifest["part_order"],
                [
                    "Shadow", "NakedBody", "Legs", "Shoes", "Chest", "Head", "Bag", "Mount",
                    "Shield", "Melee", "Pistol", "Shotgun", "Sniper", "MachineGun", "Special", "GunFire",
                ],
            )

    def test_fantasy_creator_manifest_records_the_combine_order_so_composites_match_the_creator(self):
        # Shoes go under Legs and Head over the weapon in the Fantasy creator; the modern order would draw boots over
        # trousers and helmets under axes.
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            package = tmp / "fantasy.unitypackage"
            self.package(package, "Assets/Spritesheets/NakedBody/Idle.png")
            order = ssi.extract_unitypackage(package, tmp / "fantasy-pack", "fantasy")["part_order"]
            self.assertLess(order.index("Shoes"), order.index("Legs"))
            self.assertLess(order.index("Melee"), order.index("Head"))
            self.assertEqual(order[:2], ["Shadow", "NakedBody"])

    def test_member_limit_covers_the_measured_fantasy_archive_and_remains_enforced(self):
        self.assertGreaterEqual(ssiu.MAX_UNITY_MEMBERS, 157_266)
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            package = tmp / "members.unitypackage"
            self.package(package, "Assets/Creator/Body.png")
            old_limit = ssiu.MAX_UNITY_MEMBERS
            try:
                ssiu.MAX_UNITY_MEMBERS = 2
                with self.assertRaisesRegex(ValueError, "safe extraction limits"):
                    ssi.extract_unitypackage(package, tmp / "limited-pack")
            finally:
                ssiu.MAX_UNITY_MEMBERS = old_limit
            self.assertFalse((tmp / "limited-pack").exists())

    def test_cli_help_runs_in_isolated_mode(self):
        result = subprocess.run(
            [sys.executable, "-I", str(HERE / "smallscaleint.py"), "--help"],
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("extract-unity", result.stdout)

    def test_rejects_traversal_without_installing_a_partial_destination(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            package = tmp / "bad.unitypackage"
            self.package(package, "../../outside.png")
            dest = tmp / "pack"
            with self.assertRaises(ValueError):
                ssi.extract_unitypackage(package, dest)
            self.assertFalse(dest.exists())
            self.assertFalse((tmp / "outside.png").exists())

    def test_rejects_duplicate_output_paths_from_different_guids(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            package = tmp / "duplicate.unitypackage"
            with tarfile.open(package, "w:gz") as archive:
                for guid in ("first", "second"):
                    self.add_member(archive, f"{guid}/asset", guid.encode())
                    self.add_member(archive, f"{guid}/pathname", b"Assets/Creator/Body.png")
            dest = tmp / "pack"
            with self.assertRaisesRegex(ValueError, "duplicate Unity pathname"):
                ssi.extract_unitypackage(package, dest)
            self.assertFalse(dest.exists())

    def test_rejects_links_and_declared_bytes_over_the_limit(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            linked = tmp / "linked.unitypackage"
            with tarfile.open(linked, "w:gz") as archive:
                info = tarfile.TarInfo("guid/asset")
                info.type = tarfile.SYMTYPE
                info.linkname = "../../outside"
                archive.addfile(info)
            with self.assertRaisesRegex(ValueError, "unsupported Unity member"):
                ssi.extract_unitypackage(linked, tmp / "linked-pack")

            oversized = tmp / "oversized.unitypackage"
            self.package(oversized, "Assets/Creator/Body.png")
            old_limit = ssiu.MAX_UNITY_BYTES
            try:
                ssiu.MAX_UNITY_BYTES = 1
                with self.assertRaisesRegex(ValueError, "safe extraction limits"):
                    ssi.extract_unitypackage(oversized, tmp / "oversized-pack")
            finally:
                ssiu.MAX_UNITY_BYTES = old_limit


if __name__ == "__main__":
    unittest.main()
