"""Synthetic coverage for the environment set-piece inventory.

Run: gm py -- -I scripts/assets/test_env_variety_inventory.py -v
"""

import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import env_variety_inventory as inv  # noqa: E402

try:
    from PIL import Image
except ImportError:  # pragma: no cover - the forge Python has Pillow
    Image = None


def sprite(path: Path, box: tuple[int, int, int, int], colours: int = 1) -> None:
    image = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    x0, y0, x1, y1 = box
    for x in range(x0, x1):
        for y in range(y0, y1):
            image.putpixel((x, y), (10 * ((x - x0) % colours), 80, 40, 255))
    image.save(path)


class KindTest(unittest.TestCase):
    """The gap list and the pilot pick their sources by kind, so a misfiled fence or decal hides a gap."""

    def test_wall_b_splits_palisade_from_rail_fence(self):
        self.assertEqual(inv.kind_of("Wall", "B", 2), "palisade")
        self.assertEqual(inv.kind_of("Wall", "B", 8), "fence")
        self.assertEqual(inv.kind_of("Wall", "E", 16), "fence")
        self.assertEqual(inv.kind_of("Wall", "E", 3), "building")

    def test_stone_family_separates_rocks_graves_and_crystals(self):
        self.assertEqual(inv.kind_of("Stone", "A", 1), "rock")
        self.assertEqual(inv.kind_of("Stone", "A", 14), "graveyard")
        self.assertEqual(inv.kind_of("Stone", "A", 21), "cave")

    def test_market_stalls_are_not_generic_town_props(self):
        self.assertEqual(inv.kind_of("Misc", "B", 17), "market-stall")
        self.assertEqual(inv.kind_of("Misc", "B", 29), "town-prop")

    def test_unknown_family_is_reported_not_guessed(self):
        self.assertEqual(inv.kind_of("Car", "A", 1), "unclassified")

    def test_rural_names_do_not_borrow_fantasy_meanings(self):
        # Rural "Wall B" is a house wall, not a palisade; a shared table would inflate the palisade count.
        self.assertEqual(inv.kind_of("Wall", "B", 2, "rural"), "building")
        self.assertEqual(inv.kind_of("Fence", "A", 1, "rural"), "fence")


@unittest.skipIf(Image is None, "needs Pillow (run with the forge Python)")
class InventoryTest(unittest.TestCase):
    def test_facings_group_into_one_measured_item(self):
        with tempfile.TemporaryDirectory() as tmp:
            pack = Path(tmp)
            for facing in "NESW":
                sprite(pack / f"Stone A1_{facing}.png", (100, 180, 150, 212), colours=3)
            sprite(pack / "Wall B8_E.png", (90, 150, 160, 200))
            sprite(pack / "Object10_S.png", (100, 150, 120, 200))
            (pack / "readme.txt").write_text("not a sprite")
            (pack / "Other.png").write_bytes(b"")
            rows = {row["item"]: row for row in inv.inventory({"p": pack})}

        self.assertEqual(set(rows), {"Stone A1", "Wall B8", "Object10"})
        rock = rows["Stone A1"]
        self.assertEqual(rock["facings"], ["E", "N", "S", "W"])
        self.assertEqual(rock["canvas"], (256, 256))
        self.assertEqual(rock["visible"], [50, 32])
        # Contact 4 px below the 208 ground anchor: the variants must land at the same offset.
        self.assertEqual(rock["ground_offset"], 4)
        self.assertEqual(rock["palette"], 3)
        self.assertEqual(rows["Wall B8"]["facings"], ["E"])
        self.assertEqual(rows["Wall B8"]["kind"], "fence")

    def test_summary_counts_items_per_kind_and_pack(self):
        rows = [
            {"pack": "a", "item": "Wall B1", "kind": "palisade", "facings": list("ENSW"), "visible": [10, 80]},
            {"pack": "b", "item": "Wall B1", "kind": "palisade", "facings": ["E"], "visible": [10, 60]},
        ]
        text = inv.summary(rows)
        self.assertIn("| palisade | 1 | 1 | 1/2 | 80 |", text)


if __name__ == "__main__":
    unittest.main()
