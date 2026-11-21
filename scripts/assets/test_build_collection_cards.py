"""Tests for build_collection_cards.py and install_itch_pack.py over a temp library (one pack per vendor class).

Needs the contracts validator built: pnpm --filter @ogm/contracts build.
Run: python3 -I scripts/assets/test_build_collection_cards.py
"""
import json
import subprocess
import sys
import tempfile
import time
import unittest
import zipfile
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "py" / "audio"))
import build_collection_cards as bcc  # noqa: E402
import import_sidetrax  # noqa: E402
import install_itch_pack  # noqa: E402
import test_smallscaleint  # noqa: E402

KENNEY = "kenney-1-bit-pack"  # ids with rows in data/collection_tags.jsonl
SYNTY = "synty-animation-goblin-locomotion"
png = test_smallscaleint.png


def add_pack(root: Path, pid: str, vendor: str, license: str, files: dict, ver: str = "1.0") -> Path:
    d = root / "packs" / pid
    for name, data in files.items():
        f = d / ver / "extracted" / name
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(data)
    m = {"id": pid, "vendor": vendor, "title": pid.split("-", 1)[1].replace("-", " ").title(), "license": license,
         "requires": [], "current": ver, "versions": {ver: {"extracted_files": len(files), "added": "2026-10-30"}}}
    (d / "pack.json").write_text(json.dumps(m))
    return d


def card_of(root: Path, pid: str) -> dict:
    return json.loads((root / "packs" / pid / "collection.card.json").read_text())


def validator_ok(*files: Path) -> bool:
    r = subprocess.run(["node", str(bcc.VALIDATOR), "--no-fixtures", *map(str, files)], capture_output=True, text=True)
    return r.returncode == 0 and "all checks passed" in r.stdout


