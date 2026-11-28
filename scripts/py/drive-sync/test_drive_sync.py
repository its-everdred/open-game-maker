"""Unit tests for drive_sync.py with a fake Drive. No network, no Google libraries needed.

Run: python3 -I scripts/py/drive-sync/test_drive_sync.py
"""
import copy
import hashlib
import importlib.util
import io
import json
import logging
import os
import shutil
import stat
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("drive_sync", HERE / "drive_sync.py")
ds = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ds)
logging.disable(logging.CRITICAL)  # expected failures log tracebacks; keep test output readable

ROOT = "ROOTFOLDER0001"
OUTSIDE = "OUTSIDEFOLDER01"


class FakeDrive:
    """Just enough of Drive: items with parents, a change feed, and downloads that count calls."""

    def __init__(self):
        self.items = {ROOT: {"id": ROOT, "name": "OGM drops", "mimeType": ds.FOLDER_MIME, "parents": ["kevin-root"]},
                      OUTSIDE: {"id": OUTSIDE, "name": "Kevin private", "mimeType": ds.FOLDER_MIME,
                                "parents": ["kevin-root"]}}
        self.hidden = {OUTSIDE}  # shared with the service account? no: get_file returns None
        self.content = {}
        self.changes = []
        self.downloads = []
        self.corrupt = set()

    def _emit(self, fid, removed=False):
        self.changes.append({"fileId": fid, "removed": removed,
                             "file": None if removed else copy.deepcopy(self.items[fid])})

    def add_folder(self, fid, name, parent):
        self.items[fid] = {"id": fid, "name": name, "mimeType": ds.FOLDER_MIME, "parents": [parent]}
        self._emit(fid)

    def add_file(self, fid, name, parent, data=b"x", mime="application/octet-stream", md5=True, emit=True):
        self.items[fid] = {"id": fid, "name": name, "mimeType": mime, "parents": [parent],
                           "modifiedTime": "2026-10-26T10:00:00Z"}
        self.set_content(fid, data, md5=md5, emit=emit)

    def set_content(self, fid, data, md5=True, emit=True):
        it = self.items[fid]
        self.content[fid] = data
        if not it["mimeType"].startswith(ds.NATIVE_PREFIX):
            it["size"] = str(len(data))
            if md5:
                it["md5Checksum"] = hashlib.md5(data).hexdigest()
            else:
                it.pop("md5Checksum", None)
        it["modifiedTime"] = f"2026-10-26T10:{len(self.changes):02d}:00Z"
        if emit:
            self._emit(fid)

    def rename(self, fid, name):
        self.items[fid]["name"] = name
        self._emit(fid)

    def move(self, fid, parent):
        self.items[fid]["parents"] = [parent]
        self._emit(fid)

    def trash(self, fid):
        self.items[fid]["trashed"] = True
        self._emit(fid)

    # -- client API used by Syncer
    def get_start_page_token(self):
        return str(len(self.changes))

    def list_changes(self, token):
        return copy.deepcopy(self.changes[int(token):]), str(len(self.changes))

    def get_file(self, fid):
        if fid in self.hidden or fid not in self.items:
            return None
        return copy.deepcopy(self.items[fid])

    def list_children(self, fid):
        return [copy.deepcopy(i) for i in self.items.values()
                if fid in i.get("parents", []) and not i.get("trashed")]

    def download(self, fid, out, max_bytes):
        self.downloads.append(fid)
        data = self.content[fid]
        if fid in self.corrupt:
            data = data[:-1] + b"?"
        out.write(data)


class Clock:
    def __init__(self):
        self.t = 1_800_000_000.0

    def __call__(self):
        return self.t


def zip_bytes(entries):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, data in entries:
            z.writestr(name, data)
    return buf.getvalue()


