"""Backfill pack discovery metadata and recover Unity sources without changing originals.

Run with Python isolated mode. The default is a dry run; --apply writes card metadata
and creates a new discovery-sources directory beside the existing extracted tree.
"""
import argparse
import fcntl
import hashlib
from datetime import datetime, timezone
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tarfile
import tempfile
import unicodedata

CAMERAS = ["isometric", "top-down", "third-person", "first-person", "side"]
RULES = {
    "medieval-village": r"medieval.*village|village.*medieval",
    "tavern": r"tavern|\binn\b",
    "castle": r"castle",
    "crypt": r"crypt|ossuary",
    "cave": r"cave|cavern",
    "dungeon": r"dungeon",
    "ruins": r"ruin",
    "forest": r"forest|woodland",
    "desert": r"desert",
    "modern-city": r"modern.*city|city.*modern",
    "sci-fi": r"sci.?fi|cyberpunk",
}
MAX_MEMBERS = 200_000
MAX_SOURCE = 64 * 1024 * 1024
MAX_TOTAL = 32 * 1024 * 1024 * 1024
GUID = re.compile(r"^[0-9a-fA-F]{32}$")
ID = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
VERSION = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


def settings(names):
    return [key for key, pattern in RULES.items() if any(re.search(pattern, re.sub(r"[_-]+", " ", name), re.I) for name in names)]


def safe_member(path):
    if not path or "\\" in path or any(unicodedata.category(char) in ("Cc", "Cf") for char in path):
        raise ValueError("unsafe Unity pathname")
    parts = PurePosixPath(path).parts
    if path.startswith("/") or any(part in (".", "..") for part in parts) or re.match(r"^[A-Za-z]:", path):
        raise ValueError("unsafe Unity pathname")
    return path


def unity_sources(archive):
    """Map Unity package GUIDs to safe logical paths; do not extract archive members."""
    paths = {}
    logical_paths = set()
    seen = set()
    total = 0
    with tarfile.open(archive, "r|gz") as tar:
        for number, member in enumerate(tar, 1):
            total += member.size
            if member.size < 0 or number > MAX_MEMBERS or total > MAX_TOTAL:
                raise ValueError("archive exceeds member or size limit")
            if not member.name.endswith("/pathname"):
                continue
            guid = member.name[:-len("/pathname")]
            if not GUID.fullmatch(guid) or not member.isfile() or member.size > 4096 or guid in seen:
                raise ValueError("invalid or duplicate Unity pathname")
            seen.add(guid)
            content = tar.extractfile(member)
            path = PurePosixPath(safe_member(content.read().decode("utf-8").strip())).as_posix()
            if path.lower().endswith((".unity", ".prefab")):
                if path in logical_paths:
                    raise ValueError("duplicate Unity source path")
                logical_paths.add(path)
                paths[guid] = path
    compressed = archive.stat().st_size
    if total > 1024 * 1024 and compressed > 0 and total / compressed > 200:
        raise ValueError("archive exceeds compression-ratio limit")
    return paths


def sidecar_guid(content):
    if b"\r" in content.replace(b"\r\n", b""):
        return None
    matches = re.findall(rb"(?mi)^[ \t]*guid:[ \t]*([0-9a-f]{32})[ \t]*\r?$", content)
    return matches[0].decode("ascii").lower() if len(matches) == 1 else None


