"""Resolve restrictive per-source rights before audio analysis and derivatives."""
import fnmatch
import json
import re
import subprocess
from pathlib import Path


def collection_rights(pack: Path) -> dict:
    try:
        return json.loads((pack / "collection.card.json").read_text()).get("rights") or {}
    except (OSError, json.JSONDecodeError):
        return {}


def source_cards(pack: Path) -> dict[str, list[dict]]:
    result = {}
    for path in sorted((pack / "cards").rglob("*.card.json")):
        try:
            card = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError) as exc:
            raise ValueError(f"cannot determine source rights from {path}: {exc}") from exc
        for source in card.get("source", {}).get("files", []):
            if isinstance(source.get("path"), str):
                result.setdefault(source["path"], []).append(card)
    return result


def allows_vision(rights: dict) -> bool:
    return "vision-input" in rights.get("uses", []) and rights.get("processing", "local-only") in ("any", "local-only")


def source_policy(collection: dict, cards: list[dict]) -> tuple[bool, str]:
    grants = [collection] + [card["rights"] for card in cards if card.get("rights") is not None]
    allowed = all(allows_vision(grant) for grant in grants)
    public = all(grant.get("redistribution") in ("free", "in-build") for grant in grants)
    return allowed, "previews" if public else "private/previews"


def cards_for_stem(cards: dict[str, list[dict]], source: str) -> list[dict]:
    stem = str(Path(source).with_suffix("")).lower()
    return [card for path, matches in cards.items() if str(Path(path).with_suffix("")).lower() == stem for card in matches]


def validate_inputs(packs: Path, only=None) -> None:
    repo = Path(__file__).resolve().parents[3]
    selected = [pack for pack in sorted(packs.iterdir()) if pack.is_dir()
                and any(fnmatch.fnmatch(pack.name, pattern) for pattern in only or ["*"])] if packs.is_dir() else []
    paths = [str(pack / "collection.card.json") for pack in selected if (pack / "collection.card.json").exists()]
    paths += [str(path) for pack in selected for path in sorted((pack / "cards").rglob("*.card.json"))]
    if paths:
        result = subprocess.run(["node", str(repo / "packages/contracts/bin/validate-cards.mjs"), "--paths-stdin"], input=json.dumps(paths), capture_output=True, text=True)
        if result.returncode:
            raise ValueError("card validation failed before audio analysis: " + result.stdout[-3000:])


def extracted_root(pack: Path, version: str) -> Path:
    if not isinstance(version, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", version) or ".." in version:
        raise ValueError(f"invalid collection version in {pack}")
    root = (pack / version / "extracted").resolve()
    if not root.is_relative_to(pack.resolve()):
        raise ValueError(f"extracted directory escapes collection: {pack}")
    return root