class Base(unittest.TestCase):
    def test_repo_root_tracks_the_worker_layout(self):
        """The worker must resolve repository paths correctly from scripts/py/drive-sync."""
        self.assertTrue((ds.REPO / "scripts/py/drive-sync").is_dir())

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp)
        self.cfg = dict(ds.DEFAULTS, folder_id=ROOT, quiet_seconds=180, inbox=self.tmp / "inbox",
                        state=self.tmp / "state.json", log=self.tmp / "log", notify=[])
        self.drive = FakeDrive()
        self.clock = Clock()
        self.st = ds.new_state()
        self.notes = []
        self.syncer = self.make_syncer()

    def make_syncer(self, dry_run=False):
        return ds.Syncer(self.drive, self.cfg, self.st, lambda t, b: self.notes.append((t, b)),
                         now=self.clock, dry_run=dry_run)

    def poll(self, advance=0):
        self.clock.t += advance
        self.syncer.poll()

    def drop(self, did):
        return self.st["drops"].get(did, {})

    def queue(self):
        q = self.cfg["inbox"] / "queue.jsonl"
        return [json.loads(l) for l in q.read_text().splitlines()] if q.exists() else []

    def manifest(self, did):
        return json.loads((self.cfg["inbox"] / "quarantine" / self.drop(did)["quarantine"]
                           / "manifest.json").read_text())