def matching_existing(archive, paths, version_dir, existing, archive_index):
    """Match retained sources by Unity GUID, basename, size and content."""
    candidates = {}
    for local in existing:
        candidates.setdefault(PurePosixPath(local).name.lower(), []).append(version_dir / local)
    relevant = {guid: candidates.get(PurePosixPath(name).name.lower(), []) for guid, name in paths.items()}
    relevant = {guid: files for guid, files in relevant.items() if files}
    if not relevant:
        return set()
    matched = set()
    seen = set()
    total = 0
    cache = {}
    sidecar_cache = {}
    with tarfile.open(archive, "r|gz") as tar:
        for number, member in enumerate(tar, 1):
            total += member.size
            if member.size < 0 or number > MAX_MEMBERS or total > MAX_TOTAL:
                raise ValueError("archive exceeds member or size limit")
            parts = member.name.split("/")
            if len(parts) != 2 or parts[0] not in relevant or parts[1] != "asset":
                continue
            guid = parts[0]
            if guid in seen or not member.isfile() or member.size > MAX_SOURCE:
                raise ValueError("invalid or duplicate Unity source")
            seen.add(guid)
            possible = []
            for path in relevant[guid]:
                sidecar = path.with_name(path.name + ".meta")
                if sidecar.is_symlink():
                    continue
                expected = version_dir / "discovery-sources" / str(archive_index) / paths[guid]
                owned_path = path == expected
                if sidecar.is_file():
                    if sidecar not in sidecar_cache:
                        sidecar_cache[sidecar] = sidecar_guid(sidecar.read_bytes()) if sidecar.stat().st_size <= 64 * 1024 else None
                    if sidecar_cache[sidecar] != guid.lower():
                        continue
                elif not owned_path:
                    continue
                if path.stat().st_size == member.size:
                    possible.append(path)
            if not possible:
                continue
            with tar.extractfile(member) as source:
                digest = hashlib.file_digest(source, "sha256").digest()
            for path in possible:
                if path not in cache:
                    with path.open("rb") as source:
                        cache[path] = hashlib.file_digest(source, "sha256").digest()
                if cache[path] == digest:
                    matched.add(guid)
                    break
    return matched


def executable_header(header):
    return header.startswith((b"MZ", b"#!")) or header == b"\x7fELF" or header in (
        b"\xfe\xed\xfa\xce", b"\xfe\xed\xfa\xcf", b"\xce\xfa\xed\xfe",
        b"\xcf\xfa\xed\xfe", b"\xca\xfe\xba\xbe",
    )


def recover(archive, paths, destination):
    """Copy only scene, prefab and matching sidecar bytes into an empty directory."""
    seen = set()
    total = 0
    with tarfile.open(archive, "r|gz") as tar:
        for number, member in enumerate(tar, 1):
            total += member.size
            if member.size < 0 or number > MAX_MEMBERS or total > MAX_TOTAL:
                raise ValueError("archive exceeds member or size limit")
            pieces = member.name.split("/")
            if len(pieces) != 2 or pieces[0] not in paths or pieces[1] not in ("asset", "asset.meta"):
                continue
            key = tuple(pieces)
            is_meta = pieces[1] == "asset.meta"
            if key in seen or not member.isfile() or member.size > (64 * 1024 if is_meta else MAX_SOURCE):
                raise ValueError("invalid or duplicate Unity source")
            seen.add(key)
            suffix = ".meta" if is_meta else ""
            target = destination.joinpath(*PurePosixPath(paths[pieces[0]] + suffix).parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open("xb") as out:
                source = tar.extractfile(member)
                if is_meta:
                    content = source.read()
                    if executable_header(content[:4]):
                        raise ValueError("executable content in Unity source")
                    if sidecar_guid(content) != pieces[0].lower():
                        raise ValueError("Unity sidecar GUID does not match its source")
                    out.write(content)
                else:
                    header = source.read(4)
                    if executable_header(header):
                        raise ValueError("executable content in Unity source")
                    out.write(header)
                    shutil.copyfileobj(source, out)
    if any((guid, "asset") not in seen for guid in paths):
        raise ValueError("Unity package source is missing")


def family_map(path):
    families = json.loads(path.read_text())
    result = {}
    for family in families:
        packs = family["packs"]["primary"] + family["packs"]["extras"]
        packs += [pack["id"] for group in family["sets"] for pack in group["packs"]]
        for pack in packs:
            result[pack] = family["id"]
    return result


def perspective_map(path):
    families = json.loads(path.read_text())
    result = {}
    for family in families:
        for group in family["sets"]:
            perspective = group.get("traits", {}).get("perspective", "").lower()
            cameras = []
            if re.search(r"isometric|\biso\b", perspective):
                cameras.append("isometric")
            if re.search(r"top[ -]?down", perspective):
                cameras.append("top-down")
            if re.search(r"\bside\b|platformer", perspective):
                cameras.append("side")
            for pack in group["packs"]:
                result[pack["id"]] = cameras
    return result


def field_locked(card, field):
    provenance = card.get("provenance", {})
    return bool(provenance.get("*", {}).get("locked") or provenance.get(field, {}).get("locked"))


def fingerprint(path):
    if path.is_symlink():
        raise ValueError("archive became a symlink")
    info = path.stat()
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns)


