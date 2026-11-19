"""Turn analysis sidecars into C3 sound cards (plan U5): score CLAP labels, rank them against the library, write and validate.

usage: .venv/bin/python -I build_audio_cards.py [--packs DIR] [--no-validate] [--json]
reads  packs/<id>/<ver>/analysis/**/*.analysis.json (from analyze.py) and packs/<id>/collection.card.json
writes packs/<id>/cards/<path>.card.json, updates each audio collection card's counts, prints a summary.

Ranking: CLAP's raw softmax favours some labels on every track ("sunrise", "outer space"), so each label is judged by its
lift = p(label | track) / mean p(label) over the library (music and sound effects separately). A tag is kept only when its
lift is high. game_fit keeps at most two situations, each needing high lift AND agreement from the measured tempo, energy and
key (fits); a track may suit none. Music settings are not tagged: CLAP cannot hear steampunk or pirate (it spread all 11
evenly over the library). Genre comes from the pack name when the vendor named one (Orchestral Music 02)."""
import argparse, copy, fnmatch, hashlib, json, os, re, subprocess, sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import labels as L
import name_tags
import audio_rights
import tag_previews as P
from import_sidetrax import stem_key

REPO = HERE.parents[2]
ROOT = Path(os.environ.get("OGM_ASSETS_ROOT", REPO / "assets-local"))
VALIDATOR = REPO / "packages/contracts/bin/validate-cards.mjs"
VOCAB = "2026-10-27"
TOOL = "build_audio_cards@0.1"
CLAP_ID = "laion/clap-htsat-unfused"
NOW = datetime.now().astimezone().isoformat(timespec="seconds")
NOTE_MAX = 120  # C3 caps audio.search_notes at 120 characters: one searchable line, not a paragraph
SUMMARY_MAX = 200  # and collection_info.search_summary at 200: one line per library
VOICE_PACKS = ("kenney-voiceover-pack", "kenney-voiceover-pack-fighter", "kenney-synth-voice-1", "kenney-synth-voice-2")
UI_PACKS = ("kenney-interface-sounds", "kenney-ui-audio", "kenney-ui-pack")
OPPOSED = {frozenset(x) for x in [("calm", "energetic"), ("calm", "tense"), ("calm", "epic"), ("calm", "triumphant"), ("cozy", "dark"),
           ("cozy", "tense"), ("cozy", "eerie"), ("cheerful", "dark"), ("cheerful", "sad"), ("cheerful", "eerie"), ("playful", "dark"),
           ("playful", "sad"), ("sad", "triumphant"), ("cozy", "epic"), ("playful", "epic"),
           ("energetic", "sad"), ("cozy", "energetic"), ("epic", "sad"), ("playful", "eerie")]}
# Filename words that name a material (C3 materials enum); trusted over CLAP, which hears synthetic sounds as anything.
MAT_WORDS = {"wood": "wood", "wooden": "wood", "plank": "wood", "metal": "metal", "metallic": "metal", "tin": "metal",
             "chain": "metal", "sword": "metal", "coin": "metal", "glass": "glass", "stone": "stone", "rock": "stone", "concrete": "stone",
             "carpet": "cloth", "card": "paper", "chip": "plastic", "chips": "plastic", "cloth": "cloth", "leather": "leather", "paper": "paper", "book": "paper", "water": "water",
             "snow": "ice", "ice": "ice", "grass": "plant", "leaves": "plant", "bone": "bone", "fire": "fire", "plastic": "plastic"}
# Synthesised packs: a "coin" or "sword" there is a synth blip, not metal (Kevin, first review). Only a word that names the
# material outright ("Impact metal", "Glass") counts, and CLAP is not asked.
SYNTH_PACK = ("kenney-retro-sounds", "kenney-digital-audio", "kenney-sci-fi-sounds", "kenney-interface-sounds", "kenney-ui-audio",
              "kenney-music-jingles", "kenney-synth-voice")
MAT_NAMES = {"wood", "wooden", "metal", "metallic", "glass", "stone", "concrete", "cloth", "leather", "paper", "water", "ice", "plastic"}
CLAP_MATS_NEVER = {"fire", "water", "flesh", "earth"}  # CLAP hears card slides as fire; these must come from the filename
STOP = {"sfx", "sound", "audio", "the", "and", "small", "large", "big", "short", "long", "high", "low", "light", "medium", "heavy",
        "soft", "hard", "fast", "slow", "alt", "new", "var", "version"}
FIT_LIFT = 1.6  # tuned on Kevin's first review: rejected situations kept fell from 11/14 to 2/14
PACK_GENRES = {"orchestral": ["orchestral", "cinematic"], "ambient": ["ambient"], "acoustic": ["acoustic"], "pop": ["pop"],
               "rock": ["rock"], "country": ["country"], "electronic": ["electronic"], "piano": ["piano"], "jazz": ["jazz"],
               "blues": ["blues"], "metal": ["metal"], "folk": ["folk"], "chiptune": ["chiptune"]}