class IntakeTickets(Base):
    def setUp(self):
        super().setUp()
        self.repo_check = patch.object(ds, "verify_intake_repo", create=True)
        self.repo_check.start()
        self.addCleanup(self.repo_check.stop)

    def test_repo_mismatch_fails_closed(self):
        self.repo_check.stop()
        config = self.tmp / ".aiur/config"
        config.parent.mkdir()
        config.write_text("tracker:\n  github:\n    repo: other/repo\n")
        result = subprocess.CompletedProcess([], 0, stdout=json.dumps({"nameWithOwner": self.cfg["intake_repo"]}))
        with patch.object(ds, "REPO", self.tmp), patch.object(ds.subprocess, "run", return_value=result):
            with self.assertRaises(ValueError):
                ds.verify_intake_repo(self.cfg)
            config.write_text(f"tracker:\n  github:\n    repo: {self.cfg['intake_repo']}\n")
            ds.verify_intake_repo(self.cfg)
            config.write_text("tracker:\n  kind: github\n  github:\n    label_prefix: agent\n")
            ds.verify_intake_repo(self.cfg)
            config.write_text(f'tracker:\n  github:\n    repo: "{self.cfg["intake_repo"]}"\n')
            ds.verify_intake_repo(self.cfg)
            config.write_text('tracker:\n  github:\n    repo: ""\n')
            ds.verify_intake_repo(self.cfg)
            for text in ("tracker:\n  github:\n      repo: other/repo\n",
                         "tracker:\n  github:\n    <<: *defaults\n",
                         'tracker:\n  github:\n    "repo": other/repo\n',
                         'tracker:\n  "github": {repo: other/repo}\n',
                         "tracker:\n  kind: linear\n"):
                config.write_text(text)
                with self.assertRaises(ValueError):
                    ds.verify_intake_repo(self.cfg)

    def test_new_queue_entry_gets_ticket_once_and_old_entries_are_ignored(self):
        called = []
        self.syncer.ticket_filer = lambda cfg, qdir: called.append(qdir)
        self.drive.add_file("FILEINTAKE01", "pack.fbx", ROOT)
        self.poll()
        self.poll(181)
        self.assertEqual(len(called), 1)
        self.assertEqual(json.loads((called[0] / "ticket.json").read_text())["manifest"],
                         self.queue()[0]["manifest"])

    def test_poll_files_and_dispatches_the_new_queue_entry(self):
        self.syncer.ticket_filer = ds.file_intake_ticket
        self.drive.add_file("FILEINTAKE01", "pack.fbx", ROOT)
        created = subprocess.CompletedProcess([], 0, stdout="https://github.com/o/r/issues/42\n")
        ready = subprocess.CompletedProcess([], 0, stdout=json.dumps({"state": "OPEN", "labels": [{"name": "agent:queued"}]}))
        with patch.object(ds.subprocess, "run", side_effect=[created, ready, subprocess.CompletedProcess([], 0)]) as run:
            self.poll()
            self.poll(181)
            self.poll(181)
        self.assertEqual(run.call_count, 3)
        self.assertEqual(run.call_args.args[0], [str(Path.home() / ".local/bin/aiur"), "--todo", "42"])
        record = self.cfg["inbox"] / Path(self.queue()[0]["manifest"]).parent / "ticket.json"
        self.assertTrue(json.loads(record.read_text())["dispatched"])

    def test_ticket_creation_and_dispatch_are_durable(self):
        qdir = self.tmp / "drop"
        qdir.mkdir()
        ds.save_state(qdir / "ticket.json", {"manifest": "quarantine/drop/manifest.json"})
        created = subprocess.CompletedProcess([], 0, stdout="https://github.com/o/r/issues/42\n", stderr="")
        ready = subprocess.CompletedProcess([], 0, stdout=json.dumps({"state": "OPEN", "labels": [{"name": "agent:queued"}]}))
        dispatched = subprocess.CompletedProcess([], 0, stdout="", stderr="")
        with patch.object(ds.subprocess, "run", side_effect=[created, ready, dispatched]) as run:
            ds.file_intake_ticket(self.cfg, qdir)
            ds.file_intake_ticket(self.cfg, qdir)
        self.assertEqual(run.call_count, 3)
        self.assertIn("build-lane:assets", run.call_args_list[0].args[0])
        self.assertIn("agent:queued", run.call_args_list[0].args[0])
        self.assertEqual(run.call_args_list[2].args[0], [str(Path.home() / ".local/bin/aiur"), "--todo", "42"])
        self.assertTrue(json.loads((qdir / "ticket.json").read_text())["dispatched"])

    def test_dispatch_failure_retries_without_creating_another_issue(self):
        qdir = self.tmp / "drop"
        qdir.mkdir()
        ds.save_state(qdir / "ticket.json", {"manifest": "quarantine/drop/manifest.json"})
        created = subprocess.CompletedProcess([], 0, stdout="https://github.com/o/r/issues/42\n", stderr="")
        ready = subprocess.CompletedProcess([], 0, stdout=json.dumps({"state": "OPEN", "labels": [{"name": "agent:queued"}]}))
        with patch.object(ds.subprocess, "run", side_effect=[created, ready, subprocess.CalledProcessError(1, "aiur")]):
            with self.assertRaises(subprocess.CalledProcessError):
                ds.file_intake_ticket(self.cfg, qdir)
        with patch.object(ds.subprocess, "run", side_effect=[ready, subprocess.CompletedProcess([], 0)]) as run:
            ds.file_intake_ticket(self.cfg, qdir)
        self.assertEqual(run.call_args.args[0], [str(Path.home() / ".local/bin/aiur"), "--todo", "42"])

    def test_already_dispatched_ticket_is_not_requeued(self):
        qdir = self.tmp / "drop"
        qdir.mkdir()
        ds.save_state(qdir / "ticket.json", {"manifest": "quarantine/drop/manifest.json", "number": 42})
        running = subprocess.CompletedProcess([], 0, stdout=json.dumps({"state": "OPEN", "labels": [{"name": "agent:in-progress"}]}))
        with patch.object(ds.subprocess, "run", return_value=running) as run:
            ds.file_intake_ticket(self.cfg, qdir)
        self.assertEqual(run.call_count, 1)
        self.assertTrue(json.loads((qdir / "ticket.json").read_text())["dispatched"])

    def test_missing_gh_can_be_retried(self):
        qdir = self.tmp / "drop"
        qdir.mkdir()
        ds.save_state(qdir / "ticket.json", {"manifest": "quarantine/drop/manifest.json"})
        with patch.object(ds.subprocess, "run", side_effect=FileNotFoundError()):
            with self.assertRaises(FileNotFoundError):
                ds.file_intake_ticket(self.cfg, qdir)
        self.assertFalse(json.loads((qdir / "ticket.json").read_text())["creating"])

    def test_bad_credentials_can_be_retried(self):
        qdir = self.tmp / "drop"
        qdir.mkdir()
        ds.save_state(qdir / "ticket.json", {"manifest": "quarantine/drop/manifest.json"})
        failure = subprocess.CalledProcessError(1, "gh", stderr="HTTP 401: Bad credentials")
        with patch.object(ds.subprocess, "run", side_effect=failure):
            with self.assertRaises(subprocess.CalledProcessError):
                ds.file_intake_ticket(self.cfg, qdir)
        self.assertFalse(json.loads((qdir / "ticket.json").read_text())["creating"])

    def test_uncertain_issue_creation_is_not_repeated(self):
        qdir = self.tmp / "drop"
        qdir.mkdir()
        ds.save_state(qdir / "ticket.json", {"manifest": "quarantine/drop/manifest.json"})
        empty = subprocess.CompletedProcess([], 0, stdout="[]", stderr="")
        with patch.object(ds.subprocess, "run", side_effect=[subprocess.TimeoutExpired("gh", 120), empty]) as run:
            with self.assertRaises(subprocess.TimeoutExpired):
                ds.file_intake_ticket(self.cfg, qdir)
            ds.file_intake_ticket(self.cfg, qdir)
        self.assertEqual(run.call_count, 2)
        self.assertEqual(run.call_args.args[0][:3], ["gh", "issue", "list"])

    def test_uncertain_creation_recovers_issue_by_marker(self):
        qdir = self.tmp / "drop"
        qdir.mkdir()
        manifest = "quarantine/drop/manifest.json"
        ds.save_state(qdir / "ticket.json", {"manifest": manifest, "creating": True})
        marker = "ogm-drive-intake-" + hashlib.sha256(manifest.encode()).hexdigest()
        found = subprocess.CompletedProcess([], 0, stdout=json.dumps([
            {"number": 42, "body": f"<!-- {marker} -->"}]), stderr="")
        ready = subprocess.CompletedProcess([], 0, stdout=json.dumps({"state": "OPEN", "labels": [{"name": "agent:queued"}]}))
        with patch.object(ds.subprocess, "run", side_effect=[found, ready, subprocess.CompletedProcess([], 0)]) as run:
            ds.file_intake_ticket(self.cfg, qdir)
        self.assertEqual(run.call_args.args[0], [str(Path.home() / ".local/bin/aiur"), "--todo", "42"])
        self.assertTrue(json.loads((qdir / "ticket.json").read_text())["dispatched"])


