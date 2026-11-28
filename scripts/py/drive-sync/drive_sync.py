#!/usr/bin/env python3
"""Watch one Google Drive folder and pull settled drops into the asset inbox quarantine (C2 §7).

A small listener, no AI. It polls Drive's change feed, waits until a drop (a top-level file or
subfolder of the watch folder) has stopped changing, downloads it into a fresh quarantine folder
under assets-local/inbox/, checks checksums and archives without unpacking or running anything,
writes a manifest with strict usage-rights defaults (C2 §10), and queues it for the
gm-asset-intake skill. It never imports into packs and never deletes anything in Drive.

Run (see README.md):
  scripts/py/drive-sync/.venv/bin/python -I scripts/py/drive-sync/drive_sync.py run --once
  scripts/py/drive-sync/.venv/bin/python -I scripts/py/drive-sync/drive_sync.py status
"""
from __future__ import annotations

import argparse
import bz2
import gzip
import hashlib
import json
import logging
import logging.handlers
import lzma
import os
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import time
import tomllib
import zipfile
import zlib
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

REPO = Path(__file__).resolve().parents[3]
ASSETS_LOCAL = REPO / "assets-local"
FOLDER_MIME = "application/vnd.google-apps.folder"
NATIVE_PREFIX = "application/vnd.google-apps."  # Docs, Sheets, shortcuts...: no bytes to download
SCOPE = "https://www.googleapis.com/auth/drive.readonly"
FILE_FIELDS = "id,name,mimeType,parents,md5Checksum,size,modifiedTime,trashed"
ID_RE = re.compile(r"^[A-Za-z0-9_-]{10,200}$")
MB = 1024 * 1024
MAX_DOWNLOAD_ATTEMPTS = 3
C3_STANDARD = "docs/research/v0.5/C3-asset-metadata-standard.md"

log = logging.getLogger("drive-sync")

# ---------------------------------------------------------------- config

DEFAULTS = {
    "folder_id": None,                                   # the shared Drive folder to watch
    "credentials": "~/.config/ogm/drive-sa.json",        # service-account key; never inside the repo
    "poll_seconds": 45,                                  # 30-60 recommended
    "quiet_seconds": 180,                                # a drop is settled after this long unchanged
    "max_file_mb": 4096,
    "max_drop_mb": 16384,
    "max_unpacked_mb": 32768,                            # per archive, from its own listing
    "max_archive_members": 200000,
    "max_compression_ratio": 200,                        # zip-bomb guard, per member over 1 MB
    "inbox": str(ASSETS_LOCAL / "inbox"),
    "state": "~/.local/state/ogm/drive-sync/state.json",
    "log": "~/.local/state/ogm/drive-sync/drive-sync.log",
    "notify": ["log", "desktop"],                        # any of: log, desktop, command
    "notify_command": [],                                # argv; title and body are appended
    "intake_repo": "its-everdred/open-game-maker",       # GitHub repository for intake tickets
}
CONFIG_PATH = "~/.config/ogm/drive-sync.toml"


