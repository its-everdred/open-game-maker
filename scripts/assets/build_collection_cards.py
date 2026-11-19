"""Write a C3 collection card (packs/<id>/collection.card.json) for every pack (C3 §9 migration).

Licences come from the table in packages/asset-cards/data/licenses.json (emitted from licenses.ts; pack.json keeps its
old licence strings as aliases). Facts come from pack.json and the extracted files (code); describe tags come from
data/collection_tags.jsonl, written by Claude from each pack's title, folder names and filename words (no images looked
at). A pack with no tags row gets a draft card whose description is its title. Sidetrax packs keep their importer's
describe, collection info and Kevin's interpretation. Existing interpretation and decision entries, locked provenance
fields and audio counts (build_audio_cards.py) survive; a card equal to the one on disk apart from `provenance.*.at` is
left untouched. Every card is validated before it is written; a failing card is not written and is listed.
Run: python3 -I scripts/assets/build_collection_cards.py [--root DIR] [--only GLOB] [--dry-run] [--report]
"""
import argparse
import copy
import fnmatch
import json
import subprocess
import sys
import tempfile
from collections import Counter, defaultdict
from datetime import date, datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import smallscaleint
import smallscaleint_thumbnails
import limezu_layout

REPO = Path(__file__).resolve().parents[2]
TAGS = Path(__file__).parent / "data" / "collection_tags.jsonl"
LICENSES_JSON = REPO / "packages" / "asset-cards" / "data" / "licenses.json"
STYLE_FAMILIES_JSON = REPO / "packages" / "asset-cards" / "data" / "style-families.json"
VALIDATOR = REPO / "packages" / "contracts" / "bin" / "validate-cards.mjs"
VOCAB = "2026-10-27"
NOW = datetime.now().astimezone().isoformat(timespec="seconds")
TODAY = date.today().isoformat()
TOOL = "build_collection_cards@0.2"
STRICT_DEFAULT = {"uses": ["vision-input"], "audience": "private", "redistribution": "none"}
ORDER = {"audience": ["private", "public"], "redistribution": ["none", "in-build", "free"]}
KIND_BY_EXT = {"glb": "model", "gltf": "model", "fbx": "model", "obj": "model", "blend": "model", "dae": "model",
               "png": "sprite", "svg": "sprite", "jpg": "sprite", "tga": "texture", "psd": "texture",
               "ogg": "audio", "wav": "audio", "mp3": "audio", "ttf": "ui", "otf": "ui"}
# collection_tags.jsonl `fc` letters -> C3 §8 family_coverage keys.
FAMILY_COVERAGE = {"c": "characters", "e": "environment", "p": "props", "u": "ui", "s": "sfx", "m": "music"}
SKIP_NAMES = {"preview.png", "sample.png", "license.txt", "icon.png"}

# Readers receive the extracted directory and collection card. Explicit pack
# membership prevents a reader from replacing unrelated cards from that vendor.
ITEM_BUILDERS = {
    "limezu": {"limezu-modern-farm": limezu_layout.build_cards},
}


def load_style_compatibility(path: Path = STYLE_FAMILIES_JSON) -> dict[str, dict]:
    """Curated pack id -> family and compatibility set; membership is written during intake step 7b."""
    return {
        pack["id"]: {"family": family["id"], "set": style_set["id"], "compatible_with": pack.get("compatible_with", [])}
        for family in json.loads(path.read_text())
        for style_set in family.get("sets", [])
        for pack in style_set["packs"]
    }


STYLE_COMPATIBILITY_BY_PACK = load_style_compatibility()


def load_table(path: Path = LICENSES_JSON) -> dict:
    """Licence rows keyed by lower-cased id and alias."""
    table = {}
    for row in json.loads(path.read_text()):
        for key in [row["id"], *row["aliases"]]:
            table[key.lower()] = row
    return table


def license_row(value: str, table: dict) -> dict:
    row = table.get(str(value).lower())
    if row is None:
        raise KeyError(f"licence {value!r} is not in {LICENSES_JSON.relative_to(REPO)}")
    return row