class FolderFiltering(Base):
    def test_only_items_under_the_watch_folder_become_drops(self):
        # Kevin shares one folder; anything else the service account can see must be ignored.
        self.poll()  # first run: seeds the page token
        self.drive.add_file("FILEINROOT01", "sfx.zip", ROOT)
        self.drive.add_file("FILEOUTSIDE1", "taxes.pdf", OUTSIDE)
        self.drive.add_folder("SUBFOLDER001", "Castle kit", ROOT)
        self.drive.add_folder("NESTEDFOLD01", "walls", "SUBFOLDER001")
        self.drive.add_file("NESTEDFILE01", "wall.fbx", "NESTEDFOLD01")
        self.poll(10)
        self.assertEqual(set(self.st["drops"]), {"FILEINROOT01", "SUBFOLDER001"})
        self.assertNotIn("FILEOUTSIDE1", self.st["files"])
        # a file deep in a subfolder belongs to the top-level subfolder's drop
        self.assertEqual(self.syncer.drop_of("NESTEDFILE01"), "SUBFOLDER001")

    def test_file_moved_out_of_the_folder_is_dropped_before_download(self):
        self.poll()
        self.drive.add_file("MOVEDFILE001", "oops.zip", ROOT)
        self.poll(10)
        self.drive.move("MOVEDFILE001", OUTSIDE)
        self.poll(10)
        self.assertNotIn("MOVEDFILE001", self.st["files"])
        self.assertEqual(self.drop("MOVEDFILE001")["status"], "removed")
        self.poll(600)
        self.assertEqual(self.drive.downloads, [])

    def test_files_already_in_the_folder_on_first_run_are_picked_up(self):
        # Kevin may drop files before the service is ever started.
        self.drive.add_file("EARLYFILE001", "early.ogg", ROOT, emit=False)
        self.poll()
        self.assertEqual(self.drop("EARLYFILE001")["status"], "pending")
        self.poll(200)
        self.assertEqual(self.drop("EARLYFILE001")["status"], "downloaded")


