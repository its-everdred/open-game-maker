"""Analyse every audio file in assets-local/packs once (plan U2/U5): name tags, code facts, vendor tags, a CLAP embedding,
a waveform preview and a two-second clip.

usage: .venv/bin/python -I analyze.py [--workers N] [--packs DIR] [--only PACK_GLOB] [--limit N] [--refresh]
writes, per file, packs/<id>/<ver>/analysis/<path without ext>.analysis.json:
  {"file", "sha256", "bytes", "music", "names": {ucs, group, subkind, terms}, "measure": {audio, sidecar, timing_s},
   "vendor": {...}, "clap": {"model", "windows": [...], "excerpts": [{"name", "start_s", "end_s", "embedding": [512 floats]}]},
   "preview": {"waveform": key, "clip": key}}
Labels are not scored here: the card step scores any label set against the stored embeddings, so labels can change without
re-listening. Re-runs skip files whose sidecar already has the same sha256; `--refresh` re-does them, which is how a run
adds a newly recorded field to files carded earlier.
Run with `--limit 20` first: the summary prints what the rest of the run will cost."""
import argparse, fnmatch, hashlib, json, os, re, struct, subprocess, sys, time
from multiprocessing import Pool
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from preview_paths import safe_preview

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import name_tags
import audio_rights
import previews
from card_coverage import project_run_hours

ROOT = Path(os.environ.get("OGM_ASSETS_ROOT", HERE.parents[2] / "assets-local"))
AUDIO_EXT = {".wav", ".ogg", ".mp3", ".flac", ".m4a", ".aif", ".aiff"}
MUSIC_PACKS = name_tags.MUSIC_PACKS  # the families named in #509 plus Sidetrax and Kenney music; see name_tags
CLAP_ID = "laion/clap-htsat-unfused"
CLAP_SR = 48000
WIN_S = 10  # CLAP's native window; whole windows only, so its random-crop path never runs

sys.path.insert(0, str(HERE))
import tag_previews as P


def is_music(pack: str) -> bool:
    return name_tags.is_music(pack)


def emit(record: dict, json_mode: bool = False, summary: bool = False):
    """Keep JSON-mode records on stdout and operational summaries on stderr."""
    stream = sys.stderr if json_mode and summary else sys.stdout
    print(json.dumps(record), file=stream, flush=True)


def _card_subkinds(pack: Path) -> dict[str, str]:
    result = {}
    for path in sorted((pack / "cards").rglob("*.card.json")):
        try:
            card = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        for source in card.get("source", {}).get("files", []):
            if source.get("role") == "primary" and isinstance(source.get("path"), str):
                result[source["path"]] = card.get("subkind", "")
    return result


def matches_any(name: str, only) -> bool:
    """True when the pack id matches one of the --only globs (a bare string is one glob; none means all)."""
    patterns = [only] if isinstance(only, str) else (only or ["*"])
    return any(fnmatch.fnmatch(name, pattern) for pattern in patterns)


def audio_files(packs: Path, only="*"):
    """(pack id, version dir, file) for every audio file, one format per stem (ogg preferred over wav/mp3 copies)."""
    out = []
    for pj in sorted(packs.glob("*/pack.json")):
        pid = pj.parent.name
        if not matches_any(pid, only):
            continue
        manifest = json.loads(pj.read_text())
        cur = manifest["current"]
        ext = audio_rights.extracted_root(pj.parent, cur)
        hints = P.normalize_hints(manifest.get("hints"))
        rights = audio_rights.collection_rights(pj.parent)
        cards = audio_rights.source_cards(pj.parent, ext)
        subkinds = _card_subkinds(pj.parent)
        seen = {}
        for f in sorted(ext.rglob("*")):
            if f.suffix.lower() in AUDIO_EXT and f.is_file() and not f.name.startswith("._"):
                if f.resolve() != f or not f.resolve().is_relative_to(ext):
                    raise ValueError(f"audio source escapes collection: {f}")
                key = f.with_suffix("").relative_to(ext).as_posix().lower()
                rank = [".ogg", ".wav", ".flac", ".aiff", ".aif", ".mp3", ".m4a"].index(f.suffix.lower())
                if key not in seen or rank < seen[key][0]:
                    seen[key] = (rank, f)
        for _, f in sorted(seen.values(), key=lambda x: str(x[1])):
            rel = f.relative_to(ext).as_posix()
            allowed, prefix = audio_rights.source_policy(rights, audio_rights.cards_for_stem(cards, rel))
            if not allowed:
                continue
            out.append(
                {
                    "pack": pid,
                    "version_dir": ext.parent,
                    "file": f,
                    "music": is_music(pid) or P.music_evidence(subkinds.get(rel), hints),
                    "preview_prefix": prefix,
                    "hints": hints,
                }
            )
    return out