MUSIC_CONF = 0.5  # uncalibrated until Kevin's sample review (plan U6); below 0.6 the card carries low-confidence


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


def hint_genres(hints: list[str]) -> list[str]:
    words = {word for hint in hints for word in re.findall(r"[a-z0-9]+", hint.lower())}
    return list(dict.fromkeys(genre for word, genres in PACK_GENRES.items() if word in words for genre in genres))[:3]


def _path_value(document: dict, dotted: str):
    value = document
    for part in dotted.split("."):
        if not isinstance(value, dict) or part not in value:
            return None, False
        value = value[part]
    return value, True


def _set_path(document: dict, dotted: str, value):
    target = document
    parts = dotted.split(".")
    for part in parts[:-1]:
        target = target.setdefault(part, {})
    target[parts[-1]] = copy.deepcopy(value)


def preserve_locked(previous: dict, generated: dict) -> dict:
    merged = copy.deepcopy(generated)
    for field in ("rights", "license", "source"):
        if field in previous:
            merged[field] = copy.deepcopy(previous[field])
        else:
            merged.pop(field, None)
    for dotted, provenance in previous.get("provenance", {}).items():
        if not isinstance(provenance, dict) or not provenance.get("locked") or dotted == "*":
            continue
        value, present = _path_value(previous, dotted)
        if present:
            _set_path(merged, dotted, value)
            merged.setdefault("provenance", {})[dotted] = copy.deepcopy(provenance)
    return merged


def prompts():
    """Every label set as (key, labels, prompts)."""
    moods = L.MOODS + list(L.EXTRA_MOODS)
    return {
        "moods": (moods, [f"{m} music" for m in moods]),
        "genre": (L.GENRES, [f"{g} music" for g in L.GENRES]),
        "instruments": (list(L.INSTRUMENTS), [f"music featuring {v}" for v in L.INSTRUMENTS.values()]),
        "game_fit": (list(L.GAME_FIT), list(L.GAME_FIT.values())),
        "environments": (list(L.ENVIRONMENTS), [f"music that sounds like {v}" for v in L.ENVIRONMENTS.values()]),
        "vocals": (["vocals", "instrumental"], list(L.VOCALS)),
        "sfx_event": ([e[0] for e in L.SFX_EVENTS], [f"the sound of {e[0]}" for e in L.SFX_EVENTS]),
        "sfx_material": (L.MATERIALS, [f"the sound of {m}" for m in L.MATERIALS]),
    }


def text_embeddings(sets):
    import torch
    from transformers import ClapModel, ClapProcessor
    torch.set_num_threads(int(os.environ.get("OGM_TORCH_THREADS", "2")))
    m = ClapModel.from_pretrained(CLAP_ID, use_safetensors=False, local_files_only=True).eval()
    p = ClapProcessor.from_pretrained(CLAP_ID, local_files_only=True)
    out = {}
    with torch.no_grad():
        for k, (_, texts) in sets.items():
            e = m.get_text_features(**p(text=texts, return_tensors="pt", padding=True))
            out[k] = torch.nn.functional.normalize(e, dim=-1).numpy()
        scale = float(m.logit_scale_a.exp())
    return out, scale


def softmax(x):
    x = x - x.max(-1, keepdims=True)
    e = np.exp(x)
    return e / e.sum(-1, keepdims=True)


def kebab(s):
    s = re.sub(r"([a-z0-9])([A-Z])", r"\1-\2", s)
    return re.sub(r"[^a-z0-9/]+", "-", s.lower()).strip("-").replace("/-", "/").replace("-/", "/")


def title_of(stem):
    words = re.sub(r"([a-z])([A-Z])", r"\1 \2", stem).replace("_", " ").replace("-", " ").split()
    words = [w for w in words if not re.fullmatch(r"\d{1,3}", w)] or words
    return " ".join(words).strip().capitalize()[:120] or stem


def pick(lift, p, names, min_lift, k):
    order = sorted(range(len(names)), key=lambda i: -lift[i])
    return [(names[i], float(lift[i]), float(p[i])) for i in order[:k] if lift[i] >= min_lift]


def album_no(album):
    """Sidetrax numbers its music-pack series in the album tag ("07 Rock Follies"); that number is the catalog number."""
    m = re.match(r"^(\d{1,3})\s+\S", album or "")
    return int(m.group(1)) if m else None


