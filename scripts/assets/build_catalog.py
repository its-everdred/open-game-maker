"""Rebuild catalog.json from every packs/*/pack.json and the inspiration collections.

One line per pack so tools (and a future `gm packs` CLI) can search without walking 100k files. Each entry also points at
its C3 collection card and counts the asset cards written under it (C3 §9: the catalog stays a pack list until `gm assets`).
Run: python3 -I scripts/assets/build_catalog.py [--root assets-local]
"""
import argparse
import json
from collections import Counter
from pathlib import Path

DEFAULT_ROOT = Path(__file__).resolve().parents[2] / "assets-local"


def card_info(d: Path, root: Path):
    cc = d / "collection.card.json"
    if not cc.exists():
        return {"card": None, "card_status": None, "asset_cards": 0}
    c = json.loads(cc.read_text())
    return {"card": cc.relative_to(root).as_posix(), "card_status": c["status"], "card_id": c["id"],
            "rights_uses": c["rights"]["uses"], "asset_cards": sum(1 for _ in (d / "cards").rglob("*.card.json")) if (d / "cards").exists() else 0}


def build(root: Path) -> dict:
    packs = []
    for pj in sorted((root / "packs").glob("*/pack.json")):
        m = json.loads(pj.read_text())
        v = m["versions"][m["current"]]
        ext = pj.parent / m["current"] / "extracted"
        ft = v.get("file_types") or dict(Counter(f.suffix.lower().lstrip(".") for f in ext.rglob("*") if f.is_file()).most_common())
        packs.append({
            "id": m["id"],
            "vendor": m["vendor"],
            "title": m["title"],
            "category": m.get("category") or ("audio" if m["vendor"] == "sidetrax" else None),
            "license": m["license"],
            "version": m["current"],
            "path": f"packs/{m['id']}/{m['current']}/extracted",
            "icon": f"packs/{m['id']}/icon.png" if (pj.parent / "icon.png").exists() else None,
            "files": v["extracted_files"],
            "file_types": ft,
            "requires": m.get("requires", []),
            **card_info(pj.parent, root),
        })

    inspiration = []
    for cc in sorted((root / "inspiration").glob("*/collection.card.json")):
        inspiration.append({"id": cc.parent.name, "path": cc.parent.relative_to(root).as_posix(), **card_info(cc.parent, root)})
    return {"packs": packs, "inspiration": inspiration}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    args = parser.parse_args(argv)
    root = args.root.resolve()
    if not (root / "packs").is_dir():
        parser.error(f"asset root must contain an existing packs directory: {root / 'packs'}")
    catalog = build(root)
    (root / "catalog.json").write_text(json.dumps(catalog, indent=1) + "\n")
    rows = catalog["packs"] + catalog["inspiration"]
    print(f"{len(catalog['packs'])} packs, {len(catalog['inspiration'])} inspiration collections, "
          f"{sum(row['asset_cards'] for row in rows)} asset cards -> {root / 'catalog.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
