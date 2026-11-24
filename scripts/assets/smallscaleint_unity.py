"""Bounded, atomic extraction for SmallScaleInt Unity character creators."""

from __future__ import annotations

import json
import re
import shutil
import tarfile
import tempfile
from collections import defaultdict
from datetime import datetime
from pathlib import Path, PurePosixPath

NUMBER = re.compile(r"(\d+)")
MAX_UNITY_MEMBERS = 250_000
MAX_UNITY_BYTES = 4 * 1024**3
MAX_PATHNAME_BYTES = 4096
MAX_META_BYTES = 4 * 1024**2
MODERN_PART_ORDER = [
    "Shadow", "NakedBody", "Legs", "Shoes", "Chest", "Head", "Bag", "Mount",
    "Shield", "Melee", "Pistol", "Shotgun", "Sniper", "MachineGun", "Special", "GunFire",
]
# Fantasy creator combine order (Character creator - Fantasy v1.3, SpritesheetGenerator.cs). The pack's own
# rules also swap Weapon/Shield and Bag by facing row; this is the default order.
FANTASY_PART_ORDER = [
    "Shadow", "NakedBody", "Shoes", "Legs", "Chest", "Belt", "Hands", "Shield",
    "Melee", "Ranged", "Magic", "Offhand", "Bag", "Head", "Slash", "Effect",
]


def safe_member(name: str) -> PurePosixPath:
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts or not path.parts or "\\" in name or "\0" in name or "\n" in name or "\r" in name:
        raise ValueError(f"unsafe Unity member: {name}")
    return path


def extract_unitypackage(package: Path, destination: Path, world: str = "fantasy") -> dict:
    """Reconstruct PNG layers without retaining archive payloads in memory."""
    if destination.exists():
        raise FileExistsError(f"fresh destination required: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=f".{destination.name}-", dir=destination.parent))
    records: dict[str, dict[str, Path]] = defaultdict(dict)
    try:
        record_root = stage / ".unity-records"
        member_count = total_bytes = 0
        with tarfile.open(package, "r|gz") as archive:
            for member in archive:
                member_count += 1
                total_bytes += member.size
                if member_count > MAX_UNITY_MEMBERS or total_bytes > MAX_UNITY_BYTES:
                    raise ValueError("Unity package exceeds safe extraction limits")
                member_path = safe_member(member.name)
                if member.issym() or member.islnk() or not (member.isfile() or member.isdir()):
                    raise ValueError(f"unsupported Unity member: {member.name}")
                if not member.isfile() or len(member_path.parts) != 2:
                    continue
                guid, kind = member_path.parts
                if kind not in ("asset", "asset.meta", "pathname"):
                    continue
                if kind in records[guid]:
                    raise ValueError(f"duplicate Unity member: {member.name}")
                if kind == "pathname" and member.size > MAX_PATHNAME_BYTES:
                    raise ValueError(f"oversized Unity pathname for {guid}")
                if kind == "asset.meta" and member.size > MAX_META_BYTES:
                    raise ValueError(f"oversized Unity metadata for {guid}")
                stream = archive.extractfile(member)
                if stream is None:
                    raise ValueError(f"unreadable Unity member: {member.name}")
                target = record_root / guid / kind
                target.parent.mkdir(parents=True, exist_ok=True)
                with target.open("xb") as output:
                    shutil.copyfileobj(stream, output)
                records[guid][kind] = target

        layers = []
        output_paths: dict[str, str] = {}
        for guid, record in sorted(records.items()):
            if "asset" not in record or "pathname" not in record:
                continue
            relative = safe_member(record["pathname"].read_text(encoding="utf-8").strip())
            if relative.suffix.lower() != ".png":
                continue
            path_key = relative.as_posix().casefold()
            if previous := output_paths.get(path_key):
                raise ValueError(f"duplicate Unity pathname: {relative} ({previous}, {guid})")
            output_paths[path_key] = guid
            meta = record.get("asset.meta")
            meta_text = meta.read_text(encoding="utf-8", errors="replace") if meta else ""
            match = re.search(r"m_SortingOrder:\s*(-?\d+)", meta_text)
            number = NUMBER.search(relative.stem)
            if match:
                order, order_source = int(match.group(1)), "unity"
            elif number:
                order, order_source = int(number.group(1)), "filename"
            else:
                order, order_source = None, "path"
            layers.append({"path": relative.as_posix(), "order": order, "order_source": order_source,
                           "guid": guid, "asset": record["asset"]})

        ordered = sorted(layers, key=lambda item: (item["order"] is None, item["order"] or 0, item["path"].lower()))
        manifest_layers = [{"path": item["path"], "order": item["order"] if item["order"] is not None else index,
                            "order_source": item["order_source"], "guid": item["guid"]} for index, item in enumerate(ordered)]
        manifest = {"schema": "ogm.smallscaleint-layers/1", "source": package.name, "world": world,
                    "layers": manifest_layers}
        manifest["part_order"] = MODERN_PART_ORDER if world == "modern-zombie" else FANTASY_PART_ORDER
        extracted = stage / "1.0" / "extracted"
        for item in ordered:
            target = extracted.joinpath(*PurePosixPath(item["path"]).parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(item["asset"], target)
        if record_root.exists():
            shutil.rmtree(record_root)
        (stage / "layer-order.json").write_text(json.dumps(manifest, indent=2) + "\n")
        pack_id = destination.name
        (stage / "pack.json").write_text(json.dumps({"id": pack_id, "vendor": "smallscaleint", "title": pack_id,
            "license": "LicenseRef-smallscaleint-itch", "requires": [], "current": "1.0",
            "versions": {"1.0": {"extracted_files": len(ordered), "added": datetime.now().date().isoformat()}}}, indent=2) + "\n")
        stage.rename(destination)
        return manifest
    except Exception:
        if stage.exists():
            shutil.rmtree(stage)
        raise