def settle_tempo(a, vendor):
    """Composer tempo picks between the measured tempo and its half/double readings."""
    v = vendor.get("tempo_bpm")
    if not v or a.get("tempo_bpm") is None:
        return None
    cands = [a["tempo_bpm"]] + list(a.get("tempo_alternatives", []))
    best = min(cands, key=lambda c: abs(c - v) / v)
    if abs(best - v) / v > 0.04:
        return None
    others = [c for c in cands if c != best]
    a["tempo_bpm"], a["tempo_alternatives"] = round(v, 2), [round(c, 2) for c in others][:3]
    return best


def matches_any(name: str, only) -> bool:
    """True when the pack id matches one of the --only globs (a bare string is one glob; none means all)."""
    patterns = [only] if isinstance(only, str) else (only or ["*"])
    return any(fnmatch.fnmatch(name, pattern) for pattern in patterns)


def load(packs: Path, only="*"):
    rows = []
    policies = {}
    for sc in sorted(packs.glob("*/*/analysis/**/*.analysis.json")):
        if not matches_any(sc.relative_to(packs).parts[0], only):
            continue
        d = json.loads(sc.read_text())
        d["_sidecar"] = sc
        rel = sc.relative_to(packs)
        d["_pack"], d["_ver"] = rel.parts[0], rel.parts[1]
        pack = packs / d["_pack"]
        if d["_pack"] not in policies:
            policies[d["_pack"]] = (audio_rights.collection_rights(pack), audio_rights.source_cards(pack))
        rights, cards = policies[d["_pack"]]
        allowed, prefix = audio_rights.source_policy(rights, audio_rights.cards_for_stem(cards, d["file"]))
        if not allowed:
            continue
        d["_preview_prefix"] = prefix
        rows.append(d)
    return rows


def score_all(rows, emb, scale, sets):
    """Per file and label set: softmax over the set for each excerpt, averaged over excerpts."""
    for d in rows:
        A = np.array([e["embedding"] for e in d["clap"]["excerpts"]], dtype=np.float32)
        keys = ["moods", "genre", "instruments", "game_fit", "environments", "vocals"] if d["music"] else ["sfx_event", "sfx_material"]
        d["_p"] = {k: softmax(scale * A @ emb[k].T).mean(0) for k in keys}


def library_means(rows):
    means = {}
    for music in (True, False):
        group = [d for d in rows if d["music"] == music]
        for k in (group[0]["_p"] if group else {}):
            means[(music, k)] = np.mean([d["_p"][k] for d in group], axis=0)
    return means


def energy_ranks(rows):
    """Each track's measured energy as a percentile of the music library (0 quietest, 1 most energetic)."""
    group = [d for d in rows if d["music"]]
    e = np.array([d["measure"]["audio"].get("energy") or 0.0 for d in group])
    for d, r in zip(group, e.argsort().argsort() / max(len(group) - 1, 1)):
        d["_eq"] = float(r)


def fits(name, eq, bpm, minor):
    """The measured facts must agree with a situation CLAP suggests: no chase on a slow, quiet track, no stealth on a loud one."""
    if name in L.FAST_FIT and not (eq >= 0.6 and ((bpm or 0) >= 100 or eq >= 0.8)):
        return False
    if name in L.QUIET_FIT and eq > 0.55:
        return False
    if name in L.SAD_FIT and not (minor or (bpm or 999) < 90):
        return False
    if name in L.BRIGHT_FIT and minor and eq <= 0.7:
        return False
    return True


def pack_genre(pid):
    words = set(pid.replace("-", " ").split())
    return next((g for w, g in PACK_GENRES.items() if w in words), None)


def duration_text(dur):
    """The shortest honest length: `1:32` for minutes, `12 s`, `0.42 s` for a short effect."""
    if dur >= 60:
        return f"{int(dur // 60)}:{int(dur % 60):02d}"
    return f"{dur:.0f} s" if dur >= 10 else f"{dur:.2f} s"


def search_note(describe, audio, subkind):
    """One line per file: what an agent searches for, in the words the card already carries.

    The searchability plan (§5) asks for a line of notes per file so a result row can be judged without opening the
    file: the kind of sound, what it is made of or sounds like, and the facts that narrow a query (mood, genre, tempo
    or length). Built from the same fields the card validates, so it can never say something the card does not.
    """
    dur = duration_text(audio.get("duration_s") or 0.0)
    if subkind.startswith("music/"):
        moods = describe.get("moods") or []
        genre = describe.get("genre") or []
        word = {"music/loop": "loop", "music/stinger": "stinger"}.get(subkind, "track")
        head = " ".join([*(moods[:2]), *(genre[:1]), word])
        facts = [f"{audio['tempo_bpm']:.0f} BPM"] if audio.get("tempo_bpm") else []
        if audio.get("loopable"):
            facts.append("seamless")
        return " · ".join([head.strip(), *facts, dur])[:NOTE_MAX].strip(" ·")
    kind = subkind.split("/")[-1]
    objects = (describe.get("objects") or [])[:2]
    materials = (describe.get("materials") or [])[:1]
    words = [*materials, *([] if kind in objects else [kind]), *objects]
    return " · ".join([" ".join(words), dur])[:NOTE_MAX].strip(" ·")


