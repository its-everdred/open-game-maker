"""Tag the exported CC3+ maps per C3 at three depths (cards, CAD sidecar, the image) and write validated cards.

usage: scripts/py/audio/.venv/bin/python -I scripts/py/maps/tag_maps.py analyse [--workers N]   # sha, thumbnail, CLIP embedding per map
       scripts/py/audio/.venv/bin/python -I scripts/py/maps/tag_maps.py cards [--json]          # score labels, write cards, validate

Depth 1 (card): map type, setting (folder only), environment, objects (from CAD symbol names), keywords (from map labels), grid,
publication. Depth 2 (sidecar, already written by the export): every symbol and label with coordinates, referenced from
source.files. Depth 3: the PNG itself. Map type comes from the title and folder words first; CLIP ViT-L/14 (MIT, local)
decides only when they say nothing, and its judgments are ranked by lift against the whole map library.

Kevin's first review (2026-10-29) added map.is_map, map.usable, map.view and map.scale. They come from folder and file names
plus ink coverage, not CLIP: zero-shot CLIP called a castle plan a "diagram" and a city panorama "top-down". Non-maps (standees,
tokens, symbol sheets, papercraft) and unusable maps keep their cards so search can filter them out."""
import argparse, copy, hashlib, json, os, re, subprocess, sys
from collections import Counter, defaultdict
from datetime import datetime
from multiprocessing import Pool
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import layout_fields

REPO = Path(__file__).resolve().parents[3]
ASSETS_ROOT = Path(os.environ.get("OGM_ASSETS_ROOT", REPO / "assets-local"))
COLL_DIR = ASSETS_ROOT / "inspiration/profantasy-cc3"
MAPS = COLL_DIR / "maps"
ANALYSIS = COLL_DIR / "analysis"
PREVIEWS = ASSETS_ROOT
SCHEMAS = REPO / "docs/research/v0.5/schemas"
CLIP_ID = "openai/clip-vit-large-patch14"
VERSION = "v1"
COLL_ID = f"t1:profantasy-cc3@{VERSION}"
VOCAB = "2026-10-27"
TOOL = "tag_maps@0.1"
NOW = datetime.now().astimezone().isoformat(timespec="seconds")
HASH_MANIFEST = "private/hash-manifests/profantasy-cc3-v1.txt"  # written by hash_manifest.py
NOT_MAPS = re.compile(r"(^|/)(Parts|Symbols)/")  # grid templates, altitude keys and symbol catalogues: hash-listed, not carded


def preserve_card(previous: dict, generated: dict) -> dict:
    """Keep ownership and human-locked values when regenerating map descriptions."""
    merged = copy.deepcopy(generated)
    for field in ("rights", "license", "source"):
        if field in previous:
            merged[field] = copy.deepcopy(previous[field])
        else:
            merged.pop(field, None)
    for dotted, provenance in previous.get("provenance", {}).items():
        if not isinstance(provenance, dict) or not provenance.get("locked") or dotted == "*":
            continue
        parts = dotted.split(".")
        value = previous
        for part in parts:
            if not isinstance(value, dict) or part not in value:
                break
            value = value[part]
        else:
            target = merged
            for part in parts[:-1]:
                target = target.setdefault(part, {})
            target[parts[-1]] = copy.deepcopy(value)
            merged.setdefault("provenance", {})[dotted] = copy.deepcopy(provenance)
    return merged


def card_record(path: str, card: dict) -> dict:
    return {"card": path, "status": card["status"], "flags": card.get("flags", [])}


def emit(record: dict, json_mode: bool = False, summary: bool = False):
    stream = sys.stderr if json_mode and summary else sys.stdout
    print(json.dumps(record), file=stream, flush=True)


def stage_json(out: Path, payload: dict, indent=1) -> Path:
    out.parent.mkdir(parents=True, exist_ok=True)
    staged = out.with_name(out.name + ".part")
    staged.write_text(json.dumps(payload, indent=indent) + "\n")
    return staged


def promote(staged: Path, out: Path):
    staged.replace(out)

MAP_TYPES = {"dungeon": "a top-down dungeon map with rooms and corridors", "cave": "a map of natural caves and caverns",
             "castle": "a floor plan of a castle", "keep": "a floor plan of a fortified keep tower", "temple": "a floor plan of a temple",
             "crypt": "a map of a tomb or crypt", "building": "a floor plan of a house or building",
             "tavern": "a floor plan of a tavern or inn", "town": "a map of a small town or village", "city": "a map of a large city",
             "ship": "a deck plan of a ship or starship", "sewer": "a map of sewers", "mine": "a map of a mine with tunnels",
             "wilderness": "a local area map with forests, fields and roads", "battlemap": "a battle map on a square grid",
             "region": "a world or regional map with mountains, rivers and kingdoms"}
