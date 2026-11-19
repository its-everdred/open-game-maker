"""Resolve restrictive per-source rights before audio analysis and derivatives."""
import fnmatch
import json
import re
import subprocess
from pathlib import Path


def collection_rights(pack: Path) -> dict:
    if pack.is_symlink():
        raise ValueError("collection directory symlinks are not allowed")
    try:
        if (pack / "collection.card.json").is_symlink():
            raise ValueError("collection card symlinks are not allowed")
        return json.loads((pack / "collection.card.json").read_text()).get("rights") or {}
    except (OSError, json.JSONDecodeError):
        return {}


def source_cards(pack: Path, extracted: Path | None = None) -> dict[str, list[dict]]:
    if pack.is_symlink():
        raise ValueError("collection directory symlinks are not allowed")
    result = {}
    try:
        collection_id = json.loads((pack / "collection.card.json").read_text()).get("id")
    except (OSError, json.JSONDecodeError):
        collection_id = None
    if (pack / "cards").is_symlink():
        raise ValueError("card directory symlinks are not allowed")
    for path in sorted((pack / "cards").rglob("*.card.json")):
        if path.is_symlink():
            raise ValueError(f"card symlink is not allowed: {path}")
        try:
            card = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError) as exc:
            raise ValueError(f"cannot determine source rights from {path}: {exc}") from exc
        if card.get("collection") is not None and card.get("collection") != collection_id:
            raise ValueError(f"asset card belongs to a different collection: {path}")
        for source in card.get("source", {}).get("files", []):
            if isinstance(source.get("path"), str):
                name = source["path"]
                if not name or "\\" in name or name.startswith("/") or any(part in ("", ".", "..") for part in name.split("/")):
                    raise ValueError(f"noncanonical audio source path in {path}: {name}")
                if extracted is not None:
                    candidate = extracted / name
                    if candidate.resolve() != candidate or not candidate.resolve().is_relative_to(extracted):
                        raise ValueError(f"audio source alias in {path}: {name}")
                stem = str(Path(name).with_suffix("")).lower()
                result.setdefault(stem, []).append(card)
    return result


def allows_vision(rights: dict) -> bool:
    return "vision-input" in rights.get("uses", []) and rights.get("processing", "local-only") in ("any", "local-only")


def source_policy(collection: dict, cards: list[dict]) -> tuple[bool, str]:
    grants = [collection] + [card["rights"] for card in cards if card.get("rights") is not None]
    allowed = all(allows_vision(grant) for grant in grants) and not any(
        card.get("status") == "reviewed" or card.get("provenance", {}).get("*", {}).get("locked")
        for card in cards
    )
    public = all(grant.get("redistribution") in ("free", "in-build") for grant in grants)
    return allowed, "previews" if public else "private/previews"


def cards_for_stem(cards: dict[str, list[dict]], source: str) -> list[dict]:
    stem = str(Path(source).with_suffix("")).lower()
    return cards.get(stem, [])


def validate_inputs(packs: Path, only=None) -> None:
    if packs.is_symlink():
        raise ValueError("packs directory symlinks are not allowed")
    repo = Path(__file__).resolve().parents[3]
    selected = [pack for pack in sorted(packs.iterdir()) if pack.is_dir()
                and any(fnmatch.fnmatch(pack.name, pattern) for pattern in only or ["*"])] if packs.is_dir() else []
    if any(pack.is_symlink() for pack in selected):
        raise ValueError("collection directory symlinks are not allowed")
    if any((pack / "collection.card.json").is_symlink() for pack in selected):
        raise ValueError("collection card symlinks are not allowed")
    paths = [str(pack / "collection.card.json") for pack in selected if (pack / "collection.card.json").exists()]
    if any((pack / "cards").is_symlink() for pack in selected):
        raise ValueError("card directory symlinks are not allowed")
    cards = [path for pack in selected for path in sorted((pack / "cards").rglob("*.card.json"))]
    if any(path.is_symlink() for path in cards):
        raise ValueError("card symlinks are not allowed")
    paths += [str(path) for path in cards]
    if paths:
        result = subprocess.run(["node", str(repo / "packages/contracts/bin/validate-cards.mjs"), "--paths-stdin"], input=json.dumps(paths), capture_output=True, text=True)
        if result.returncode:
            raise ValueError("card validation failed before audio analysis: " + (result.stderr or result.stdout)[-3000:])


def extracted_root(pack: Path, version: str) -> Path:
    if not isinstance(version, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", version) or ".." in version:
        raise ValueError(f"invalid collection version in {pack}")
    root = (pack / version / "extracted").resolve()
    if not root.is_relative_to(pack.resolve()):
        raise ValueError(f"extracted directory escapes collection: {pack}")
    return root