def sidecar_path(vdir: Path, f: Path) -> Path:
    rel = f.relative_to(vdir / "extracted").with_suffix("")
    return vdir / "analysis" / (rel.as_posix() + ".analysis.json")


def job_list(packs: Path, only: str, limit: int = 0, refresh: bool = False):
    """Build work records, including whether to ignore existing sidecars."""
    jobs = audio_files(packs, only)
    jobs = jobs[:limit] if limit else jobs
    return [{**job, "refresh": refresh} for job in jobs]


def sha256(f: Path) -> str:
    h = hashlib.sha256()
    with open(f, "rb") as r:
        for b in iter(lambda: r.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def analysis_current(
    data: dict,
    source_hash: str,
    version_dir: Path,
    expected_music: bool,
    expected_preview_prefix: str,
    expected_hints: list[str],
    assets_root: Path = ROOT,
) -> bool:
    if (
        data.get("sha256") != source_hash
        or data.get("music") is not expected_music
        or data.get("hints") != expected_hints
    ):
        return False
    waveform = data.get("preview", {}).get("waveform")
    if not isinstance(waveform, str) or not waveform.startswith(expected_preview_prefix + "/"):
        return False
    if not safe_preview(assets_root, waveform).is_file():
        return False
    if not expected_music:
        return True
    clip = data.get("preview", {}).get("clip")
    tile = data.get("preview_tile")
    return (
        isinstance(clip, str)
        and clip.startswith(expected_preview_prefix + "/")
        and isinstance(tile, str)
        and safe_preview(assets_root, clip).is_file()
        and (version_dir / tile).is_file()
    )


def vendor_tags(f: Path) -> dict:
    """Container tags (ffprobe) plus the DAW tempo label Sidetrax WAVs carry in a RIFF adtl/labl chunk ("Tempo: 120.0")."""
    out = {}
    try:
        p = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format_tags", "-of", "json", str(f)], capture_output=True, text=True, timeout=60)
        tags = {k.lower(): v for k, v in json.loads(p.stdout or "{}").get("format", {}).get("tags", {}).items()}
    except (subprocess.SubprocessError, json.JSONDecodeError):
        tags = {}
    for k in ("title", "album", "artist", "composer", "date", "genre", "track"):
        if tags.get(k):
            out[k] = tags[k].strip()
    m = re.match(r"^(\d{1,4})\s+(.+)$", out.get("title", ""))
    if m:
        out["catalog_no"], out["title"] = int(m.group(1)), m.group(2)
    if f.suffix.lower() == ".wav":
        b = f.read_bytes()
        i = 12
        while i + 8 <= len(b):
            cid, n = b[i:i + 4], struct.unpack("<I", b[i + 4:i + 8])[0]
            if cid == b"LIST" and b[i + 8:i + 12] == b"adtl":
                t = re.search(rb"Tempo:\s*([0-9.]+)", b[i + 8:i + 8 + n])
                if t:
                    out["tempo_bpm"] = float(t.group(1))
            i += 8 + n + (n & 1)
    return out


def excerpts(curve, dur, music):
    """Windows to embed. Music: the median-energy 30 s and the loudest 30 s (non-overlapping), each as 3 x 10 s.
    Music of 60 s or less: its two halves, so every track still gets two excerpts.
    Short sound effects: the whole file, cut into 10 s windows (at most 3)."""
    import numpy as np
    if not music:
        n = max(1, min(3, int(dur // WIN_S)))
        return [("whole", 0.0, min(dur, n * WIN_S) if dur >= WIN_S else dur)]
    if dur <= 60:
        return [("first-half", 0.0, dur / 2), ("second-half", dur / 2, dur)]
    c = np.array(curve, float)
    w = 30
    sums = np.convolve(np.where(c > -70, c, -70), np.ones(w) / w, "valid")
    loud = int(np.argmax(sums))
    med = int(np.argmin(np.abs(sums - np.median(sums))))
    if abs(med - loud) < w:
        far = [i for i in range(len(sums)) if abs(i - loud) >= w]
        med = min(far, key=lambda i: abs(sums[i] - np.median(sums))) if far else med
    return sorted([("typical", float(med), float(med + w)), ("loudest", float(loud), float(loud + w))], key=lambda x: x[1])


_M = None


def clap():
    global _M
    if _M is None:
        import torch
        from transformers import ClapModel, ClapProcessor
        torch.set_num_threads(int(os.environ.get("OGM_TORCH_THREADS", "2")))
        _M = (
            ClapModel.from_pretrained(CLAP_ID, use_safetensors=False, local_files_only=True).eval(),
            ClapProcessor.from_pretrained(CLAP_ID, local_files_only=True),
        )
    return _M


def embed(y, spans):
    """One L2-normalised embedding per excerpt: mean of its 10 s windows' embeddings."""
    import numpy as np, torch
    m, p = clap()
    out = []
    for name, a, b in spans:
        seg = y[int(a * CLAP_SR):int(b * CLAP_SR)]
        wins = [seg[i:i + WIN_S * CLAP_SR] for i in range(0, max(len(seg) - CLAP_SR, 1), WIN_S * CLAP_SR)][:3] or [seg]
        wins = [w for w in wins if len(w) >= CLAP_SR // 10] or [seg]
        with torch.no_grad():
            e = m.get_audio_features(**p(audio=wins, sampling_rate=CLAP_SR, return_tensors="pt", padding=True))
        e = torch.nn.functional.normalize(e, dim=-1).mean(0)
        e = torch.nn.functional.normalize(e, dim=0)
        out.append({"name": name, "start_s": round(a, 2), "end_s": round(b, 2), "windows": len(wins), "embedding": [round(float(x), 5) for x in e]})
    return out


def waveform_png(y, out: Path):
    """800x120 min/max waveform, grey on white; enough to see dynamics and silence at a glance."""
    import numpy as np
    from PIL import Image, ImageDraw
    W, H = 800, 120
    img = Image.new("L", (W, H), 255)
    d = ImageDraw.Draw(img)
    if len(y):
        cols = np.array_split(y, W)
        for x, c in enumerate(cols):
            if len(c):
                lo, hi = float(c.min()), float(c.max())
                d.line([(x, int(H / 2 - hi * H / 2)), (x, int(H / 2 - lo * H / 2))], fill=90)
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, optimize=True)


def analyse(job):
    pid, vdir, f = job["pack"], job["version_dir"], job["file"]
    sc = sidecar_path(vdir, f)
    analysis_root = (vdir / "analysis").resolve()
    if not analysis_root.is_relative_to(vdir.resolve()) or not sc.resolve().is_relative_to(analysis_root):
        return {"file": str(f), "status": "fail", "error": "analysis path escapes collection"}
    h = sha256(f)
    if sc.exists() and not job["refresh"]:
        try:
            if analysis_current(
                json.loads(sc.read_text()),
                h,
                vdir,
                job["music"],
                job["preview_prefix"],
                job["hints"],
            ):
                return {"file": str(f), "status": "skip"}
        except json.JSONDecodeError:
            pass
    t0 = time.time()
    try:
        import librosa
        import measure
        music = job["music"]
        rel = f.relative_to(vdir / "extracted")
        names = name_tags.names_for(pid, rel)
        meas = measure.measure(f, loop_search=music, music=music)
        dur = meas["audio"]["duration_s"]
        y, _ = librosa.load(str(f), sr=CLAP_SR, mono=True)
        spans = excerpts(meas["sidecar"].get("loudness_short_term_1hz", []), dur, music)
        prefix = job["preview_prefix"]
        key = f"{prefix}/{h[:2]}/{h[:16]}-waveform.png"
        waveform_png(y, safe_preview(ROOT, key, create=True))
        preview = {"waveform": key}
        tile = None
        if music:
            start, length = P.preview_bounds(meas["sidecar"], dur)
            clip_key = P.derivative_key(prefix, h, "clip", "ogg", start_s=start, duration_s=length)
            P.make_clip(f, ROOT / clip_key, start, length)
            preview["clip"] = clip_key
            tile = sc.with_name(sc.name.removesuffix(".analysis.json") + ".preview.png")
            P.render_tile(y, f.stem, tile)
        elif previews.have_ffmpeg():
            clip_key = previews.clip_key(prefix, h)
            try:
                previews.clip(f, safe_preview(ROOT, clip_key, create=True))
                preview["clip"] = clip_key
            except (OSError, RuntimeError, ValueError) as exc:
                print(json.dumps({"file": str(f), "preview": "fail", "error": str(exc)[:300]}), file=sys.stderr, flush=True)
        res = {"file": f.relative_to(vdir / "extracted").as_posix(), "pack": pid, "sha256": h, "bytes": f.stat().st_size, "music": music,
               "measure": meas, "vendor": vendor_tags(f), "names": names, "clap": {"model": CLAP_ID, "excerpts": embed(y, spans)},
               "preview": preview, "hints": job["hints"],
               **({"preview_tile": tile.relative_to(vdir).as_posix()} if tile else {}),
               "analysed_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "secs": round(time.time() - t0, 1)}
    except Exception as e:  # one bad file must not stop the batch; reported, retried on the next run
        return {"file": str(f), "status": "fail", "error": f"{type(e).__name__}: {e}"[:300]}
    sc.parent.mkdir(parents=True, exist_ok=True)
    tmp = sc.with_name(sc.name + ".part")
    tmp.write_text(json.dumps(res))
    tmp.rename(sc)
    return {"file": str(f), "status": "ok", "secs": res["secs"]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--packs", type=Path, default=ROOT / "packs")
    ap.add_argument("--only", action="append", help="pack id glob; repeat to select several packs")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    audio_rights.validate_inputs(a.packs, a.only)
    jobs = job_list(a.packs, a.only, a.limit, a.refresh)
    emit({"files": len(jobs), "workers": a.workers}, a.json, summary=True)
    counts = {}
    secs, timed = 0.0, 0
    with Pool(a.workers, maxtasksperchild=200) as pool:
        for i, r in enumerate(pool.imap_unordered(analyse, jobs, chunksize=1), 1):
            counts[r["status"]] = counts.get(r["status"], 0) + 1
            if r["status"] == "ok":
                secs, timed = secs + (r.get("secs") or 0.0), timed + 1
            if r["status"] != "skip":
                emit({"n": i, **r}, a.json)
    per_file = secs / timed if timed else None
    emit({"done": counts, "calibration": {"files": timed, "secs_per_file": round(per_file, 1) if per_file else None, "projected_hours": project_run_hours(per_file, len(jobs) - timed)}}, a.json, summary=True)
    if counts.get("fail"):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