class Debounce(Base):
    def test_drop_waits_for_quiet_period_after_the_last_change(self):
        # An upload of many files must not be split into half-finished drops.
        self.poll()
        self.drive.add_folder("PACKFOLDER01", "Dungeon pack", ROOT)
        self.drive.add_file("PACKFILE0001", "a.fbx", "PACKFOLDER01")
        self.poll(10)
        self.poll(120)
        self.drive.add_file("PACKFILE0002", "b.fbx", "PACKFOLDER01")  # still uploading
        self.poll(30)   # 160 s after the first file, 0 s after the second
        self.poll(130)  # 290 s after the first, 130 s after the second: not yet
        self.assertEqual(self.drop("PACKFOLDER01")["status"], "pending")
        self.assertEqual(self.drive.downloads, [])
        self.poll(60)   # 190 s quiet
        self.assertEqual(self.drop("PACKFOLDER01")["status"], "downloaded")
        self.assertEqual(sorted(self.drive.downloads), ["PACKFILE0001", "PACKFILE0002"])
        files = self.cfg["inbox"] / "quarantine" / self.drop("PACKFOLDER01")["quarantine"] / "files"
        self.assertTrue((files / "Dungeon pack" / "a.fbx").exists())

    def test_change_seen_only_on_the_second_look_restarts_the_timer(self):
        # Size and checksum must match on two polls in a row, even if the change feed lags.
        self.poll()
        self.drive.add_file("LAGGYFILE001", "big.zip", ROOT, data=b"part")
        self.poll(10)
        self.drive.set_content("LAGGYFILE001", b"part-and-more", emit=False)
        self.poll(200)
        self.assertEqual(self.drop("LAGGYFILE001")["status"], "pending")
        self.assertEqual(self.drive.downloads, [])
        self.poll(200)
        self.assertEqual(self.drop("LAGGYFILE001")["status"], "downloaded")
        self.assertEqual(self.manifest("LAGGYFILE001")["files"][0]["size"], len(b"part-and-more"))

    def test_file_without_checksum_is_never_ready(self):
        self.poll()
        self.drive.add_file("NOMD5FILE001", "uploading.bin", ROOT, md5=False)
        self.poll(10)
        self.poll(400)
        self.assertEqual(self.drop("NOMD5FILE001")["status"], "pending")
        self.assertIn("checksum", self.drop("NOMD5FILE001")["note"])
        self.drive.set_content("NOMD5FILE001", b"done")
        self.poll(10)
        self.poll(200)
        self.assertEqual(self.drop("NOMD5FILE001")["status"], "downloaded")