def basis_from_row(row: dict, ref: str, day: str) -> list:
    """The licence basis entry, plus the strict default while the row is unconfirmed (C3 §5)."""
    default = {"type": "default", **STRICT_DEFAULT, "set_by": {"role": "intake-code"}, "date": day}
    if row["id"] == "NOASSERTION":
        return [default]
    c = row["ceiling"]
    lic = {"type": "license", "license": row["id"], "ref": ref, "uses": c["uses"], **({"forbids": c["forbids"]} if "forbids" in c else {}),
           "audience": c["audience"], "redistribution": c["redistribution"], "attribution": c["attribution"],
           "set_by": {"role": "intake-code"}}
    if row.get("confirmed"):
        lic.update(confirmed_by=row["confirmed"]["by"], date=row["confirmed"]["on"])
    else:
        lic["date"] = day
    lic["note"] = row["note"]
    return [lic] if row.get("confirmed") else [lic, default]


def effective(basis: list) -> dict:
    """Python mirror of effectiveRights in packages/contracts/src/rights.ts."""
    ceiling = next((b for b in basis if b["type"] == "license" and b.get("confirmed_by")), None) or \
        next(b for b in basis if b["type"] == "default")
    uses = list(ceiling["uses"])
    audience, redistribution = ceiling["audience"], ceiling["redistribution"]
    for b in basis:
        if b["type"] == "interpretation":
            uses += [u for u in b["uses"] if u not in uses]
    for b in basis:
        if b["type"] == "decision":
            uses = [u for u in uses if u in b["uses"]]
            audience = min(audience, b["audience"], key=ORDER["audience"].index)
            redistribution = min(redistribution, b["redistribution"], key=ORDER["redistribution"].index)
    attribution = ceiling.get("attribution") if ceiling["type"] == "license" else None
    return {"uses": uses, "audience": audience, "redistribution": redistribution, "attribution": attribution}


def processing_for(row: dict, status: str) -> str:
    """The row's processing; quarantined cards are always local-only (defaultProcessing in packages/contracts/src/rights.ts)."""
    return "local-only" if status == "quarantined" else row["processing"]


def status_for(describe: dict) -> str:
    return "tagged" if all(describe.get(k) for k in ("description", "objects", "roles")) else "draft"


def counts(ext_dir: Path, category):
    """Files by C3 kind, from extensions. Images in icon/UI packs count as ui, textures folders as texture."""
    c = Counter()
    for f in ext_dir.rglob("*"):
        if not f.is_file() or f.name.lower() in SKIP_NAMES:
            continue
        k = KIND_BY_EXT.get(f.suffix.lower().lstrip("."))
        if not k:
            continue
        low = f.as_posix().lower()
        if k == "sprite" and (category in ("icons", "ui") or "/icons" in low):
            k = "ui"
        elif k == "sprite" and "/textures" in low:
            k = "texture"
        elif k == "model" and "/animations" in low:
            k = "anim"
        c[k] += 1
    return dict(sorted(c.items()))


def get_path(d: dict, path: str):
    for part in path.split("."):
        if not isinstance(d, dict) or part not in d:
            return None
        d = d[part]
    return d


def set_path(d: dict, path: str, value) -> None:
    *head, last = path.split(".")
    for part in head:
        d = d.setdefault(part, {})
    if value is None:
        d.pop(last, None)
    else:
        d[last] = value


def without_at(card: dict) -> dict:
    c = copy.deepcopy(card)
    for entry in c.get("provenance", {}).values():
        entry.pop("at", None)
    return c