# Title/folder words -> map type, most specific first.
TYPE_WORDS = [("tavern", r"\b(tavern|inn|alehouse|pub)\b"), ("sewer", r"\bsewers?\b"), ("mine", r"\bmines?\b"),
              ("crypt", r"\b(crypts?|tombs?|catacombs?|mausoleums?|barrows?)\b"),
              ("temple", r"\b(temples?|church|cathedral|monastery|abbey|shrine|chapel)\b"), ("keep", r"\b(keep|tower)\b"),
              ("castle", r"\b(castles?|fortress|fort|citadel|stronghold)\b"), ("cave", r"\b(caves?|caverns?|grotto)\b"),
              ("dungeon", r"\b(dungeons?|geomorphs?|lair)\b"), ("ship", r"\b(ships?|starships?|galleon|boat|deck|spaceship)\b"),
              ("city", r"\b(city|cities|metropolis)\b"), ("town", r"\b(towns?|village|hamlet)\b"),
              ("building", r"\b(house|mansions?|manor|shop|hall|villa|palace|building|floorplan)\b"),
              ("region", r"\b(world|worlds|realms?|atlas|continent|islands?|kingdom|overland|region|fractal|star ?charts?|projection|hex)\b")]
ENVIRONMENTS = {"dungeon": "a dungeon", "crypt": "a crypt", "cave": "a cave", "mine": "a mine", "sewer": "a sewer",
                "castle": "a castle", "temple": "a temple", "ruins": "ruins", "graveyard": "a graveyard", "camp": "a camp",
                "town": "a town", "village": "a village", "city": "a city", "interior": "a building interior", "tavern": "a tavern",
                "shop": "a shop", "house": "a house", "farm": "a farm", "forest": "a forest", "jungle": "a jungle",
                "grassland": "grassland", "mountain": "mountains", "snow": "a snowy land", "desert": "a desert", "swamp": "a swamp",
                "beach": "a coast", "ocean": "the sea", "underwater": "an underwater place", "sky": "a sky city",
                "space": "outer space", "space-station": "a space station", "industrial": "an industrial site", "road": "roads",
                "arena": "an arena"}
SYM_STOP = {"flat", "small", "large", "big", "med", "medium", "shadow", "color", "colour", "top", "var", "alt", "default", "symbol",
            "layer", "new", "left", "right", "half", "full", "dark", "light", "white", "black", "red", "blue", "green", "brown", "grey",
            "gray", "yellow", "and", "the", "with", "block", "bldng", "sheet", "fill", "mask", "base", "copy"}
SYM_STOP |= {"fill", "tool", "circle", "loop", "patch", "vari", "mixed", "marker", "piece", "standard", "tan", "bare", "button", "str",
             "edge", "part", "single", "lrg", "sml", "normal", "background", "lead", "round", "closed", "down", "ornate", "gothic", "rose",
             "varicolor", "symbol", "arched", "lit", "open", "side", "end", "inner", "outer", "corner", "straight", "curved", "style"}
SYM_ALIAS = {"decid": "tree", "fdecid": "tree", "deciduous": "tree", "ftree": "tree", "trees": "tree", "conifer": "pine", "fir": "pine",
             "mtns": "mountain", "mtn": "mountain", "mountains": "mountain", "hills": "hill", "foothill": "hill", "foothills": "hill",
             "rocks": "rock", "woods": "forest", "stonewall": "wall", "bushes": "bush", "shrub": "bush", "esc": "escarpment",
             "leaves": "leaf", "needles": "pine", "scrubland": "scrub"}
STYLE_PREFIX = ("merc", "spd", "msf", "wrt", "ttc", "cosa", "sym", "jr", "mk", "ca", "f", "s", "d")
try:
    DICT = {w.strip().lower() for w in open("/usr/share/dict/american-english", encoding="utf-8", errors="ignore") if w.strip().isalpha()}
except OSError:  # no word list: keep every word, the stop list still applies
    DICT = None