class Downloads(Base):
    def test_checksum_mismatch_never_marks_a_file_processed(self):
        self.poll()
        self.drive.add_file("CORRUPTFILE1", "x.png", ROOT, data=b"pixels")
        self.drive.corrupt.add("CORRUPTFILE1")
        self.poll(10)
        for _ in range(ds.MAX_DOWNLOAD_ATTEMPTS):
            self.poll(200)
        self.assertEqual(self.drop("CORRUPTFILE1")["status"], "failed")
        self.assertNotIn("CORRUPTFILE1", self.st["processed"])
        self.assertEqual(self.queue(), [])
        self.assertEqual(list((self.cfg["inbox"] / "quarantine").iterdir()), [])
        self.assertTrue(any("failed" in t for t, _ in self.notes))

    def test_google_native_docs_are_skipped_and_do_not_block(self):
        self.poll()
        self.drive.add_folder("MIXEDFOLDER1", "Sounds", ROOT)
        self.drive.add_file("NATIVEDOC001", "notes", "MIXEDFOLDER1", mime="application/vnd.google-apps.document")
        self.drive.add_file("REALFILE0001", "hit.wav", "MIXEDFOLDER1")
        self.drive.add_file("ONLYNATIVE01", "plan", ROOT, mime="application/vnd.google-apps.spreadsheet")
        self.poll(10)
        self.poll(200)
        self.assertEqual(self.drive.downloads, ["REALFILE0001"])
        m = self.manifest("MIXEDFOLDER1")
        self.assertEqual([s["drive_id"] for s in m["skipped"]], ["NATIVEDOC001"])
        self.assertEqual(self.drop("ONLYNATIVE01")["status"], "skipped")

    def test_oversized_drop_is_rejected_not_downloaded(self):
        self.cfg["max_file_mb"] = 1
        self.poll()
        self.drive.add_file("HUGEFILE0001", "huge.zip", ROOT, data=b"0" * (ds.MB + 1))
        self.poll(10)
        self.poll(200)
        self.assertEqual(self.drop("HUGEFILE0001")["status"], "rejected")
        self.assertEqual(self.drive.downloads, [])
        self.assertTrue(any("too large" in t for t, _ in self.notes))

    def test_hostile_drive_names_stay_inside_quarantine(self):
        self.poll()
        self.drive.add_folder("EVILFOLDER01", "..", ROOT)
        self.drive.add_file("EVILFILE0001", "../../escape.txt", "EVILFOLDER01")
        self.drive.add_file("EVILFILE0002", "a/b", "EVILFOLDER01")
        self.drive.add_file("EVILFILE0003", "a/b", "EVILFOLDER01", data=b"other")  # duplicate name
        self.poll(10)
        self.poll(200)
        q = (self.cfg["inbox"] / "quarantine").resolve()
        written = [p for p in self.tmp.rglob("*") if p.is_file()]
        for p in written:
            self.assertTrue(p.resolve().is_relative_to(q) or p.name in ("queue.jsonl", "log"), p)
        m = self.manifest("EVILFOLDER01")
        self.assertEqual(len({f["path"] for f in m["files"]}), 3)
        for f in m["files"]:
            self.assertFalse(os.stat(q / self.drop("EVILFOLDER01")["quarantine"] / "files" / f["path"]).st_mode
                             & stat.S_IXUSR)

    def test_manifest_has_strict_rights_and_queue_entry(self):
        # C2 §10: unknown license => vision-input only, private, no redistribution, until Kevin confirms.
        self.poll()
        self.drive.add_folder("KITFOLDER001", "Kit", ROOT)
        self.drive.add_file("KITLICENSE01", "License.txt", "KITFOLDER001", data=b"CC0")
        self.drive.add_file("KITZIP000001", "models.zip", "KITFOLDER001",
                            data=zip_bytes([("models/orc.glb", b"g"), ("EULA.pdf", b"e")]))
        self.poll(10)
        self.poll(200)
        m = self.manifest("KITFOLDER001")
        self.assertEqual(m["usage_rights"], {"uses": ["vision-input"], "audience": "private",
                                             "redistribution": "none", "attribution": None,
                                             "basis": "unknown", "confirmed_by": None})
        self.assertEqual(m["license"]["status"], "unknown")
        self.assertEqual(m["tagging"]["status"], "pending")
        self.assertIn("Kit/License.txt", m["license_files"])
        self.assertIn("Kit/models.zip!/EULA.pdf", m["license_files"])
        self.assertTrue(m["integrity_ok"])
        [entry] = self.queue()
        self.assertEqual(entry["drop_id"], "KITFOLDER001")
        self.assertTrue((self.cfg["inbox"] / entry["manifest"]).exists())
        # never auto-imported
        self.assertFalse((self.tmp / "packs").exists())

    def test_dry_run_writes_nothing(self):
        self.syncer = self.make_syncer(dry_run=True)
        self.poll()
        self.drive.add_file("DRYFILE00001", "a.ogg", ROOT)
        self.poll(10)
        self.poll(200)
        self.assertEqual(self.drive.downloads, [])
        self.assertFalse(self.cfg["inbox"].exists())


