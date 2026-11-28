# Drive watch folder (`scripts/py/drive-sync/`)

The local, single-machine version of the Drive watch folder in C2 §7. Kevin drops asset files into one shared Google Drive folder. This listener notices them, waits until the upload has settled, downloads each drop into a fresh quarantine folder under `assets-local/inbox/`, checks it, and queues it for the `gm-asset-intake` skill. It has no AI in it, never runs anything it downloads, never imports into `packs/`, and never changes or deletes anything in Drive. The service account only has read access.

## How it works

1. **Changes.** Every `poll_seconds` (default 45) it calls Drive's `changes.list` with the saved page token. It keeps only items inside the watch folder, including subfolders, by walking each item's parents. On the first run it lists the whole folder, so files dropped before the service started are picked up too.
2. **Drops.** A drop is one top-level item in the watch folder: a single file, or a subfolder and everything in it.
3. **Debounce.** A drop is settled when nothing in it has changed for `quiet_seconds` (default 180). At that point the listener fetches the drop's metadata again straight from Drive. If any name, size or MD5 differs from what it recorded, the quiet period starts over. A file with no MD5 yet keeps the drop waiting.
4. **Download.** Each settled drop goes into a new, empty folder at `assets-local/inbox/quarantine/<UTC time>-<name>-<id>/files/`. Drive names are sanitized, so `..` or `/` in a name can't escape that folder. Every file is checked against Drive's size and MD5, then made read-only and non-executable. A drop with any file over `max_file_mb`, or a total over `max_drop_mb`, is rejected and nothing is downloaded. Google Docs, Sheets and shortcuts have no file bytes, so they are skipped with a log line.
5. **Checks.** Archives are listed and tested without being extracted:
   - zip and tar (including `.unitypackage`, `.tgz` and other compressed tars) with Python's standard library;
   - 7z and rar with the `7z` binary.

   Unsafe paths (absolute, drive letters, `..`), symlinks, device files, encrypted members, CRC or stream errors, zip-bomb compression ratios, and member-count or unpacked-size limits are all recorded as problems. Executables and nested archives are noted.
6. **Manifest and queue.** The listener writes `manifest.json` next to `files/` and appends one line to `assets-local/inbox/queue.jsonl`. The manifest lists Drive ids, names, paths, sizes, MD5s, times, the kind (guessed from the extension), any license-looking files (including ones inside archives), problems and warnings. It also sets strict default rights (C2 §10): `uses: [vision-input]`, `audience: private`, `redistribution: none`, `basis: unknown`. Only the intake skill proposes wider rights, and only Kevin confirms them. The `tagging` block is the hook where the asset-metadata standard (C3) plugs in later.
7. **Intake tickets.** Each new queue entry gets a GitHub issue labelled `build-lane:assets` and `agent:queued`; `aiur --todo` adds the dispatch state. The service needs authenticated `gh`, a running Aiur daemon for this repository, and permission to create issues. `intake_repo` selects the GitHub repository and must match both the checkout and the effective `tracker.github.repo` in its Aiur configuration (or the checkout origin when omitted); ambiguous configuration fails closed. A durable `ticket.json` records the issue and dispatch state; dispatch failures retry on later polls. If issue creation has an uncertain result, the listener searches for its unique marker and never blindly creates a duplicate. If no matching issue appears, inspect the log and reconcile the record before retrying.
8. **Notifications.** Every notice goes to the log, and to `notify-send` if it's installed. Add `"command"` to `notify` to run your own program with the title and body as two arguments. Adding a new notifier means adding one function to `NOTIFIERS`.
9. **Re-changes.** The listener remembers each processed file by Drive id and MD5. If a file in an already-downloaded drop changes its bytes, the drop settles again and only the changed file is downloaded, into a new quarantine folder with a new manifest revision. Unchanged files point to the earlier quarantine folder. Renames, and files touched without their bytes changing, are never downloaded again.

The listener's state (page token, the folders and files it knows about, drops, processed MD5s) is a JSON file outside the repo at `~/.local/state/ogm/drive-sync/state.json`, and so is the log.

### Inbox layout

```
assets-local/inbox/                       # gitignored with the rest of assets-local/
  queue.jsonl                             # one line per downloaded drop (append-only, written by the listener)
  quarantine/<YYYYmmdd-HHMMSS>-<slug>-<id8>/
    manifest.json                         # written by the listener
    files/<drop name>/...                 # downloaded files, read-only
    intake.json                           # written by gm-asset-intake when it has handled the drop
    ticket.json                           # intake issue creation and dispatch state
```

A queue entry is open until `intake.json` exists next to its manifest.

## Run

Commands below use `<repo>` for your OGM checkout; this host keeps it at `~/games/open-game-maker-2000`.