OVERLAND = {"mountain", "hill", "peak", "ridge", "escarpment"}
SETTLEMENT = {"city", "town", "village", "castle"}
FLORA = {"tree", "pine", "bush", "forest", "copse", "jungle", "reed", "heather", "scrub", "palm", "fern", "grass", "weed", "marsh", "swamp"}
INTERIOR = {"door", "window", "wall", "stair", "chair", "table", "bed", "chest", "barrel", "bench", "bookcase", "torch", "sconce", "stool",
            "crate", "pillar", "altar", "throne", "rug", "fireplace"}
# Folder or file words -> what the image is when it is not a map (checked against the path, first match wins).
SHEETS = [("standee", r"paper standees"), ("tokens", r"token treasury|\btokens?\b"), ("handout", r"props and handouts"),
          ("texture", r"textures?\b"), ("papercraft", r"diorama"),
          ("symbol-sheet", r"symbol catalogs|heraldic|symbol reference|example symbol|chart example|\bkey\b|\blegend\b|tinctures")]
VIEWS = [("side", r"side views|cross-?sections?|profile view|side ?view"),
         ("perspective", r"panoramas?|perspectives?|isometric|\d ?3d\b|3d\.png$|3d$")]
STEP = re.compile(r"(?i)(tutorial|step|wt)[ _-]?\d+$")  # numbered frames of a step-by-step tutorial
INK_EMPTY = 0.03  # share of thumbnail pixels that differ from the background; below this the image is blank or a bare outline
SCALES = {"region": "region", "city": "settlement", "town": "settlement", "castle": "building", "keep": "building", "temple": "building",
          "building": "building", "tavern": "building", "ship": "building", "crypt": "battlemap", "dungeon": "battlemap",
          "cave": "battlemap", "mine": "battlemap", "sewer": "battlemap", "wilderness": "battlemap", "battlemap": "battlemap"}
FOLDER_SETTINGS = [("modern", r"^wwii/"), ("medieval", r"^(source maps )?castles/"),
                   ("sci-fi", r"sci-?fi|starship|space|hispace|cyberpunk|colonial outpost")]
LEVELS = {"cellar": {"cellar", "cellars", "basement"}, "ground": {"ground"}, "upper": {"upper", "stories", "storey", "floor"},
          "roof": {"roof", "roofs"}}
LABEL_STOP = {"scale", "feet", "foot", "miles", "mile", "north", "south", "east", "west", "level", "map", "the", "and", "of"}


def rights_allow_map(rel: str) -> bool:
    try:
        collection = json.loads((COLL_DIR / "collection.card.json").read_text())
        grants = [collection.get("rights")]
        path = COLL_DIR / "cards" / (kebab(Path(rel).with_suffix("").as_posix()) + ".card.json")
        if path.exists():
            card = json.loads(path.read_text())
            if "rights" in card:
                grants.append(card["rights"])
        return all(isinstance(rights, dict) and "vision-input" in rights.get("uses", [])
                   and rights.get("processing", "local-only") in ("any", "local-only") for rights in grants)
    except (OSError, json.JSONDecodeError, TypeError):
        return False


def maps():
    for png in sorted(MAPS.rglob("*.png")):
        rel = png.relative_to(MAPS).as_posix()
        meta = png.with_suffix(".json")
        if NOT_MAPS.search(rel) or not meta.exists() or not rights_allow_map(rel):
            continue
        if json.loads(meta.read_text()).get("ok"):
            yield png


def sidecar(png: Path) -> Path:
    return ANALYSIS / (png.relative_to(MAPS).with_suffix("").as_posix() + ".analysis.json")


_M = None


def clip():
    global _M
    if _M is None:
        import torch
        from transformers import CLIPModel, CLIPProcessor
        torch.set_num_threads(int(os.environ.get("OGM_TORCH_THREADS", "3")))
        _M = (
            CLIPModel.from_pretrained(CLIP_ID, local_files_only=True).eval(),
            CLIPProcessor.from_pretrained(CLIP_ID, local_files_only=True),
        )
    return _M