class ReChange(Base):
    def setUp(self):
        super().setUp()
        self.poll()
        self.drive.add_folder("REFOLDER0001", "Props", ROOT)
        self.drive.add_file("REFILE000001", "barrel.fbx", "REFOLDER0001", data=b"v1")
        self.drive.add_file("REFILE000002", "crate.fbx", "REFOLDER0001", data=b"c1")
        self.poll(10)
        self.poll(200)
        self.assertEqual(self.drop("REFOLDER0001")["status"], "downloaded")
        self.drive.downloads.clear()
        self.first_q = self.drop("REFOLDER0001")["quarantine"]

    def test_changed_md5_redownloads_only_that_file(self):
        self.drive.set_content("REFILE000001", b"v2")
        self.poll(10)
        self.assertEqual(self.drop("REFOLDER0001")["status"], "pending")
        self.poll(200)
        self.assertEqual(self.drive.downloads, ["REFILE000001"])
        self.assertNotEqual(self.drop("REFOLDER0001")["quarantine"], self.first_q)
        m = self.manifest("REFOLDER0001")
        self.assertEqual(m["revision"], 1)
        crate = next(f for f in m["files"] if f["drive_id"] == "REFILE000002")
        self.assertEqual((crate["downloaded"], crate["previous_quarantine"]), (False, self.first_q))
        self.assertEqual(len(self.queue()), 2)

    def test_rename_or_same_bytes_never_redownloads(self):
        self.drive.rename("REFILE000002", "crate_renamed.fbx")
        self.drive.set_content("REFILE000001", b"v1")  # touched, same bytes
        self.poll(10)
        self.poll(200)
        self.assertEqual(self.drive.downloads, [])
        self.assertEqual(self.drop("REFOLDER0001")["status"], "downloaded")
        self.assertEqual(len(self.queue()), 1)

    def test_removed_and_readded_file_with_same_bytes_is_not_fetched_again(self):
        self.drive.trash("REFILE000002")
        self.poll(10)
        self.drive.items["REFILE000002"].pop("trashed")
        self.drive._emit("REFILE000002")
        self.poll(10)
        self.poll(200)
        self.assertEqual(self.drive.downloads, [])