def preserve_item_locks(pack: Path, cards: list[dict]) -> list[dict]:
    """Keep human-locked item fields and refuse to discard locked obsolete cards."""
    expected = {smallscaleint.card_path(pack, card): card for card in cards}
    for path in (pack / 'cards').rglob('*.card.json'):
        old = json.loads(path.read_text())
        locks = {field: entry for field, entry in old.get('provenance', {}).items() if entry.get('locked')}
        if not locks:
            continue
        if path not in expected:
            raise ValueError(f'locked item card no longer generated: {path.relative_to(pack)}')
        if '*' in locks:
            expected[path].clear()
            expected[path].update(old)
            continue
        for field, entry in locks.items():
            set_path(expected[path], field, copy.deepcopy(get_path(old, field)))
            expected[path]['provenance'][field] = entry
    return cards


def card(pj: Path, tags: dict, table: dict, old: dict | None) -> dict:
    m = json.loads(pj.read_text())
    pid, ver, vendor = m["id"], m["current"], m["vendor"]
    v = m["versions"][ver]
    row = license_row(m["license"], table)
    day = v.get("added") or TODAY
    ref = m.get("license_source") or row["ref"]
    # Decisions only narrow, so they always survive; an interpretation belongs to the licence it was made for.
    same_licence = old is not None and table.get(str(old.get("license", "")).lower(), {}).get("id") == row["id"]
    kept = [b for b in (old or {}).get("rights", {}).get("basis", [])
            if b["type"] == "decision" or (b["type"] == "interpretation" and same_licence)]
    basis = basis_from_row(row, ref, day) + kept
    t = tags.get(pid)
    # An importer's card (Sidetrax) keeps its describe and collection info; a tags row or this tool's own card is rebuilt.
    keep_old = old is not None and t is None and not old["provenance"]["*"].get("tool", "").startswith("build_collection_cards")
    prov = {"*": {"by": "code", "tool": TOOL, "at": NOW, "input": "pack.json + extracted file extensions"},
            "rights": {"by": "license", "tool": TOOL, "at": NOW,
                       "input": f"licence table {row['id']}" + (f", confirmed {row['confirmed']['on']}" if row.get("confirmed") else ", unconfirmed")}}
    if keep_old:
        describe = copy.deepcopy(old.get("describe", {}))
        info = old["collection_info"]
        prov = {**old.get("provenance", {}), "rights": prov["rights"]}
    else:
        if t:
            describe = {"description": t["d"], "objects": t["o"], "environments": t["e"], "settings": t["s"], "roles": t["r"],
                        "style_family": t["sf"]}
            if t["pov"]:
                describe["pov_fit"] = t["pov"]
            prov["describe"] = {"by": "model", "model": "claude-opus-5-5", "tool": "gm-tag-collection@0.1", "at": NOW, "confidence": 0.7,
                                "input": "pack title, top folders and filename words; no images seen"}
        else:
            describe = {"description": f"{m['title']} ({vendor.capitalize()})"}
            prov["describe"] = {"by": "filename", "tool": TOOL, "at": NOW, "input": "pack title"}
        info = {"vendor": vendor, "version": ver, "origin": "bundle" if v.get("bundle") else "vendor-pack",
                **({"bundle": v["bundle"]} if v.get("bundle") else {}),
                **({"requires": [f"t1:{r}@{json.loads((pj.parent.parent / r / 'pack.json').read_text())['current']}" for r in m["requires"]]}
                   if m.get("requires") else {}),
                "counts": counts(pj.parent / ver / "extracted", m.get("category")),
                "creation_choice": False, "pack_manifest": f"assets-local/packs/{pid}/pack.json", "files_total": v.get("extracted_files", 0)}
        if t:
            info["family_coverage"] = {name: letter in t.get("fc", "") for letter, name in FAMILY_COVERAGE.items()}
    if compatibility := STYLE_COMPATIBILITY_BY_PACK.get(pid):
        describe["style_family"] = compatibility["family"]
        describe["set"] = compatibility["set"]
        prov["describe.style_family"] = {"by": "code", "tool": TOOL, "at": NOW,
                                         "input": "packages/asset-cards/data/style-families.json"}
        prov["describe.set"] = {"by": "code", "tool": TOOL, "at": NOW,
                                "input": "packages/asset-cards/data/style-families.json"}
    else:
        describe.pop("set", None)
        prov.pop("describe.set", None)
    old_counts = (old or {}).get("collection_info", {}).get("counts", {})
    if any(k.startswith("audio/") for k in old_counts):  # build_audio_cards.py owns the audio counts
        info["counts"] = {**{k: n for k, n in info["counts"].items() if not k.startswith("audio")},
                          **{k: n for k, n in old_counts.items() if k.startswith("audio")}}
    out = {"schema": "ogm.asset-card/1.0", "vocab": VOCAB, "id": f"t1:{pid}@{ver}", "card_type": "collection", "status": None,
           "title": (old or {}).get("title") if keep_old else f"{m['title']} ({vendor.capitalize()})", "license": row["id"],
           "rights": None, "describe": describe, "collection_info": info, "provenance": prov}
    compatibility = STYLE_COMPATIBILITY_BY_PACK.get(pid, {})
    prior_related = (old or {}).get('related', []) if not (old or {}).get('provenance', {}).get('related', {}).get('tool', '').startswith(TOOL) else []
    related = copy.deepcopy(prior_related)
    for peer in compatibility.get('compatible_with', []):
        manifest = pj.parent.parent / peer / 'pack.json'
        if manifest.exists():
            peer_version = json.loads(manifest.read_text())['current']
            relation = {'rel': 'pairs-with', 'id': f't1:{peer}@{peer_version}'}
            if relation not in related:
                related.append(relation)
    if related:
        out['related'] = related
        out['provenance']['related'] = {'by': 'code', 'tool': TOOL, 'at': NOW,
                                        'input': 'style-families.json compatible packs and installed pack versions'}
    if keep_old:
        for k in ("previews", "flags"):
            if k in old:
                out[k] = old[k]
    elif (pj.parent / "icon.png").exists():
        out["previews"] = {"thumb": f"packs/{pid}/icon.png"}
    else:
        out["flags"] = ["missing-preview"]
    smallscaleint.decorate_collection(out, pid, pj.parent)
    locks = {path: entry for path, entry in (old or {}).get("provenance", {}).items() if entry.get("locked") and path != "*"}

    def restore_locks():  # locked fields are never overwritten
        for path, entry in locks.items():
            set_path(out, path, copy.deepcopy(get_path(old, path)))
            out["provenance"][path] = entry

    restore_locks()
    out["status"] = status_for(out["describe"])  # derived from the content actually written, locks included
    out["rights"] = {**effective(basis), "processing": processing_for(row, out["status"]), "basis": basis}
    restore_locks()  # a locked status or rights block stays as it was
    return old if old and without_at(old) == without_at(out) else out  # equal content keeps the old timestamps