def analyse(png: Path):
    sc = sidecar(png)
    h = hashlib.sha256(png.read_bytes()).hexdigest()
    if sc.exists() and json.loads(sc.read_text()).get("sha256") == h:
        return {"map": str(png), "status": "skip"}
    try:
        import torch
        from PIL import Image
        Image.MAX_IMAGE_PIXELS = None  # our own renders, up to ~100 MP
        im = Image.open(png)
        w, hgt, alpha = im.width, im.height, im.mode in ("RGBA", "LA") or "transparency" in im.info
        im = im.convert("RGB")
        im.thumbnail((1024, 1024))
        key = f"private/previews/{h[:2]}/{h[:16]}-thumb.webp"  # redistribution none: private prefix (C3 §7)
        (PREVIEWS / key).parent.mkdir(parents=True, exist_ok=True)
        im.save(PREVIEWS / key, "WEBP", quality=80)
        def square(x):
            s = max(x.size)
            c = Image.new("RGB", (s, s), "white")
            c.paste(x, ((s - x.width) // 2, (s - x.height) // 2))
            return c
        cw, ch = im.width // 4, im.height // 4
        views = [square(im), square(im.crop((cw, ch, im.width - cw, im.height - ch)))]  # whole map + its centre at 2x detail
        m, p = clip()
        with torch.no_grad():
            e = m.get_image_features(**p(images=views, return_tensors="pt"))
        e = torch.nn.functional.normalize(e, dim=-1)
        res = {"map": png.relative_to(MAPS).as_posix(), "sha256": h, "bytes": png.stat().st_size, "width": w, "height": hgt,
               "has_alpha": bool(alpha), "thumb": key, "clip": {"model": CLIP_ID, "views": ["whole", "centre"],
                                                                 "embeddings": [[round(float(v), 5) for v in x] for x in e]}}
    except Exception as ex:
        return {"map": str(png), "status": "fail", "error": f"{type(ex).__name__}: {ex}"[:300]}
    sc.parent.mkdir(parents=True, exist_ok=True)
    sc.with_name(sc.name + ".part").write_text(json.dumps(res))
    sc.with_name(sc.name + ".part").rename(sc)
    return {"map": str(png), "status": "ok"}


def kebab(s):
    return re.sub(r"[^a-z0-9/]+", "-", s.lower()).strip("-").replace("/-", "/").replace("-/", "/")


def tag(s):
    t = kebab(s).replace("/", "-")[:40].strip("-")
    return t if re.fullmatch(r"[a-z][a-z0-9-]*", t) else None


def noun(w):
    """One CAD symbol-name word -> an English noun, or None. Strips vendor style prefixes (mercTree, spdHouse)."""
    w = SYM_ALIAS.get(w, w)
    if DICT is not None and w not in DICT:
        for pre in STYLE_PREFIX:
            if w.startswith(pre) and len(w) - len(pre) >= 3 and SYM_ALIAS.get(w[len(pre):], w[len(pre):]) in DICT | set(SYM_ALIAS.values()):
                w = SYM_ALIAS.get(w[len(pre):], w[len(pre):])
                break
        else:
            return None
    w = w[:-1] if w.endswith("s") and not w.endswith("ss") and (DICT is None or w[:-1] in DICT) else w
    return None if w in SYM_STOP or len(w) < 3 else w


def symbol_counts(symbols):
    c = Counter()
    for s in symbols:
        name = re.sub(r"^CA\d+_", "", s.get("name") or "")
        for w in re.findall(r"[A-Za-z][a-z]+|[A-Z]{3,}(?![a-z])|[a-z]{3,}", name.replace("_", " ")):
            n = noun(w.lower())
            if n:
                c[n] += 1
    return c


def symbol_objects(symbols):
    return [w for w, _ in symbol_counts(symbols).most_common(12)]


def symbol_type(c: Counter):
    """Map type from what the CAD symbols depict, when the title says nothing: mountains + settlements = region."""
    total = sum(c.values())
    if total < 20:
        return None
    over, sett, flora, inner = (sum(c[w] for w in S) for S in (OVERLAND, SETTLEMENT, FLORA, INTERIOR))
    if over >= 5 and sett >= 1:
        return "region"
    if flora / total >= 0.6 and inner / total < 0.1:
        return "wilderness"
    return None


def label_keywords(labels):
    """Words from short labels (place and room names). Longer labels are notes ("rooms for the priests, view of the
    surroundings") whose words describe the text, not what is drawn."""
    c = Counter()
    for l in labels:
        if len(l.get("text", "").split()) > 4:
            continue
        for w in re.findall(r"[A-Za-z][A-Za-z']{3,}", l.get("text", "")):
            w = w.lower().replace("'", "")
            if w not in LABEL_STOP and tag(w):
                c[w] += 1
    return [w for w, _ in c.most_common(12)]


def publication(rel: str):
    parts = rel.split("/")
    return parts[-2] if len(parts) > 1 else "CC3+ examples"


def sheet_kind(rel: str):
    low = rel.lower()
    return next((k for k, rx in SHEETS if re.search(rx, low)), None)


def view_of(rel: str):
    low = rel.lower()
    return next((k for k, rx in VIEWS if re.search(rx, low)), "topdown")


def scale_of(rel: str, map_type: str):
    low = rel.lower()
    if re.search(r"\b(world|worlds|continent|atlas|planet)\b", low):
        return "world"
    return SCALES.get(map_type, "battlemap")


def ink(thumb: Path):
    from PIL import Image
    im = Image.open(thumb).convert("L")
    im.thumbnail((256, 256))
    a = np.asarray(im, np.float32)
    bg = np.median(np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]]))
    return float((np.abs(a - bg) > 24).mean())


