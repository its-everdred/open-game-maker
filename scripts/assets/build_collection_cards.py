"""Write a C3 collection card (packs/<id>/collection.card.json) for every Kenney and Synty pack (C3 §9 migration).

Facts come from pack.json and the extracted files (code); describe tags come from data/collection_tags.jsonl, written by
Claude from each pack's title, folder names and filename words (no images looked at). Sidetrax packs keep the card their
importer wrote. Run: python3 -I scripts/assets/build_collection_cards.py
With pack ids (python3 -I ... <id> ...), writes just those packs' cards, taking rights from each pack.json's confirmed
usage_rights (any vendor; used by itch.io intake).
"""
import json, sys
from collections import Counter
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
ROOT = REPO / "assets-local"
TAGS = Path(__file__).parent / "data" / "collection_tags.jsonl"
VOCAB = "2026-10-27"
NOW = datetime.now().astimezone().isoformat(timespec="seconds")
TOOL = "build_collection_cards@0.1"
ALL_USES = ["in-game", "placeholder", "derive-layout", "style-reference", "vision-input"]
# Licence ceilings as recorded in C3 §5 (Kevin confirmed both vendor licences on 2026-10-26).
LICENSES = {
    "kenney": {"license": "CC0-1.0", "ref": "License.txt", "audience": "public", "redistribution": "free",
               "note": "Kenney CC0; credit optional."},
    "synty": {"license": "LicenseRef-synty-personal", "ref": "Synty EULA (personal purchase); B11 policy", "audience": "private",
              "redistribution": "in-build",
              "note": "Kevin's instance and private repos only; raw files never committed or shared. Check the EULA before anything public."},
}
KIND_BY_EXT = {"glb": "model", "gltf": "model", "fbx": "model", "obj": "model", "blend": "model", "dae": "model",
               "png": "sprite", "svg": "sprite", "jpg": "sprite", "tga": "texture", "psd": "texture",
               "ogg": "audio", "wav": "audio", "mp3": "audio", "ttf": "ui", "otf": "ui"}
SKIP_NAMES = {"preview.png", "sample.png", "license.txt", "icon.png"}


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


def card(pj: Path, tags: dict) -> dict:
    m = json.loads(pj.read_text())
    pid, ver = m["id"], m["current"]
    v = m["versions"][ver]
    t = tags[pid]
    if m["vendor"] in LICENSES:
        lic = LICENSES[m["vendor"]]
        basis = {"type": "license", "license": lic["license"], "ref": lic["ref"], "uses": ALL_USES, "audience": lic["audience"],
                 "redistribution": lic["redistribution"], "attribution": None, "set_by": {"role": "intake-code"},
                 "confirmed_by": "kevin", "date": "2026-10-26", "note": lic["note"]}
        rights, rin = {"uses": ALL_USES, "audience": lic["audience"], "redistribution": lic["redistribution"], "attribution": None,
                       "basis": [basis]}, f"vendor licence ({lic['license']}), confirmed 2026-10-26"
    else:
        u = m["usage_rights"]
        rights = {k: u.get(k) for k in ("uses", "audience", "redistribution", "attribution", "processing", "basis")}
        rin = f"pack.json usage_rights ({m['license']}), confirmed by {u.get('confirmed_by')} {u.get('confirmed')}"
    describe = {"description": t["d"], "objects": t["o"], "environments": t["e"], "settings": t["s"], "roles": t["r"],
                "style_family": t["sf"]}
    if t["pov"]:
        describe["pov_fit"] = t["pov"]
    info = {"vendor": m["vendor"], "version": ver, "origin": "bundle" if v.get("bundle") else "vendor-pack",
            **({"bundle": v["bundle"]} if v.get("bundle") else {}),
            **({"requires": [f"t1:{r}@{json.loads((pj.parent.parent / r / 'pack.json').read_text())['current']}" for r in m["requires"]]}
               if m.get("requires") else {}),
            "counts": counts(pj.parent / ver / "extracted", m.get("category")),
            "creation_choice": False, "pack_manifest": f"assets-local/packs/{pid}/pack.json", "files_total": v.get("extracted_files", 0)}
    out = {"schema": "ogm.asset-card/1.0", "vocab": VOCAB, "id": f"t1:{pid}@{ver}", "card_type": "collection", "status": "tagged",
           "title": m["title"] if m["vendor"] not in LICENSES else f"{m['title']} ({m['vendor'].capitalize()})", "license": m["license"] if m["vendor"] not in LICENSES else lic["license"],
           "rights": rights,
           "describe": describe, "collection_info": info,
           "provenance": {"*": {"by": "code", "tool": TOOL, "at": NOW, "input": "pack.json + extracted file extensions"},
                          "rights": {"by": "license", "tool": TOOL, "at": NOW, "input": rin},
                          "describe": {"by": "model", "model": "claude-opus-5-5", "tool": "gm-tag-collection@0.1", "at": NOW, "confidence": 0.7,
                                       "input": "pack title, top folders and filename words; no images seen"}}}
    if (pj.parent / "icon.png").exists():
        out["previews"] = {"thumb": f"packs/{pid}/icon.png"}
    else:
        out["flags"] = ["missing-preview"]
    return out


def main():
    tags = {d["id"]: d for d in map(json.loads, TAGS.read_text().splitlines())}
    n = 0
    only = sys.argv[1:]
    for pj in sorted((ROOT / "packs").glob("*/pack.json")):
        if only and pj.parent.name not in only:
            continue
        if not only and json.loads(pj.read_text())["vendor"] not in LICENSES:
            continue
        c = card(pj, tags)
        (pj.parent / "collection.card.json").write_text(json.dumps(c, indent=1) + "\n")
        n += 1
    print(f"{n} collection cards written")


if __name__ == "__main__":
    main()