def library_summary(entries, limit=SUMMARY_MAX):
    """The per-library line: what this pack holds and which moods and genres it covers most.

    Answers "which pack has feet on gravel" before any file is opened (#364 §6): counts by kind, then the three
    moods, two genres and two materials that recur most, so a pack whose cards say nothing reads as empty rather
    than interesting.
    """
    kinds = defaultdict(int)
    for subkind, _ in entries:
        kinds[subkind.split("/")[-1]] += 1
    top = lambda field, k: [name for name, _ in Counter(x for _, d in entries for x in (d.get(field) or [])[:3]).most_common(k)]
    parts = [f"{n} {kind}" for kind, n in sorted(kinds.items(), key=lambda kv: (-kv[1], kv[0]))[:3]]
    for label, values in (("moods", top("moods", 3)), ("genres", top("genre", 2)), ("materials", top("materials", 2))):
        if values:
            parts.append(f"{label} " + ", ".join(values))
    return "; ".join(parts)[:limit].strip(" ;")


def keywords_of(d, exclude=()):
    """Search words the name layer already knows (`describe.keywords`), minus whatever another field says.

    The name layer runs before the model (asset-searchability §5), so a UCS category, a spelled-out subcategory and the
    words in the filename reach the card even when CLAP is not part of the run at all.
    """
    names = d.get("names") or {}
    return name_tags.search_terms(names.get("ucs") or {}, names.get("terms") or [], exclude)


def music_describe(d, lift, sets, a, subkind):
    names = lambda k: sets[k][0]
    proposed = []
    moods = []
    for name, lf, p in pick(lift["moods"], d["_p"]["moods"], names("moods"), 1.3, 6):
        if name in L.MOODS:
            target = name
        else:
            target = L.EXTRA_MOODS[name]
            proposed.append({"field": "moods", "tag": name, "nearest": target, "reason": f"CLAP lift {lf:.1f} vs library"})
        if (target == "energetic" and d["_eq"] < 0.4) or (target == "calm" and d["_eq"] > 0.6):
            continue  # measured energy overrules CLAP on the one mood it can check
        if target not in moods and not any(frozenset((target, m)) in OPPOSED for m in moods):
            moods.append(target)
    if not moods:
        i = int(np.argmax(lift["moods"]))
        n = names("moods")[i]
        moods = [n if n in L.MOODS else L.EXTRA_MOODS[n]]
    moods = moods[:3]
    genre = [n for n, _, _ in pick(lift["genre"], d["_p"]["genre"], names("genre"), 1.3, 3)] or [names("genre")[int(np.argmax(lift["genre"]))]]
    vendor_genre = hint_genres(d.get("hints", [])) or pack_genre(d["_pack"])
    if vendor_genre:
        genre = list(dict.fromkeys(vendor_genre + genre))[:3]
    instruments = [n for n, _, _ in pick(lift["instruments"], d["_p"]["instruments"], names("instruments"), 1.8, 4)]
    envs = [n for n, _, _ in pick(lift["environments"], d["_p"]["environments"], names("environments"), 2.0, 2)]
    minor = a.get("mode") == "minor" and a.get("key_strength", 0) >= 0.5
    fit = {n: round(min(1.0, (lf - 1) / 2), 2) for n, lf, _ in pick(lift["game_fit"], d["_p"]["game_fit"], names("game_fit"), FIT_LIFT, 24)
           if fits(n, d["_eq"], a.get("tempo_bpm"), minor)}
    fit = dict(list(fit.items())[:2])
    pv = float(d["_p"]["vocals"][0])
    desc = {"description": "", "objects": [], "roles": ["music-bed"], "moods": moods, "genre": genre, "game_fit": fit,
            "style_family": "any"}
    if instruments:
        desc["instruments"] = instruments
    if envs:
        desc["environments"] = envs
    if pv > 0.75 or pv < 0.25:
        desc["has_vocals"] = pv > 0.75
    kind_word = {"music/loop": "loop", "music/stinger": "stinger"}.get(subkind, "track")
    dur = a["duration_s"]
    facts = []
    if a.get("tempo_bpm"):
        facts.append(f"{a['tempo_bpm']:.0f} BPM")
    if a.get("key") and a.get("key_strength", 0) >= 0.5:
        facts.append(f"{a['key']} {a['mode']}")
    facts.append(f"{int(dur // 60)}:{int(dur % 60):02d}" if dur >= 60 else f"{dur:.0f} s" if dur >= 10 else f"{dur:.1f} s")
    text = f"{moods[0].capitalize()}{', ' + moods[1] if len(moods) > 1 else ''} {genre[0]} {kind_word} ({', '.join(facts)})"
    if fit:
        text += "; suits " + " and ".join(k.replace("-", " ") for k in fit)
    if envs:
        text += f"; evokes {L.ENVIRONMENTS[envs[0]]}"
    desc["description"] = (text + ".")[:300]
    keywords = keywords_of(d, [*moods, *genre, *instruments, *(L.ENVIRONMENTS[e] for e in envs)])
    if keywords:
        desc["keywords"] = keywords
    return desc, proposed


