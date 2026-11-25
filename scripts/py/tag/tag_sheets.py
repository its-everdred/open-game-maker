"""Tag model, sprite, and VFX cards from local preview sheets with cached CLIP."""

import argparse
import copy
import fnmatch
import hashlib
import json
import os
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from preview_paths import safe_preview

import numpy as np

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
ROOT = Path(os.environ.get("OGM_ASSETS_ROOT", REPO / "assets-local"))
SCHEMA = REPO / "packages/contracts/schemas/asset-card.schema.json"
VALIDATOR = REPO / "packages/contracts/bin/validate-cards.mjs"
CLIP_ID = "openai/clip-vit-large-patch14"
TOOL = "tag_sheets@0.1"
VISUAL_KINDS = {"model", "sprite", "vfx"}
CAPS = {"environments": 4, "settings": 2, "roles": 4, "materials": 3, "condition": 1, "moods": 3}
VOCAB_KEYS = {
    "environments": "environment",
    "settings": "setting",
    "roles": "role",
    "materials": "material",
    "condition": "condition",
    "moods": "mood",
}
PROMPTS = {
    "environments": "a game asset used in a {label}",
    "settings": "a {label} game asset",
    "roles": "a game asset used as {label}",
    "materials": "a game asset made of {label}",
    "condition": "a {label} game asset",
    "moods": "a {label} visual effect",
}
STOP_OBJECTS = {
    "sm", "bld", "obj", "mesh", "model", "models", "prop", "asset", "assets", "sprite", "sprites",
    "image", "images", "glb", "gltf", "png", "fbx", "format", "low", "poly", "copy", "new", "v",
}


def emit(record: dict, json_mode=False, summary=False):
    stream = sys.stderr if json_mode and summary else sys.stdout
    print(json.dumps(record), file=stream, flush=True)


def stage_json(out: Path, payload: dict) -> Path:
    out.parent.mkdir(parents=True, exist_ok=True)
    staged = out.with_name(out.name + ".part")
    staged.write_text(json.dumps(payload, indent=2) + "\n")
    return staged


def promote(staged: Path, out: Path):
    staged.replace(out)


def label_groups(schema_path: Path = SCHEMA) -> dict[str, list[str]]:
    vocab = json.loads(schema_path.read_text())["$defs"]["vocab"]
    return {field: vocab[key]["enum"] for field, key in VOCAB_KEYS.items()}


def rank_group(probabilities, labels: list[str], cap: int, threshold=1.5, seeds=None) -> list[dict]:
    matrix = np.asarray(probabilities, dtype=float)
    if matrix.ndim != 2 or matrix.shape[1] != len(labels):
        raise ValueError("probability matrix does not match labels")
    baseline = np.maximum(matrix.mean(axis=0), 1e-9)
    output = []
    for row_index, row in enumerate(matrix):
        candidates = []
        row_seeds = set(seeds[row_index]) if seeds else set()
        for index, label in enumerate(labels):
            lift = float(row[index] / baseline[index])
            if label in row_seeds:
                lift = max(threshold, lift * 1.5)
            if lift >= threshold:
                candidates.append((lift, float(row[index]), label))
        candidates.sort(key=lambda item: (item[2] not in row_seeds, -item[0], -item[1], item[2]))
        kept = candidates[:cap]
        confidence = max((min(0.9, lift / 3) for lift, _, _ in kept), default=0.0)
        output.append(
            {
                "values": [label for _, _, label in kept],
                "confidence": round(confidence, 4),
                "baseline_count": len(matrix),
            }
        )
    return output


def filename_objects(card: dict) -> list[str]:
    files = card.get("source", {}).get("files", [])
    primary = next((item for item in files if item.get("role") == "primary"), files[0] if files else {})
    stem = Path(primary.get("path", "")).stem
    words = re.findall(r"[a-z]+", re.sub(r"([a-z])([A-Z])", r"\1 \2", stem).lower())
    result = []
    for word in words:
        if word in STOP_OBJECTS or len(word) < 3:
            continue
        if word.endswith("s") and not word.endswith("ss") and len(word) > 4:
            word = word[:-1]
        if word not in result:
            result.append(word)
    return result[:6]