def validate(cards: dict) -> dict:
    """Run the contracts validator once over all cards; returns {pid: [failure lines]}."""
    failures = defaultdict(list)
    with tempfile.TemporaryDirectory() as tmp:
        pids, files = list(cards), []
        for i, pid in enumerate(pids):  # numbered names: pack ids may hold characters the output format splits on
            f = Path(tmp) / f"{i}.json"
            f.write_text(json.dumps(cards[pid]))
            files.append(str(f))
        r = subprocess.run(["node", str(VALIDATOR), "--no-fixtures", *files], capture_output=True, text=True)
        if r.returncode not in (0, 1):
            sys.exit(f"validator failed to run: {r.stderr.strip()}")
        for line in r.stdout.splitlines():
            if line.startswith("FAIL"):
                failures[pids[int(line.split()[2].removesuffix(".json"))]].append(line)
    return failures


def dump(pid: str, c: dict) -> str:
    return json.dumps(c, indent=1 if pid.startswith(("kenney-", "synty-")) else 2) + "\n"


def run(root: Path, only: str = "*", dry_run: bool = False, table: dict | None = None) -> dict:
    table = table or load_table()
    tags = {d["id"]: d for d in map(json.loads, TAGS.read_text().splitlines())}
    built, items, vendor_of, errors = {}, {}, {}, {}
    for pj in sorted((root / "packs").glob("*/pack.json")):
        pid = pj.parent.name
        if not fnmatch.fnmatch(pid, only):
            continue
        cc = pj.parent / "collection.card.json"
        vendor_of[pid] = json.loads(pj.read_text())["vendor"]
        try:
            built[pid] = card(pj, tags, table, json.loads(cc.read_text()) if cc.exists() else None)
            if pid in smallscaleint.PACKS:
                items[pid] = smallscaleint.build_cards(pj.parent, built[pid])
            elif builder := ITEM_BUILDERS.get(vendor_of[pid], {}).get(pid):
                cards = builder(pj.parent / built[pid]["collection_info"]["version"] / "extracted", built[pid])
                if not cards:
                    raise ValueError(f'no recognized assets in {pid}')
                items[pid] = preserve_item_locks(pj.parent, cards)
        except (KeyError, OSError, ValueError, json.JSONDecodeError) as e:
            errors[pid] = [str(e).strip('"')]
    smallscale_items = {pid: cards for pid, cards in items.items() if pid in smallscaleint.PACKS}
    if smallscale_items:
        try:
            thumbnail_jobs = smallscaleint_thumbnails.thumbnail_jobs(root, smallscale_items)
            if not dry_run:
                smallscaleint_thumbnails.render_thumbnails(root, thumbnail_jobs)
        except (OSError, ValueError, json.JSONDecodeError) as e:
            for pid in smallscale_items:
                errors.setdefault(pid, []).append(str(e).strip('"'))
    documents = dict(built)
    documents.update({f"{pid}::{index}": item for pid, cards in items.items() for index, item in enumerate(cards)})
    for label, failures in validate(documents).items() if documents else ():
        errors.setdefault(label.split("::", 1)[0], []).extend(failures)
    report = defaultdict(lambda: {"written": 0, "unchanged": 0, "draft": 0, "tagged": 0, "failed": 0, "item_cards": 0})
    sheet_collections, sheet_cards = {}, {}
    for pid, vendor in vendor_of.items():
        r = report[vendor]
        if pid in errors:
            r["failed"] += 1
            continue
        c = built[pid]
        r[c["status"]] = r.get(c["status"], 0) + 1
        cc = root / "packs" / pid / "collection.card.json"
        text = dump(pid, c)
        r["item_cards"] += len(items.get(pid, []))
        if pid in items:
            smallscaleint.write_cards(cc.parent, items[pid], dry_run)
            if pid in smallscaleint.PACKS:
                sheet_collections[pid], sheet_cards[pid] = c, items[pid]
        if cc.exists() and json.loads(cc.read_text()) == c:
            r["unchanged"] += 1
            continue
        if not dry_run:
            cc.write_text(text)
        r["written"] += 1
    installed_smallscaleint = {
        path.parent.name
        for path in (root / "packs").glob("*/pack.json")
        if path.parent.name in smallscaleint.PACKS
    }
    if sheet_cards and set(sheet_cards) == installed_smallscaleint and not dry_run:
        smallscaleint.write_contact_sheets(root, sheet_collections, sheet_cards)
    return {"vendors": dict(sorted(report.items())), "failures": {k: errors[k] for k in sorted(errors)}}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", type=Path, default=REPO / "assets-local")
    ap.add_argument("--only", default="*", help="pack id glob")
    ap.add_argument("--dry-run", action="store_true", help="build and validate, write nothing")
    ap.add_argument("--report", action="store_true", help="print the per-vendor report as JSON")
    a = ap.parse_args(argv)
    rep = run(a.root, a.only, a.dry_run)
    if a.report:
        print(json.dumps(rep, indent=1))
    n = sum(v["written"] for v in rep["vendors"].values())
    print(f"{n} collection cards {'would be ' if a.dry_run else ''}written; {len(rep['failures'])} failed", file=sys.stderr)
    return 1 if rep["failures"] else 0


if __name__ == "__main__":
    sys.exit(main())