def sfx_describe(d, lift, sets, a, stem, pid):
    events = sets["sfx_event"][0]
    p = d["_p"]["sfx_event"]
    top = int(np.argmax(p))
    ev = L.SFX_EVENTS[top]
    words = [w.lower() for w in re.findall(r"[A-Za-z][a-z]+|[A-Z]+(?![a-z])", stem) if len(w) > 2 and w.lower() not in STOP]
    objects = []
    for w in words:
        w = w[:-1] if w.endswith("s") and not w.endswith("ss") else w
        if re.fullmatch(r"[a-z][a-z0-9-]*", w) and w not in objects:
            objects.append(w)
    noun_sub = {}
    for e in L.SFX_EVENTS:
        noun_sub.setdefault(e[1], e[2])
    named = [w for w in objects if w in noun_sub]  # the filename already says what makes the sound
    clap_obj = ev[1] if p[top] >= 0.3 and not named and pid not in VOICE_PACKS else None
    if clap_obj and clap_obj not in objects:
        objects.append(clap_obj)
    objects = objects[:12]
    synth = pid.startswith(SYNTH_PACK)
    mats = [] if pid in VOICE_PACKS else list(dict.fromkeys(MAT_WORDS[w] for w in words if w in MAT_WORDS and (w in MAT_NAMES or not synth)))[:2]
    if not mats and not synth and pid not in UI_PACKS + VOICE_PACKS and (named and noun_sub[named[0]] or ev[2]) in ("sfx/foley", "sfx/impact", "sfx/footstep"):
        mats = [n for n, _, pp in pick(lift["sfx_material"], d["_p"]["sfx_material"], sets["sfx_material"][0], 1.5, 1) if pp >= 0.5 and n not in CLAP_MATS_NEVER]
    if pid in VOICE_PACKS:
        subkind, roles = "voice", ["voice-line"]
    elif pid in UI_PACKS:
        subkind, roles = "sfx/ui", ["feedback"]
    else:
        # The name layer runs first (asset-searchability §5): a UCS category or a folder word is evidence from the file
        # itself, so it outranks CLAP. "voice" is never taken from a name, only from a voice pack, for the same reason
        # CLAP cannot say it: a scream is a creature sound, not a spoken line.
        named_sub = (d.get("names") or {}).get("subkind")
        if named_sub == "voice":
            named_sub = None
        subkind = named_sub or (noun_sub[named[0]] if named else (ev[2] if p[top] >= 0.15 else "sfx/other"))
        if subkind.startswith("music/") or subkind == "voice":  # voice only from the voice packs, never a CLAP guess
            subkind = "sfx/other"
        roles = {"ambience": ["ambience-bed"], "voice": ["voice-line"], "sfx/ui": ["feedback"]}.get(subkind, ["feedback", "effect"])
    title = title_of(stem)
    if subkind == "voice":
        text = f"Voice line: \"{title.lower()}\" ({a['duration_s']:.1f} s)."
    else:
        text = f"{title}: {a['duration_s']:.2f} s {subkind.split('/')[-1]} sound"
        if mats:
            text += f", {mats[0]}"
        if clap_obj:
            text += f"; sounds like {events[top]}"
        text += "."
    desc = {"description": text[:300], "objects": objects, "roles": roles, "style_family": "any"}
    if subkind == "voice":  # the words are the spoken line, not things in the scene
        desc["objects"], desc["keywords"] = ["voice"], [w for w in objects if w != "voice"][:12]
    if mats:
        desc["materials"] = mats
    keywords = keywords_of(d, [*objects, *mats])
    if keywords:  # a voice pack's keywords are the spoken words; the name layer adds its own on top
        desc["keywords"] = list(dict.fromkeys([*desc.get("keywords", []), *keywords]))[:12]
    conf = round(min(0.85, 0.35 + float(p[top])), 2)
    return desc, subkind, conf, events[top], float(p[top])