```bash
PY=<repo>/scripts/py/drive-sync/.venv/bin/python
SYNC=<repo>/scripts/py/drive-sync/drive_sync.py
$PY -I $SYNC run --once --dry-run          # read Drive only: no state, files, queue or notifications
$PY -I $SYNC run --once --quiet-seconds 0  # one real poll that downloads anything already settled
$PY -I $SYNC run                           # poll forever (what the systemd unit runs)
$PY -I $SYNC status                        # drops by status, plus queue entries awaiting intake
```

`--config PATH` or `OGM_DRIVE_SYNC_CONFIG` picks another config file. `OGM_DRIVE_SA_KEY` overrides the key path.

## Tests

```bash
python3 -I <repo>/scripts/py/drive-sync/test_drive_sync.py -v
```

The tests use a fake Drive, so they need no network and no Google libraries. They cover folder filtering, debounce, two-look stability, missing checksums, checksum mismatches, size caps, Google-native files, hostile names, zip-slip, symlinks, corrupt or truncated archives, zip bombs, 7z, re-changes, the strict-rights manifest, dry runs, and the config refusing secrets inside the repo.

## One-time setup

All of this is free: the Drive API has no charge, and no billing account is needed. `gcloud` is optional. Each step also says how to do it in the web console.

1. Create a Google Cloud project. Console: <https://console.cloud.google.com/projectcreate>.
   ```bash
   PROJECT=ogm-drive-sync-$RANDOM
   gcloud projects create "$PROJECT" --name="OGM Drive sync" && gcloud config set project "$PROJECT"
   ```
2. Enable the Drive API. Console: APIs & Services > Library > Google Drive API > Enable.
   ```bash
   gcloud services enable drive.googleapis.com
   ```
3. Create the service account. It needs no IAM roles. Console: IAM & Admin > Service Accounts > Create.
   ```bash
   gcloud iam service-accounts create ogm-drive-sync --display-name="OGM Drive sync"
   ```
4. Download its key outside the repo, readable only by you. Console: the service account > Keys > Add key > JSON, then move the file to this path.
   ```bash
   mkdir -p ~/.config/ogm && chmod 700 ~/.config/ogm
   (umask 077; gcloud iam service-accounts keys create ~/.config/ogm/drive-sa.json \
      --iam-account="ogm-drive-sync@$PROJECT.iam.gserviceaccount.com")
   chmod 600 ~/.config/ogm/drive-sa.json
   python3 -c "import json,os; print(json.load(open(os.path.expanduser('~/.config/ogm/drive-sa.json')))['client_email'])"
   ```
5. In Google Drive, create the watch folder. Share it with the email printed above as **Viewer**, and untick "Notify people". Then copy the folder id, which is the part of the folder's URL after `/folders/`.
6. Write the config:
   ```bash
   cp <repo>/scripts/py/drive-sync/drive-sync.example.toml ~/.config/ogm/drive-sync.toml
   sed -i 's/PASTE_FOLDER_ID_HERE/<the folder id>/' ~/.config/ogm/drive-sync.toml
   ```
7. Install the dependencies. On this machine the venv already exists, so this step can be skipped.
   ```bash
   python3 -m venv <repo>/scripts/py/drive-sync/.venv
   <repo>/scripts/py/drive-sync/.venv/bin/pip install -r <repo>/scripts/py/drive-sync/requirements.txt
   ```
8. Verify. Put a small file in the Drive folder, then:
   ```bash
   PY=<repo>/scripts/py/drive-sync/.venv/bin/python
   SYNC=<repo>/scripts/py/drive-sync/drive_sync.py
   $PY -I $SYNC run --once --dry-run           # should log: watching '<folder>' as <sa email>
   $PY -I $SYNC run --once --quiet-seconds 0   # downloads it into assets-local/inbox/quarantine/
   $PY -I $SYNC status
   ```
9. Run it in the background. `ops/bin/ogm-host-setup.sh` (setup step 1) already installed and enabled `ogm-drive-sync`, which runs `ops/bin/ogm-run drive-sync`; it waits as a placeholder until the venv, `~/.config/ogm/drive-sync.toml` and `~/.config/ogm/drive-sa.json` exist. Restart it once they do (the `ogm-drive-sync.service` in this folder is the older standalone unit):
   ```bash
   systemctl --user restart ogm-drive-sync
   systemctl --user status ogm-drive-sync     # no PLACEHOLDER line
   journalctl --user -u ogm-drive-sync -f
   ```
   To keep it running while logged out, run `loginctl enable-linger $USER`. Desktop notifications only appear while you're logged into a desktop session.

## Limits of this local version

- Polling only. Drive push notifications (`changes.watch`) need a public HTTPS endpoint, so they come later with the hosted product.
- If the process stops after appending to the queue but before saving its state, the next run downloads that drop again and queues it twice. The duplicate gets a new quarantine folder, and the intake skill should ignore a drop id + MD5 set it has already handled.
- A drop stuck without an MD5 waits forever. `status` shows it with a note.
- Folder names and file names are only sanitized, not deduplicated across case. A file and a folder with the same name in the same Drive folder make that drop fail loudly.