def usable_of(rel: str, is_map: bool, scale: str, ink_share: float):
    """(usable, reason). Kevin: blank frames and tutorial steps are useless; a whole-country map is a paper map, not a level."""
    if not is_map:
        return "no", "not-a-map"
    if ink_share < INK_EMPTY:
        return "no", "near-empty"
    if STEP.search(Path(rel).stem):
        return "no", "tutorial-step"
    if scale in ("region", "world"):
        return "reference-only", "zoomed-out"
    return "yes", None


def level_of(title: str):
    words = set(re.findall(r"[a-z]+", title.lower()))
    return next((k for k, ws in LEVELS.items() if words & ws), None)


def text_type(rel: str):
    if rel.lower().startswith("wwii/"):
        return "region"  # wargame operation maps: CLIP read their hex grids as mines
    words = (rel.replace("_", " ").replace("-", " ")).lower()
    for t, rx in TYPE_WORDS:
        if re.search(rx, words):
            return t
    return None


def cards(json_mode=False, limit=0):
    import torch
    from transformers import CLIPModel, CLIPProcessor
    torch.set_num_threads(int(os.environ.get("OGM_TORCH_THREADS", "3")))
    rows = [row for p in sorted(ANALYSIS.rglob("*.analysis.json"))
            if rights_allow_map((row := json.loads(p.read_text()))["map"])]
    m = CLIPModel.from_pretrained(CLIP_ID, local_files_only=True).eval()
    p = CLIPProcessor.from_pretrained(CLIP_ID, local_files_only=True)
    sets = {"map_type": (list(MAP_TYPES), list(MAP_TYPES.values())),
            "environments": (list(ENVIRONMENTS), [f"a map of {v}" for v in ENVIRONMENTS.values()])}
    with torch.no_grad():
        T = {k: torch.nn.functional.normalize(m.get_text_features(**p(text=v[1], return_tensors="pt", padding=True)), dim=-1).numpy()
             for k, v in sets.items()}
        scale = float(m.logit_scale.exp())
    for r in rows:
        E = np.array(r["clip"]["embeddings"], dtype=np.float32)
        r["_p"] = {}
        for k in sets:
            z = scale * E @ T[k].T
            z = np.exp(z - z.max(1, keepdims=True))
            r["_p"][k] = (z / z.sum(1, keepdims=True)).mean(0)
    mean = {k: np.mean([r["_p"][k] for r in rows], 0) for k in sets}
    seen, dups, written, records = {}, [], 0, []
    outdir = COLL_DIR / "cards"
    type_counts = Counter()
    selected_rows = sorted(rows, key=lambda r: (r["map"].startswith("Source Maps"), r["map"]))
    selected_rows = selected_rows[:limit] if limit else selected_rows
    for r in selected_rows:  # keep the non-"Source Maps" copy of duplicates
        if r["sha256"] in seen:
            dups.append((r["map"], seen[r["sha256"]]))
            continue
        rel = r["map"]
        png = MAPS / rel
        meta = json.loads(png.with_suffix(".json").read_text())
        ents_path = png.with_name(png.stem + ".entities.json")
        ents = json.loads(ents_path.read_text()) if ents_path.exists() else {"symbols": [], "labels": []}
        lift = {k: r["_p"][k] / mean[k] for k in sets}
        names = lambda k: sets[k][0]
        tt = text_type(rel) or symbol_type(symbol_counts(ents["symbols"]))
        ci = int(np.argmax(lift["map_type"]))
        map_type = tt or names("map_type")[ci]
        type_conf = round(float(min(0.9, 0.4 + r["_p"]["map_type"][ci])), 2)
        envs = [names("environments")[i] for i in np.argsort(-lift["environments"])[:2] if lift["environments"][i] >= 1.5]
        if map_type in ENVIRONMENTS and map_type not in envs:
            envs = [map_type] + envs[:1]
        sheet = sheet_kind(rel)
        is_map = sheet is None
        view, scale = view_of(rel), scale_of(rel, map_type)
        usable, why = usable_of(rel, is_map, scale, ink(PREVIEWS / r["thumb"]))
        folder_setting = next((st for st, rx in FOLDER_SETTINGS if re.search(rx, rel.lower())), None)
        # Settings and moods are not judged from the image: on line-art plans CLIP spread all nine settings and seven moods
        # almost evenly (a WWII map "pirate", a crypt "cozy"). Only a folder or publication that names the setting counts.
        settings = [folder_setting] if folder_setting else []
        if not is_map:
            envs, settings = [], []
        objects = [o for o in symbol_objects(ents["symbols"]) if o != "map"]
        keywords = [k for k in label_keywords(ents["labels"]) if k != "map"]
        lvl = level_of(png.stem)
        if lvl:  # a cellar's "Map Links" legend names the other floors; those words describe other maps
            other = set().union(*(ws for k, ws in LEVELS.items() if k != lvl))
            keywords = [k for k in keywords if k not in other]
            objects = [o for o in objects if o not in other]
        g = meta.get("grid") or {}
        title = re.sub(r"\s+", " ", png.stem.replace("_", " ")).strip()[:120]
        bits = []
        if g.get("type") in ("square", "hex") and g.get("spacing"):
            bits.append(f"{g['spacing']:g} {meta.get('units', {}).get('name', 'unit')} {g['type']} grid")
        bits.append(f"{len(ents['symbols'])} symbols")
        if objects:
            bits.append("mostly " + ", ".join(objects[:3]))
        if ents["labels"]:
            bits.append(f"{len(ents['labels'])} labels")
        if not is_map:
            desc = f"{sheet.replace('-', ' ').capitalize()} '{title}' from {publication(rel)}, not a map: {'; '.join(bits)}."
        else:
            view_word = {"side": "Side-view ", "perspective": "Perspective "}.get(view, "")
            desc = f"{view_word}{map_type} map '{title}' from {publication(rel)}: {'; '.join(bits)}."
            desc = desc[0].upper() + desc[1:]
            if usable != "yes":
                desc = desc[:-1] + {"near-empty": "; nearly blank.", "tutorial-step": "; a tutorial step.", "zoomed-out": "; zoomed out, reference only."}[why]
        if len(desc) > 300:
            desc = desc[:297] + "..."
        files = [{"path": f"maps/{rel}", "sha256": "sha256:" + r["sha256"], "bytes": r["bytes"], "format": "png", "role": "primary"}]
        for extra in (png.with_suffix(".json"), ents_path):
            if extra.exists():
                files.append({"path": f"maps/{extra.relative_to(MAPS).as_posix()}", "sha256": "sha256:" + hashlib.sha256(extra.read_bytes()).hexdigest(),
                              "bytes": extra.stat().st_size, "format": "json", "role": "metadata"})
        mapb = {"map_type": map_type, "is_map": is_map, "usable": usable, "view": view, "scale": scale, "publication": publication(rel)[:120], "levels_shown": 1,
                "site": kebab(png.stem).replace("/", "-")[:60].strip("-") or "map", "layout_spec": {"status": "pending"}}
        if why:
            mapb["usable_reason"] = why
        if sheet:
            mapb["sheet_kind"] = sheet
        if g.get("px_per_cell") and g.get("export_cols"):
            mapb["grid_detected"] = {"cell_px": g["px_per_cell"], "cols": g["export_cols"], "rows": g["export_rows"],
                                     "confidence": 0.95 if g.get("source") != "inferred" else 0.7}
        describe = {"description": desc, "objects": [o for o in objects if tag(o)], "roles": ["layout-reference"]}
        if envs:
            describe["environments"] = envs
        if settings:
            describe["settings"] = settings
        if keywords:
            describe["keywords"] = keywords
        prov = {"*": {"by": "code", "tool": TOOL, "at": NOW, "input": "PNG header, sha256, CC3+ export metadata"},
                "describe": {"by": "model", "model": CLIP_ID, "tool": TOOL, "at": NOW, "confidence": 0.55,
                             "input": "CLIP on the whole map and its centre vs environment prompts, lift vs library"},
                "describe.objects": {"by": "code", "tool": TOOL, "at": NOW, "input": "CAD symbol names from the DXF export (depth 2 sidecar)"},
                "describe.keywords": {"by": "code", "tool": TOOL, "at": NOW, "input": "words of the map's own text labels"},
                "describe.description": {"by": "code", "tool": TOOL, "at": NOW, "input": "template from map type, grid and CAD counts"},
                "map": {"by": "code", "tool": TOOL, "at": NOW, "input": "export JSON grid + folder name"},
                "map.is_map": {"by": "filename", "tool": TOOL, "at": NOW, "input": "folder and file words (standees, tokens, symbol sheets, dioramas)"},
                "map.usable": {"by": "code", "tool": TOOL, "at": NOW, "input": "is_map, thumbnail ink coverage, numbered tutorial-step names, scale"},
                "map.view": {"by": "filename", "tool": TOOL, "at": NOW, "input": "folder and file words (side views, panoramas, perspective, 3D)"},
                "map.scale": {"by": "code", "tool": TOOL, "at": NOW, "input": "map type, plus world/continent words"}}
        if tt:
            prov["map.map_type"] = {"by": "filename" if text_type(rel) else "code", "tool": TOOL, "at": NOW,
                                    "input": "title and folder words" if text_type(rel) else "CAD symbol mix (relief + settlements, or mostly flora)"}
        else:
            prov["map.map_type"] = {"by": "model", "model": CLIP_ID, "tool": TOOL, "at": NOW, "confidence": type_conf,
                                    "input": "CLIP map-type prompts, lift vs library; no type word in title or folder"}
        layers = layout_fields.layout(map_type, envs, objects, keywords, g, lvl) if is_map else {}
        if layers:
            mapb["layout"] = layers
            prov["map.layout"] = {"by": "code", "tool": TOOL, "at": NOW,
                                  "input": "export grid, map type, judged environments, CAD symbol and label words"}
        flags = ["low-confidence"] if not tt and type_conf < 0.6 else []
        card = {"schema": "ogm.asset-card/1.0", "vocab": VOCAB, "id": f"t1:profantasy-cc3/{kebab(Path(rel).with_suffix('').as_posix())}@{VERSION}",
                "card_type": "asset", "status": "tagged", "title": title, "kind": "inspiration", "subkind": "map", "collection": COLL_ID,
                "source": {"files": files, "content_hash": "sha256:" + r["sha256"]}, "previews": {"thumb": r["thumb"]},
                "describe": describe, "image": {"width_px": r["width"], "height_px": r["height"], "has_alpha": r["has_alpha"],
                                                "indexed_colors": None, "pixel_art": False},
                "map": mapb, "provenance": prov}
        if flags:
            card["flags"] = flags
        out = outdir / (kebab(Path(rel).with_suffix("").as_posix()) + ".card.json")
        if out.is_file():
            previous = json.loads(out.read_text())
            rights = previous.get("rights")
            if rights is not None and ("vision-input" not in rights.get("uses", []) or rights.get("processing", "local-only") not in ("any", "local-only")):
                continue
            card = preserve_card(previous, card)
        staged = stage_json(out, card)
        records.append((out, staged, card))
        seen[r["sha256"]] = card["id"]
        type_counts[map_type] += 1
        written += 1
    (COLL_DIR / "duplicates.json").write_text(json.dumps([{"duplicate": d, "same_as": k} for d, k in dups], indent=1) + "\n")
    emit({"analysed": len(rows), "cards": written, "duplicates": len(dups), "map_types": dict(type_counts.most_common())}, json_mode, summary=True)
    cardsf = sorted(str(x) for x in outdir.rglob("*.card.json")) + [str(staged) for _, staged, _ in records]
    rr = subprocess.run(["node", str(SCHEMAS / "tools/validate.mjs"), str(SCHEMAS), str(COLL_DIR / "collection.card.json"), *cardsf],
                        capture_output=True, text=True)
    fails = [l for l in rr.stdout.splitlines() if l.startswith("FAIL")]
    emit({"validated": len(cardsf), "fail_lines": len(fails), "rc": rr.returncode}, json_mode, summary=True)
    for l in fails[:20]:
        print(l, file=sys.stderr if json_mode else sys.stdout)
    if rr.returncode:
        if json_mode:
            for path, staged, _ in records:
                if any(staged.name in failure for failure in fails):
                    emit({"card": path.relative_to(ASSETS_ROOT).as_posix(), "status": "invalid", "flags": [], "errors": fails})
        for _, staged, _ in records:
            staged.unlink(missing_ok=True)
        raise SystemExit(1)
    for path, staged, _ in records:
        promote(staged, path)
    if not json_mode:
        write_collection(written, type_counts)
    if json_mode:
        for path, _, card in records:
            emit(card_record(path.relative_to(ASSETS_ROOT).as_posix(), card), json_mode=True)