def build_pack_derivatives(pid: str, items: list[dict], collection: dict, packs: Path) -> bool:
    music = sorted((item for item in items if item.get("music")), key=lambda item: item["file"])
    if not music or any("preview_tile" not in item for item in music):
        return False
    prefix = P.preview_prefix(collection.get("rights"))
    if any(item.get("_preview_prefix") == "private/previews" for item in music):
        prefix = "private/previews"
    combined_hash = hashlib.sha256("\0".join(item["sha256"] for item in music).encode()).hexdigest()
    tiles = [packs / pid / item["_ver"] / item["preview_tile"] for item in music]
    missing = [path for path in tiles if not path.is_file()]
    if missing:
        raise FileNotFoundError(f"missing audio preview tile: {missing[0]}")
    sheet_key = P.derivative_key(prefix, combined_hash, "audio-sheet", "webp", tracks=len(music), version=1)
    sheet_out = ROOT / sheet_key
    if not sheet_out.is_file():
        P.compose_sheet(tiles, sheet_out)

    tracks = [
        {
            "id": f"{pid}/{item['file']}",
            "duration_s": item["measure"]["audio"]["duration_s"],
            "sidecar": item["measure"]["sidecar"],
        }
        for item in music
    ]
    plan = P.medley_plan(tracks)
    by_id = {track["id"]: item for track, item in zip(tracks, music)}
    entries = []
    for slot in plan:
        item = by_id[slot["id"]]
        entries.append(
            {
                **slot,
                "source": packs / pid / item["_ver"] / "extracted" / item["file"],
            }
        )
    plan_hash = hashlib.sha256(
        (combined_hash + "\0" + json.dumps(plan, sort_keys=True, separators=(",", ":"))).encode()
    ).hexdigest()
    medley_key = P.derivative_key(prefix, plan_hash, "medley", "ogg", tracks=len(music), duration_s=30, version=1)
    medley_out = ROOT / medley_key
    if not medley_out.is_file():
        P.make_medley(entries, medley_out)
    collection.setdefault("previews", {}).update({"sheet": sheet_key, "clip": medley_key})
    return True