def _locked(card: dict, path: str) -> bool:
    provenance = card.get("provenance", {})
    keys = ["*"]
    parts = path.split(".")
    keys.extend(".".join(parts[:index]) for index in range(1, len(parts) + 1))
    return any(isinstance(provenance.get(key), dict) and provenance[key].get("locked") for key in keys)


def _model_provenance(confidence: float, baseline_count: int, now: str) -> dict:
    return {
        "by": "model",
        "model": CLIP_ID,
        "tool": TOOL,
        "at": now,
        "confidence": confidence,
        "input": f"local CLIP sheet ranking; lift baseline={baseline_count}",
    }


def merge_card(card: dict, selections: dict[str, dict], baseline_count: int, now: str | None = None) -> dict:
    merged = copy.deepcopy(card)
    now = now or datetime.now().astimezone().isoformat(timespec="seconds")
    describe = merged.setdefault("describe", {})
    provenance = merged.setdefault("provenance", {})
    applicable = set(CAPS)
    if merged.get("kind") != "vfx":
        applicable.remove("moods")

    for field in sorted(applicable):
        path = f"describe.{field}"
        if _locked(card, path):
            continue
        selection = selections.get(field, {"values": [], "confidence": 0.0})
        values = selection.get("values", [])
        if values:
            describe[field] = values[0] if field == "condition" else list(values)
            provenance[path] = _model_provenance(float(selection.get("confidence", 0)), baseline_count, now)
        elif provenance.get(path, {}).get("tool") == TOOL:
            describe.pop(field, None)
            provenance.pop(path, None)

    objects = filename_objects(card)
    if objects and not _locked(card, "describe.objects"):
        describe["objects"] = objects
        provenance["describe.objects"] = {
            "by": "filename",
            "tool": TOOL,
            "at": now,
            "input": "normalized primary filename nouns",
        }

    roles = describe.get("roles", [])
    if objects and roles and not _locked(card, "describe.description"):
        label = merged.get("title") or objects[0].replace("-", " ").title()
        role_text = ", ".join(role.replace("-", " ") for role in roles[:3])
        describe["description"] = f"{label} game asset showing {', '.join(objects[:3])}; useful as {role_text}."[:300]
        provenance["describe.description"] = {
            "by": "code",
            "tool": TOOL,
            "at": now,
            "input": "template from filename objects and CLIP enum roles",
        }

    core = bool(describe.get("description") and describe.get("objects") and describe.get("roles"))
    if merged.get("status") != "reviewed":
        merged["status"] = "tagged" if core else "measured"

    confidence = min(
        (float(value.get("confidence", 0)) for field, value in selections.items()
         if field in applicable and value.get("values")),
        default=0.0,
    )
    flags = list(merged.get("flags", []))
    bounds = merged.get("geometry", {}).get("bounds_m", {})
    minimum, maximum = bounds.get("min"), bounds.get("max")
    if ("floor" in roles and isinstance(minimum, list) and isinstance(maximum, list)
            and len(minimum) > 1 and len(maximum) > 1
            and float(maximum[1]) - float(minimum[1]) >= 0.3
            and "conflicts-with-measured" not in flags):
        flags.append("conflicts-with-measured")
    owned_low = provenance.get("flags.low_confidence", {}).get("tool") == TOOL
    if confidence < 0.6:
        if "low-confidence" not in flags:
            flags.append("low-confidence")
            owned_low = True
        if owned_low:
            provenance["flags.low_confidence"] = {
                "by": "code",
                "tool": TOOL,
                "at": now,
                "confidence": confidence,
                "input": f"CLIP confidence threshold; lift baseline={baseline_count}",
            }
    elif owned_low:
        flags = [flag for flag in flags if flag != "low-confidence"]
        provenance.pop("flags.low_confidence", None)
    if flags:
        merged["flags"] = flags
    else:
        merged.pop("flags", None)
    return merged


