"""Resolve restrictive per-source rights before audio analysis and derivatives."""
import json
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
    return "vision-input" in rights.get("uses", []) and rights.get("processing") in ("any", "local-only")


def source_policy(collection: dict, cards: list[dict]) -> tuple[bool, str]:
    grants = [collection] + [card["rights"] for card in cards if card.get("rights") is not None]
    allowed = all(allows_vision(grant) for grant in grants)
    public = all(grant.get("redistribution") in ("free", "in-build") for grant in grants)
    return allowed, "previews" if public else "private/previews"


def cards_for_stem(cards: dict[str, list[dict]], source: str) -> list[dict]:
    stem = str(Path(source).with_suffix("")).lower()
    return [card for path, matches in cards.items() if str(Path(path).with_suffix("")).lower() == stem for card in matches]