def backfill(root, pack_id, families, apply=False, classification=None, metadata_only=False, perspectives=None):
    if not ID.fullmatch(pack_id):
        raise ValueError("invalid pack id")
    pack = root / "packs" / pack_id
    if pack.is_symlink() or not pack.is_dir():
        raise ValueError("pack directory must be a real directory")
    card_path = pack / "collection.card.json"
    if card_path.is_symlink():
        raise ValueError("collection card must not be a symlink")
    original = card_path.read_bytes()
    card = json.loads(original)
    if card.get("card_type") != "collection" or card.get("status") in ("quarantined", "rejected"):
        raise ValueError("pack is not a confirmed collection")
    # Tier-2 collections may contain individual rights; only their pack metadata can be inferred here.
    tier = card.get("id", "").split(":", 1)[0]
    if tier not in ("t1", "t2"):
        raise ValueError("invalid collection tier")
    version = card.get("collection_info", {}).get("version", "")
    if not VERSION.fullmatch(version) or version in (".", ".."):
        raise ValueError("invalid version")
    if card.get("id") != f"{tier}:{pack_id}@{version}":
        raise ValueError("collection id does not match pack and version")
    version_dir = pack / version
    if version_dir.is_symlink() or not version_dir.is_dir():
        raise ValueError("version directory must be a real directory")
    originals = version_dir / "originals"
    manifest_path = pack / "pack.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.is_file() and not manifest_path.is_symlink() else {}
    bundle_source = manifest.get("versions", {}).get(version, {}).get("format") == "bundle"
    original_files = [path for path in originals.rglob("*") if path.is_file() and not path.is_symlink()] if originals.is_dir() and not originals.is_symlink() else []
    archives = sorted(path for path in original_files if path.suffix.lower() == ".unitypackage")
    unscanned = [path for path in original_files if path.suffix.lower() in (".zip", ".7z", ".rar", ".tar", ".tgz", ".gz")]
    fingerprints = {path: fingerprint(path) for path in archives}
    found = [(path, unity_sources(path)) for path in archives] if tier == "t1" and not metadata_only else []
    if any(fingerprint(path) != fingerprints[path] for path in archives):
        raise ValueError("archive changed while being scanned")
    found = [(path, {guid: name for guid, name in paths.items() if not field_locked(card, "scenes" if name.lower().endswith(".unity") else "prefabs")}) for path, paths in found]
    names = [name for _, paths in found for name in paths.values()]
    existing = []
    if tier == "t1" and not metadata_only:
        for directory in (version_dir / "extracted", version_dir / "discovery-sources"):
            if not directory.is_dir() or directory.is_symlink():
                continue
            for path in directory.rglob("*"):
                if path.is_symlink() or not path.is_file():
                    continue
                local = path.relative_to(version_dir).as_posix()
                lower = local.lower()
                is_scene_glb = lower.endswith(".glb") and (path.stem.lower() in ("scene", "demo") or "scenes" in PurePosixPath(lower).parts)
                field = "prefabs" if lower.endswith(".prefab") else "scenes"
                if (lower.endswith((".unity", ".umap", ".prefab")) or is_scene_glb) and not field_locked(card, field):
                    existing.append(local)
    if existing:
        filtered = []
        for index, (archive, paths) in enumerate(found):
            duplicates = matching_existing(archive, paths, version_dir, existing, index)
            if fingerprint(archive) != fingerprints[archive]:
                raise ValueError("archive changed while comparing sources")
            filtered.append((archive, {guid: name for guid, name in paths.items() if guid not in duplicates}))
        found = filtered
    names = [name for _, paths in found for name in paths.values()]
    updated = dict(card)
    if classification is not None:
        if not isinstance(classification, dict) or set(classification) - {"style_family", "cameras"}:
            raise ValueError("invalid classification fields")
        family = classification.get("style_family")
        cameras = classification.get("cameras")
        if family is not None and (not isinstance(family, str) or family not in set(families.values())):
            raise ValueError("unknown style family")
        if cameras is not None and (not isinstance(cameras, list) or any(camera not in CAMERAS for camera in cameras) or len(cameras) != len(set(cameras))):
            raise ValueError("invalid or duplicate cameras")
        if pack_id.startswith("smallscaleint-") and cameras is not None and any(camera != "isometric" for camera in cameras):
            raise ValueError("SmallScaleInt cameras must be isometric")
        for field, value in (("style_family", family), ("cameras", cameras)):
            if value is None:
                continue
            if field_locked(card, field) and card.get(field) != value:
                raise ValueError(f"{field} is locked")
            updated[field] = value
    if "style_family" not in updated and not field_locked(card, "style_family"):
        family = families.get(pack_id) or card.get("describe", {}).get("style_family")
        if family in set(families.values()):
            updated["style_family"] = family
    if "cameras" not in updated and not field_locked(card, "cameras"):
        counts = card.get("collection_info", {}).get("counts", {})
        pov = card.get("describe", {}).get("pov_fit", [])
        views = [camera for old, camera in (("iso", "isometric"), ("topdown", "top-down"), ("side", "side"), ("follow", "third-person"), ("fps", "first-person")) if old in pov]
        curated = (perspectives or {}).get(pack_id, [])
        updated["cameras"] = (["isometric"] if pack_id.startswith("smallscaleint-") else CAMERAS[:] if counts.get("model", 0) else list(dict.fromkeys([*curated, *views])))
    recorded = [scene.get("path", "") for scene in card.get("scenes", [])] + list(card.get("prefabs", []))
    inferred_settings = settings([pack_id, card.get("title", ""), *names, *existing, *recorded])
    locked = field_locked(card, "settings")
    if not locked:
        updated["settings"] = list(dict.fromkeys([*(card.get("settings") or []), *inferred_settings]))
    scenes = list(card.get("scenes") or [])
    prefabs = list(card.get("prefabs") or [])
    scene_paths = {scene["path"] for scene in scenes}
    for name in sorted(existing):
        path = f"packs/{pack_id}/{version}/{name}"
        if name.lower().endswith(".prefab"):
            if path not in prefabs:
                prefabs.append(path)
        elif path not in scene_paths:
            engine = "glb" if name.lower().endswith(".glb") else "unreal" if name.lower().endswith(".umap") else "unity"
            scenes.append({"path": path, "engine": engine, "settings": settings([pack_id, card.get("title", ""), name]), "preview": None})
            scene_paths.add(path)
    for index, (_, paths) in enumerate(found):
        for name in sorted(paths.values()):
            path = f"packs/{pack_id}/{version}/discovery-sources/{index}/{name}"
            if name.lower().endswith(".unity"):
                scenes.append({"path": path, "engine": "unity", "settings": settings([pack_id, card.get("title", ""), name]), "preview": None})
            else:
                prefabs.append(path)
    if tier == "t1" and not metadata_only:
        if not bundle_source and not field_locked(card, "scenes"):
            updated["scenes"] = scenes
        if not bundle_source and not field_locked(card, "prefabs"):
            updated["prefabs"] = prefabs
    if "settings" not in card and not locked:
        provenance = dict(card.get("provenance", {}))
        provenance["settings"] = {"by": "filename", "tool": "gm-pack-backfill@0.1", "at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")}
        updated["provenance"] = provenance
    counts = card.get("collection_info", {}).get("counts", {})
    kinds = {key.split("/", 1)[0] for key, count in counts.items() if count}
    audio_only = bool(kinds) and kinds <= {"audio"}
    not_applicable = ["style_family", "cameras"] if audio_only else []
    if card.get("describe", {}).get("style_family") == "any" and "style_family" not in not_applicable:
        not_applicable.append("style_family")
    missing = [field for field in ("style_family", "cameras") if not updated.get(field) and field not in not_applicable]
    if any(not scene.get("preview") for scene in scenes):
        missing.append("scene-previews")
    if unscanned:
        missing.append("unscanned-archives")
    if bundle_source:
        missing.append("bundle-source-not-scanned")
    if tier == "t2":
        missing.append("per-file-rights")
    if metadata_only and archives:
        missing.append("scene-sources-not-scanned")
    if not apply:
        return {"pack": pack_id, "scenes": len(scenes), "prefabs": len(prefabs), "missing": missing, "not_applicable": not_applicable, "applied": False}
    lock_path = pack / ".gm-tag.lock"
    lock_fd = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BaseException:
        os.close(lock_fd)
        raise
    destination = version_dir / "discovery-sources"
    created = False
    staging = None
    temp_path = None
    try:
        if names:
            if destination.exists() or destination.is_symlink():
                raise FileExistsError("discovery-sources exists but does not contain all recovered sources")
            staging = Path(tempfile.mkdtemp(prefix=".discovery-stage-", dir=version_dir))
            for index, (archive, paths) in enumerate(found):
                if not paths:
                    continue
                if fingerprint(archive) != fingerprints[archive]:
                    raise ValueError("archive changed before recovery")
                recover(archive, paths, staging / str(index))
                if fingerprint(archive) != fingerprints[archive]:
                    raise ValueError("archive changed during recovery")
        if card_path.read_bytes() != original:
            raise ValueError("collection card changed during backfill")
        with tempfile.NamedTemporaryFile("w", dir=pack, prefix=".discovery-card-", delete=False) as tmp:
            temp_path = Path(tmp.name)
            json.dump(updated, tmp, indent=2)
            tmp.write("\n")
        validator = Path(__file__).resolve().parents[2] / "packages/contracts/bin/validate-cards.mjs"
        result = subprocess.run(["node", str(validator), "--no-fixtures", str(temp_path)], capture_output=True, text=True, check=False, timeout=60)
        if result.returncode:
            raise ValueError(f"card validation failed: {result.stderr.strip() or result.stdout.strip()}")
        os.chmod(temp_path, card_path.stat().st_mode & 0o777)
        if card_path.read_bytes() != original:
            raise ValueError("collection card changed during backfill")
        if staging:
            if destination.exists() or destination.is_symlink():
                raise FileExistsError("discovery-sources appeared during recovery")
            os.rename(staging, destination)
            staging = None
            created = True
        os.replace(temp_path, card_path)
        return {"pack": pack_id, "scenes": len(scenes), "prefabs": len(prefabs), "missing": missing, "not_applicable": not_applicable, "applied": True}
    except BaseException:
        if created:
            shutil.rmtree(destination)
        if temp_path:
            temp_path.unlink(missing_ok=True)
        raise
    finally:
        if staging:
            shutil.rmtree(staging, ignore_errors=True)
        fcntl.flock(lock_fd, fcntl.LOCK_UN)
        os.close(lock_fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument("--only", help="exact pack id")
    selection.add_argument("--all", action="store_true", help="visit every collection card")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--metadata-only", action="store_true", help="skip source recovery when updating classifications")
    parser.add_argument("--classifications", type=Path, help="JSON object keyed by pack id with style_family and/or cameras")
    args = parser.parse_args()
    registry = Path(__file__).resolve().parents[2] / "packages/asset-cards/data/style-families.json"
    families = family_map(registry)
    perspectives = perspective_map(registry)
    classifications = json.loads(args.classifications.read_text()) if args.classifications else {}
    if not isinstance(classifications, dict):
        parser.error("classifications must be an object keyed by pack id")
    ids = [args.only] if args.only else sorted(path.parent.name for path in (args.root / "packs").glob("*/collection.card.json"))
    unknown = set(classifications) - set(ids)
    if unknown:
        parser.error(f"classifications reference unselected packs: {', '.join(sorted(unknown))}")
    failed = False
    for pack_id in ids:
        try:
            result = backfill(args.root, pack_id, families, args.apply, classifications.get(pack_id), args.metadata_only, perspectives)
            print(json.dumps(result), flush=True)
            if args.apply and result["missing"]:
                failed = True
        except (OSError, ValueError, TypeError, KeyError, AttributeError, tarfile.TarError, UnicodeError, subprocess.TimeoutExpired) as error:
            failed = True
            print(json.dumps({"pack": pack_id, "error": str(error)}), flush=True)
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