def load_clip(model_class=None, processor_class=None):
    if model_class is None or processor_class is None:
        import torch
        from transformers import CLIPModel, CLIPProcessor
        torch.set_num_threads(int(os.environ.get("OGM_TORCH_THREADS", "2")))
        model_class, processor_class = CLIPModel, CLIPProcessor
    try:
        model = model_class.from_pretrained(CLIP_ID, local_files_only=True)
        processor = processor_class.from_pretrained(CLIP_ID, local_files_only=True)
    except OSError as error:
        cache = Path(os.environ.get("HF_HUB_CACHE", Path(os.environ.get("HF_HOME", Path.home() / ".cache/huggingface")) / "hub"))
        raise RuntimeError(f"{CLIP_ID} is missing from the local Hugging Face cache {cache}; offline tagging cannot start") from error
    return model.eval(), processor


def _image_features(images: list[Path], model, processor, batch_size=16):
    import torch
    from PIL import Image

    rows = []
    for start in range(0, len(images), batch_size):
        opened = []
        try:
            for path in images[start : start + batch_size]:
                with Image.open(path) as image:
                    opened.append(image.convert("RGB").copy())
            inputs = processor(images=opened, return_tensors="pt")
            with torch.no_grad():
                rows.append(torch.nn.functional.normalize(model.get_image_features(**inputs), dim=-1).cpu())
            emit({"progress": {"done": min(start + batch_size, len(images)), "total": len(images)}})
        finally:
            for image in opened:
                image.close()
    return torch.cat(rows, dim=0)


def _probabilities(features, prompts: list[str], model, processor) -> np.ndarray:
    import torch

    text_inputs = processor(text=prompts, return_tensors="pt", padding=True)
    with torch.no_grad():
        text = torch.nn.functional.normalize(model.get_text_features(**text_inputs), dim=-1).cpu()
    logits = (features @ text.T).numpy()
    logits -= logits.max(axis=1, keepdims=True)
    exp = np.exp(logits * 100)
    return exp / exp.sum(axis=1, keepdims=True)


def score_rows(rows: list[dict], model, processor) -> list[dict[str, dict]]:
    groups = label_groups()
    result = [dict() for _ in rows]
    features = _image_features([row["preview"] for row in rows], model, processor)
    for field, labels in groups.items():
        indices = [index for index, row in enumerate(rows) if field != "moods" or row["card"].get("kind") == "vfx"]
        if not indices:
            continue
        prompts = [PROMPTS[field].format(label=label.replace("-", " ")) for label in labels]
        seeds = []
        for index in indices:
            card = rows[index]["card"]
            words = set(filename_objects(card))
            origin = card.get("provenance", {}).get(f"describe.{field}", {}).get("by")
            existing = card.get("describe", {}).get(field, []) if origin == "filename" else []
            existing = [existing] if isinstance(existing, str) else existing
            seeds.append([label for label in labels if label in words or label in existing])
        ranked = rank_group(_probabilities(features[indices], prompts, model, processor), labels, CAPS[field], seeds=seeds)
        for index, selection in zip(indices, ranked):
            result[index][field] = selection
    return result