def _inside(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def load_config(path: str | None = None, need_folder: bool = True) -> dict:
    p = Path(path or os.environ.get("OGM_DRIVE_SYNC_CONFIG") or CONFIG_PATH).expanduser()
    cfg = dict(DEFAULTS)
    if p.exists():
        cfg.update(tomllib.loads(p.read_text()))
    elif need_folder:
        sys.exit(f"config not found: {p} (copy scripts/py/drive-sync/drive-sync.example.toml there)")
    unknown = set(cfg) - set(DEFAULTS)
    if unknown:
        sys.exit(f"unknown config keys in {p}: {sorted(unknown)}")
    if os.environ.get("OGM_DRIVE_SA_KEY"):
        cfg["credentials"] = os.environ["OGM_DRIVE_SA_KEY"]
    for k in ("credentials", "inbox", "state", "log"):
        cfg[k] = Path(cfg[k]).expanduser().resolve()
    return validate_config(cfg, need_folder)


def validate_config(cfg: dict, need_folder: bool = True) -> dict:
    if need_folder and not (isinstance(cfg["folder_id"], str) and ID_RE.match(cfg["folder_id"])):
        sys.exit("config: folder_id must be the Drive folder id (the part after /folders/ in its URL)")
    for k in ("credentials", "state", "log"):
        if _inside(cfg[k], REPO):
            sys.exit(f"config: {k} must live outside the repo ({cfg[k]})")
    if _inside(cfg["inbox"], REPO) and not _inside(cfg["inbox"], ASSETS_LOCAL):
        sys.exit(f"config: inbox inside the repo must be under assets-local/ (gitignored): {cfg['inbox']}")
    if not 10 <= cfg["poll_seconds"] <= 3600:
        sys.exit("config: poll_seconds must be between 10 and 3600 (30-60 recommended)")
    if cfg["quiet_seconds"] < 0:
        sys.exit("config: quiet_seconds must be >= 0")
    if not isinstance(cfg["intake_repo"], str) or not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", cfg["intake_repo"]):
        sys.exit("config: intake_repo must be owner/repository")
    bad = set(cfg["notify"]) - set(NOTIFIERS)
    if bad:
        sys.exit(f"config: unknown notify kinds {sorted(bad)}; use {sorted(NOTIFIERS)}")
    return cfg


# ---------------------------------------------------------------- notifications (pluggable)

def _notify_log(cfg, title, body):
    log.info("NOTIFY %s: %s", title, body)


def _notify_desktop(cfg, title, body):
    if shutil.which("notify-send"):
        subprocess.run(["notify-send", "--app-name=OGM Drive sync", title, body],
                       timeout=10, check=False, stdin=subprocess.DEVNULL)


def _notify_command(cfg, title, body):
    if cfg["notify_command"]:
        subprocess.run([*cfg["notify_command"], title, body], timeout=30, check=False,
                       stdin=subprocess.DEVNULL)


NOTIFIERS = {"log": _notify_log, "desktop": _notify_desktop, "command": _notify_command}


def make_notifier(cfg):
    def notify(title: str, body: str) -> None:
        for kind in cfg["notify"]:
            try:
                NOTIFIERS[kind](cfg, title, body)
            except Exception as e:  # a broken notifier must never stop the sync
                log.warning("notifier %s failed: %s", kind, e)
    return notify


# ---------------------------------------------------------------- Drive client (REST, read-only)

class DriveClient:
    """The five calls the syncer needs. Tests swap in a fake with the same methods."""

    BASE = "https://www.googleapis.com/drive/v3"

    def __init__(self, key_path: Path):
        from google.auth.transport.requests import AuthorizedSession
        from google.oauth2 import service_account
        if not key_path.exists():
            sys.exit(f"service-account key not found: {key_path}")
        if key_path.stat().st_mode & 0o077:
            log.warning("key %s is readable by others; run: chmod 600 %s", key_path, key_path)
        creds = service_account.Credentials.from_service_account_file(str(key_path), scopes=[SCOPE])
        self.email = creds.service_account_email
        self.session = AuthorizedSession(creds)

    @staticmethod
    def _id(fid: str) -> str:
        if not ID_RE.match(fid):
            raise ValueError(f"unexpected Drive id {fid!r}")
        return fid

    def _get(self, path: str, **params):
        params.setdefault("supportsAllDrives", "true")
        r = self.session.get(f"{self.BASE}/{path}", params=params, timeout=60)
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return r.json()

    def get_start_page_token(self) -> str:
        return self._get("changes/startPageToken")["startPageToken"]

    def list_changes(self, token: str):
        out = []
        while True:
            j = self._get("changes", pageToken=token, pageSize=1000, includeRemoved="true",
                          includeItemsFromAllDrives="true",
                          fields=f"nextPageToken,newStartPageToken,changes(fileId,removed,file({FILE_FIELDS}))")
            out += j.get("changes", [])
            if "newStartPageToken" in j:
                return out, j["newStartPageToken"]
            token = j["nextPageToken"]

    def get_file(self, fid: str):
        return self._get(f"files/{self._id(fid)}", fields=FILE_FIELDS)

    def list_children(self, folder_id: str):
        out, page = [], None
        while True:
            params = {"q": f"'{self._id(folder_id)}' in parents and trashed = false", "pageSize": 1000,
                      "includeItemsFromAllDrives": "true", "fields": f"nextPageToken,files({FILE_FIELDS})"}
            if page:
                params["pageToken"] = page
            j = self._get("files", **params)
            out += j.get("files", [])
            page = j.get("nextPageToken")
            if not page:
                return out

    def download(self, fid: str, out, max_bytes: int) -> None:
        url = f"{self.BASE}/files/{self._id(fid)}"
        with self.session.get(url, params={"alt": "media", "supportsAllDrives": "true"},
                              stream=True, timeout=120) as r:
            r.raise_for_status()
            n = 0
            for chunk in r.iter_content(MB):
                n += len(chunk)
                if n > max_bytes:
                    raise ValueError(f"download exceeded {max_bytes} bytes")
                out.write(chunk)


# ---------------------------------------------------------------- file inspection (never executes)

KINDS = {}
for _kind, _exts in {
    "model": "fbx glb gltf obj blend dae 3ds stl ply usd usdz vox",
    "image": "png jpg jpeg tga webp psd bmp gif tif tiff exr hdr ktx2 dds svg",
    "audio": "wav ogg mp3 flac opus m4a aif aiff",
    "video": "mp4 webm mov",
    "archive": "zip 7z rar tar gz tgz bz2 xz unitypackage",
    "document": "txt md pdf html htm rtf doc docx",
    "font": "ttf otf woff woff2 fnt",
    "map": "fcw fct",
    "engine": "meta mat prefab unity asset uasset umap controller anim",
    "executable": "exe msi dll so dylib sh bat cmd ps1 appimage jar apk deb rpm dmg app com scr vbs",
}.items():
    for _e in _exts.split():
        KINDS[_e] = _kind

LICENSE_RE = re.compile(r"licen[cs]e|copying|eula|terms|credits|attribution|read_?me", re.I)


def kind_of(name: str) -> str:
    return KINDS.get(name.rsplit(".", 1)[-1].lower() if "." in name else "", "other")


def is_license_name(name: str) -> bool:
    return bool(LICENSE_RE.search(PurePosixPath(name.replace("\\", "/")).name))


def unsafe_member(name: str) -> bool:
    n = name.replace("\\", "/")
    return ("\x00" in n or n.startswith("/") or bool(re.match(r"^[A-Za-z]:", n))
            or ".." in PurePosixPath(n).parts)


def sniff(path: Path) -> str | None:
    with open(path, "rb") as fh:
        head = fh.read(512)
    if head[:4] in (b"PK\x03\x04", b"PK\x05\x06"):
        return "zip"
    if head.startswith(b"7z\xbc\xaf\x27\x1c"):
        return "7z"
    if head.startswith(b"Rar!\x1a\x07"):
        return "rar"
    if head[257:262] == b"ustar":
        return "tar"
    if head.startswith(b"\x1f\x8b"):
        return "gz"
    if head.startswith(b"BZh"):
        return "bz2"
    if head.startswith(b"\xfd7zXZ\x00"):
        return "xz"
    if head.startswith((b"\x7fELF", b"MZ", b"#!")):
        return "executable"
    return None


class _Report:
    def __init__(self, fmt):
        self.d = {"format": fmt, "ok": False, "members": 0, "unpacked_bytes": 0, "problems": [],
                  "license_files": [], "nested_archives": [], "executables": []}

    def problem(self, msg):
        p = self.d["problems"]
        if len(p) < 20:
            p.append(msg)
        elif len(p) == 20:
            p.append("... more problems not listed")

    def member(self, name, size):
        self.d["members"] += 1
        self.d["unpacked_bytes"] += size
        k = kind_of(name)
        if is_license_name(name):
            self.d["license_files"].append(name)
        if k == "archive":
            self.d["nested_archives"].append(name)
        elif k == "executable":
            self.d["executables"].append(name)

    def finish(self, cfg):
        if self.d["members"] > cfg["max_archive_members"]:
            self.problem(f"too many members: {self.d['members']} > {cfg['max_archive_members']}")
        if self.d["unpacked_bytes"] > cfg["max_unpacked_mb"] * MB:
            self.problem(f"unpacked size {self.d['unpacked_bytes']} bytes > max_unpacked_mb")
        for k in ("license_files", "nested_archives", "executables"):
            self.d[k] = self.d[k][:200]
        self.d["ok"] = not self.d["problems"]
        return self.d


def check_zip(path: Path, cfg: dict) -> dict:
    rep = _Report("zip")
    try:
        with zipfile.ZipFile(path) as z:
            for i in z.infolist():
                if unsafe_member(i.filename):
                    rep.problem(f"unsafe path (zip-slip): {i.filename!r}")
                if stat.S_ISLNK(i.external_attr >> 16):
                    rep.problem(f"symlink: {i.filename!r}")
                if i.flag_bits & 0x1:
                    rep.problem(f"encrypted member: {i.filename!r}")
                if i.is_dir():
                    continue
                if (i.file_size > MB and i.compress_size
                        and i.file_size / i.compress_size > cfg["max_compression_ratio"]):
                    rep.problem(f"suspicious compression ratio (zip bomb?): {i.filename!r}")
                rep.member(i.filename, i.file_size)
            if not rep.d["problems"] and rep.d["unpacked_bytes"] <= cfg["max_unpacked_mb"] * MB:
                bad = z.testzip()  # reads every member and checks its CRC; writes nothing
                if bad:
                    rep.problem(f"CRC error in {bad!r}")
    except (zipfile.BadZipFile, zlib.error, EOFError, OSError, NotImplementedError, RuntimeError,
            ValueError) as e:
        rep.problem(f"not a readable zip: {e}")
    return rep.finish(cfg)


_DECOMPRESSORS = {"gz": gzip.open, "bz2": bz2.open, "xz": lzma.open}


def check_tar(path: Path, cfg: dict, compression: str | None) -> dict:
    rep = _Report("tar" if compression is None else f"tar.{compression}")
    try:
        if compression:  # read the whole stream once so the compressor's own checksum is verified
            limit, n = cfg["max_unpacked_mb"] * MB, 0
            with _DECOMPRESSORS[compression](path, "rb") as fh:
                while chunk := fh.read(MB):
                    n += len(chunk)
                    if n > limit:
                        rep.problem("decompressed stream larger than max_unpacked_mb")
                        return rep.finish(cfg)
        with tarfile.open(path, "r:*") as t:
            for m in t:
                if unsafe_member(m.name):
                    rep.problem(f"unsafe path (zip-slip): {m.name!r}")
                if m.issym() or m.islnk():
                    rep.problem(f"link: {m.name!r} -> {m.linkname!r}")
                elif m.ischr() or m.isblk() or m.isfifo():
                    rep.problem(f"device or fifo: {m.name!r}")
                elif m.isfile():
                    rep.member(m.name, m.size)
                if rep.d["members"] > cfg["max_archive_members"]:
                    break
    except (tarfile.TarError, EOFError, OSError, zlib.error, lzma.LZMAError, ValueError) as e:
        rep.problem(f"not a readable tar: {e}")
    return rep.finish(cfg)


def check_7z(path: Path, cfg: dict, fmt: str) -> dict:
    """7z and rar: list and test with the 7-Zip binary (a trusted tool reading data, nothing run)."""
    rep = _Report(fmt)
    exe = shutil.which("7z") or shutil.which("7zz") or shutil.which("7za")
    if not exe:
        rep.problem("cannot test: 7-Zip (7z) is not installed")
        return rep.finish(cfg)
    # A dummy password makes encrypted archives fail instead of prompting.
    base = [exe, "-pOGM-NOT-A-PASSWORD", "-bd", "--", str(path)]
    try:
        lst = subprocess.run([exe, "l", "-slt", *base[1:]], capture_output=True, text=True,
                             errors="replace", timeout=600, stdin=subprocess.DEVNULL)
        if lst.returncode != 0:
            rep.problem(f"cannot list archive: {lst.stdout[-300:].strip()} {lst.stderr[-300:].strip()}")
            return rep.finish(cfg)
        body = lst.stdout.split("\n----------\n", 1)[-1]
        for block in body.split("\n\n"):
            f = dict(line.split(" = ", 1) for line in block.splitlines() if " = " in line)
            if "Path" not in f:
                continue
            name, attrs = f["Path"], f.get("Attributes", "")
            if unsafe_member(name):
                rep.problem(f"unsafe path (zip-slip): {name!r}")
            if re.search(r"\bl[rwx-]{9}", attrs) or f.get("Symbolic Link"):
                rep.problem(f"symlink: {name!r}")
            if f.get("Encrypted") == "+":
                rep.problem(f"encrypted member: {name!r}")
            if f.get("Folder") == "+" or attrs.startswith("D"):
                continue
            rep.member(name, int(f.get("Size") or 0))
        if not rep.d["problems"]:
            t = subprocess.run([exe, "t", *base[1:]], capture_output=True, text=True,
                               errors="replace", timeout=1800, stdin=subprocess.DEVNULL)
            if t.returncode != 0:
                rep.problem(f"integrity test failed: {t.stdout[-300:].strip()} {t.stderr[-300:].strip()}")
    except subprocess.TimeoutExpired:
        rep.problem("7z timed out")
    return rep.finish(cfg)


def inspect_file(path: Path, name: str, cfg: dict) -> dict:
    """Facts about one downloaded file. Archives are listed and tested, never extracted."""
    magic = sniff(path)
    info = {"kind": kind_of(name),
            "executable": kind_of(name) == "executable" or magic == "executable"}
    archive = None
    if magic == "zip" or (magic is None and name.lower().endswith(".zip")):
        archive = check_zip(path, cfg)
    elif magic == "tar":
        archive = check_tar(path, cfg, None)
    elif magic in _DECOMPRESSORS:
        try:
            with tarfile.open(path, "r:*") as t:
                t.next()
            archive = check_tar(path, cfg, magic)
        except (tarfile.TarError, EOFError, OSError, zlib.error, lzma.LZMAError):
            archive = {"format": magic, "ok": None, "problems": [],
                       "note": "single compressed file, not an archive; not tested"}
    elif magic in ("7z", "rar") or (magic is None and name.lower().endswith((".7z", ".rar"))):
        archive = check_7z(path, cfg, magic or name.rsplit(".", 1)[-1].lower())
    if archive:
        info["kind"] = "archive"
        info["archive"] = archive
    return info


# ---------------------------------------------------------------- state

def new_state() -> dict:
    return {"version": 1, "root_id": None, "page_token": None,
            "folders": {}, "files": {}, "drops": {}, "processed": {}}


def load_state(path: Path) -> dict:
    if path.exists():
        return json.loads(path.read_text())
    return new_state()


def save_state(path: Path, st: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as fh:
        json.dump(st, fh, indent=1)
    os.replace(tmp, path)


def iso(t: float | None) -> str | None:
    return None if t is None else datetime.fromtimestamp(t, timezone.utc).isoformat(timespec="seconds")


def safe_component(name: str, fallback: str) -> str:
    n = name.replace("/", "_").replace("\\", "_").replace("\x00", "").strip()
    if n in ("", ".", ".."):
        n = fallback
    return n[:200]


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:48] or "drop"


class _HashWriter:
    def __init__(self, out):
        self.out, self.md5, self.n = out, hashlib.md5(), 0

    def write(self, b):
        self.md5.update(b)
        self.n += len(b)
        return self.out.write(b)


# ---------------------------------------------------------------- intake ticket outbox

def verify_intake_repo(cfg) -> None:
    """Fail closed unless the checkout and its Aiur tracker name the same repo."""
    result = subprocess.run(["gh", "repo", "view", "--json", "nameWithOwner"], cwd=REPO,
                            capture_output=True, text=True, timeout=120, check=True,
                            stdin=subprocess.DEVNULL)
    actual = json.loads(result.stdout)["nameWithOwner"]
    # Accept only the explicit, unambiguous mapping in the local Aiur config.
    # Unsupported YAML forms fail closed rather than guessing a daemon target.
    config_path = REPO / ".aiur/config"
    if not config_path.exists():
        config_path = Path.home() / ".aiur/config"
    config = config_path.read_text()
    trackers = list(re.finditer(r"(?m)^tracker\s*:[^\n]*$", config))
    if len(trackers) != 1 or not re.fullmatch(r"tracker:\s*(?:#.*)?", trackers[0].group()):
        raise ValueError("cannot determine Aiur tracker repository")
    remainder = config[trackers[0].end():]
    end = re.search(r"(?m)^[^\s#]", remainder)
    tracker = remainder[:end.start()] if end else remainder
    # Merges, anchors and differently indented identity keys can change the
    # effective tracker without appearing in the narrow mapping below.
    for line in tracker.splitlines():
        data = line.split("#", 1)[0]
        if (re.search(r"(?:^|\s)(?:<<\s*:|[&*][A-Za-z0-9_-]+)", data)
                or re.match(r"^\s*[\"'?{\[!]", data)):
            raise ValueError("cannot determine Aiur tracker repository")
        if re.match(r"^\s+github\s*:", data) and not data.startswith("  github:"):
            raise ValueError("cannot determine Aiur tracker repository")
    kinds = re.findall(r"(?m)^  kind:\s*([^\s#]+)", tracker)
    if len(kinds) > 1 or (kinds and kinds[0].strip("\"'") != "github"):
        raise ValueError("Aiur tracker is not GitHub")
    githubs = list(re.finditer(r"(?m)^  github\s*:[^\n]*$", tracker))
    if len(githubs) > 1:
        raise ValueError("cannot determine Aiur tracker repository")
    tracker_repo = actual  # Aiur defaults an omitted repository to the checkout origin.
    if githubs:
        if not re.fullmatch(r"  github:\s*(?:#.*)?", githubs[0].group()):
            raise ValueError("cannot determine Aiur tracker repository")
        remainder = tracker[githubs[0].end():]
        end = re.search(r"(?m)^  [^\s#]", remainder)
        github = remainder[:end.start()] if end else remainder
        for line in github.splitlines():
            data = line.split("#", 1)[0]
            if re.match(r"^\s+repo\s*:", data) and not data.startswith("    repo:"):
                raise ValueError("cannot determine Aiur tracker repository")
        repo_lines = re.findall(r"(?m)^    repo\s*:[^\n]*$", github)
        if len(repo_lines) > 1:
            raise ValueError("cannot determine Aiur tracker repository")
        if repo_lines:
            value = repo_lines[0].split(":", 1)[1].strip().split(" #", 1)[0].strip()
            if len(value) >= 2 and value[0] in "\"'" and value[-1] == value[0]:
                value = value[1:-1]
            if value and not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", value):
                raise ValueError("cannot determine Aiur tracker repository")
            tracker_repo = value or actual
    if tracker_repo.casefold() != cfg["intake_repo"].casefold() or actual.casefold() != cfg["intake_repo"].casefold():
        raise ValueError("intake_repo does not match the checkout and Aiur tracker")


def file_intake_ticket(cfg, qdir: Path) -> None:
    """Persist each step so failed dispatches can resume without recreating an issue."""
    record_path = qdir / "ticket.json"
    record = json.loads(record_path.read_text())
    if record.get("dispatched"):
        return
    verify_intake_repo(cfg)
    marker = "ogm-drive-intake-" + hashlib.sha256(record["manifest"].encode()).hexdigest()
    if not record.get("number"):
        # A failed or interrupted create may have succeeded. Recover the issue by
        # its unique marker; an absent search result is not proof of failure.
        if record.get("creating"):
            found = subprocess.run(["gh", "issue", "list", "--repo", cfg["intake_repo"],
                                    "--state", "all", "--search", marker, "--limit", "100",
                                    "--json", "number,body"], cwd=REPO, capture_output=True,
                                   text=True, timeout=120, check=True, stdin=subprocess.DEVNULL)
            matches = [issue for issue in json.loads(found.stdout)
                       if f"<!-- {marker} -->" in (issue.get("body") or "")]
            if len(matches) != 1:
                log.error("intake ticket creation needs reconciliation for %s (%s)",
                          record["manifest"], marker)
                return
            record["number"] = matches[0]["number"]
            record["creating"] = False
            save_state(record_path, record)
        else:
            create_intake_ticket(cfg, record_path, record, marker)
    # A previous dispatch may have succeeded before the process was interrupted.
    # Do not requeue a ticket that has already reached todo or a later state.
    issue = subprocess.run(["gh", "issue", "view", str(record["number"]), "--repo", cfg["intake_repo"],
                            "--json", "labels,state"], cwd=REPO, capture_output=True,
                           text=True, timeout=120, check=True, stdin=subprocess.DEVNULL)
    details = json.loads(issue.stdout)
    labels = {label["name"] for label in details["labels"]}
    if details["state"] != "OPEN" or any(label.startswith("agent:") and label != "agent:queued" for label in labels):
        record["dispatched"] = True
        save_state(record_path, record)
        return
    aiur = Path.home() / ".local/bin/aiur"
    subprocess.run([str(aiur), "--todo", str(record["number"])], cwd=REPO,
                   capture_output=True, text=True, timeout=120, check=True, stdin=subprocess.DEVNULL)
    record["dispatched"] = True
    save_state(record_path, record)


def create_intake_ticket(cfg, record_path, record, marker):
    record["creating"] = True
    save_state(record_path, record)
    body = ("Run gm-asset-intake on the queued Drive drop below, including its license and integrity gates. "
            "Record the outcome and complete the applicable catalog and preprocessing steps.\n\n"
            f"Manifest: `assets-local/inbox/{record['manifest']}`\n\n<!-- {marker} -->\n")
    try:
        result = subprocess.run(["gh", "issue", "create", "--repo", cfg["intake_repo"],
                                 "--title", "Intake new Drive asset drop", "--body", body,
                                 "--label", "build-lane:assets", "--label", "agent:queued"],
                                cwd=REPO, capture_output=True,
                                text=True, timeout=120, check=True, stdin=subprocess.DEVNULL)
    except FileNotFoundError:
        # The executable did not start, so no request could have been sent.
        record["creating"] = False
        save_state(record_path, record)
        raise
    except subprocess.CalledProcessError as exc:
        # These gh preflight failures happen before its create mutation.
        error = (exc.stderr or "").lower()
        if (any(reason in error for reason in ("not logged into any github hosts", "could not resolve to a label"))
                or ("401" in error and "bad credentials" in error)):
            record["creating"] = False
            save_state(record_path, record)
        raise
    match = re.search(r"/issues/(\d+)\s*$", result.stdout)
    if not match:
        raise ValueError("issue creation returned no issue number")
    record["number"] = int(match.group(1))
    record["creating"] = False
    save_state(record_path, record)

# ---------------------------------------------------------------- the syncer

class Syncer:
    """State machine for drops.

    file status: pending (needs download) | downloaded | skipped (Google-native)
    drop status: pending -> ready -> downloaded | skipped | rejected | failed | removed
    A drop is the top-level item under the watch folder (a file, or a subfolder and everything in it).
    """

    def __init__(self, client, cfg, st, notify, now=time.time, dry_run=False, save=lambda: None,
                 ticket_filer=None):
        self.c, self.cfg, self.st, self.notify, self.now = client, cfg, st, notify, now
        self.dry, self.save, self.ticket_filer = dry_run, save, ticket_filer
        self.root = cfg["folder_id"]
        if st.get("root_id") not in (None, self.root):
            sys.exit(f"state file belongs to folder {st['root_id']}, config says {self.root}; "
                     "move the state file aside to start over")
        st["root_id"] = self.root
        self._outside: set[str] = set()

    # -- tree bookkeeping

    @property
    def folders(self):
        return self.st["folders"]

    @property
    def files(self):
        return self.st["files"]

    @property
    def drops(self):
        return self.st["drops"]

    def drop_of(self, fid: str) -> str | None:
        cur = fid
        for _ in range(100):
            parent = (self.folders.get(cur) or self.files.get(cur) or {}).get("parent")
            if parent is None:
                return None
            if parent == self.root:
                return cur
            cur = parent
        return None

    def files_of(self, did: str) -> list[str]:
        return [f for f in self.files if self.drop_of(f) == did]

    def rel_parts(self, fid: str) -> list[str]:
        parts, cur = [self.files[fid]["name"]], self.files[fid]["parent"]
        while cur != self.root:
            parts.append(self.folders[cur]["name"])
            cur = self.folders[cur]["parent"]
        return parts[::-1]

    def resolve(self, folder_id: str, depth: int = 0) -> bool:
        """Is this folder the watch folder or inside it? Walks up unknown parents once."""
        if folder_id == self.root or folder_id in self.folders:
            return True
        if folder_id in self._outside or depth > 50:
            return False
        meta = self.c.get_file(folder_id)
        if meta and meta.get("mimeType") == FOLDER_MIME and not meta.get("trashed") and \
                any(self.resolve(p, depth + 1) for p in meta.get("parents") or []):
            self.observe(meta)
            return folder_id in self.folders
        self._outside.add(folder_id)
        return False

    def inside_parent(self, f: dict) -> str | None:
        return next((p for p in f.get("parents") or [] if self.resolve(p)), None)

    def _touch(self, did: str | None) -> None:
        if did is None:
            return
        if did in self.folders:
            name, kind = self.folders[did]["name"], "folder"
        elif did in self.files:
            name, kind = self.files[did]["name"], "file"
        else:
            return
        d = self.drops.setdefault(did, {"first_seen": self.now(), "status": "new", "downloads": 0})
        if d["status"] != "pending":
            log.info("drop %r: change seen (was %s); waiting %ss for it to settle",
                     name, d["status"], self.cfg["quiet_seconds"])
        d.update(status="pending", last_changed=self.now(), name=name, kind=kind, attempts=0)
        d.pop("note", None)

    def observe(self, f: dict) -> bool:
        """Record one Drive item's metadata. Returns True if anything changed."""
        fid = f["id"]
        if fid == self.root:
            return False
        if f.get("trashed"):
            return self.forget(fid)
        parent = self.inside_parent(f)
        if parent is None:
            return self.forget(fid)
        now = self.now()
        if f.get("mimeType") == FOLDER_MIME:
            new, old = {"name": f["name"], "parent": parent}, self.folders.get(fid)
            if old == new:
                return False
            old_drop = self.drop_of(fid) if old else None
            self.folders[fid] = new
            for did in {old_drop, self.drop_of(fid)}:
                self._touch(did)
            if old is None:
                self.scan(fid)
            return True
        size = f.get("size")
        sig = {"name": f["name"], "parent": parent, "mime": f.get("mimeType", ""),
               "md5": f.get("md5Checksum"), "size": int(size) if size is not None else None,
               "modified": f.get("modifiedTime")}
        rec = self.files.get(fid)
        if rec and all(rec.get(k) == v for k, v in sig.items()):
            return False
        old_drop = self.drop_of(fid) if rec else None
        rec = rec or {"first_seen": now}
        rec.update(sig, last_changed=now)
        if sig["mime"].startswith(NATIVE_PREFIX):
            if rec.get("status") != "skipped":
                log.info("skipping Google-native file %r (%s): no file bytes to download",
                         sig["name"], sig["mime"])
            rec["status"] = "skipped"
        elif sig["md5"] and self.st["processed"].get(fid) == sig["md5"]:
            rec["status"] = "downloaded"  # same bytes as before: never fetched again
        else:
            rec["status"] = "pending"
        self.files[fid] = rec
        for did in {old_drop, self.drop_of(fid)}:
            self._touch(did)
        return True

    def forget(self, fid: str) -> bool:
        """An item was removed, trashed or moved out of the watch folder. Local files are kept."""
        if fid not in self.folders and fid not in self.files:
            return False
        did = self.drop_of(fid)
        if fid in self.folders:
            for child in [k for k, v in self.folders.items() if v["parent"] == fid]:
                self.forget(child)
            for child in [k for k, v in self.files.items() if v["parent"] == fid]:
                self.forget(child)
            del self.folders[fid]
        else:
            del self.files[fid]
        if did in self.folders or did in self.files:
            self._touch(did)
        elif did in self.drops and self.drops[did]["status"] in ("pending", "ready", "rejected"):
            log.info("drop %r removed from Drive before download", self.drops[did].get("name"))
            self.drops[did]["status"] = "removed"
        return True

    def scan(self, folder_id: str) -> None:
        for item in self.c.list_children(folder_id):
            self.observe(item)

    def apply_change(self, ch: dict) -> None:
        fid, f = ch.get("fileId"), ch.get("file")
        if not fid or fid == self.root:
            if f and f.get("trashed"):
                log.error("the watch folder itself is in the trash")
            return
        if ch.get("removed") or not f:
            self.forget(fid)
        else:
            self.observe(f)

    # -- one poll

    def poll(self) -> None:
        self._outside.clear()
        if not self.st.get("page_token"):
            token = self.c.get_start_page_token()  # taken first, so nothing during the scan is lost
            log.info("first run: scanning the watch folder")
            self.scan(self.root)
            self.st["page_token"] = token
        else:
            changes, token = self.c.list_changes(self.st["page_token"])
            for ch in changes:
                self.apply_change(ch)
            self.st["page_token"] = token
        self.save()
        self.settle()
        for did in [d for d, v in self.drops.items() if v["status"] == "ready"]:
            self.process(did)
        self.save()
        if not self.dry and self.ticket_filer:
            self.file_pending_tickets()

    def file_pending_tickets(self) -> None:
        queue = self.cfg["inbox"] / "queue.jsonl"
        if not queue.exists():
            return
        for line in queue.read_text().splitlines():
            entry = json.loads(line)
            qdir = self.cfg["inbox"] / Path(entry["manifest"]).parent
            if not (qdir / "ticket.json").exists():
                continue  # entries predating ticket filing
            try:
                self.ticket_filer(self.cfg, qdir)
            except (OSError, ValueError, subprocess.SubprocessError):
                log.exception("could not file intake ticket for %s", entry["manifest"])

    def verify(self, did: str) -> bool:
        """Second look straight from Drive. True if anything differs from what we recorded."""
        meta = self.c.get_file(did)
        if not meta:
            return self.forget(did) or True
        changed = self.observe(meta)
        if did not in self.folders:
            return changed or did not in self.files
        seen, stack = set(), [did]
        while stack:
            for item in self.c.list_children(stack.pop()):
                seen.add(item["id"])
                changed |= self.observe(item)
                if item.get("mimeType") == FOLDER_MIME:
                    stack.append(item["id"])
        stale = [k for k in list(self.files) + list(self.folders)
                 if k != did and k not in seen and self.drop_of(k) == did]
        for k in stale:
            changed |= self.forget(k)
        return changed

    def settle(self) -> None:
        for did, d in list(self.drops.items()):
            if d["status"] != "pending" or self.now() - d["last_changed"] < self.cfg["quiet_seconds"]:
                continue
            if self.verify(did) or d["status"] != "pending":
                continue  # changed on the second look: the quiet period starts again
            recs = [self.files[f] for f in self.files_of(did)]
            todo = [r for r in recs if r["status"] == "pending"]
            waiting = [r["name"] for r in todo if not r["md5"] or r["size"] is None]
            if waiting:
                d["note"] = f"waiting for Drive checksum: {', '.join(waiting[:3])}"
                continue
            big = [r["name"] for r in todo if r["size"] > self.cfg["max_file_mb"] * MB]
            total = sum(r["size"] for r in todo)
            if big or total > self.cfg["max_drop_mb"] * MB:
                d["status"] = "rejected"
                d["note"] = (f"over max_file_mb: {', '.join(big[:3])}" if big
                             else f"drop is {total // MB} MB > max_drop_mb")
                self.notify("Drive drop too large", f"{d['name']}: {d['note']}. Not downloaded.")
                continue
            d["status"], d["settled_at"] = "ready", self.now()

    # -- download one settled drop

    def process(self, did: str) -> None:
        d = self.drops[did]
        fids = self.files_of(did)
        todo = [f for f in fids if self.files[f]["status"] == "pending"]
        if not todo:
            had = any(self.files[f]["status"] == "downloaded" for f in fids)
            d["status"] = "downloaded" if had else "skipped"
            log.info("drop %r: nothing new to download (%s)", d["name"],
                     "content unchanged" if had else "only Google-native files")
            return
        stamp = datetime.fromtimestamp(self.now(), timezone.utc).strftime("%Y%m%d-%H%M%S")
        qname = f"{stamp}-{slug(d['name'])}-{did[:8]}"
        qroot = self.cfg["inbox"] / "quarantine"
        nbytes = sum(self.files[f]["size"] for f in todo)
        if self.dry:
            log.info("[dry-run] drop %r: would download %d file(s), %d bytes, into %s",
                     d["name"], len(todo), nbytes, qroot / qname)
            return
        qroot.mkdir(parents=True, exist_ok=True)
        n = 1
        while (qroot / qname).exists():
            n += 1
            qname = f"{stamp}-{slug(d['name'])}-{did[:8]}-{n}"
        qdir = qroot / qname
        try:
            qdir.mkdir()  # fresh and empty, every time
            manifest = self._download_drop(did, d, fids, qdir, qname)
        except Exception as e:
            shutil.rmtree(qdir, ignore_errors=True)
            d["attempts"] = d.get("attempts", 0) + 1
            log.exception("drop %r: download attempt %d failed", d["name"], d["attempts"])
            if d["attempts"] >= MAX_DOWNLOAD_ATTEMPTS:
                d["status"], d["note"] = "failed", str(e)[:300]
                self.notify("Drive drop failed", f"{d['name']}: {d['note']}")
            self.save()
            return
        for f in todo:
            self.st["processed"][f] = self.files[f]["md5"]
            self.files[f]["status"], self.files[f]["quarantine"] = "downloaded", qname
        d["downloads"] = d.get("downloads", 0) + 1
        d.update(status="downloaded", quarantine=qname, downloaded_at=self.now())
        entry = {"queued_at": iso(self.now()), "drop_id": did, "name": d["name"],
                 "revision": manifest["revision"], "manifest": f"quarantine/{qname}/manifest.json",
                 "files": len(manifest["files"]), "bytes": manifest["totals"]["bytes"],
                 "integrity_ok": manifest["integrity_ok"], "problems": manifest["problems"]}
        save_state(qdir / "ticket.json", {"manifest": entry["manifest"]})
        with open(self.cfg["inbox"] / "queue.jsonl", "a") as q:
            q.write(json.dumps(entry) + "\n")
        self.save()
        flag = "" if manifest["integrity_ok"] else " NEEDS ATTENTION: " + "; ".join(manifest["problems"][:2])
        self.notify("New asset drop", f"{d['name']}: {len(todo)} file(s), {nbytes // MB} MB in "
                    f"quarantine; license unknown until reviewed.{flag}")

    def _download_drop(self, did, d, fids, qdir, qname) -> dict:
        used: set[str] = set()
        entries, skipped, problems, warnings, licenses = [], [], [], [], []
        for fid in sorted(fids, key=lambda f: self.rel_parts(f)):
            rec = self.files[fid]
            base = {"drive_id": fid, "name": rec["name"], "mime": rec["mime"], "size": rec["size"],
                    "md5": rec["md5"], "modified": rec["modified"]}
            if rec["status"] == "skipped":
                skipped.append({**base, "reason": "Google-native file (Docs/Sheets/shortcut): not downloaded"})
                continue
            parts = [safe_component(p, fid[:8]) for p in self.rel_parts(fid)]
            rel = PurePosixPath(*parts)
            if str(rel) in used:
                rel = rel.with_name(f"{rel.stem}~{fid[:8]}{rel.suffix}")
            used.add(str(rel))
            entry = {**base, "path": str(rel), "kind": kind_of(rec["name"])}
            if rec["status"] == "pending":
                dest = qdir / "files" / rel
                self._download_verified(fid, rec, dest)
                entry.update(downloaded=True, **inspect_file(dest, rec["name"], self.cfg))
                a = entry.get("archive")
                if a:
                    problems += [f"{rel}: {p}" for p in a["problems"]]
                    licenses += [f"{rel}!/{m}" for m in a.get("license_files", [])]
                    if a.get("executables"):
                        warnings.append(f"{rel}: contains executables (never run): {a['executables'][:5]}")
                    if a.get("nested_archives"):
                        warnings.append(f"{rel}: nested archives need a second pass: {a['nested_archives'][:5]}")
                if entry["executable"]:
                    warnings.append(f"{rel}: executable file (never run)")
            else:
                entry.update(downloaded=False, previous_quarantine=rec.get("quarantine"))
            if is_license_name(rec["name"]):
                licenses.append(str(rel))
            entries.append(entry)
        by_kind: dict[str, int] = {}
        for e in entries:
            by_kind[e["kind"]] = by_kind.get(e["kind"], 0) + 1
        manifest = {
            "schema": "ogm-drive-drop/1",
            "drop_id": did, "name": d["name"], "kind": d["kind"], "revision": d.get("downloads", 0),
            "source": {"type": "google-drive", "watch_folder_id": self.root, "drive_id": did},
            "first_seen": iso(d["first_seen"]), "last_changed": iso(d["last_changed"]),
            "settled_at": iso(d.get("settled_at")), "downloaded_at": iso(self.now()),
            "quarantine": f"quarantine/{qname}", "files_root": f"quarantine/{qname}/files",
            "files": entries, "skipped": skipped,
            "totals": {"files": len(entries), "bytes": sum(e["size"] or 0 for e in entries),
                       "by_kind": by_kind},
            "license_files": licenses,
            "integrity_ok": not problems, "problems": problems, "warnings": warnings,
            # C2 §10 strict defaults. Only the intake skill proposes, and only Kevin confirms, wider rights.
            "license": {"id": "NOASSERTION", "status": "unknown"},
            "usage_rights": {"uses": ["vision-input"], "audience": "private", "redistribution": "none",
                             "attribution": None, "basis": "unknown", "confirmed_by": None},
            # Hook for the asset-metadata standard (C3): the intake skill fills this in once C3 exists.
            "tagging": {"status": "pending", "standard": C3_STANDARD},
        }
        out = qdir / "manifest.json"
        out.write_text(json.dumps(manifest, indent=1) + "\n")
        return manifest

    def _download_verified(self, fid, rec, dest: Path) -> None:
        dest.parent.mkdir(parents=True, exist_ok=True)
        part = dest.with_name(dest.name + ".part")
        with open(part, "xb") as fh:
            w = _HashWriter(fh)
            self.c.download(fid, w, self.cfg["max_file_mb"] * MB)
        if w.n != rec["size"] or w.md5.hexdigest() != rec["md5"]:
            part.unlink()
            raise ValueError(f"{rec['name']}: checksum/size mismatch after download "
                             f"(got {w.n} bytes md5 {w.md5.hexdigest()}, Drive says {rec['size']} {rec['md5']})")
        os.chmod(part, 0o444)  # read-only, never executable
        os.replace(part, dest)


# ---------------------------------------------------------------- CLI

def setup_logging(cfg: dict | None) -> None:
    handlers: list[logging.Handler] = [logging.StreamHandler()]
    if cfg:
        cfg["log"].parent.mkdir(parents=True, exist_ok=True)
        handlers.append(logging.handlers.RotatingFileHandler(cfg["log"], maxBytes=5 * MB, backupCount=3))
    logging.basicConfig(level=logging.INFO, handlers=handlers,
                        format="%(asctime)s %(levelname)s %(message)s")


def cmd_run(args) -> None:
    cfg = load_config(args.config)
    if args.quiet_seconds is not None:
        cfg["quiet_seconds"] = args.quiet_seconds
    setup_logging(cfg)
    client = DriveClient(cfg["credentials"])
    try:
        root = client.get_file(cfg["folder_id"])
    except Exception as e:
        sys.exit(f"cannot reach Drive as {client.email}: {e}")
    if not root or root.get("mimeType") != FOLDER_MIME:
        sys.exit(f"watch folder {cfg['folder_id']} not visible. Share it (Viewer) with {client.email}")
    log.info("watching %r as %s (poll %ss, quiet %ss)%s", root["name"], client.email,
             cfg["poll_seconds"], cfg["quiet_seconds"], " [dry-run]" if args.dry_run else "")
    st = load_state(cfg["state"])
    save = (lambda: None) if args.dry_run else (lambda: save_state(cfg["state"], st))
    syncer = Syncer(client, cfg, st, make_notifier(cfg) if not args.dry_run else
                    (lambda t, b: log.info("[dry-run] would notify %s: %s", t, b)),
                    dry_run=args.dry_run, save=save, ticket_filer=file_intake_ticket)
    while True:
        try:
            syncer.poll()
        except Exception:
            log.exception("poll failed; retrying next interval")
            if args.once:
                sys.exit(1)
        if args.once:
            break
        time.sleep(cfg["poll_seconds"])
    print_status(cfg, st)


def print_status(cfg: dict, st: dict) -> None:
    now = time.time()
    drops = sorted(st["drops"].values(), key=lambda d: d.get("last_changed", 0))
    print(f"{len(drops)} drop(s); page token {'set' if st.get('page_token') else 'not set (first run pending)'}")
    for d in drops:
        age = int(now - d.get("last_changed", now))
        extra = d.get("note") or d.get("quarantine") or ""
        if d["status"] == "pending":
            left = max(0, int(cfg["quiet_seconds"] - age))
            extra = f"settles in ~{left}s" + (f"; {d['note']}" if d.get("note") else "")
        print(f"  {d['status']:<10} {d['name'][:40]:<40} changed {age}s ago  {extra}")
    q = cfg["inbox"] / "queue.jsonl"
    if q.exists():
        waiting = []
        for line in q.read_text().splitlines():
            e = json.loads(line)
            if not (cfg["inbox"] / Path(e["manifest"]).parent / "intake.json").exists():
                waiting.append(e)
        print(f"{len(waiting)} queue entr{'y' if len(waiting) == 1 else 'ies'} awaiting intake")
        for e in waiting:
            ok = "ok" if e["integrity_ok"] else "PROBLEMS"
            print(f"  {e['queued_at']}  {e['name'][:40]:<40} {e['files']} file(s) {ok}  {e['manifest']}")


def cmd_status(args) -> None:
    cfg = load_config(args.config, need_folder=False)
    print_status(cfg, load_state(cfg["state"]))


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--config", help=f"config file (default ${{OGM_DRIVE_SYNC_CONFIG}} or {CONFIG_PATH})")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run", help="poll Drive (forever, or once)")
    r.add_argument("--once", action="store_true", help="one poll, then print status and exit")
    r.add_argument("--dry-run", action="store_true", help="read Drive only; write no state, files or queue")
    r.add_argument("--quiet-seconds", type=int, help="override quiet_seconds (e.g. 0 with --once to test)")
    r.set_defaults(fn=cmd_run)
    s = sub.add_parser("status", help="list pending / ready / downloaded drops and the intake queue")
    s.set_defaults(fn=cmd_status)
    args = ap.parse_args(argv)
    args.fn(args)


if __name__ == "__main__":
    main()