def build(rows, sets, means, packs: Path, update_counts=True, limit=0):
    selected_sidecars = {d["_sidecar"] for d in rows[:limit]} if limit else None
    by_pack = defaultdict(list)
    for d in rows:
        by_pack[d["_pack"]].append(d)
    same_name = defaultdict(list)  # same piece across Sidetrax packs (full track in one pack, loop in another)
    for d in rows:
        if d["_pack"].startswith("sidetrax-"):
            same_name[stem_key(Path(d["file"]).stem)].append(d)
    written, flags_count, counts, records, collection_updates = 0, defaultdict(int), defaultdict(lambda: defaultdict(int)), [], []
    described = defaultdict(list)  # pid -> (subkind, describe) of every card written, for the per-library summary
    group_sizes = defaultdict(int)  # a variation group of one is not a set: only names with siblings get the field
    for d in rows:
        group = (d.get("names") or {}).get("group")
        if group:
            group_sizes[(d["_pack"], group)] += 1
    for pid, items in by_pack.items():
        cc = json.loads((packs / pid / "collection.card.json").read_text())
        coll = cc["id"]
        ver = coll.rsplit("@", 1)[1]
        pack_records = []
        compatibility_rows = []
        groups = defaultdict(list)
        for d in items:
            groups[(str(Path(d["file"]).parent), stem_key(Path(d["file"]).stem))].append(d)
        for _, g in groups.items():
            g.sort(key=lambda d: -d["measure"]["audio"]["duration_s"])
            d = g[0]
            a = dict(d["measure"]["audio"])
            a["analysis"] = d["_sidecar"].relative_to(packs / pid).as_posix()
            v = d.get("vendor", {})
            vend = {k: v[k] for k in ("title", "album", "composer") if v.get(k)}
            if v.get("catalog_no") is not None:
                vend["catalog_no"] = v["catalog_no"]
            elif album_no(v.get("album")) is not None:
                vend["catalog_no"] = album_no(v.get("album"))
            if re.fullmatch(r"\d{4}", str(v.get("date", ""))):
                vend["year"] = int(v["date"])
            if v.get("tempo_bpm"):
                vend["tempo_bpm"] = v["tempo_bpm"]
            if vend:
                a["vendor"] = vend
            matched = settle_tempo(a, v) if d["music"] else None
            rel = Path(d["file"])
            stem = rel.stem
            names = d.get("names") or {}
            path_id = kebab(rel.with_suffix("").as_posix())
            lift = {k: d["_p"][k] / means[(d["music"], k)] for k in d["_p"]}
            prov = {"*": {"by": "code", "tool": TOOL, "at": NOW, "input": "analyze.py: Essentia + librosa measures, sha256"}}
            flags = []
            proposed = []
            if d["music"]:
                subkind = ("music/loop" if "loop" in pid else "music/stinger" if a["duration_s"] < 15 or "jingle" in pid else "music/track")
                describe, proposed = music_describe(d, lift, sets, a, subkind)
                hints = P.normalize_hints(d.get("hints", []))
                if hints:
                    describe["hints"] = hints
                prov["describe"] = {"by": "model", "model": CLAP_ID, "tool": TOOL, "at": NOW, "confidence": MUSIC_CONF,
                                    "input": "CLAP embeddings of two 30 s excerpts vs label prompts, lift vs library; key/tempo not shown"}
                prov["describe.description"] = {"by": "code", "tool": TOOL, "at": NOW, "input": "template from CLAP tags + measured audio"}
                if hints:
                    prov["describe.hints"] = {"by": "collection", "tool": TOOL, "at": NOW, "input": "pack.json hints"}
                flags += ["low-confidence", "mood-unverified"]
            else:
                describe, subkind, conf, ev, pev = sfx_describe(d, lift, sets, a, stem, pid)
                for field, (value, why) in name_tags.card_name_fields(names, group_sizes[(pid, names.get("group"))]).items():
                    a[field] = value
                    prov[f"audio.{field}"] = {"by": "filename", "tool": TOOL, "at": NOW, "input": why}
                if names.get("subkind") and names["subkind"] == subkind:
                    prov["subkind"] = {"by": "filename", "tool": TOOL, "at": NOW, "input": "UCS category or folder word, ahead of CLAP"}
                prov["describe"] = {"by": "model", "model": CLAP_ID, "tool": TOOL, "at": NOW, "confidence": conf,
                                    "input": f"CLAP vs {len(L.SFX_EVENTS)} sound events (top: {ev} p={pev:.2f}) + {len(L.MATERIALS)} materials"}
                prov["describe.objects"] = {"by": "filename", "tool": TOOL, "at": NOW, "input": "filename words, plus the top CLAP event noun when p>=0.2"}
                prov["describe.description"] = {"by": "code", "tool": TOOL, "at": NOW, "input": "template from filename + CLAP event + measured duration"}
                if conf < 0.6:
                    flags.append("low-confidence")
            if subkind == "voice" or pid in VOICE_PACKS or pid in UI_PACKS:
                prov["subkind"] = {"by": "filename", "tool": TOOL, "at": NOW, "input": "pack name"}
            if a.get("vendor"):
                prov["audio.vendor"] = {"by": "vendor-metadata", "tool": TOOL, "at": NOW, "input": "ffprobe tags + RIFF adtl label"}
            if matched is not None:
                prov["audio.tempo_bpm"] = {"by": "vendor-metadata", "tool": TOOL, "at": NOW,
                                           "input": f"composer tempo {a['tempo_bpm']} matched measured candidate {matched}"}
            a["search_notes"] = search_note(describe, a, subkind)
            prov["audio.search_notes"] = {"by": "code", "tool": TOOL, "at": NOW,
                                           "input": "template from the card's own kind, moods, genre, materials and duration"}
            files = [{"path": x["file"], "sha256": "sha256:" + x["sha256"], "bytes": x["bytes"], "format": Path(x["file"]).suffix.lstrip(".").lower(),
                      "role": "primary" if x is d else "companion"} for x in g]
            card = {"schema": "ogm.asset-card/1.0", "vocab": VOCAB, "id": f"t1:{pid}/{path_id}@{ver}", "card_type": "asset", "status": "tagged",
                    "title": (v.get("title") or title_of(stem))[:120], "kind": "audio", "subkind": subkind, "collection": coll,
                    "source": {"files": files, "content_hash": "sha256:" + d["sha256"]},
                    "previews": {k: value for k, value in (d.get("preview") or {}).items() if value},
                    "describe": describe, "audio": a, "provenance": prov}
            if len(g) > 1:
                card["audio"]["cuts"] = [{"path": x["file"], "role": "loop" if "loop" in x["file"].lower() else "alt-mix",
                                          "duration_s": x["measure"]["audio"]["duration_s"], "loudness_lufs": x["measure"]["audio"].get("loudness_lufs"),
                                          "peak_dbfs": x["measure"]["audio"]["peak_dbfs"]} for x in g[1:]]
            rel_ids = [o for o in same_name.get(stem_key(stem), []) if o["_pack"] != pid]
            if rel_ids:
                card["related"] = [{"rel": "same-set", "id": f"t1:{o['_pack']}/{kebab(Path(o['file']).with_suffix('').as_posix())}@{o['_ver']}"} for o in rel_ids][:10]
            if proposed:
                card["proposed_tags"] = proposed[:12]
            if flags:
                card["flags"] = flags
            out = packs / pid / "cards" / (path_id + ".card.json")
            selected = selected_sidecars is None or any(item["_sidecar"] in selected_sidecars for item in g)
            pack_records.append((out, card, selected))
            if d["music"]:
                embedding = np.mean([excerpt["embedding"] for excerpt in d["clap"]["excerpts"]], axis=0)
                norm = float(np.linalg.norm(embedding))
                compatibility_rows.append(
                    {
                        "id": card["id"],
                        "hash": d["sha256"],
                        "tempo_bpm": a.get("tempo_bpm"),
                        "key": a.get("key"),
                        "mode": a.get("mode"),
                        "key_strength": a.get("key_strength", 0),
                        "embedding": (embedding / norm).tolist() if norm else [],
                    }
                )
            counts[pid]["audio/" + subkind] += 1
            counts[pid]["audio"] += 1
            described[pid].append((subkind, describe))
            if selected:
                for flag in flags:
                    flags_count[flag] += 1
                written += 1
        set_ids = P.compatibility_sets(compatibility_rows, pid)
        for out, card, selected in pack_records:
            if card["id"] in set_ids:
                card["describe"]["set"] = set_ids[card["id"]]
                card["provenance"]["describe.set"] = {
                    "by": "model",
                    "model": CLAP_ID,
                    "tool": TOOL,
                    "at": NOW,
                    "confidence": 0.8,
                    "input": "measured tempo/key + normalized CLAP timbre; pack-local complete-link grouping",
                }
            if not selected:
                continue
            if out.is_file():
                card = preserve_locked(json.loads(out.read_text()), card)
            staged = stage_json(out, card)
            records.append((out, staged, card))
        collection_changed = build_pack_derivatives(pid, items, cc, packs)
        if update_counts:
            info = cc.setdefault("collection_info", {})
            info["counts"] = {**{k: v for k, v in info.get("counts", {}).items() if not k.startswith("audio")}, **dict(sorted(counts[pid].items()))}
        if described[pid]:
            cc.setdefault("collection_info", {})["search_summary"] = library_summary(described[pid])
        if update_counts or collection_changed or described[pid]:
            out = packs / pid / "collection.card.json"
            staged = stage_json(out, cc, indent=1 if pid.startswith(("kenney-", "synty-")) else 2)
            collection_updates.append((out, staged, cc))
    return written, dict(flags_count), records, collection_updates