class Archives(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp)
        self.cfg = dict(ds.DEFAULTS)

    def write(self, name, data):
        p = self.tmp / name
        p.write_bytes(data)
        return p

    def test_zip_slip_is_rejected(self):
        p = self.write("evil.zip", zip_bytes([("ok.png", b"1"), ("../../.bashrc", b"rm -rf ~")]))
        r = ds.inspect_file(p, "evil.zip", self.cfg)
        self.assertFalse(r["archive"]["ok"])
        self.assertTrue(any("zip-slip" in x for x in r["archive"]["problems"]))
        self.assertFalse((self.tmp.parent / ".bashrc").exists())

    def test_absolute_and_windows_paths_are_rejected(self):
        for bad in ("/etc/cron.d/x", "C:\\Windows\\x.dll", "a\\..\\..\\x"):
            p = self.write("w.zip", zip_bytes([(bad, b"1")]))
            self.assertFalse(ds.check_zip(p, self.cfg)["ok"], bad)

    def test_zip_symlink_is_rejected(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            info = zipfile.ZipInfo("link")
            info.external_attr = (stat.S_IFLNK | 0o777) << 16
            z.writestr(info, "/etc/passwd")
        p = self.write("l.zip", buf.getvalue())
        self.assertTrue(any("symlink" in x for x in ds.check_zip(p, self.cfg)["problems"]))

    def test_corrupt_zip_fails_integrity(self):
        data = bytearray(zip_bytes([("a.txt", b"hello world" * 100)]))
        i = data.find(b"hello")
        data[i:i + 5] = b"HELLO"  # stored entry: content changed, CRC no longer matches
        p = self.write("c.zip", bytes(data))
        self.assertFalse(ds.check_zip(p, self.cfg)["ok"])

    def test_zip_bomb_ratio_is_flagged(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("zeros.bin", b"\0" * (20 * ds.MB))
        p = self.write("bomb.zip", buf.getvalue())
        self.assertTrue(any("ratio" in x for x in ds.check_zip(p, self.cfg)["problems"]))

    def test_good_zip_reports_licenses_nested_archives_and_executables(self):
        p = self.write("g.zip", zip_bytes([("Pack/License.txt", b"CC0"), ("Pack/inner.zip", b"PK"),
                                           ("Pack/setup.exe", b"MZ"), ("Pack/a.fbx", b"f")]))
        r = ds.check_zip(p, self.cfg)
        self.assertTrue(r["ok"])
        self.assertEqual((r["members"], r["license_files"], r["nested_archives"], r["executables"]),
                         (4, ["Pack/License.txt"], ["Pack/inner.zip"], ["Pack/setup.exe"]))

    def test_tar_gz_slip_and_links_are_rejected(self):
        p = self.tmp / "t.unitypackage"
        with tarfile.open(p, "w:gz") as t:
            for name in ("guid/asset", "../escape"):
                ti = tarfile.TarInfo(name)
                ti.size = 1
                t.addfile(ti, io.BytesIO(b"x"))
            ln = tarfile.TarInfo("guid/link")
            ln.type, ln.linkname = tarfile.SYMTYPE, "/etc/passwd"
            t.addfile(ln)
        r = ds.inspect_file(p, "t.unitypackage", self.cfg)
        self.assertEqual(r["archive"]["format"], "tar.gz")
        self.assertTrue(any("zip-slip" in x for x in r["archive"]["problems"]))
        self.assertTrue(any("link" in x for x in r["archive"]["problems"]))

    def test_truncated_tar_gz_fails(self):
        p = self.tmp / "t.tgz"
        with tarfile.open(p, "w:gz") as t:
            ti = tarfile.TarInfo("a.bin")
            data = os.urandom(200_000)
            ti.size = len(data)
            t.addfile(ti, io.BytesIO(data))
        p.write_bytes(p.read_bytes()[:-5000])
        self.assertFalse(ds.inspect_file(p, "t.tgz", self.cfg)["archive"]["ok"])

    @unittest.skipUnless(shutil.which("7z"), "7z not installed")
    def test_7z_good_and_slip(self):
        src = self.tmp / "src"
        (src / "Pack").mkdir(parents=True)
        (src / "Pack" / "LICENSE").write_text("CC0")
        good = self.tmp / "good.7z"
        subprocess.run(["7z", "a", "-bd", str(good), str(src / "Pack")], check=True, capture_output=True)
        r = ds.inspect_file(good, "good.7z", self.cfg)
        self.assertTrue(r["archive"]["ok"], r)
        self.assertEqual(r["archive"]["license_files"], ["Pack/LICENSE"])
        bad = bytearray(good.read_bytes())
        bad[40] ^= 0xFF
        self.assertFalse(ds.inspect_file(self.write("bad.7z", bytes(bad)), "bad.7z", self.cfg)["archive"]["ok"])


class Config(unittest.TestCase):
    def cfg(self, **kw):
        c = {**ds.DEFAULTS, "folder_id": ROOT, **kw}
        for k in ("credentials", "inbox", "state", "log"):
            c[k] = Path(c[k]).expanduser().resolve()
        return c

    def test_secrets_and_state_must_stay_outside_the_repo(self):
        with self.assertRaises(SystemExit):
            ds.validate_config(self.cfg(credentials=str(ds.REPO / "drive-sa.json")))
        with self.assertRaises(SystemExit):
            ds.validate_config(self.cfg(state=str(ds.REPO / "scripts" / "state.json")))

    def test_inbox_in_repo_must_be_under_gitignored_assets_local(self):
        with self.assertRaises(SystemExit):
            ds.validate_config(self.cfg(inbox=str(ds.REPO / "docs" / "inbox")))
        ds.validate_config(self.cfg())  # default inbox under assets-local/ is fine

    def test_folder_id_is_validated(self):
        with self.assertRaises(SystemExit):
            ds.validate_config(self.cfg(folder_id="x' or name contains '"))


if __name__ == "__main__":
    unittest.main()