def expected_sheet_key(card: dict, collection_rights: dict, restrictions=()) -> str | None:
    files = card.get("source", {}).get("files", [])
    primary = next((file for file in files if file.get("role") == "primary"), files[0] if files else {})
    source_hash = primary.get("sha256", "")
    if not isinstance(source_hash, str) or not source_hash.startswith("sha256:"):
        return None
    grants = [collection_rights]
    for other in (restrictions or [card]):
        if "rights" in other:
            grants.append(other["rights"])
    prefix = "previews" if all(isinstance(grant, dict) and grant.get("redistribution") in ("free", "in-build") for grant in grants) else "private/previews"
    kind = card.get("kind")
    params = {"version": 1}
    if kind == "sprite":
        params = {"pixelArt": card.get("image", {}).get("pixel_art") is True, "version": 1}
    payload = {"sourceHash": source_hash.removeprefix("sha256:"), "kind": f"{kind}-sheet", "parameters": params}
    digest = hashlib.sha256(json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
    return f"{prefix}/{digest[:2]}/{digest[:16]}-{kind}-sheet.webp"


def eligible_cards(pack: Path, kind: str | None = None, *, include_reviewed=False, required_uses=("vision-input",), facing=None) -> list[dict]:
    if pack.is_symlink():
        raise ValueError("collection directory symlinks are not allowed")
    try:
        if (pack / "collection.card.json").is_symlink():
            raise ValueError("collection card symlinks are not allowed")
        collection = json.loads((pack / "collection.card.json").read_text())
    except (OSError, json.JSONDecodeError):
        return []
    rights = collection.get("rights", {})
    try:
        version = json.loads((pack / "pack.json").read_text())["current"]
        if not isinstance(version, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", version) or ".." in version:
            return []
        extracted = (pack / version / "extracted").resolve()
        if not extracted.is_relative_to(pack.resolve()):
            return []
    except (OSError, json.JSONDecodeError, KeyError, TypeError):
        return []
    if not all(use in rights.get("uses", []) for use in required_uses) or rights.get("processing", "local-only") not in ("any", "local-only"):
        return []
    assets_root = pack.parents[1]
    rows = []
    if (pack / "cards").is_symlink():
        raise ValueError("card directory symlinks are not allowed")
    paths = sorted((pack / "cards").rglob("*.card.json"))
    if any(path.is_symlink() for path in paths):
        raise ValueError("card symlinks are not allowed")
    cards = [(path, json.loads(path.read_text())) for path in paths]
    by_source = {}
    for path, item in cards:
        if item.get("collection") != collection.get("id"):
            raise ValueError(f"asset card belongs to a different collection: {path}")
        for file in item.get("source", {}).get("files", []):
            name = file.get("path")
            if not isinstance(name, str) or not name or "\\" in name or name.startswith("/") or any(part in ("", ".", "..") for part in name.split("/")):
                raise ValueError("noncanonical visual asset source path")
            candidate = extracted / name
            if candidate.resolve() != candidate or not candidate.resolve().is_relative_to(extracted):
                raise ValueError(f"visual source alias: {name}")
            by_source.setdefault(name, []).append(item)
    for path, card in cards:
        if not include_reviewed and (card.get("status") == "reviewed" or _locked(card, "previews.sheet")):
            continue
        if card.get("kind") not in VISUAL_KINDS or (kind and card.get("kind") != kind):
            continue
        if card.get("kind") == "model":
            files = card.get("source", {}).get("files", [])
            primary = next((file for file in files if file.get("role") == "primary"), files[0] if files else {})
            if primary.get("format") != "glb":
                continue
        files = card.get("source", {}).get("files", [])
        primary = next((file for file in files if file.get("role") == "primary"), files[0] if files else {})
        if facing is not None:
            if card.get("kind") != "sprite":
                continue
            selected = card.get("sprite", {}).get("facings", {}).get(facing)
            primary = next((file for file in files if file.get("path") == selected), {})
            if not selected or not primary:
                continue
        restrictions = by_source.get(primary.get("path"), [card])
        grants = [item["rights"] if "rights" in item else rights for item in restrictions]
        if any(not isinstance(grant, dict) or any(use not in grant.get("uses", []) for use in required_uses) or grant.get("processing", "local-only") not in ("any", "local-only") for grant in grants):
            continue
        source = (extracted / primary.get("path", "")).resolve()
        if source != extracted / primary.get("path", "") or not source.is_relative_to(extracted) or not source.is_file():
            continue
        with source.open("rb") as stream:
            actual_hash = "sha256:" + hashlib.file_digest(stream, "sha256").hexdigest()
        if actual_hash != primary.get("sha256"):
            continue
        if facing is not None:
            rows.append({"card": card, "path": path, "preview": source, "collection": pack / "collection.card.json"})
            continue
        preview = card.get("previews", {}).get("sheet")
        if isinstance(preview, str) and preview == expected_sheet_key(card, rights, restrictions):
            preview_path = safe_preview(assets_root, preview).resolve()
            try:
                preview_path.relative_to(assets_root.resolve())
            except ValueError:
                continue
            rows.append({"card": card, "path": path, "preview": preview_path, "collection": pack / "collection.card.json"})
    return rows


def validate(packs: Path, staged: list[Path], only=None):
    selected = lambda path: any(fnmatch.fnmatch(path.relative_to(packs).parts[0], pattern) for pattern in only or ["*"])
    collections = sorted(str(path) for path in packs.glob("*/collection.card.json") if selected(path))
    cards = sorted(str(path) for path in packs.glob("*/cards/**/*.card.json") if selected(path))
    result = subprocess.run(
        ["node", str(VALIDATOR), "--paths-stdin"],
        input=json.dumps([*collections, *cards, *(str(path) for path in staged)]),
        capture_output=True,
        text=True,
    )
    failures = [line for line in result.stdout.splitlines() if line.startswith("FAIL")]
    return result.returncode, failures, result.stdout


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--packs", type=Path, default=ROOT / "packs")
    parser.add_argument("--only", action="append", help="pack id glob; repeat to select several packs")
    parser.add_argument("--kind", choices=sorted(VISUAL_KINDS))
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    if args.packs.is_symlink():
        raise ValueError("packs directory symlinks are not allowed")

    rows = []
    for pack in sorted(args.packs.iterdir() if args.packs.is_dir() else []):
        if pack.is_dir() and any(fnmatch.fnmatch(pack.name, pattern) for pattern in args.only or ["*"]):
            rows.extend(eligible_cards(pack, args.kind))
    if not rows:
        emit({"eligible": 0, "reason": "no local vision-input cards with previews"}, args.json, summary=True)
        raise SystemExit(2)

    inputs = sorted({str(row["collection"]) for row in rows})
    inputs.extend(str(row["path"]) for row in rows)
    checked = subprocess.run(["node", str(VALIDATOR), "--paths-stdin"], input=json.dumps(inputs), capture_output=True, text=True)
    if checked.returncode:
        print("card validation failed before visual analysis: " + (checked.stderr or checked.stdout)[-3000:], file=sys.stderr)
        raise SystemExit(1)
    model, processor = load_clip()
    selections = score_rows(rows, model, processor)
    selected = list(zip(rows, selections))[: args.limit or None]
    staged = []
    records = []
    for row, labels in selected:
        merged = merge_card(row["card"], labels, baseline_count=len(rows))
        part = stage_json(row["path"], merged)
        staged.append(part)
        records.append((row["path"], part, merged))
    rc, failures, output = validate(args.packs, staged, args.only)
    if rc:
        for path, _, card in records:
            if args.json:
                emit({"card": path.relative_to(ROOT).as_posix(), "status": "invalid", "flags": card.get("flags", []), "errors": failures})
        for part in staged:
            part.unlink(missing_ok=True)
        if not failures:
            print(output[-3000:], file=sys.stderr)
        raise SystemExit(1)
    for path, part, card in records:
        promote(part, path)
        emit({"card": path.relative_to(ROOT).as_posix(), "status": card["status"], "flags": card.get("flags", [])}, args.json)
    emit({"eligible": len(rows), "written": len(records), "baseline_count": len(rows)}, args.json, summary=True)


if __name__ == "__main__":
    main()