class Library(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        add_pack(self.root, KENNEY, "kenney", "CC0-1.0", {"Tiles/a.png": b"p", "License.txt": b"cc0"})
        add_pack(self.root, SYNTY, "synty", "synty-personal", {"Anim/run.fbx": b"f"}, ver="v1")
        add_pack(self.root, "limezu-test-pack", "limezu", "LimeZu-commercial", {"a.png": b"p"}, ver="2026-10-30")
        add_pack(self.root, "smallscaleint-2d-character-knight", "smallscaleint", "smallscaleint-itch", {
            **{f"Knight/Attack/{direction}/{frame}.png": png(64, 64) for direction in ("E", "N", "NE", "NW", "S", "SE", "SW", "W") for frame in range(2)},
            "Spritesheets/Shadowless/Knight/Attack.png": png(128, 512),
            "Spritesheets/With shadow/Knight/Attack.png": png(128, 512),
        })
        add_pack(self.root, "kaykit-adventurers", "kaykit", "kaykit", {"Models/gltf/Barrel.gltf": b"{}", "License.txt": b"cc0"}, ver="1.0")
        side = add_pack(self.root, "sidetrax-pack-60-battle", "sidetrax", "sidetrax-royalty-free", {"Charge.wav": b"RIFF"}, ver="v1")
        (side / "collection.card.json").write_text(json.dumps(import_sidetrax.draft_card("sidetrax-pack-60-battle", "Pack 60: Battle", 1, True)))

    def tearDown(self):
        self.tmp.cleanup()

    def test_unconfirmed_drop_licenses_keep_strict_rights(self):
        for vendor, licence in [('caseportman', 'caseportman-royalty-free'), ('tinyrpg', 'unknown-itch-free')]:
            pid = vendor + '-test'
            add_pack(self.root, pid, vendor, licence, {'sample.png': png(1, 1)})
            self.assertEqual(bcc.run(self.root, only=pid)['failures'], {})
            rights = card_of(self.root, pid)['rights']
            self.assertEqual(rights['uses'], ['vision-input'])
            self.assertEqual(rights['audience'], 'private')
            self.assertEqual(rights['redistribution'], 'none')
            self.assertEqual(rights['processing'], 'local-only')

    def test_rebuild_keeps_only_matching_licence_confirmation(self):
        pid = 'caseportman-test'
        pack = add_pack(self.root, pid, 'caseportman', 'caseportman-royalty-free', {'sample.png': png(1, 1)})
        self.assertEqual(bcc.run(self.root, only=pid)['failures'], {})
        card = card_of(self.root, pid)
        licence = card['rights']['basis'][0]
        licence['confirmed_by'] = 'kevin'
        card['rights']['basis'] = [licence]
        (pack / 'collection.card.json').write_text(json.dumps(card))
        self.assertEqual(bcc.run(self.root, only=pid)['failures'], {})
        self.assertEqual(card_of(self.root, pid)['rights']['audience'], 'public')
        self.assertIn('confirmed 2026-10-30 (prior collection)', card_of(self.root, pid)['provenance']['rights']['input'])
        manifest = json.loads((pack / 'pack.json').read_text())
        manifest['current'] = '2.0'
        manifest['versions']['2.0'] = manifest['versions']['1.0']
        (pack / 'pack.json').write_text(json.dumps(manifest))
        self.assertEqual(bcc.run(self.root, only=pid)['failures'], {})
        self.assertEqual(card_of(self.root, pid)['rights']['audience'], 'private')
        manifest['current'] = '1.0'
        (pack / 'pack.json').write_text(json.dumps(manifest))
        # Restore the confirmed old version to check changed evidence separately.
        (pack / 'collection.card.json').write_text(json.dumps(card))
        card = card_of(self.root, pid)
        card['rights']['basis'][0]['ref'] = 'different-evidence.txt'
        (pack / 'collection.card.json').write_text(json.dumps(card))
        self.assertEqual(bcc.run(self.root, only=pid)['failures'], {})
        self.assertEqual(card_of(self.root, pid)['rights']['audience'], 'private')

    def test_tinyrpg_reader_measures_animation_strips(self):
        paths = {f'Characters(100x100 split)/Orc/Orc/Orc_{action}.png': png(frames * 100, 100)
                 for action, frames in [('Idle', 6), ('Walk', 8), ('Attack01', 6),
                                        ('Attack02', 6), ('Hurt', 4), ('Death', 4)]}
        paths['Characters(100x100 split)/Orc/Orc with shadows/Orc_Idle.png'] = png(600, 100)
        pack = add_pack(self.root, 'tinyrpg-characters-01-soldier-orc', 'tinyrpg', 'unknown-itch-free', paths)
        self.assertEqual(bcc.run(self.root, only=pack.name)['failures'], {})
        item, = (pack / 'cards').rglob('*.card.json')
        card = json.loads(item.read_text())
        self.assertTrue(validator_ok(item, pack / 'collection.card.json'))
        self.assertEqual(len(card['sprite']['animations'][1]['frames']), 8)
        self.assertEqual(len(card['sprite']['animations'][0]['sheets']), 2)

    def test_limezu_reader_writes_valid_item_cards_from_canonical_size(self):
        pack = add_pack(self.root, 'limezu-modern-farm', 'limezu', 'limezu-standard', {
            '32x32/Animated_32x32/Animated_sheets_32x32/Cow_32x32.png': png(32, 32),
            '16x16/Animated_16x16/Animated_sheets_16x16/Cow_16x16.png': png(16, 16),
        })
        report = bcc.run(self.root, only='limezu-modern-farm')
        self.assertEqual(report['failures'], {})
        cards = list((pack / 'cards').rglob('*.card.json'))
        self.assertEqual(len(cards), 1)
        self.assertTrue(validator_ok(cards[0], pack / 'collection.card.json'))
        self.assertEqual(len(json.loads(cards[0].read_text())['source']['files']), 2)

    def test_unrecognized_pack_contents_fail_without_replacing_existing_cards(self):
        pack = add_pack(self.root, 'limezu-modern-farm', 'limezu', 'limezu-standard', {
            'unexpected.png': png(32, 32),
        })
        report = bcc.run(self.root, only='limezu-modern-farm')
        self.assertIn('limezu-modern-farm', report['failures'])
        self.assertFalse((pack / 'collection.card.json').exists())

    def test_limezu_collection_records_compatible_collections(self):
        for peer in ('limezu-modern-interiors', 'limezu-modern-exteriors', 'limezu-modern-user-interface'):
            add_pack(self.root, peer, 'limezu', 'LimeZu-commercial', {'image.png': png(1, 1)})
        add_pack(self.root, 'limezu-modern-farm', 'limezu', 'limezu-standard', {
            '32x32/Animals_32x32/Cow_32x32.png': png(32, 32),
        })
        self.assertEqual(bcc.run(self.root, only='limezu-modern-farm')['failures'], {})
        card = card_of(self.root, 'limezu-modern-farm')
        self.assertEqual(card['describe']['set'], 'limezu-modern')
        self.assertEqual({r['id'] for r in card['related']}, {
            't1:limezu-modern-interiors@1.0', 't1:limezu-modern-exteriors@1.0',
            't1:limezu-modern-user-interface@1.0',
        })

    def test_limezu_item_preserves_a_locked_human_title(self):
        pack = add_pack(self.root, 'limezu-modern-farm', 'limezu', 'limezu-standard', {
            '32x32/Animated_32x32/Animated_sheets_32x32/Cow_32x32.png': png(32, 32),
        })
        self.assertEqual(bcc.run(self.root, only='limezu-modern-farm')['failures'], {})
        path = next((pack / 'cards').rglob('*.card.json'))
        card = json.loads(path.read_text())
        card['title'] = 'Curated cow'
        card['provenance']['title'] = {'by': 'human', 'locked': True, 'at': '2026-11-01T00:00:00Z'}
        path.write_text(json.dumps(card))
        self.assertEqual(bcc.run(self.root, only='limezu-modern-farm')['failures'], {})
        self.assertEqual(json.loads(path.read_text())['title'], 'Curated cow')

    def test_reader_refuses_to_delete_an_obsolete_locked_item(self):
        pack = add_pack(self.root, 'limezu-modern-farm', 'limezu', 'limezu-standard', {
            '32x32/Animated_32x32/Animated_sheets_32x32/Cow_32x32.png': png(32, 32),
        })
        self.assertEqual(bcc.run(self.root, only='limezu-modern-farm')['failures'], {})
        path = next((pack / 'cards').rglob('*.card.json'))
        card = json.loads(path.read_text())
        card['provenance']['title'] = {'by': 'human', 'locked': True, 'at': '2026-11-01T00:00:00Z'}
        obsolete = path.with_name('obsolete.card.json')
        obsolete.write_text(json.dumps(card))
        report = bcc.run(self.root, only='limezu-modern-farm')
        self.assertIn('limezu-modern-farm', report['failures'])
        self.assertTrue(obsolete.exists())

    def test_every_vendor_gets_a_valid_card_with_the_processing_default(self):
        """Packs the old script skipped (LimeZu) were invisible to search; vendor-licensed bytes must stay local."""
        rep = bcc.run(self.root)
        self.assertEqual(rep["failures"], {})
        pids = [KENNEY, SYNTY, "limezu-test-pack", "kaykit-adventurers", "sidetrax-pack-60-battle"]
        self.assertTrue(validator_ok(*(self.root / "packs" / p / "collection.card.json" for p in pids)))
        processing = {p: card_of(self.root, p)["rights"]["processing"] for p in pids}
        self.assertEqual(processing, {KENNEY: "any", SYNTY: "local-only", "limezu-test-pack": "local-only", "kaykit-adventurers": "any",
                                      "sidetrax-pack-60-battle": "local-only"})
        self.assertEqual(card_of(self.root, SYNTY)["license"], "LicenseRef-synty-personal")
        self.assertEqual(card_of(self.root, "kaykit-adventurers")["license"], "CC0-1.0")
        self.assertEqual(card_of(self.root, "kaykit-adventurers")["collection_info"]["counts"], {"model": 1})
        self.assertEqual(card_of(self.root, "kaykit-adventurers")["describe"]["style_family"], "chunky-low-poly")
        self.assertEqual(card_of(self.root, "kaykit-adventurers")["describe"]["set"], "kaykit")
        self.assertEqual(card_of(self.root, "kaykit-adventurers")["provenance"]["describe.style_family"]["by"], "code")
        self.assertEqual(card_of(self.root, KENNEY)["status"], "tagged")
        self.assertEqual(card_of(self.root, KENNEY)["describe"]["set"], "kenney-1-bit")
        set_provenance = card_of(self.root, KENNEY)["provenance"]["describe.set"]
        self.assertEqual(set_provenance["by"], "code")
        self.assertEqual(set_provenance["input"], "packages/asset-cards/data/style-families.json")

    def test_owner_confirmed_audio_licence_builds_a_private_local_collection_card(self):
        pack = add_pack(
            self.root,
            "drive-barbarian-chiptune",
            "kevin",
            "unknown-owned",
            {"01.wav": b"RIFF"},
            ver="v1",
        )

        report = bcc.run(self.root, only="drive-barbarian-chiptune")

        self.assertEqual(report["failures"], {})
        self.assertTrue(validator_ok(pack / "collection.card.json"))
        card = card_of(self.root, "drive-barbarian-chiptune")
        self.assertEqual(card["license"], "LicenseRef-kevin-owned")
        self.assertEqual(card["rights"]["audience"], "private")
        self.assertEqual(card["rights"]["redistribution"], "in-build")
        self.assertEqual(card["rights"]["processing"], "local-only")

    def test_untagged_pack_is_a_draft_seeded_from_its_title(self):
        """No describe tags are invented for packs the tags file does not cover."""
        bcc.run(self.root)
        c = card_of(self.root, "limezu-test-pack")
        self.assertEqual(c["status"], "draft")
        self.assertEqual(c["describe"], {"description": "Test Pack (Limezu)"})
        self.assertEqual(c["provenance"]["describe"]["by"], "filename")
        self.assertEqual(c["rights"]["attribution"], "LimeZu")

    def test_smallscaleint_pack_gets_world_and_one_semantic_character_card(self):
        rep = bcc.run(self.root)
        self.assertEqual(rep["failures"], {})
        pack = "smallscaleint-2d-character-knight"
        c = card_of(self.root, pack)
        self.assertEqual((c["describe"]["style_family"], c["describe"]["set"], c["describe"]["world"]),
                         ("isometric-2d", "smallscaleint", "fantasy"))
        cards = list((self.root / "packs" / pack / "cards").rglob("*.card.json"))
        self.assertEqual(len(cards), 1)
        item = json.loads(cards[0].read_text())
        self.assertEqual((item["subkind"], [a["name"] for a in item["sprite"]["animations"]]),
                         ("character", ["attack"]))
        self.assertRegex(item["previews"]["thumb"], r"^private/previews/[0-9a-f]{2}/[0-9a-f]{16}-thumb\.webp$")
        self.assertTrue((self.root / item["previews"]["thumb"]).is_file())
        self.assertTrue(validator_ok(self.root / "packs" / pack / "collection.card.json", cards[0]))

    def test_smallscaleint_sheet_thumbnail_crops_the_measured_south_row(self):
        pack = "smallscaleint-2d-character-knight"
        pack_dir = self.root / "packs" / pack
        collection = bcc.card(pack_dir / "pack.json", {}, bcc.load_table(), None)
        cards = bcc.smallscaleint.build_cards(pack_dir, collection)
        jobs = bcc.smallscaleint_thumbnails.thumbnail_jobs(self.root, {pack: cards})
        self.assertEqual(jobs[0]["extract"], {"left": 0, "top": 128, "width": 64, "height": 64})

    def test_thumbnail_failure_writes_neither_collection_nor_item_cards(self):
        pack = "smallscaleint-2d-character-knight"
        with mock.patch.object(
            bcc.smallscaleint_thumbnails,
            "render_thumbnails",
            side_effect=ValueError("thumbnail renderer failed"),
        ):
            rep = bcc.run(self.root, only=pack)
        self.assertIn("thumbnail renderer failed", " ".join(rep["failures"][pack]))
        self.assertFalse((self.root / "packs" / pack / "collection.card.json").exists())
        self.assertFalse((self.root / "packs" / pack / "cards").exists())

    def test_thumbnail_renderer_rejects_escapes_and_cleans_failed_output(self):
        source = "packs/smallscaleint-2d-character-knight/1.0/extracted/Spritesheets/With shadow/Knight/Attack.png"
        with tempfile.TemporaryDirectory() as outside_tmp:
            outside = Path(outside_tmp)
            outside_image = outside / "outside.png"
            outside_image.write_bytes(png(64, 64))

            with self.subTest("input traversal"):
                relative_outside = f"../{outside.name}/outside.png"
                with self.assertRaisesRegex(ValueError, "thumbnail input escapes asset root"):
                    bcc.smallscaleint_thumbnails.render_thumbnails(
                        self.root,
                        [{"input": relative_outside, "output": "private/previews/input-escape.webp"}],
                    )

            with self.subTest("output traversal"):
                escaped_output = outside / "escaped.webp"
                with self.assertRaisesRegex(ValueError, "thumbnail output escapes asset root"):
                    bcc.smallscaleint_thumbnails.render_thumbnails(
                        self.root,
                        [{"input": source, "output": f"../{outside.name}/escaped.webp"}],
                    )
                self.assertFalse(escaped_output.exists())

            with self.subTest("existing output symlink"):
                output = self.root / "private" / "previews" / "linked.webp"
                output.parent.mkdir(parents=True, exist_ok=True)
                target = outside / "target.webp"
                target.write_bytes(b"outside")
                output.symlink_to(target)
                with self.assertRaisesRegex(ValueError, "thumbnail output is a symlink"):
                    bcc.smallscaleint_thumbnails.render_thumbnails(
                        self.root,
                        [{"input": source, "output": "private/previews/linked.webp"}],
                    )

            with self.subTest("failed crop cleanup"):
                failed = self.root / "private" / "previews" / "failed.webp"
                with self.assertRaisesRegex(ValueError, "thumbnail renderer failed"):
                    bcc.smallscaleint_thumbnails.render_thumbnails(
                        self.root,
                        [{
                            "input": source,
                            "output": "private/previews/failed.webp",
                            "extract": {"left": 10_000, "top": 0, "width": 64, "height": 64},
                        }],
                    )
                self.assertFalse(failed.exists())
                self.assertEqual(list(failed.parent.glob("failed.webp.*.tmp.webp")), [])

    def test_smallscaleint_layout_failure_replaces_neither_collection_nor_item_cards(self):
        pack = "smallscaleint-2d-character-knight"
        sheet = self.root / "packs" / pack / "1.0" / "extracted" / "Spritesheets" / "Shadowless" / "Knight" / "Attack.png"
        sheet.write_bytes(png(130, 512))
        rep = bcc.run(self.root, only=pack)
        self.assertIn(pack, rep["failures"])
        self.assertFalse((self.root / "packs" / pack / "collection.card.json").exists())
        self.assertFalse((self.root / "packs" / pack / "cards").exists())

    def test_filtered_smallscaleint_run_preserves_the_complete_sheet_tree(self):
        second = "smallscaleint-2d-character-pack-1"
        add_pack(self.root, second, "smallscaleint", "smallscaleint-itch", {
            "Character/Idle/0.png": png(64, 64),
            "Character/Idle/1.png": png(64, 64),
        })
        self.assertEqual(bcc.run(self.root)["failures"], {})
        sheets = self.root / "sets" / "smallscaleint" / "sheets"
        marker = sheets / "complete-run.marker"
        marker.write_text("preserve until every installed pack is rebuilt")

        self.assertEqual(bcc.run(self.root, only="smallscaleint-2d-character-knight")["failures"], {})
        self.assertTrue(marker.exists())

    def test_sidetrax_gets_the_confirmed_licence_and_keeps_kevins_interpretation(self):
        """Kevin confirmed the Sidetrax licence: in-game opens, vision-input stays through his interpretation."""
        bcc.run(self.root)
        c = card_of(self.root, "sidetrax-pack-60-battle")
        self.assertEqual(sorted(c["rights"]["uses"]), ["in-game", "vision-input"])
        self.assertEqual(c["rights"]["redistribution"], "in-build")
        interp = [b for b in c["rights"]["basis"] if b["type"] == "interpretation"]
        self.assertEqual(interp[0]["note"], import_sidetrax.INTERPRETATION_NOTE)
        self.assertEqual(c["status"], "draft")

    def test_sidetrax_with_description_objects_and_roles_is_tagged(self):
        """The C3 rule: tagged only once the descriptive core exists."""
        cc = self.root / "packs" / "sidetrax-pack-60-battle" / "collection.card.json"
        old = json.loads(cc.read_text())
        old["describe"].update(description="Battle music", objects=["drum"], roles=["music-bed"])
        cc.write_text(json.dumps(old))
        bcc.run(self.root)
        self.assertEqual(card_of(self.root, "sidetrax-pack-60-battle")["status"], "tagged")

    def test_second_run_is_byte_identical(self):
        """Re-running the migration must not churn timestamps on cards whose content did not change."""
        bcc.run(self.root)
        files = sorted((self.root / "packs").glob("*/collection.card.json"))
        before = {f: (f.read_bytes(), f.stat().st_mtime_ns) for f in files}
        time.sleep(1.1)  # NOW has one-second resolution; a rebuilt card would differ
        import importlib
        importlib.reload(bcc)
        rep = bcc.run(self.root)
        self.assertEqual(sum(v["written"] for v in rep["vendors"].values()), 0)
        self.assertEqual({f: (f.read_bytes(), f.stat().st_mtime_ns) for f in files}, before)

    def test_locked_describe_field_survives(self):
        """A field Kevin locked is never overwritten by the tags file."""
        bcc.run(self.root)
        cc = self.root / "packs" / KENNEY / "collection.card.json"
        c = json.loads(cc.read_text())
        c["describe"]["pov_fit"] = ["iso"]
        c["provenance"]["describe.pov_fit"] = {"by": "human", "at": "2026-10-31T00:00:00-07:00", "locked": True}
        cc.write_text(json.dumps(c))
        bcc.run(self.root)
        after = card_of(self.root, KENNEY)
        self.assertEqual(after["describe"]["pov_fit"], ["iso"])
        self.assertTrue(after["provenance"]["describe.pov_fit"]["locked"])

    def test_locked_describe_drives_status(self):
        """Status is derived from what is written, so a locked full describe on an untagged pack makes it tagged."""
        bcc.run(self.root)
        cc = self.root / "packs" / "limezu-test-pack" / "collection.card.json"
        c = json.loads(cc.read_text())
        c["describe"] = {"description": "Modern rooms", "objects": ["sofa"], "roles": ["furniture"]}
        c["provenance"]["describe"] = {"by": "human", "at": "2026-10-31T00:00:00-07:00", "locked": True}
        cc.write_text(json.dumps(c))
        bcc.run(self.root)
        self.assertEqual(card_of(self.root, "limezu-test-pack")["status"], "tagged")

    def test_interpretation_is_dropped_when_the_licence_changes(self):
        """Kevin's reading of one licence must not widen a different licence's rights."""
        cc = self.root / "packs" / "sidetrax-pack-60-battle" / "collection.card.json"
        old = json.loads(cc.read_text())
        old["license"] = "LicenseRef-itch-custom"
        old["rights"]["basis"][2]["uses"] = ["vision-input", "derive-layout"]
        cc.write_text(json.dumps(old))
        bcc.run(self.root)
        c = card_of(self.root, "sidetrax-pack-60-battle")
        self.assertEqual([b["type"] for b in c["rights"]["basis"]], ["license"])
        self.assertNotIn("derive-layout", c["rights"]["uses"])

    def test_admin_decision_survives_and_narrows(self):
        """A decision Kevin recorded on a card is kept across rebuilds and still narrows the rights."""
        bcc.run(self.root)
        cc = self.root / "packs" / KENNEY / "collection.card.json"
        c = json.loads(cc.read_text())
        c["rights"]["basis"].append({"type": "decision", "uses": ["in-game"], "audience": "private", "redistribution": "none",
                                     "set_by": {"role": "admin", "name": "kevin"}, "date": "2026-10-31"})
        cc.write_text(json.dumps(c))
        self.assertEqual(bcc.run(self.root)["failures"], {})
        r = card_of(self.root, KENNEY)["rights"]
        self.assertEqual((r["uses"], r["audience"], r["redistribution"]), (["in-game"], "private", "none"))

    def test_audio_counts_from_the_audio_tagger_survive(self):
        """build_audio_cards.py owns the audio counts; rebuilding the collection card must not reset them."""
        bcc.run(self.root)
        cc = self.root / "packs" / KENNEY / "collection.card.json"
        c = json.loads(cc.read_text())
        c["collection_info"]["counts"].update({"audio": 3, "audio/music/stinger": 3})
        cc.write_text(json.dumps(c))
        bcc.run(self.root)
        counts = card_of(self.root, KENNEY)["collection_info"]["counts"]
        self.assertEqual((counts["audio"], counts["audio/music/stinger"], counts["sprite"]), (3, 3, 1))

    def test_unknown_licence_fails_loudly_and_writes_nothing(self):
        """An unmapped licence must not silently get someone else's ceiling."""
        add_pack(self.root, "acme-mystery", "acme", "made-up", {"a.png": b"p"})
        self.assertEqual(bcc.main(["--root", str(self.root)]), 1)
        self.assertIn("acme-mystery", bcc.run(self.root)["failures"])
        self.assertFalse((self.root / "packs" / "acme-mystery" / "collection.card.json").exists())

    def test_dry_run_writes_nothing(self):
        bcc.run(self.root, dry_run=True)
        self.assertFalse((self.root / "packs" / KENNEY / "collection.card.json").exists())


class ItchInstaller(unittest.TestCase):
    def test_installer_writes_rights_the_schema_accepts(self):
        """The old installer wrote redistribution 'not-allowed' and a string basis, which the schema rejects."""
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            src = tmp / "dl"
            src.mkdir()
            (src / "sources.json").write_text(json.dumps({"page": "https://example.itch.io/ufo"}))
            with zipfile.ZipFile(src / "ufo.zip", "w") as z:
                z.writestr("ufo/ship.png", b"p")
            root = tmp / "lib"
            install_itch_pack.main([str(src), "acme-ufo", "UFO pack", "Store page: commercial use ok.", "--extract", "ufo",
                                    "--root", str(root)])
            pj = json.loads((root / "packs" / "acme-ufo" / "pack.json").read_text())
            self.assertEqual(pj["license"], "LicenseRef-itch-custom")
            rights = pj["usage_rights"]
            self.assertEqual(rights["redistribution"], "none")  # unconfirmed row: strict default until Kevin confirms
            self.assertEqual(rights["basis"][0]["type"], "license")
            rep = bcc.run(root)
            self.assertEqual(rep["failures"], {})
            self.assertEqual(card_of(root, "acme-ufo")["rights"], rights)

    def test_smallscaleint_default_licence_and_unknown_override_fail_before_install(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            src = tmp / "dl"
            src.mkdir()
            (src / "sources.json").write_text(json.dumps({"page": "https://smallscaleint.itch.io/example"}))
            with zipfile.ZipFile(src / "pack.zip", "w") as archive:
                archive.writestr("pack/Walk.png", png(64, 512))
            root = tmp / "library"
            install_itch_pack.main([
                str(src), "smallscaleint-example", "Example", "SmallScaleInt licence", "--extract", "pack",
                "--root", str(root),
            ])
            manifest = json.loads((root / "packs" / "smallscaleint-example" / "pack.json").read_text())
            self.assertEqual(manifest["license"], "LicenseRef-smallscaleint-itch")

            rejected_root = tmp / "rejected-library"
            with self.assertRaises(KeyError):
                install_itch_pack.main([
                    str(src), "smallscaleint-rejected", "Rejected", "Unknown", "--extract", "pack",
                    "--license-id", "LicenseRef-not-real", "--root", str(rejected_root),
                ])
            self.assertFalse(rejected_root.exists())


def load_tests(loader, tests, pattern):
    """The asset-card package's existing Python entrypoint also owns the SmallScaleInt reader suite."""
    tests.addTests(loader.loadTestsFromModule(test_smallscaleint))
    return tests


if __name__ == "__main__":
    unittest.main()