def validate(packs: Path, staged=()):
    cards = sorted(str(p) for p in packs.glob("*/cards/**/*.card.json"))
    colls = sorted(str(p) for p in packs.glob("*/collection.card.json"))
    r = subprocess.run(["node", str(VALIDATOR), *colls, *cards, *(str(p) for p in staged)], capture_output=True, text=True)
    fails = [l for l in r.stdout.splitlines() if l.startswith("FAIL")]
    return r.returncode, len(cards), fails, r.stdout


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--packs", type=Path, default=ROOT / "packs")
    ap.add_argument("--only", action="append", help="pack id glob; repeat to select several packs")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--no-validate", action="store_true")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    rows = load(a.packs, a.only)
    sets = prompts()
    emb, scale = text_embeddings(sets)
    score_all(rows, emb, scale, sets)
    means = library_means(rows)
    energy_ranks(rows)
    n, flags, records, collection_updates = build(rows, sets, means, a.packs, update_counts=not a.json, limit=a.limit)
    staged = [part for _, part, _ in records] + [part for _, part, _ in collection_updates]
    emit({"sidecars": len(rows), "music": sum(d["music"] for d in rows), "cards": n, "flags": flags}, a.json, summary=True)
    if not a.no_validate:
        rc, nc, fails, out = validate(a.packs, staged)
        emit({"validated": nc, "fail_lines": len(fails), "rc": rc}, a.json, summary=True)
        for l in fails[:30]:
            print(l, file=sys.stderr if a.json else sys.stdout)
        if rc and not fails:
            print(out[-3000:], file=sys.stderr if a.json else sys.stdout)
        if rc:
            if a.json:
                for path, part, _ in records:
                    if any(part.name in failure for failure in fails):
                        emit({"card": path.relative_to(ROOT).as_posix(), "status": "invalid", "flags": [], "errors": fails})
            for part in staged:
                part.unlink(missing_ok=True)
            raise SystemExit(1)
    for path, part, _ in records:
        promote(part, path)
    for path, part, _ in collection_updates:
        promote(part, path)
    if a.json:
        for path, _, card in records:
            emit(card_record(path.relative_to(ROOT).as_posix(), card), json_mode=True)


if __name__ == "__main__":
    main()
