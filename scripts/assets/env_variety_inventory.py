"""Inventory the static isometric set pieces a SmallScaleInt scene can be dressed with, grouped by kind.

The fantasy isometric tileset names every environment sprite ``<Family> <Letter><n>_<facing>.png`` on a 256x256
canvas whose ground anchor is pixel (128, 208). This reads one or more pack directories (read-only), groups the files
into items (one item = every facing of one name), measures each item and assigns it a scene-dressing kind
(palisade, fence, rock, grime decal, clutter, ...). The kind table below is a judgement made by looking at the
#486 contact sheets; re-check it when a pack version changes.

Run with the forge Python (needs Pillow and NumPy):

    gm py -- scripts/assets/env_variety_inventory.py OUT_DIR fantasy=<dir> [desert=<dir>] [rural:rural=<dir>] [--sheets]

It writes ``inventory.json`` (one record per item) and ``INVENTORY.md`` (count per kind and pack) into OUT_DIR, and
with ``--sheets`` a labelled contact sheet per kind (``sheets/<kind>.png``, south facing when it exists).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

NAME = re.compile(
    r"^(?P<family>[A-Za-z]+(?: [A-Za-z]+)??)(?: (?P<letter>[A-Z]))?(?P<num>\d+)(?:_(?P<facing>[NESW]))?\.png$"
)
FACINGS = ("N", "E", "S", "W")
ANCHOR = (128, 208)

KINDS = (
    "market-stall",
    "building",
    "palisade",
    "fence",
    "path",
    "ground",
    "rock",
    "grime-decal",
    "scatter",
    "clutter",
    "town-prop",
    "graveyard",
    "cave",
    "vegetation",
    "tree",
    "foliage",
    "helper",
)

# Family-letter defaults, then single items. Ranges are inclusive.
FAMILY_KIND = {
    "Chest": "clutter",
    "Door": "building",
    "Roof": "building",
    "Wall A": "building",
    "Wall C": "building",
    "Wall D": "building",
    "Wall E": "building",
    "Wall F": "building",
    "Wall G": "building",
    "Wall H": "building",
    "Wall I": "building",
    "Wall J": "building",
    "Wall K": "building",
    "HalfWall A": "building",
    "Wall B": "palisade",
    "Misc A": "clutter",
    "Misc B": "town-prop",
    "Misc C": "town-prop",
    "Misc D": "town-prop",
    "Misc E": "clutter",
    "Stone A": "rock",
    "Stone B": "rock",
    "Ground A": "vegetation",
    "Ground B": "ground",
    "Ground C": "grime-decal",
    "Ground D": "path",
    "Ground E": "path",
    "Ground F": "path",
    "Ground G": "cave",
    "Ground H": "path",
    "Ground I": "ground",
    "Ground J": "vegetation",
    "Ground K": "ground",
    "Ground W": "ground",
    "Foam A": "ground",
    "Flora A": "vegetation",
    "Flora B": "foliage",
    "Flora C": "vegetation",
    "Tree A": "tree",
    "Tree B": "foliage",
    "Tree C": "tree",
    "Tree D": "tree",
    "Tree E": "tree",
    "WallFlora A": "foliage",
    "Shadow": "helper",
}
ITEM_KIND = {
    **{f"Wall B{n}": "fence" for n in range(7, 12)},
    **{f"Wall E{n}": "fence" for n in range(15, 19)},
    "Misc A1": "scatter",
    **{f"Misc B{n}": "market-stall" for n in (10, 12, 14, 17, 18, 19, 37, 38, 39, 40)},
    **{f"Misc B{n}": "clutter" for n in (1, 2, 3, 8, 13, 20, 26, 27, 28, 53, 58, 59)},
    "Misc C4": "clutter",
    **{f"Stone A{n}": "graveyard" for n in (4, 5, 13, 14, 15)},
    **{f"Stone A{n}": "town-prop" for n in (6, 7, 8)},
    **{f"Stone A{n}": "cave" for n in (16, 21, 22)},
    "Ground A1": "ground",
    **{f"Ground A{n}": "ground" for n in range(14, 18)},
    **{f"Ground A{n}": "scatter" for n in range(22, 25)},
    **{f"Ground E{n}": "scatter" for n in range(10, 16)},
    **{f"Ground G{n}": "path" for n in range(1, 12)},
    "Tree A4": "scatter",
    "Tree E2": "scatter",
    "Tree E4": "scatter",
    "Tree E5": "scatter",
}


# The HD rural tileset reuses family names with other meanings (its Wall B is a house wall), so it is classified by
# family only. Its canvases differ too (128-wide ground, 256x512 trees): measure, don't mix it into a fantasy scene.
RURAL_FAMILY_KIND = {
    "Fence": "fence",
    "Tree": "tree",
    "Flora": "vegetation",
    "Ground": "ground",
    "Cliff": "cave",
    "Wall": "building",
    "Roof": "building",
    "Object": "clutter",
}


def kind_of(family: str, letter: str | None, num: int, scheme: str = "fantasy") -> str:
    if scheme == "rural":
        return RURAL_FAMILY_KIND.get(family, "unclassified")
    item = f"{family} {letter}{num}"
    return ITEM_KIND.get(item) or FAMILY_KIND.get(f"{family} {letter}") or FAMILY_KIND.get(family) or "unclassified"


def item_name(family: str, letter: str | None, num: int) -> str:
    return f"{family} {letter}{num}" if letter else f"{family}{num}"


def group(directory: Path, scheme: str = "fantasy") -> dict[str, dict]:
    """Every parsable PNG in ``directory`` grouped into items; other files are ignored."""
    items: dict[str, dict] = {}
    for path in sorted(directory.glob("*.png")):
        match = NAME.match(path.name)
        if not match:
            continue
        family, letter, num = match["family"], match["letter"], int(match["num"])
        item = item_name(family, letter, num)
        record = items.setdefault(
            item,
            {
                "item": item,
                "family": f"{family} {letter}" if letter else family,
                "kind": kind_of(family, letter, num, scheme),
                "files": {},
            },
        )
        record["files"][match["facing"] or "default"] = path
    return items


def measure(record: dict) -> dict:
    """Canvas, union alpha bounds, visible size, opaque palette size and ground-contact offset of one item."""
    import numpy as np
    from PIL import Image

    sizes, boxes, colours = set(), [], set()
    for path in record["files"].values():
        with Image.open(path) as image:
            rgba = np.asarray(image.convert("RGBA"))
        sizes.add((rgba.shape[1], rgba.shape[0]))
        alpha = rgba[..., 3]
        ys, xs = np.nonzero(alpha > 0)
        if len(xs):
            boxes.append((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
        opaque = rgba[alpha == 255][:, :3]
        colours.update(map(tuple, np.unique(opaque, axis=0).tolist()))
    box = (
        [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)]
        if boxes
        else None
    )
    return {
        "canvas": sorted(sizes)[0] if len(sizes) == 1 else sorted(sizes),
        "bbox": box,
        "visible": [box[2] - box[0], box[3] - box[1]] if box else [0, 0],
        "ground_offset": box[3] - ANCHOR[1] if box else None,
        "palette": len(colours),
    }


def inventory(packs: dict[str, Path], schemes: dict[str, str] | None = None) -> list[dict]:
    rows = []
    for pack, directory in packs.items():
        for record in group(directory, (schemes or {}).get(pack, "fantasy")).values():
            facings = sorted(f for f in record["files"] if f in FACINGS)
            source = record["files"].get("S") or next(iter(record["files"].values()))
            rows.append(
                {
                    "pack": pack,
                    "item": record["item"],
                    "family": record["family"],
                    "kind": record["kind"],
                    "facings": facings or ["default"],
                    "source": source.name,
                    **measure(record),
                }
            )
    return rows


def summary(rows: list[dict]) -> str:
    packs = sorted({row["pack"] for row in rows})
    table = defaultdict(lambda: defaultdict(list))
    for row in rows:
        table[row["kind"]][row["pack"]].append(row)
    lines = [
        "# Environment set-piece inventory",
        "",
        "Items per kind and pack (an item is one name in every facing it ships). "
        "Facings: share of items with all four of N/E/S/W. Height: median visible pixels on the 256 canvas.",
        "",
        "| Kind | " + " | ".join(packs) + " | Facings | Height |",
        "|---|" + "---|" * len(packs) + "---|---|",
    ]
    for kind in [*KINDS, "unclassified"]:
        if kind not in table:
            continue
        all_rows = [row for pack in packs for row in table[kind][pack]]
        four = sum(len(row["facings"]) == 4 for row in all_rows)
        heights = sorted(row["visible"][1] for row in all_rows)
        counts = " | ".join(str(len(table[kind][pack])) for pack in packs)
        lines.append(
            f"| {kind} | {counts} | {four}/{len(all_rows)} | {heights[len(heights) // 2] if heights else 0} |"
        )
    lines += ["", "## Items per kind", ""]
    for kind in [*KINDS, "unclassified"]:
        names = sorted({row["item"] for pack in packs for row in table[kind][pack]}, key=natural)
        if names:
            lines.append(f"- **{kind}**: {', '.join(names)}")
    return "\n".join(lines) + "\n"


def natural(text: str) -> list:
    return [int(part) if part.isdigit() else part for part in re.split(r"(\d+)", text)]


def contact_sheets(rows: list[dict], packs: dict[str, Path], out: Path, cell: int = 160) -> list[Path]:
    from PIL import Image, ImageDraw

    written = []
    by_kind = defaultdict(list)
    for row in rows:
        by_kind[row["kind"]].append(row)
    for kind, members in by_kind.items():
        members.sort(key=lambda row: (row["pack"], natural(row["item"])))
        cols = 10
        sheet_rows = (len(members) + cols - 1) // cols
        sheet = Image.new("RGBA", (cols * cell, sheet_rows * (cell + 14)), (34, 40, 36, 255))
        draw = ImageDraw.Draw(sheet)
        for index, row in enumerate(members):
            path = packs[row["pack"]] / Path(row["source"]).name
            with Image.open(path) as image:
                sprite = image.convert("RGBA")
            box = sprite.getbbox() or (0, 0, 1, 1)
            crop = sprite.crop(box)
            crop.thumbnail((cell - 8, cell - 8), Image.NEAREST)
            x, y = (index % cols) * cell, (index // cols) * (cell + 14)
            sheet.alpha_composite(crop, (x + (cell - crop.width) // 2, y + cell - crop.height - 4))
            draw.text((x + 4, y + cell), f"{row['item']} [{row['pack']}]", fill=(230, 230, 230, 255))
        target = out / "sheets" / f"{kind}.png"
        target.parent.mkdir(parents=True, exist_ok=True)
        sheet.save(target)
        written.append(target)
    return written


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("out", type=Path)
    parser.add_argument("packs", nargs="+", help="name[:rural]=directory of environment PNGs")
    parser.add_argument("--sheets", action="store_true")
    args = parser.parse_args(argv)
    packs, schemes = {}, {}
    for spec in args.packs:
        label, _, directory = spec.partition("=")
        name, _, scheme = label.partition(":")
        if not directory or not Path(directory).is_dir() or scheme not in ("", "fantasy", "rural"):
            parser.error(f"{spec}: expected name[:rural]=<existing directory>")
        packs[name], schemes[name] = Path(directory), scheme or "fantasy"
    rows = inventory(packs, schemes)
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "inventory.json").write_text(json.dumps(rows, indent=1) + "\n")
    (args.out / "INVENTORY.md").write_text(summary(rows))
    if args.sheets:
        contact_sheets(rows, packs, args.out)
    print(f"{len(rows)} items from {len(packs)} packs -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