def write_collection(n, type_counts):
    """Rights: Kevin's 2026-10-26 decision (inspiration only). The EULA reading is not yet confirmed, so the strict default
    applies and effective rights are vision-input only; confirming the licence entry unlocks derive-layout."""
    lic = {"type": "license", "license": "LicenseRef-profantasy-eula", "ref": "ProFantasy EULA shipped with the CC3+ installers",
           "uses": ["derive-layout", "style-reference", "vision-input"], "audience": "private", "redistribution": "none", "attribution": None,
           "set_by": {"role": "intake-code"}, "date": "2026-10-28",
           "note": "Proposed ceiling for a purchased product used privately. Needs Kevin's confirmation of the EULA reading (confirmed_by)."}
    default = {"type": "default", "uses": ["vision-input"], "audience": "private", "redistribution": "none", "set_by": {"role": "intake-code"},
               "date": "2026-10-28"}
    decision = {"type": "decision", "uses": ["derive-layout", "vision-input"], "audience": "private", "redistribution": "none",
                "set_by": {"role": "admin", "name": "kevin"}, "date": "2026-10-26",
                "note": "Inspiration only: agents learn layouts; images and symbols never used in a game, not even as placeholders (C2 §9)."}
    files_total = sum(1 for f in MAPS.rglob("*") if f.is_file())
    card = {"schema": "ogm.asset-card/1.0", "vocab": VOCAB, "id": COLL_ID, "card_type": "collection", "status": "tagged",
            "title": "Campaign Cartographer 3+ maps (ProFantasy)", "license": "LicenseRef-profantasy-eula",
            "rights": {"uses": ["vision-input"], "audience": "private", "redistribution": "none", "attribution": None,
                       "basis": [lic, default, decision]},
            "describe": {"description": "Every map shipped with Kevin's CC3+ bundle (examples, Cartographer's Annual issues, castles, temples, cities), exported to PNG with grid scale and CAD symbol/label sidecars.",
                         "environments": ["dungeon", "castle", "temple", "city", "town"], "settings": ["fantasy", "medieval", "sci-fi"],
                         "roles": ["layout-reference"]},
            "collection_info": {"vendor": "profantasy", "version": VERSION, "origin": "vendor-pack", "counts": {"inspiration/map": n},
                                "creation_choice": False, "files_total": files_total,
                                **({"hash_manifest": HASH_MANIFEST} if (REPO / "assets-local" / HASH_MANIFEST).exists() else {})},
            "provenance": {"*": {"by": "code", "tool": TOOL, "at": NOW},
                           "rights": {"by": "license", "tool": TOOL, "at": NOW, "input": "proposed licence + strict default + Kevin's decision"},
                           "describe": {"by": "code", "tool": TOOL, "at": NOW, "input": "folder list"}}}
    (COLL_DIR / "collection.card.json").write_text(json.dumps(card, indent=1) + "\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("step", choices=["analyse", "cards"])
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    inputs = [str(COLL_DIR / "collection.card.json"), *(str(path) for path in sorted((COLL_DIR / "cards").rglob("*.card.json")))]
    result = subprocess.run(["node", str(SCHEMAS / "tools/validate.mjs"), str(SCHEMAS), *inputs], capture_output=True, text=True)
    if result.returncode:
        print("card validation failed before map analysis: " + result.stdout[-3000:], file=sys.stderr)
        raise SystemExit(1)
    if a.step == "analyse":
        jobs = list(maps())
        jobs = jobs[:a.limit] if a.limit else jobs
        emit({"maps": len(jobs)}, a.json, summary=True)
        c = Counter()
        with Pool(a.workers) as pool:
            for r in pool.imap_unordered(analyse, jobs):
                c[r["status"]] += 1
                if r["status"] != "skip":
                    emit(r, a.json)
        emit({"done": dict(c)}, a.json, summary=True)
        if c.get("fail"):
            raise SystemExit(1)
    else:
        cards(a.json, a.limit)


if __name__ == "__main__":
    main()
